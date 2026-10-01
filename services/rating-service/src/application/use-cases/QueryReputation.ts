import { AppError } from '@punto-amigo/shared';
import {
  FACETAS,
  facetaEvaluada,
  normalizarPaginacion,
  promedioDeServicio,
  type Faceta,
  type ICalificacionRepository,
  type IReputacionRepository,
  type ITasaCancelacionRepository,
} from '../../domain';
import type { ReputationRecalculator } from '../ReputationRecalculator';

/**
 * Consultas publicas de reputacion (SRS RF83 a RF85, RF167, RF192).
 *
 * Todas pasan por `vistaPublica()`, que LANZA si la calificacion no es publica.
 * Es deliberado: si el listado usara `toJSON()`, el periodo ciego dependeria de
 * que cada consulta recordara filtrar, y el primero que lo olvidara publicaria
 * notas antes de tiempo.
 */
export class QueryReputationUseCase {
  constructor(
    private readonly calificaciones: ICalificacionRepository,
    private readonly reputaciones: IReputacionRepository,
    private readonly tasas: ITasaCancelacionRepository,
    private readonly recalculador: ReputationRecalculator
  ) {}

  /**
   * Perfil publico de reputacion de una persona.
   *
   * Las dos facetas van separadas (SRS RF165). Promediarlas en un solo numero
   * destruye informacion: alguien impecable atendiendo y desastroso contratando
   * quedaria "normal", y quien lo contrate no sabria cual de las dos le toca.
   */
  async deUsuario(idUsuario: number): Promise<Record<string, unknown>> {
    const facetas: Record<string, unknown> = {};

    for (const faceta of FACETAS) {
      const reputacion = await this.reputaciones.buscar(idUsuario, faceta);
      const tasa = await this.tasas.buscar(idUsuario, faceta);

      facetas[faceta] = {
        // Sin calificaciones todavia: se devuelve el cero explicito en lugar de
        // omitir la faceta, para que quien consulte no tenga que distinguir
        // entre "no hay datos" y "no vino el campo".
        puntuacionMedia: reputacion?.puntuacionMedia ?? 0,
        totalCalificaciones: reputacion?.totalCalificaciones ?? 0,
        /**
         * La tasa solo aparece a partir del primer umbral (SRS RF192).
         *
         * Al no haber cobro, la visibilidad es el unico instrumento disuasorio;
         * pero publicar el 0 % de todo el mundo no disuade a nadie y si expone
         * a quien cancelo una vez de forma justificada.
         */
        ...(tasa?.esPublica === true
          ? { tasaCancelacion: tasa.tasa, umbralAlcanzado: tasa.umbralAlcanzado }
          : {}),
      };
    }

    return { idUsuario, facetas };
  }

  /** Calificaciones publicas que recibio una persona en una faceta (SRS RF83). */
  async listarDeUsuario(entrada: {
    idUsuario: number;
    faceta: Faceta;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);
    const resultado = await this.calificaciones.listarPublicasDeReceptor(
      entrada.idUsuario,
      entrada.faceta,
      pagina,
      tamano
    );

    return {
      elementos: resultado.elementos.map((c) => c.vistaPublica()),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }

  /** Calificaciones y promedio de un servicio (SRS RF83, RF84). */
  async deServicio(entrada: {
    idServicio: number;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);

    const [resultado, agregado] = await Promise.all([
      this.calificaciones.listarPublicasDeServicio(entrada.idServicio, pagina, tamano),
      this.calificaciones.agregadoDeServicio(entrada.idServicio),
    ]);

    return {
      ...promedioDeServicio(entrada.idServicio, agregado),
      elementos: resultado.elementos.map((c) => c.vistaPublica()),
      pagina: resultado.pagina,
      tamano: resultado.tamano,
      // `total` del agregado es cuantas puntuan; el del listado es cuantas hay
      // visibles. Coinciden, pero se devuelve el del agregado por coherencia
      // con la media que lo acompana.
      totalVisibles: resultado.total,
    };
  }

  /**
   * Retirada por moderacion (SRS RF85).
   *
   * La ejecuta un administrador, nunca el autor: si el autor pudiera retirar la
   * suya, bastaria con hacerlo cada vez que la contraparte respondiera mal y la
   * reputacion solo guardaria elogios.
   */
  async ocultarPorModeracion(entrada: {
    idCalificacion: number;
    correlationId: string;
  }): Promise<void> {
    const calificacion = await this.calificaciones.findById(entrada.idCalificacion);
    if (calificacion === null) throw AppError.notFound('La calificacion no existe.');

    calificacion.ocultarPorModeracion();
    await this.calificaciones.update(calificacion);

    /**
     * Y la reputacion se recalcula AQUI MISMO, en la misma transaccion.
     *
     * Retirar una calificacion sin restarla de la media la deja contando: el
     * administrador creeria haberla quitado y el numero seguiria incluyendola.
     * Se usa el recalculador compartido para que la media se calcule en un solo
     * sitio, aunque los caminos que llegan a el no se parezcan.
     */
    await this.recalculador.recalcular({
      idUsuario: calificacion.idReceptor,
      faceta: facetaEvaluada(calificacion.direccion),
      idServicio: calificacion.idServicio,
      correlationId: entrada.correlationId,
    });
  }
}
