import {
  Notificacion,
  type DatosNotificacion,
  type EstadoCuentaRef,
  type INotificacionRepository,
  type IUsuarioRefRepository,
} from '../../domain';

/**
 * Crea avisos a partir de eventos de otros servicios (SRS RF90 a RF92).
 *
 * Este es el servicio que mas datos ajenos ve pasar, asi que la regla principal
 * es de contencion: del evento se toma lo justo para redactar el aviso y
 * apuntar al recurso. Ni telefonos, ni correos, ni motivos internos. Un aviso
 * que diga "Pedro acepto tu solicitud" esta bien; uno que incluya su telefono
 * convertiria la bandeja en un directorio.
 */
export class CreateFromEventUseCase {
  constructor(
    private readonly notificaciones: INotificacionRepository,
    private readonly usuarios: IUsuarioRefRepository
  ) {}

  /**
   * Crea el aviso si hay a quien avisar.
   *
   * Que el destinatario no este en la replica NO es un error: puede ser una
   * cuenta anterior a este servicio, o un evento que llego antes que el alta.
   * Lanzar mandaria a la cola de fallidos algo que no tiene arreglo por
   * reintento, asi que se descarta y se sigue.
   */
  async crear(datos: DatosNotificacion): Promise<boolean> {
    if (!(await this.usuarios.existe(datos.idUsuario))) return false;

    await this.notificaciones.save(Notificacion.crear(datos));
    return true;
  }

  /** Alta o refresco de la replica de usuario. */
  async registrarUsuario(datos: {
    idUsuario: number;
    nombre: string;
    estado: EstadoCuentaRef;
    syncedAt: Date;
  }): Promise<void> {
    await this.usuarios.guardar(datos);
  }

  async cambiarEstadoUsuario(datos: {
    idUsuario: number;
    estado: EstadoCuentaRef;
    syncedAt: Date;
  }): Promise<void> {
    await this.usuarios.actualizarEstado(datos.idUsuario, datos.estado, datos.syncedAt);
  }

  /**
   * Guarda la especialidad del prestador (SRS RF172).
   *
   * Es lo unico del perfil que este servicio necesita: dirige el aviso de
   * necesidades afines. Si el usuario todavia no esta replicado, no se inventa
   * una fila; se pierde la especialidad hasta el proximo refresco del perfil, y
   * eso solo significa que no recibe avisos de afinidad durante ese rato.
   */
  async registrarEspecialidad(datos: {
    idUsuario: number;
    especialidad: string;
    syncedAt: Date;
  }): Promise<void> {
    await this.usuarios.actualizarEspecialidad(
      datos.idUsuario,
      datos.especialidad,
      datos.syncedAt
    );
  }
}
