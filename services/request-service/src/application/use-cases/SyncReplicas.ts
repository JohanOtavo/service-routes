import type { IReplicaRepository } from '../../domain';

/**
 * Mantiene al dia las copias locales de datos ajenos.
 *
 * `prestador_ref`, `servicio_ref` y `categoria_ref` son replicas de lo que
 * poseen provider-service y catalog-service. Existen porque este servicio
 * necesita responder "este servicio sigue activo" o "quien es el usuario detras
 * de este prestador" en CADA contratacion, y preguntarselo por HTTP ataria la
 * contratacion a que esos dos servicios esten levantados: una caida del
 * catalogo impediria aceptar una solicitud ya acordada, que no tiene sentido.
 *
 * El precio es consistencia eventual, y aqui es asumible. Lo peor que puede
 * pasar es admitir una propuesta unos segundos despues de que el perfil se
 * suspendiera; lo contrario —no poder contratar porque otro servicio esta
 * caido— es mucho peor y mucho mas frecuente.
 *
 * Todos los metodos son UPSERT, no INSERT. El broker entrega al menos una vez y
 * los eventos pueden llegar desordenados: un INSERT fallaria en la segunda
 * entrega y mandaria a la cola de fallidos algo que no tiene nada de malo.
 */
export class SyncReplicasUseCase {
  constructor(private readonly replicas: IReplicaRepository) {}

  /**
   * Usuario.
   *
   * `UserAccountSuspended` no trae nombre ni contacto, solo el identificador y
   * el motivo. Por eso se conserva lo que ya habia: tomar el campo ausente
   * borraria el contacto de la replica y, con el, lo que se revela a la
   * contraparte de una contratacion ya acordada.
   */
  async alCambiarUsuario(datos: {
    idUsuario: number;
    nombre?: string | null;
    correo?: string | null;
    telefono?: string | null;
    estado: string;
  }): Promise<void> {
    const actual = await this.replicas.usuarioPorId(datos.idUsuario);

    await this.replicas.upsertUsuario({
      idUsuario: datos.idUsuario,
      nombre: datos.nombre ?? actual?.nombre ?? '',
      correo: datos.correo ?? actual?.correo ?? null,
      telefono: datos.telefono ?? actual?.telefono ?? null,
      estado: datos.estado,
    });
  }

  async alCambiarPrestador(datos: {
    idPrestador: number;
    idUsuario: number;
    nombre?: string | null;
    especialidad?: string | null;
    estado: string;
  }): Promise<void> {
    const actual = await this.replicas.prestadorPorId(datos.idPrestador);

    await this.replicas.upsertPrestador({
      idPrestador: datos.idPrestador,
      idUsuario: datos.idUsuario,
      // `ProviderStatusChanged` solo trae el estado. Conservar el nombre que ya
      // habia evita que un cambio de estado borre el nombre por no venir en ese
      // evento concreto.
      nombre: datos.nombre ?? actual?.nombre ?? '',
      especialidad: datos.especialidad ?? actual?.especialidad ?? null,
      estado: datos.estado,
    });
  }

  async alCambiarServicio(datos: {
    idServicio: number;
    idPrestador: number;
    idCategoria: number;
    nombreServicio?: string | null;
    estado: string;
  }): Promise<void> {
    const actual = await this.replicas.servicioPorId(datos.idServicio);

    await this.replicas.upsertServicio({
      idServicio: datos.idServicio,
      idPrestador: datos.idPrestador,
      idCategoria: datos.idCategoria,
      nombreServicio: datos.nombreServicio ?? actual?.nombreServicio ?? '',
      estado: datos.estado,
    });
  }

  async alCambiarCategoria(datos: {
    idCategoria: number;
    nombreCategoria: string;
    activa: boolean;
  }): Promise<void> {
    await this.replicas.upsertCategoria(datos);
  }
}
