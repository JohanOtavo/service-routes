import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { currentDb } from '@punto-amigo/service-kit';
import {
  Necesidad,
  type EstadoNecesidad,
  type FiltrosNecesidad,
  type INecesidadRepository,
  type Pagina,
} from '../../domain';

interface FilaNecesidad {
  id_necesidad: number;
  titulo: string;
  descripcion: string;
  id_usuario: number;
  id_categoria: number;
  presupuesto_estimado: string | null;
  fecha_deseada: Date | null;
  ubicacion_aproximada: string | null;
  estado: string;
  fecha_publicacion: Date;
  fecha_vigencia: Date;
}

const COLUMNAS = [
  'id_necesidad',
  'titulo',
  'descripcion',
  'id_usuario',
  'id_categoria',
  'presupuesto_estimado',
  'fecha_deseada',
  'ubicacion_aproximada',
  'estado',
  'fecha_publicacion',
  'fecha_vigencia',
] as const;

export class KnexNecesidadRepository implements INecesidadRepository {
  constructor(private readonly knex: Knex) {}

  /** La transaccion en curso si la hay: el cambio y su evento van juntos. */
  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async findById(id: number): Promise<Necesidad | null> {
    const fila = await this.db<FilaNecesidad>('necesidad')
      .select(...COLUMNAS)
      .where({ id_necesidad: id })
      .whereNull('deleted_at')
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  async save(necesidad: Necesidad, creadoPor: number): Promise<Necesidad> {
    const d = necesidad.toOwnerJSON();

    const [id] = await this.db('necesidad').insert({
      titulo: d['titulo'],
      descripcion: d['descripcion'],
      id_usuario: d['idUsuario'],
      id_categoria: d['idCategoria'],
      presupuesto_estimado: d['presupuestoEstimado'],
      fecha_deseada: d['fechaDeseada'],
      ubicacion_aproximada: d['ubicacionAproximada'],
      estado: d['estado'],
      fecha_publicacion: d['fechaPublicacion'],
      fecha_vigencia: d['fechaVigencia'],
      created_by: creadoPor,
    });

    const guardada = await this.findById(Number(id));
    if (guardada === null) {
      throw new Error('La necesidad recien insertada no se pudo leer.');
    }
    return guardada;
  }

  async update(necesidad: Necesidad, motivoCierre: string | null = null): Promise<void> {
    const d = necesidad.toOwnerJSON();

    const afectadas = await this.db('necesidad')
      .where({ id_necesidad: d['id'] })
      .whereNull('deleted_at')
      .update({
        titulo: d['titulo'],
        descripcion: d['descripcion'],
        presupuesto_estimado: d['presupuestoEstimado'],
        estado: d['estado'],
        fecha_vigencia: d['fechaVigencia'],
        ...(motivoCierre === null ? {} : { motivo_cierre: motivoCierre }),
      });

    // Cero filas significa que desaparecio entre la lectura y la escritura.
    // Confirmar la transaccion dejaria un evento anunciando un cambio que no fue.
    if (afectadas === 0) {
      throw AppError.conflict('La necesidad cambio o se elimino mientras se editaba.');
    }
  }

  /**
   * Cuantas tiene abiertas Y vigentes.
   *
   * La vigencia entra en la cuenta a proposito: una necesidad que ya vencio no
   * deberia seguir ocupando una plaza del limite. El estado VENCIDA lo pone un
   * proceso programado, asi que entre el vencimiento y ese proceso hay una
   * ventana en la que el estado todavia dice ABIERTA.
   */
  async contarAbiertasDe(idUsuario: number, ahora: Date): Promise<number> {
    const filas = (await this.db('necesidad')
      .where({ id_usuario: idUsuario, estado: 'ABIERTA' })
      .where('fecha_vigencia', '>', ahora)
      .whereNull('deleted_at')
      .count({ total: '*' })) as unknown as { total: number }[];

    return Number(filas[0]?.total ?? 0);
  }

  async listarAbiertas(
    filtros: FiltrosNecesidad,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Necesidad>> {
    const ahora = new Date();
    const texto = filtros.texto?.trim();

    return this.paginar(
      (q) => {
        let base = q
          .where({ estado: 'ABIERTA' })
          .where('fecha_vigencia', '>', ahora)
          .whereNull('deleted_at');

        if (filtros.idCategoria !== undefined) {
          base = base.where({ id_categoria: filtros.idCategoria });
        }
        if (texto !== undefined && texto.length > 0) {
          // Knex parametriza el LIKE: el comodin se concatena al VALOR, nunca
          // al SQL, asi que el texto del usuario no puede inyectar nada.
          base = base.where((w) =>
            w.whereLike('titulo', '%' + texto + '%').orWhereLike('descripcion', '%' + texto + '%')
          );
        }
        return base;
      },
      // Las mas recientes primero: una necesidad lleva poco tiempo util.
      (q) => q.orderBy('fecha_publicacion', 'desc'),
      pagina,
      tamano
    );
  }

  async listarDeAutor(idUsuario: number, pagina: number, tamano: number): Promise<Pagina<Necesidad>> {
    return this.paginar(
      (q) => q.where({ id_usuario: idUsuario }).whereNull('deleted_at'),
      (q) => q.orderBy('fecha_publicacion', 'desc'),
      pagina,
      tamano
    );
  }

  /**
   * El filtro se aplica dos veces —contar y traer— desde la MISMA funcion, para
   * que no puedan divergir: un total calculado con otro filtro produce una
   * paginacion con paginas vacias al final.
   */
  private async paginar(
    filtrar: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
    ordenar: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Necesidad>> {
    const conteo = (await filtrar(this.db('necesidad')).count({ total: '*' })) as unknown as {
      total: number;
    }[];

    const filas = (await ordenar(filtrar(this.db('necesidad')).select(...COLUMNAS))
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as FilaNecesidad[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  private aDominio(fila: FilaNecesidad): Necesidad {
    return Necesidad.rehydrate({
      id: Number(fila.id_necesidad),
      titulo: fila.titulo,
      descripcion: fila.descripcion,
      idUsuario: Number(fila.id_usuario),
      idCategoria: Number(fila.id_categoria),
      // DECIMAL llega como cadena y asi se queda: convertirlo a number perderia
      // precision en los importes, que es justo lo que DECIMAL evita.
      presupuestoEstimado: fila.presupuesto_estimado,
      fechaDeseada: fila.fecha_deseada,
      ubicacionAproximada: fila.ubicacion_aproximada,
      // El CHECK de la columna garantiza el conjunto de valores.
      estado: fila.estado as EstadoNecesidad,
      fechaPublicacion: fila.fecha_publicacion,
      fechaVigencia: fila.fecha_vigencia,
    });
  }
}
