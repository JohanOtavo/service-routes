import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { currentDb } from '@punto-amigo/service-kit';
import { Servicio, type CriteriosBusqueda, type EstadoServicio } from '../../domain';
import type { IServicioRepository, Pagina, ServicioListado } from '../../application/ports';

/** Fila de `pa_catalog.servicio`, tal como la devuelve el motor. */
interface FilaServicio {
  id_servicio: number;
  nombre_servicio: string;
  descripcion: string;
  id_prestador: number;
  id_categoria: number;
  estado: string;
  deleted_at: Date | null;
}

/** Fila de la busqueda: el servicio mas lo que se muestra junto a el. */
interface FilaListado extends FilaServicio {
  prestador_nombre: string;
  prestador_especialidad: string | null;
  puntuacion_media: string | number | null;
  total_calificaciones: number | null;
}

const COLUMNAS = [
  'servicio.id_servicio',
  'servicio.nombre_servicio',
  'servicio.descripcion',
  'servicio.id_prestador',
  'servicio.id_categoria',
  'servicio.estado',
  'servicio.deleted_at',
] as const;

/** Lo que se anade a `COLUMNAS` para pintar una fila de resultados. */
const COLUMNAS_LISTADO = [
  'prestador_ref.nombre as prestador_nombre',
  'prestador_ref.especialidad as prestador_especialidad',
  'service_rating_summary.puntuacion_media',
  'service_rating_summary.total_calificaciones',
] as const;

