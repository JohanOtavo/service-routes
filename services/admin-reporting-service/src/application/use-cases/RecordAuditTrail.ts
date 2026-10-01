import type { EventEnvelope } from '@punto-amigo/shared';
import { crearAsiento, type IAuditRepository } from '../../domain';

/**
 * Asientos de auditoria a partir de los eventos consumidos (SRS RF101, RF108).
 *
 * Lo invoca el consumidor, DENTRO de la transaccion en la que el propio
 * consumidor escribe la marca de "evento ya procesado". Por eso ningun metodo
 * abre transaccion propia: separarlas dejaria la puerta a que una reentrega
 * escribiera el asiento dos veces, y una bitacora con el mismo hecho repetido
 * falsea el informe de actividad que se calcula contando sus filas.
 *
 * Cada manejador nombra los campos del payload uno a uno. No hay ningun
 * `...payload`: lo que la tabla guarda tiene que ser una decision escrita, no
 * lo que el emisor decida incluir manana. `depurarDetalle` es la segunda
 * barrera, no la primera.
 */
export class RecordAuditTrailUseCase {
  constructor(private readonly auditoria: IAuditRepository) {}

  /**
   * Suspension de una cuenta (auth-service, SRS RF97).
   *
   * El emisor publica este mismo evento para la suspension y para el borrado
   * logico de la cuenta, distinguiendolos solo por `reason`. Aqui se registra
   * una sola accion y el motivo viaja en el detalle: deducir dos acciones
   * distintas del texto del motivo seria inventar un contrato que el emisor no
   * declara.
   */
  async alSuspenderCuenta(sobre: EventEnvelope): Promise<void> {
    await this.auditoria.registrar(
      crearAsiento({
        ocurridoAt: new Date(sobre.occurredAt),
        idActor: entero(sobre.payload['suspendedBy']),
        // El sobre no acredita con que rol actuo quien lo hizo, y ponerle
        // ADMINISTRADOR porque "solo un administrador puede" seria escribir en
        // una tabla de evidencia algo que la evidencia no respalda.
        actorRol: null,
        accion: 'CUENTA_SUSPENDIDA',
        recursoTipo: 'Usuario',
        recursoId: entero(sobre.payload['userId']),
        // Un evento de dominio solo se publica si el hecho ocurrio: no existe
        // el caso de un evento que documente un intento fallido.
        resultado: 'EXITO',
        correlationId: sobre.correlationId,
        detalle: { motivo: texto(sobre.payload['reason']) },
      })
    );
  }

  /**
   * Cambio de roles (auth-service, SRS RF161).
   *
   * El emisor publica `UserRoleAssigned` tanto al conceder como al retirar un
   * rol, asi que la accion se registra como una actualizacion y son las dos
   * listas del detalle las que dicen en que sentido fue. Llamarlo "rol
   * asignado" cuando se retiro uno dejaria la bitacora mintiendo.
   */
  async alAsignarRol(sobre: EventEnvelope): Promise<void> {
    await this.auditoria.registrar(
      crearAsiento({
        ocurridoAt: new Date(sobre.occurredAt),
        idActor: entero(sobre.payload['assignedBy']),
        actorRol: null,
        accion: 'ROLES_ACTUALIZADOS',
        recursoTipo: 'Usuario',
        recursoId: entero(sobre.payload['userId']),
        resultado: 'EXITO',
        correlationId: sobre.correlationId,
        detalle: {
          rolesAnteriores: listaDeTextos(sobre.payload['previousRoles']),
          rolesNuevos: listaDeTextos(sobre.payload['newRoles']),
        },
      })
    );
  }

  /**
   * Cambio de estado de un perfil de prestador (provider-service, SRS RF29).
   *
   * `idActor` queda en NULL porque el payload de `ProviderStatusChanged` no
   * lleva quien lo ejecuto. La columna admite NULL con el sentido "lo hizo el
   * sistema", que aqui no es exacto, pero es preferible a atribuir el cambio a
   * alguien que no consta. Queda anotado como limitacion del contrato de ese
   * evento.
   *
   * `idUsuario` del payload NO se copia: el recurso afectado es el perfil, y
   * replicar aqui el vinculo entre perfil y cuenta reconstruiria en un tercer
   * esquema la correlacion que provider-service se niega a exponer.
   */
  async alCambiarEstadoPrestador(sobre: EventEnvelope): Promise<void> {
    await this.auditoria.registrar(
      crearAsiento({
        ocurridoAt: new Date(sobre.occurredAt),
        idActor: null,
        actorRol: null,
        accion: 'ESTADO_PRESTADOR_CAMBIADO',
        recursoTipo: 'Prestador',
        recursoId: entero(sobre.payload['idPrestador']),
        resultado: 'EXITO',
        correlationId: sobre.correlationId,
        detalle: {
          estadoAnterior: texto(sobre.payload['estadoAnterior']),
          estado: texto(sobre.payload['estado']),
          visible: sobre.payload['visible'] === true,
          motivo: texto(sobre.payload['motivo']),
        },
      })
    );
  }
}

/**
 * Lee un identificador del payload sin confiar en su tipo.
 *
 * El payload llega como JSON desde otro servicio: un numero puede venir como
 * cadena y un campo puede faltar. Devolver null en vez de NaN importa porque
 * NaN acabaria en la columna como cero o como error del motor, y un asiento
 * atribuido al usuario 0 es peor que uno sin actor.
 */
function entero(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isInteger(valor) && valor > 0) return valor;
  if (typeof valor === 'string' && /^[1-9][0-9]{0,18}$/u.test(valor)) return Number(valor);
  return null;
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio.length === 0 ? null : limpio;
}

function listaDeTextos(valor: unknown): readonly string[] | null {
  if (!Array.isArray(valor)) return null;
  const limpia = valor.filter((e): e is string => typeof e === 'string');
  return limpia.length === 0 ? null : limpia;
}
