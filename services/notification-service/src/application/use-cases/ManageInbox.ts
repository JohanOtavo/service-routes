import {
  exigirNotificacion,
  normalizarPaginacion,
  type EstadoNotificacion,
  type INotificacionRepository,
} from '../../domain';
import type { IClock } from '@punto-amigo/service-kit';

/**
 * La bandeja de cada persona (SRS RF93 a RF95).
 *
 * Toda consulta lleva el identificador del token como filtro OBLIGATORIO, no
 * como comprobacion posterior. La diferencia importa: filtrar en la consulta
 * hace imposible devolver avisos ajenos, mientras que comprobar despues depende
 * de que nadie olvide el `if` al anadir una ruta.
 */
export class ManageInboxUseCase {
  constructor(
    private readonly notificaciones: INotificacionRepository,
    private readonly clock: IClock
  ) {}

  async listar(entrada: {
    idUsuario: number;
    estado?: EstadoNotificacion | undefined;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);
    const resultado = await this.notificaciones.listarDe(
      entrada.idUsuario,
      { estado: entrada.estado },
      pagina,
      tamano
    );

    return {
      elementos: resultado.elementos.map((n) => n.vista()),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
      noLeidas: await this.notificaciones.contarNoLeidas(entrada.idUsuario),
    };
  }

  async contarNoLeidas(idUsuario: number): Promise<Record<string, unknown>> {
    return { noLeidas: await this.notificaciones.contarNoLeidas(idUsuario) };
  }

  /**
   * Marca una como leida (SRS RF94).
   *
   * La propiedad la comprueba el dominio dentro de `marcarLeida`: el borde sabe
   * quien llama, no si ESTE aviso es suyo. Marcar el de otro devuelve 404 y no
   * 403, porque un 403 confirmaria que ese aviso existe.
   */
  async marcarLeida(entrada: { idNotificacion: number; idUsuario: number }): Promise<void> {
    const notificacion = await exigirNotificacion(this.notificaciones, entrada.idNotificacion);

    // Devuelve false si ya estaba leida: no es un error, es pulsar dos veces.
    if (!notificacion.marcarLeida(entrada.idUsuario, this.clock.now())) return;

    await this.notificaciones.update(notificacion);
  }

  async marcarTodasLeidas(idUsuario: number): Promise<Record<string, unknown>> {
    const cuantas = await this.notificaciones.marcarTodasLeidasDe(idUsuario, this.clock.now());
    return { marcadas: cuantas };
  }
}
