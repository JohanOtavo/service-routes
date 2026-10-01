import { AppError, EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  Prestador,
  exigirPerfil,
  normalizarPaginacion,
  type DatosPerfil,
  type IPrestadorRepository,
  type IValidationLogRepository,
} from '../../domain';

/**
 * Operaciones que hace el OFERENTE sobre su propio perfil (SRS RF22 a RF25, RF28).
 *
 * Ninguna se fia del identificador que llega en la ruta para decidir la
 * propiedad: todas pasan por el dominio, que compara el dueno. El borde HTTP
 * sabe que quien llama tiene el rol OFERENTE, no que sea el dueno de ESTE
 * perfil, y confundir las dos cosas es exactamente un IDOR.
 */
export class ManageProviderProfileUseCase {
  constructor(
    private readonly prestadores: IPrestadorRepository,
    private readonly bitacora: IValidationLogRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  /**
   * Alta del perfil (SRS RF22, RF23, RF24).
   *
   * Nace PENDING_VALIDATION; el estado no es parametro. La unicidad por usuario
   * la garantiza el UNIQUE de la base y el repositorio traduce el choque, asi
   * que aqui no se consulta antes: entre la consulta y el INSERT cabe otra
   * peticion y la comprobacion previa daria una falsa sensacion de seguridad.
   */
  async crear(entrada: {
    idUsuario: number;
    datos: DatosPerfil;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const prestador = Prestador.crear({ idUsuario: entrada.idUsuario, ...entrada.datos });
    const guardado = await this.prestadores.save(prestador, entrada.idUsuario);

    // Primer asiento de la bitacora: deja constancia de que el perfil entro en
    // la cola de revision y cuando, que es lo que RF26 audita.
    await this.bitacora.registrar({
      idPrestador: guardado.id,
      estadoAnterior: null,
      estadoNuevo: guardado.estado,
      validadoPor: entrada.idUsuario,
      motivo: null,
      registradoAt: this.clock.now(),
    });

    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceProviderProfileCreated,
        aggregateType: 'Prestador',
        aggregateId: guardado.id,
        payload: {
          idPrestador: guardado.id,
          idUsuario: guardado.idUsuario,
          nombre: guardado.nombre,
          especialidad: guardado.especialidad,
          estado: guardado.estado,
        },
      },
      entrada.correlationId
    );

    return guardado.vistaPrivada();
  }

  /**
   * Edicion por su dueno (SRS RF28).
   *
   * El evento sale siempre que la operacion llega hasta aqui, aunque los
   * valores coincidan con los anteriores: comparar campo a campo para ahorrar
   * un evento obligaria a recordar el estado previo completo, y el consumidor
   * del catalogo es idempotente de todas formas.
   */
  async editar(entrada: {
    idPrestador: number;
    idUsuario: number;
    cambios: Partial<DatosPerfil>;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const prestador = await exigirPerfil(this.prestadores, entrada.idPrestador);

    prestador.editar(entrada.idUsuario, entrada.cambios);
    await this.prestadores.update(prestador);

    /**
     * El catalogo guarda una copia del nombre y la especialidad en
     * `prestador_ref`. Sin este evento se queda con los datos antiguos para
     * siempre y publica informacion que ya no es cierta.
     */
    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceProviderProfileUpdated,
        aggregateType: 'Prestador',
        aggregateId: prestador.id,
        payload: {
          idPrestador: prestador.id,
          idUsuario: prestador.idUsuario,
          nombre: prestador.nombre,
          especialidad: prestador.especialidad,
          estado: prestador.estado,
        },
      },
      entrada.correlationId
    );

    return prestador.vistaPrivada();
  }

  /** Su propio perfil, con datos de contacto incluidos. */
  async verPropio(idUsuario: number): Promise<Record<string, unknown>> {
    const prestador = await this.prestadores.findByUsuario(idUsuario);
    if (prestador === null) {
      throw AppError.notFound('Todavia no tiene un perfil de prestador.');
    }
    return prestador.vistaParaDueno(idUsuario);
  }

  /**
   * Perfil publico de un prestador (SRS RF25).
   *
   * Un perfil que no es visible publicamente da 404 y no 403. Un 403 confirma
   * que el perfil existe, y con eso se recorre el rango de identificadores para
   * saber quien esta suspendido o en revision.
   */
  async verPublico(idPrestador: number): Promise<Record<string, unknown>> {
    const prestador = await exigirPerfil(this.prestadores, idPrestador);

    if (!prestador.esVisiblePublicamente) {
      throw AppError.notFound('El perfil de prestador no existe.');
    }
    return prestador.vistaPublica();
  }

  /** Directorio publico, acotado y filtrable por especialidad (SRS RF25). */
  async listarPublicos(entrada: {
    especialidad?: string | undefined;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);
    const resultado = await this.prestadores.listarVisibles(
      { especialidad: entrada.especialidad },
      pagina,
      tamano
    );

    return {
      elementos: resultado.elementos.map((p) => p.vistaPublica()),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }

  /**
   * Retirada voluntaria del catalogo (SRS RF29).
   *
   * Pasa a INACTIVE, que NO es un borrado: la bitacora y el historial de
   * contrataciones siguen existiendo. Para volver, el perfil pasa otra vez por
   * la cola de validacion.
   */
  async retirar(entrada: {
    idPrestador: number;
    idUsuario: number;
    correlationId: string;
  }): Promise<void> {
    const prestador = await exigirPerfil(this.prestadores, entrada.idPrestador);

    // La propiedad se comprueba por el mismo camino que la edicion: leer el
    // perfil de otro y retirarlo seria el IDOR mas caro de todos.
    prestador.vistaParaDueno(entrada.idUsuario);

    const anterior = prestador.cambiarEstado('INACTIVE');
    await this.prestadores.update(prestador);

    await this.bitacora.registrar({
      idPrestador: prestador.id,
      estadoAnterior: anterior,
      estadoNuevo: prestador.estado,
      validadoPor: entrada.idUsuario,
      motivo: 'RETIRADA_VOLUNTARIA',
      registradoAt: this.clock.now(),
    });

    await this.eventos.enqueue(
      {
        eventName: EventName.ProviderStatusChanged,
        aggregateType: 'Prestador',
        aggregateId: prestador.id,
        payload: {
          idPrestador: prestador.id,
          idUsuario: prestador.idUsuario,
          estadoAnterior: anterior,
          estado: prestador.estado,
        },
      },
      entrada.correlationId
    );
  }
}