export class KnexServicioRepository implements IServicioRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Conexion a usar: la transaccion en curso si la hay.
   *
   * Es lo que permite que el cambio del servicio y su evento en el outbox se
   * confirmen juntos. Usar `this.knex` directamente escribiria por fuera de la
   * transaccion y rompia esa garantia sin avisar.
   */
  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  /**
   * El filtro de borrado logico va en SQL y no despues de cargar.
   *
   * Un servicio borrado no existe para nadie, asi que traerlo para descartarlo
   * solo gasta trabajo.
   *
   * INACTIVE no se filtra: es un ESTADO, no un borrado. Su dueno tiene que
   * poder verlo en su propio catalogo para saber que sigue ahi.
   */
  async findById(id: number): Promise<Servicio | null> {
    const fila = await this.db<FilaServicio>('servicio')
      .select(...COLUMNAS)
      .where('servicio.id_servicio', id)
      .whereNull('servicio.deleted_at')
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  async save(servicio: Servicio, creadoPor: number): Promise<Servicio> {
    const datos = servicio.toJSON();

    const [id] = await this.db('servicio').insert({
      nombre_servicio: datos['nombre'],
      descripcion: datos['descripcion'],
      id_prestador: datos['idPrestador'],
      id_categoria: datos['idCategoria'],
      estado: datos['estado'],
      created_by: creadoPor,
    });

    /**
     * El resumen de calificaciones nace con el servicio, en cero.
     *
     * Sin esta fila, la primera calificacion no tendria donde sumarse:
     * `acumular` hace un UPDATE y devolveria "no habia servicio", de modo que la
     * calificacion se perderia sin que nada fallara. Crearla aqui, en la misma
     * transaccion que el alta, convierte "todo servicio tiene resumen" en un
     * invariante en lugar de en una esperanza.
     */
    await this.db('service_rating_summary').insert({
      id_servicio: Number(id),
      puntuacion_media: 0,
      total_calificaciones: 0,
    });

    const guardado = await this.findById(Number(id));
    if (guardado === null) {
      // Imposible salvo que algo borre la fila entre el INSERT y el SELECT,
      // dentro de la misma transaccion. Si ocurre, es un error del sistema.
      throw new Error('El servicio recien insertado no se pudo leer.');
    }
    return guardado;
  }

  async update(servicio: Servicio): Promise<void> {
    const datos = servicio.toJSON();

    const afectadas = await this.db('servicio')
      .where({ id_servicio: datos['id'] })
      .whereNull('deleted_at')
      .update({
        nombre_servicio: datos['nombre'],
        descripcion: datos['descripcion'],
        id_categoria: datos['idCategoria'],
        estado: datos['estado'],
      });

    // Cero filas significa que el servicio se borro entre la lectura y la
    // escritura. Confirmar la transaccion como si todo hubiera ido bien dejaria
    // un evento en el outbox anunciando un cambio que no ocurrio.
    if (afectadas === 0) {
      throw AppError.conflict('El servicio cambio o se elimino mientras se editaba.');
    }
  }

  /**
   * Lo que la busqueda publica considera visible.
   *
   * Dos condiciones y no una: el servicio tiene que estar activo Y su prestador
   * tambien. Sin la segunda, suspender a un prestador no retiraria su catalogo,
   * y la suspension solo serviria para que no pudiera publicar MAS.
   *
   * El INNER JOIN contra `prestador_ref` no es un adorno: un servicio cuyo
   * prestador todavia no se replico no se puede pintar —faltaria el nombre— y
   * es preferible que no aparezca a que aparezca a medias.
   */
  private visibles(q: Knex.QueryBuilder): Knex.QueryBuilder {
    return q
      .innerJoin('prestador_ref', 'prestador_ref.id_prestador', 'servicio.id_prestador')
      .where('servicio.estado', 'ACTIVE')
      .whereNull('servicio.deleted_at')
      .where('prestador_ref.estado', 'ACTIVE');
  }

  /**
   * El agregado de calificaciones va en LEFT JOIN.
   *
   * Un servicio recien publicado no tiene fila en `service_rating_summary`, y
   * con un INNER JOIN desapareceria de la busqueda hasta que alguien lo
   * calificara: el catalogo nuevo quedaria invisible justo cuando mas necesita
   * verse.
   */
  private conResumen(q: Knex.QueryBuilder): Knex.QueryBuilder {
    return q.leftJoin(
      'service_rating_summary',
      'service_rating_summary.id_servicio',
      'servicio.id_servicio'
    );
  }

  /**
   * Filtros de la busqueda publica (SRS RF45 a RF49).
   *
   * El texto usa el indice FULLTEXT que la migracion creo para esto, con el
   * termino como PARAMETRO: nunca se concatena al SQL. Se consulta en modo
   * lenguaje natural y no booleano a proposito: en modo booleano los caracteres
   * `+ - * " ~ ( ) <` que el usuario escriba son operadores de la sintaxis de
   * busqueda, y una comilla suelta hace que MySQL rechace la consulta entera.
   *
   * Limitacion conocida: el modo lenguaje natural ignora palabras mas cortas
   * que `innodb_ft_min_token_size` (3 por omision), asi que buscar "tv" no
   * devuelve nada. Queda anotado; cambiarlo es configuracion del motor, no de
   * esta consulta.
   */
  private filtrar(q: Knex.QueryBuilder, criterios: CriteriosBusqueda): Knex.QueryBuilder {
    let consulta = this.visibles(q);

    if (criterios.texto !== undefined) {
      consulta = consulta.whereRaw(
        'MATCH(`servicio`.`nombre_servicio`, `servicio`.`descripcion`) AGAINST (? IN NATURAL LANGUAGE MODE)',
        [criterios.texto]
      );
    }
    if (criterios.idCategoria !== undefined) {
      consulta = consulta.where('servicio.id_categoria', criterios.idCategoria);
    }
    if (criterios.idPrestador !== undefined) {
      consulta = consulta.where('servicio.id_prestador', criterios.idPrestador);
    }

    return consulta;
  }

  /**
   * Busqueda paginada.
   *
   * El filtro se aplica dos veces —una para contar y otra para traer la
   * pagina— a partir de la MISMA funcion, para que no puedan divergir: un total
   * calculado con otro filtro produce paginas vacias al final.
   *
   * El conteo no arrastra el LEFT JOIN del resumen: no cambia el numero de
   * filas y solo le daria trabajo de mas al motor.
   */
  async buscar(criterios: CriteriosBusqueda): Promise<Pagina<ServicioListado>> {
    const conteo = (await this.filtrar(this.db('servicio'), criterios).count({
      total: 'servicio.id_servicio',
    })) as unknown as { total: number }[];

    const filas = (await this.conResumen(this.filtrar(this.db('servicio'), criterios))
      .select(...COLUMNAS, ...COLUMNAS_LISTADO)
      // Mejor calificados primero (SRS RF53); el identificador desempata para
      // que la misma consulta devuelva siempre el mismo orden y la paginacion
      // no repita ni se salte filas.
      .orderBy([
        { column: 'service_rating_summary.puntuacion_media', order: 'desc' },
        { column: 'service_rating_summary.total_calificaciones', order: 'desc' },
        { column: 'servicio.id_servicio', order: 'desc' },
      ])
      .limit(criterios.tamano)
      .offset((criterios.pagina - 1) * criterios.tamano)) as unknown as FilaListado[];

    return {
      elementos: filas.map((f) => this.aListado(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina: criterios.pagina,
      tamano: criterios.tamano,
    };
  }

  /**
   * Ficha publica de un servicio.
   *
   * Pasa por `visibles`, el mismo filtro que la busqueda: si solo comprobara el
   * estado del servicio, el de un prestador suspendido seguiria siendo
   * accesible por su enlace directo aunque hubiera desaparecido del listado.
   * Devuelve null y el caso de uso lo traduce a 404, nunca a 403: un 403
   * confirmaria que ese servicio existe.
   */
  async verPublico(id: number): Promise<ServicioListado | null> {
    const fila = (await this.conResumen(this.visibles(this.db('servicio')))
      .select(...COLUMNAS, ...COLUMNAS_LISTADO)
      .where('servicio.id_servicio', id)
      .first()) as unknown as FilaListado | undefined;

    return fila === undefined ? null : this.aListado(fila);
  }

  /**
   * El catalogo propio del oferente (SRS RF52).
   *
   * Incluye los INACTIVE: su dueno tiene que verlos para saber que siguen ahi y
   * poder reactivarlos. Lo que si se excluye es el borrado logico, que no es un
   * estado sino una baja.
   *
   * No pasa por `visibles` ni trae el resumen de calificaciones: es la vista de
   * gestion, no el escaparate.
   */
  async listarDePrestador(
    idPrestador: number,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Servicio>> {
    const filtrar = (q: Knex.QueryBuilder): Knex.QueryBuilder =>
      q.where('servicio.id_prestador', idPrestador).whereNull('servicio.deleted_at');

    const conteo = (await filtrar(this.db('servicio')).count({
      total: 'servicio.id_servicio',
    })) as unknown as { total: number }[];

    const filas = (await filtrar(this.db('servicio'))
      .select(...COLUMNAS)
      .orderBy('servicio.id_servicio', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as FilaServicio[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  private aDominio(fila: FilaServicio): Servicio {
    return Servicio.rehydrate({
      id: Number(fila.id_servicio),
      nombre: fila.nombre_servicio,
      descripcion: fila.descripcion,
      idPrestador: Number(fila.id_prestador),
      idCategoria: Number(fila.id_categoria),
      // El CHECK de la columna garantiza el conjunto de valores. Si alguien lo
      // cambiara, el dominio fallaria en la primera transicion y no en silencio.
      estado: fila.estado as EstadoServicio,
      deletedAt: fila.deleted_at,
    });
  }

  /**
   * Un servicio sin calificaciones sale con media 0 y total 0, no con null.
   *
   * Es el LEFT JOIN hablando: no hay fila en el resumen todavia. Devolver null
   * obligaria a cada consumidor a decidir que hacer con el, y el primero que lo
   * olvidara pintaria "null estrellas" en el catalogo.
   */
  private aListado(fila: FilaListado): ServicioListado {
    return {
      servicio: this.aDominio(fila),
      nombrePrestador: fila.prestador_nombre,
      especialidadPrestador: fila.prestador_especialidad,
      // DECIMAL llega como cadena desde el motor.
      puntuacionMedia: Number(fila.puntuacion_media ?? 0),
      totalCalificaciones: Number(fila.total_calificaciones ?? 0),
    };
  }
}
