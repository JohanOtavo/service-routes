import { EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  exigirPerfil,
  normalizarPaginacion,
  type EstadoPrestador,
  type IPrestadorRepository,
  type IValidationLogRepository,
  type Prestador,
} from '../../domain';

/**
 * Revision administrativa de perfiles (SRS RF26, RF27, RF29, RF30).
 *
 * Quien ejecuta llega resuelto desde el borde, que ya exigio el rol
 * ADMINISTRADOR. Aqui no se vuelve a comprobar el rol, pero si se registra
 * QUIEN actuo en cada asiento: sin eso la bitacora de RF26 y RF27 no sirve para
 * rendir cuentas, que es la unica razon de que exista.
 */
export class ReviewProviderProfileUseCase {
  constructor(
    private readonly prestadores: IPrestadorRepository,
    private readonly bitacora: IValidationLogRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  /** Cola de revision, los mas antiguos primero (SRS RF26). */
  async listarPendientes(entrada: {
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);
    const resultado = await this.prestadores.listarPendientes(pagina, tamano);

    return {
      // Vista privada: el administrador necesita ver el contacto para poder
      // comprobar lo que el perfil afirma.
      elementos: resultado.elementos.map((p) => p.vistaPrivada()),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }

  /** Ficha completa de un perfil, para revisarlo. */
  async ver(idPrestador: number): Promise<Record<string, unknown>> {
    const prestador = await exigirPerfil(this.prestadores, idPrestador);
    return prestador.vistaPrivada();
  }

  /**
   * Validacion: el perfil entra en servicio y pasa a ser visible (SRS RF26).
   *
   * Emite dos eventos distintos a proposito. `ServiceProviderProfileValidated`
   * es el hecho de negocio —hay un prestador nuevo disponible— y lo consume la
   * notificacion; `ProviderStatusChanged` es el cambio de estado y lo consume el
   * catalogo, al que solo le importa si debe mostrar el perfil o no. Fundirlos
   * obligaria a cada consumidor a mirar el payload para saber si le interesa.
   */
  async validar(entrada: {
    idPrestador: number;
    idAdministrador: number;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const prestador = await exigirPerfil(this.prestadores, entrada.idPrestador);
    const anterior = prestador.validar();

    await this.prestadores.update(prestador);
    await this.asentar(prestador, anterior, entrada.idAdministrador, null);

    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceProviderProfileValidated,
        aggregateType: 'Prestador',
        aggregateId: prestador.id,
        payload: {
          idPrestador: prestador.id,
          idUsuario: prestador.idUsuario,
          nombre: prestador.nombre,
          especialidad: prestador.especialidad,
          validadoPor: entrada.idAdministrador,
        },
      },
      entrada.correlationId
    );
    await this.publicarCambioDeEstado(prestador, anterior, entrada.correlationId);

    return prestador.vistaPrivada();
  }

  /**
   * Rechazo (SRS RF27).
   *
   * El motivo es obligatorio y lo exige el dominio. Va a la bitacora y al
   * payload del evento, que es como el oferente se enterara de por que: un
   * rechazo sin explicacion solo produce un segundo intento identico.
   */
  async rechazar(entrada: {
    idPrestador: number;
    motivo: string;
    idAdministrador: number;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const prestador = await exigirPerfil(this.prestadores, entrada.idPrestador);
    const anterior = prestador.rechazar(entrada.motivo);

    await this.prestadores.update(prestador);
    await this.asentar(prestador, anterior, entrada.idAdministrador, entrada.motivo);
    await this.publicarCambioDeEstado(prestador, anterior, entrada.correlationId, entrada.motivo);

    return prestador.vistaPrivada();
  }

  /**
   * Cambio de estado pedido por un administrador (SRS RF29, RF30).
   *
   * El destino lo valida el dominio contra la tabla de transiciones. Aqui no se
   * repite esa comprobacion: duplicarla crearia dos tablas que divergen.
   */
  async cambiarEstado(entrada: {
    idPrestador: number;
    destino: EstadoPrestador;
    motivo: string | null;
    idAdministrador: number;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const prestador = await exigirPerfil(this.prestadores, entrada.idPrestador);
    const anterior = prestador.cambiarEstado(entrada.destino);

    await this.prestadores.update(prestador);
    await this.asentar(prestador, anterior, entrada.idAdministrador, entrada.motivo);
    await this.publicarCambioDeEstado(
      prestador,
      anterior,
      entrada.correlationId,
      entrada.motivo ?? undefined
    );

    return prestador.vistaPrivada();
  }

  private async asentar(
    prestador: Prestador,
    anterior: EstadoPrestador,
    validadoPor: number,
    motivo: string | null
  ): Promise<void> {
    await this.bitacora.registrar({
      idPrestador: prestador.id,
      estadoAnterior: anterior,
      estadoNuevo: prestador.estado,
      validadoPor,
      motivo,
      registradoAt: this.clock.now(),
    });
  }

  /**
   * Cambio de estado para los demas servicios.
   *
   * El motivo viaja porque la notificacion lo necesita para contarle al oferente
   * que paso. Queda escrito aqui que el catalogo NO debe mostrarlo: el motivo de
   * una suspension es informacion interna entre el administrador y el afectado.
   */
  private async publicarCambioDeEstado(
    prestador: Prestador,
    anterior: EstadoPrestador,
    correlationId: string,
    motivo?: string
  ): Promise<void> {
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
          visible: prestador.esVisiblePublicamente,
          ...(motivo === undefined ? {} : { motivo }),
        },
      },
      correlationId
    );
  }
}
