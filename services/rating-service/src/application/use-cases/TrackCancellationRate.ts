import { EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  TasaCancelacion,
  inicioDeVentana,
  validarCancelacion,
  type CancelacionImputada,
  type Faceta,
  type ITasaCancelacionRepository,
} from '../../domain';

/**
 * Tasa de cancelacion por faceta (SRS RF180 a RF183, RF192).
 *
 * Este servicio NO vuelve a clasificar la cancelacion. El peso y a quien se le
 * carga los decide request-service, que es dueno del hecho, y llegan resueltos
 * en el evento. Recalcularlos aqui crearia dos copias de la politica que
 * divergirian en cuanto alguien ajustara un umbral, y entonces la tasa dejaria
 * de corresponder con lo que quedo registrado.
 */
export class TrackCancellationRateUseCase {
  constructor(
    private readonly tasas: ITasaCancelacionRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock,
    private readonly diasVentana: number
  ) {}

  /**
   * Aplica una cancelacion y recalcula la tasa de quien la carga.
   *
   * Una cancelacion que no computa —en periodo de gracia, excusada, o pendiente
   * de revision— se GUARDA igual pero no imputa a nadie. Guardarla importa: sin
   * la fila no se podria reclasificar despues si la revision le da la vuelta.
   */
  async alCancelar(entrada: {
    cancelacion: CancelacionImputada;
    correlationId: string;
  }): Promise<void> {
    const cancelacion = validarCancelacion(entrada.cancelacion);
    await this.tasas.registrarCancelacion(cancelacion);

    if (!cancelacion.computa) return;

    await this.recalcular({
      idUsuario: cancelacion.idUsuarioImputado,
      faceta: cancelacion.faceta,
      correlationId: entrada.correlationId,
    });
  }

  /**
   * Recalcula tambien al CERRARSE una contratacion, aunque no se cancele.
   *
   * El denominador son las contrataciones cerradas en la ventana, asi que una
   * completada baja la tasa. Sin este camino, quien cruzo un umbral se quedaria
   * marcado hasta su siguiente cancelacion: el unico modo de mejorar seria
   * cancelar otra vez, que es exactamente lo contrario de lo que se busca.
   */
  async alCerrarContratacion(entrada: {
    idUsuario: number;
    faceta: Faceta;
    correlationId: string;
  }): Promise<void> {
    await this.recalcular(entrada);
  }

  private async recalcular(entrada: {
    idUsuario: number;
    faceta: Faceta;
    correlationId: string;
  }): Promise<void> {
    const ahora = this.clock.now();
    const desde = inicioDeVentana(ahora, this.diasVentana);

    const tasa =
      (await this.tasas.buscar(entrada.idUsuario, entrada.faceta)) ??
      TasaCancelacion.inicial(entrada.idUsuario, entrada.faceta, desde, ahora);

    const [resumen, contrataciones] = await Promise.all([
      this.tasas.resumirVentana(entrada.idUsuario, entrada.faceta, desde),
      this.tasas.contarContrataciones(entrada.idUsuario, entrada.faceta, desde),
    ]);

    const cruzado = tasa.recalcular(
      { contrataciones, ponderadas: resumen.ponderadas, ventanaDesde: desde },
      ahora
    );
    await this.tasas.guardar(tasa);

    // Solo se anuncia el CRUCE de un umbral, nunca el estar por encima. Repetir
    // el aviso en cada recalculo convertiria la bandeja administrativa y los
    // avisos al usuario en ruido que nadie mira.
    if (cruzado === null) return;

    await this.eventos.enqueue(
      {
        eventName: EventName.CancellationThresholdReached,
        aggregateType: 'TasaCancelacion',
        aggregateId: entrada.idUsuario,
        payload: {
          idUsuario: entrada.idUsuario,
          faceta: entrada.faceta,
          umbral: cruzado,
          tasa: tasa.tasa,
          contratacionesEnVentana: tasa.contratacionesEnVentana,
          // El tercer umbral abre revision administrativa; los dos primeros
          // son aviso y restriccion, y los resuelve el propio sistema.
          requiereRevision: cruzado >= 3,
        },
      },
      entrada.correlationId
    );
  }
}
