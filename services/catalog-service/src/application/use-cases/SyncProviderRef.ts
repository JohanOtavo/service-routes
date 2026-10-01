import type { EstadoPrestador } from '../../domain';
import { ESTADOS_PRESTADOR_CONOCIDOS, type IPrestadorRefRepository } from '../ports';

/**
 * Mantiene al dia la replica `prestador_ref` (SRS RNF54).
 *
 * La replica existe para que una pagina de resultados pueda mostrar el nombre
 * del prestador y descartar a los suspendidos sin una llamada sincrona por
 * fila. Es consistencia eventual, y el precio es este archivo: si nadie
 * aplicara los eventos, el catalogo publicaria nombres viejos y servicios de
 * prestadores que ya no estan activos.
 *
 * Ningun metodo abre transaccion. Reciben la del consumidor —la misma en la que
 * se escribe la marca de "evento ya procesado"— porque separarlas dejaria el
 * efecto sin marca y se repetiria, o la marca sin efecto y se perderia.
 */
export class SyncProviderRefUseCase {
  constructor(private readonly prestadores: IPrestadorRefRepository) {}

  /**
   * Alta y refresco del perfil replicado.
   *
   * Sirve a `ServiceProviderProfileCreated`, `...Updated` y `...Validated`
   * porque los tres traen la misma foto del perfil y la diferencia esta en el
   * estado, que el llamador resuelve. Un manejador por evento repetiria tres
   * veces el mismo upsert.
   */
  async alRefrescarPerfil(entrada: {
    idPrestador: number;
    idUsuario: number;
    nombre: string;
    especialidad: string | null;
    estado: EstadoPrestador;
    ocurridoAt: Date;
  }): Promise<void> {
    await this.prestadores.upsert(entrada);
  }

  /**
   * Cambio de estado (SRS RF29, RF30, RF32).
   *
   * Solo toca `estado`: el evento no lleva nombre ni especialidad, y un upsert
   * con cadenas vacias dejaria el catalogo mostrando fichas sin nombre.
   *
   * Que la fila no exista NO es un error. El catalogo pudo desplegarse despues
   * de que ese prestador se creara, y entonces nunca vio su alta. Lanzar aqui
   * mandaria el evento a la cola de fallidos sin que nada estuviera mal; la
   * fila aparecera con el proximo `ServiceProviderProfileUpdated`.
   *
   * El motivo de la suspension viaja en el payload y aqui se ignora a
   * proposito: es informacion interna entre el administrador y el afectado, y
   * el catalogo es una vista publica.
   */
  async alCambiarEstado(entrada: {
    idPrestador: number;
    estado: EstadoPrestador;
    ocurridoAt: Date;
  }): Promise<void> {
    await this.prestadores.actualizarEstado(entrada);
  }
}

/**
 * Traduce el estado que viene en un evento.
 *
 * Un valor desconocido NO se guarda. La columna `prestador_ref.estado` no tiene
 * CHECK, asi que escribir cualquier cadena colaria; y si ese valor acabara en
 * la replica, el filtro `estado = 'ACTIVE'` de la busqueda lo excluiria para
 * siempre sin que nadie entendiera por que ese prestador desaparecio. Se cae
 * ruidosamente y el evento va a la cola de fallidos, que es donde se ve.
 */
export function exigirEstadoPrestador(bruto: unknown): EstadoPrestador {
  const valor = String(bruto ?? '');
  if (!(ESTADOS_PRESTADOR_CONOCIDOS as readonly string[]).includes(valor)) {
    throw new Error(`Estado de prestador no reconocido: "${valor}".`);
  }
  return valor as EstadoPrestador;
}
