import type { Knex } from 'knex';
import { currentDb } from '@punto-amigo/service-kit';
import type { AsientoValidacion, IValidationLogRepository } from '../../domain';

/**
 * Bitacora de validaciones (SRS RF26, RF27).
 *
 * Solo inserta. No hay `update` ni `delete` a proposito: una bitacora que se
 * puede corregir no prueba nada, y el valor de esta tabla es precisamente que
 * lo escrito queda. Las correcciones se hacen anadiendo otro asiento.
 */
export class KnexValidationLogRepository implements IValidationLogRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async registrar(asiento: AsientoValidacion): Promise<void> {
    await this.db('provider_validation_log').insert({
      id_prestador: asiento.idPrestador,
      estado_anterior: asiento.estadoAnterior,
      estado_nuevo: asiento.estadoNuevo,
      validado_por: asiento.validadoPor,
      motivo: asiento.motivo,
      registrado_at: asiento.registradoAt,
    });
  }
}
