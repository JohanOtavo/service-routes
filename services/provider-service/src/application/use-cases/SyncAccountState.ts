import { EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  MOTIVOS_SISTEMA,
  type IPrestadorRepository,
  type IValidationLogRepository,
} from '../../domain';

/**
 * Arrastre de la suspension de la cuenta al perfil de prestador (SRS RF32).
 *
 * Lo invoca el consumidor de `UserAccountSuspended`, dentro de la transaccion
 * que tambien escribe la marca de "evento ya procesado". Por eso no abre
 * transaccion propia: hacerlo separaria el efecto de su marca y una entrega
 * repetida volveria a aplicarlo.
 */
export class SyncAccountStateUseCase {
  constructor(
    private readonly prestadores: IPrestadorRepository,
    private readonly bitacora: IValidationLogRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  /**
   * Suspende el perfil del usuario suspendido.
   *
   * Que el usuario no tenga perfil NO es un error: la mayoria de las cuentas
   * suspendidas seran de solicitantes, que nunca crearon uno. Lanzar aqui
   * mandaria esos eventos a la cola de fallidos sin que nada estuviera mal.
   *
   * Tampoco lo es que el perfil ya estuviera suspendido, retirado o sin
   * validar: el dominio devuelve `false` y entonces no se emite nada, para no
   * llenar la bandeja del oferente de avisos identicos por cada reentrega.
   */
  async alSuspenderCuenta(entrada: {
    idUsuario: number;
    motivo: string;
    correlationId: string;
  }): Promise<void> {
    const prestador = await this.prestadores.findByUsuario(entrada.idUsuario);
    if (prestador === null) return;

    const anterior = prestador.estado;
    if (!prestador.suspenderPorCuentaSuspendida()) return;

    await this.prestadores.update(prestador);

    await this.bitacora.registrar({
      idPrestador: prestador.id,
      estadoAnterior: anterior,
      estadoNuevo: prestador.estado,
      // Lo arrastro el sistema, no un administrador revisando este perfil.
      // Se atribuye al propio usuario para no inventar un actor que no existe.
      validadoPor: entrada.idUsuario,
      motivo: MOTIVOS_SISTEMA.cuentaSuspendida,
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
          visible: prestador.esVisiblePublicamente,
          motivo: MOTIVOS_SISTEMA.cuentaSuspendida,
        },
      },
      entrada.correlationId
    );
  }

  /**
   * La reactivacion de la cuenta NO devuelve el perfil a ACTIVE.
   *
   * RF32 define el arrastre en un solo sentido y no dice nada del contrario, y
   * el silencio aqui importa: un perfil en SUSPENDED puede estarlo porque un
   * administrador lo suspendio por su propio contenido, no por la cuenta.
   * Reactivarlo en automatico al reactivar la cuenta deshacia esa decision sin
   * que nadie la revisara.
   *
   * Asi que el perfil se queda en SUSPENDED y vuelve con PATCH .../status, que
   * exige un administrador y deja asiento. Queda pendiente confirmarlo en el
   * SRS como regla explicita en lugar de como ausencia.
   */
}
