import type { Knex } from 'knex';
import { currentDb } from '@punto-amigo/service-kit';
import type { IRatingSummaryRepository } from '../../application/ports';

/**
 * Agregado de calificaciones por servicio (SRS RF53, RF84).
 *
 * Es una copia desnormalizada de lo que posee rating-service. Existe porque la
 * busqueda del catalogo ordena por puntuacion, y preguntarle la media a otro
 * servicio por cada fila de cada pagina convertiria una busqueda en decenas de
 * llamadas de red.
 */
export class KnexRatingSummaryRepository implements IRatingSummaryRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  /**
   * Suma una calificacion al agregado, sin leerlo antes.
   *
   * El calculo va DENTRO del UPDATE para que sea atomico: leer la media, sumar
   * en memoria y escribirla dejaria una ventana en la que dos calificaciones
   * simultaneas se pisarian y una de las dos se perderia.
   *
   * La media se recalcula desde el total anterior y no se arrastra la ya
   * redondeada: `(media * total + nueva) / (total + 1)` sobre un valor de dos
   * decimales acumula error en cada suma.
   */
  async acumular(datos: {
    idServicio: number;
    puntuacion: number;
    actualizadoAt: Date;
  }): Promise<boolean> {
    const afectadas = await this.db('service_rating_summary')
      .where({ id_servicio: datos.idServicio })
      .update({
        puntuacion_media: this.db.raw(
          '(puntuacion_media * total_calificaciones + ?) / (total_calificaciones + 1)',
          [datos.puntuacion]
        ),
        total_calificaciones: this.db.raw('total_calificaciones + 1'),
        actualizado_at: datos.actualizadoAt,
      });

    // Cero filas significa que el servicio no existe en esta replica. No es un
    // error: puede ser una calificacion de un servicio ya borrado, y lanzar
    // mandaria a la cola de fallidos un evento que no tiene nada de malo.
    return afectadas > 0;
  }

  /**
   * Fija el agregado con el valor que rating-service considera verdadero.
   *
   * Es la correccion de deriva: `acumular` va sumando entrega a entrega, y
   * cualquier evento perdido o aplicado de mas dejaria esta copia desviada para
   * siempre. El recalculo completo la devuelve al valor bueno.
   */
  async fijar(datos: {
    idServicio: number;
    puntuacionMedia: number;
    totalCalificaciones: number;
    actualizadoAt: Date;
  }): Promise<boolean> {
    const afectadas = await this.db('service_rating_summary')
      .where({ id_servicio: datos.idServicio })
      .update({
        puntuacion_media: datos.puntuacionMedia,
        total_calificaciones: datos.totalCalificaciones,
        actualizado_at: datos.actualizadoAt,
      });

    return afectadas > 0;
  }
}
