import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import { ejecutar, pedir } from './cliente';
import * as e from './esquemas';

/**
 * Consultas y mutaciones contra el gateway.
 *
 * Las claves de cache estan nombradas por recurso y parametros para que una
 * mutacion pueda invalidar exactamente lo que cambio. Invalidar de mas vuelve a
 * pedir pantallas que nadie esta mirando; invalidar de menos deja datos viejos
 * en pantalla despues de una accion, que es peor porque la persona cree que su
 * cambio no funciono.
 */

export const claves = {
  categorias: ['categorias'] as const,
  servicios: (filtros: object) => ['servicios', filtros] as const,
  servicio: (id: number) => ['servicio', id] as const,
  misServicios: ['mis-servicios'] as const,
  prestador: (id: number) => ['prestador', id] as const,
  miPerfil: ['mi-perfil-prestador'] as const,
  pendientes: ['prestadores-pendientes'] as const,
  necesidades: (filtros: object) => ['necesidades', filtros] as const,
  necesidad: (id: number) => ['necesidad', id] as const,
  misNecesidades: ['mis-necesidades'] as const,
  propuestasDe: (idNecesidad: number) => ['propuestas-de', idNecesidad] as const,
  misPropuestas: ['mis-propuestas'] as const,
  misContrataciones: (como: string) => ['mis-contrataciones', como] as const,
  contratacion: (id: number) => ['contratacion', id] as const,
  motivosCancelacion: ['motivos-cancelacion'] as const,
  reputacion: (idUsuario: number) => ['reputacion', idUsuario] as const,
  recibidas: (idUsuario: number, faceta: string) => ['recibidas', idUsuario, faceta] as const,
  avisos: (estado?: string) => ['avisos', estado ?? 'todos'] as const,
  noLeidas: ['avisos-no-leidas'] as const,
};

// ─── Catalogo ───────────────────────────────────────────────────────────────

export function useCategorias() {
  return useQuery({
    queryKey: claves.categorias,
    queryFn: () => pedir('/api/v1/categories', e.listaCategorias, { publica: true }),
    // Las categorias cambian muy poco: pedirlas en cada pantalla es gastar
    // datos de alguien por nada.
    staleTime: 30 * 60 * 1000,
  });
}

export interface FiltrosCatalogo {
  texto?: string;
  idCategoria?: number;
  pagina?: number;
}

export function useBuscarServicios(filtros: FiltrosCatalogo) {
  return useQuery({
    queryKey: claves.servicios(filtros),
    queryFn: () =>
      pedir('/api/v1/services', e.pagina(e.servicioListado), {
        publica: true,
        consulta: {
          texto: filtros.texto,
          idCategoria: filtros.idCategoria,
          pagina: filtros.pagina,
        },
      }),
  });
}

export function useServicio(id: number) {
  return useQuery({
    queryKey: claves.servicio(id),
    queryFn: () => pedir(`/api/v1/services/${id}`, e.servicioListado, { publica: true }),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useMisServicios() {
  return useQuery({
    queryKey: claves.misServicios,
    queryFn: () => pedir('/api/v1/services/mine', e.pagina(e.servicioPropio)),
  });
}

export function usePublicarServicio() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: { nombre: string; descripcion: string; idCategoria: number }) =>
      pedir('/api/v1/services', e.servicioPropio, { metodo: 'POST', cuerpo: datos }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: claves.misServicios });
      // Tambien la busqueda: el servicio nuevo tiene que aparecer en ella.
      void cliente.invalidateQueries({ queryKey: ['servicios'] });
    },
  });
}

export function useDesactivarServicio() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => ejecutar(`/api/v1/services/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: claves.misServicios });
      void cliente.invalidateQueries({ queryKey: ['servicios'] });
    },
  });
}

// ─── Prestadores ────────────────────────────────────────────────────────────

export function usePerfilPublico(id: number) {
  return useQuery({
    queryKey: claves.prestador(id),
    queryFn: () => pedir(`/api/v1/providers/${id}`, e.prestadorPublico, { publica: true }),
    enabled: Number.isInteger(id) && id > 0,
  });
}

/**
 * Mi perfil de prestador.
 *
 * Un 404 aqui significa "todavia no tiene perfil", que es el estado normal de
 * quien acaba de registrarse. Por eso no se reintenta: reintentar un 404
 * esperado solo gasta tres peticiones para llegar a la misma conclusion.
 */
export function useMiPerfil(): UseQueryResult<e.PrestadorPrivado> {
  return useQuery({
    queryKey: claves.miPerfil,
    queryFn: () => pedir('/api/v1/providers/me', e.prestadorPrivado),
    retry: false,
  });
}

export function useCrearPerfil() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: {
      nombre: string;
      especialidad: string;
      experiencia?: string | null;
      telefono?: string | null;
      correo?: string | null;
      disponibilidad?: string | null;
    }) => pedir('/api/v1/providers', e.prestadorPrivado, { metodo: 'POST', cuerpo: datos }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: claves.miPerfil }),
  });
}

// ─── Demanda: necesidades ───────────────────────────────────────────────────

export interface FiltrosNecesidades {
  texto?: string;
  idCategoria?: number;
  pagina?: number;
}

export function useNecesidadesAbiertas(filtros: FiltrosNecesidades) {
  return useQuery({
    queryKey: claves.necesidades(filtros),
    queryFn: () =>
      pedir('/api/v1/needs', e.pagina(e.necesidadPublica), {
        consulta: { texto: filtros.texto, idCategoria: filtros.idCategoria, pagina: filtros.pagina },
      }),
  });
}

export function useNecesidad(id: number) {
  return useQuery({
    queryKey: claves.necesidad(id),
    queryFn: () => pedir(`/api/v1/needs/${id}`, e.necesidadPublica),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useMisNecesidades() {
  return useQuery({
    queryKey: claves.misNecesidades,
    queryFn: () => pedir('/api/v1/needs/mine', e.pagina(e.necesidadPropia)),
  });
}

export function usePublicarNecesidad() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: {
      titulo: string;
      descripcion: string;
      idCategoria: number;
      presupuestoEstimado?: string | null;
      fechaDeseada?: string | null;
      ubicacionAproximada?: string | null;
    }) => pedir('/api/v1/needs', e.necesidadPropia, { metodo: 'POST', cuerpo: datos }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: claves.misNecesidades });
      void cliente.invalidateQueries({ queryKey: ['necesidades'] });
    },
  });
}

export function useCerrarNecesidad() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: { id: number; estado: 'CERRADA' | 'CANCELADA'; motivo?: string | null }) =>
      ejecutar(`/api/v1/needs/${datos.id}/close`, {
        metodo: 'POST',
        cuerpo: { estado: datos.estado, motivo: datos.motivo ?? null },
      }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: claves.misNecesidades });
      void cliente.invalidateQueries({ queryKey: ['necesidades'] });
    },
  });
}

// ─── Demanda: propuestas ────────────────────────────────────────────────────

/** Solo el autor de la necesidad puede verlas. El servidor lo decide. */
export function usePropuestasDe(idNecesidad: number) {
  return useQuery({
    queryKey: claves.propuestasDe(idNecesidad),
    // Arreglo plano, no paginado: este endpoint devuelve TODAS las propuestas de
    // la necesidad, porque su autor las compara entre si y paginarlas le
    // obligaria a ir y venir para decidir.
    queryFn: () => pedir(`/api/v1/needs/${idNecesidad}/proposals`, z.array(e.propuesta)),
    enabled: Number.isInteger(idNecesidad) && idNecesidad > 0,
  });
}

export function useMisPropuestas() {
  return useQuery({
    queryKey: claves.misPropuestas,
    queryFn: () => pedir('/api/v1/proposals/mine', e.pagina(e.propuesta)),
  });
}

export function useEnviarPropuesta() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: {
      idNecesidad: number;
      precio: string;
      tiempoEstimado: number;
      mensaje: string;
      idServicio?: number | null;
    }) =>
      pedir(`/api/v1/needs/${datos.idNecesidad}/proposals`, e.propuesta, {
        metodo: 'POST',
        cuerpo: {
          precio: datos.precio,
          tiempoEstimado: datos.tiempoEstimado,
          mensaje: datos.mensaje,
          idServicio: datos.idServicio ?? null,
        },
      }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: claves.misPropuestas }),
  });
}

export function useRetirarPropuesta() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => ejecutar(`/api/v1/proposals/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: claves.misPropuestas }),
  });
}

/**
 * Adjudicar cambia cuatro cosas de golpe: la necesidad, la propuesta elegida,
 * todas las demas y la contratacion nueva. Por eso invalida tanto.
 */
export function useAdjudicar() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: { idNecesidad: number; idPropuesta: number }) =>
      pedir(`/api/v1/needs/${datos.idNecesidad}/award`, e.solicitud, {
        metodo: 'POST',
        cuerpo: { idPropuesta: datos.idPropuesta },
      }),
    onSuccess: (_datos, variables) => {
      void cliente.invalidateQueries({ queryKey: claves.misNecesidades });
      void cliente.invalidateQueries({ queryKey: claves.propuestasDe(variables.idNecesidad) });
      void cliente.invalidateQueries({ queryKey: ['mis-contrataciones'] });
    },
  });
}

// ─── Contrataciones ─────────────────────────────────────────────────────────

export function useMisContrataciones(como: 'SOLICITANTE' | 'OFERENTE') {
  return useQuery({
    queryKey: claves.misContrataciones(como),
    queryFn: () => pedir('/api/v1/requests/mine', e.pagina(e.solicitud), { consulta: { como } }),
  });
}

export function useContratacion(id: number) {
  return useQuery({
    queryKey: claves.contratacion(id),
    queryFn: () => pedir(`/api/v1/requests/${id}`, e.solicitud),
    enabled: Number.isInteger(id) && id > 0,
  });
}

export function useContratarServicio() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: { idServicio: number; descripcionProblema: string }) =>
      pedir('/api/v1/requests', e.solicitud, { metodo: 'POST', cuerpo: datos }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['mis-contrataciones'] }),
  });
}

/**
 * Cambio de estado.
 *
 * CANCELADA no entra por aqui: tiene su propio hook porque exige motivo del
 * catalogo y devuelve la clasificacion. El tipo lo impide, para que nadie
 * intente cancelar por este camino y se salte la politica.
 */
export function useCambiarEstado() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: {
      id: number;
      destino: 'ACEPTADA' | 'RECHAZADA' | 'COMPLETADA';
      motivo?: string | null;
    }) =>
      pedir(`/api/v1/requests/${datos.id}/status`, e.solicitud, {
        metodo: 'PATCH',
        cuerpo: { destino: datos.destino, motivo: datos.motivo ?? null },
      }),
    onSuccess: (_datos, variables) => {
      void cliente.invalidateQueries({ queryKey: claves.contratacion(variables.id) });
      void cliente.invalidateQueries({ queryKey: ['mis-contrataciones'] });
    },
  });
}

/**
 * Cancelacion.
 *
 * Devuelve la franja y el peso, y la interfaz los MUESTRA. Ocultar el efecto
 * haria que la medida no disuadiera a nadie: lo que no se ve no corrige el
 * comportamiento.
 */
export function useCancelar() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: {
      id: number;
      codigoMotivo: string;
      detalle?: string | null;
      fechaAcordada?: string | null;
    }) =>
      pedir(`/api/v1/requests/${datos.id}/cancel`, e.resultadoCancelacion, {
        metodo: 'POST',
        cuerpo: {
          codigoMotivo: datos.codigoMotivo,
          detalle: datos.detalle ?? null,
          fechaAcordada: datos.fechaAcordada ?? null,
        },
      }),
    onSuccess: (_datos, variables) => {
      void cliente.invalidateQueries({ queryKey: claves.contratacion(variables.id) });
      void cliente.invalidateQueries({ queryKey: ['mis-contrataciones'] });
      void cliente.invalidateQueries({ queryKey: claves.misNecesidades });
    },
  });
}

/**
 * Catalogo de motivos de cancelacion.
 *
 * Se pide al servidor y no se lleva fijo en el cliente: la tabla existe para
 * que un administrador pueda cambiar los motivos sin desplegar, y una lista
 * escrita aqui anularia eso.
 */
export function useMotivosCancelacion() {
  return useQuery({
    queryKey: claves.motivosCancelacion,
    queryFn: () =>
      pedir(
        '/api/v1/requests/cancellation-reasons',
        z.object({
          elementos: z.array(
            z.object({
              codigo: z.string(),
              descripcion: z.string(),
              exigeDetalle: z.boolean(),
              abreRevision: z.boolean(),
            })
          ),
        })
      ),
    // Cambian muy poco: no hay razon para pedirlos en cada cancelacion.
    staleTime: 30 * 60 * 1000,
  });
}

// ─── Reputacion ─────────────────────────────────────────────────────────────

export function useReputacion(idUsuario: number) {
  return useQuery({
    queryKey: claves.reputacion(idUsuario),
    queryFn: () => pedir(`/api/v1/ratings/users/${idUsuario}`, e.reputacionUsuario),
    enabled: Number.isInteger(idUsuario) && idUsuario > 0,
  });
}

export function useCalificacionesRecibidas(
  idUsuario: number,
  faceta: 'COMO_OFERENTE' | 'COMO_SOLICITANTE'
) {
  return useQuery({
    queryKey: claves.recibidas(idUsuario, faceta),
    queryFn: () =>
      pedir(`/api/v1/ratings/users/${idUsuario}/received`, e.pagina(e.calificacion), {
        consulta: { faceta },
      }),
    enabled: Number.isInteger(idUsuario) && idUsuario > 0,
  });
}

export function useCalificar() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: { idSolicitud: number; puntuacion: number; comentario?: string | null }) =>
      pedir('/api/v1/ratings', e.calificacion, {
        metodo: 'POST',
        cuerpo: {
          idSolicitud: datos.idSolicitud,
          puntuacion: datos.puntuacion,
          comentario: datos.comentario ?? null,
        },
      }),
    onSuccess: (_datos, variables) => {
      void cliente.invalidateQueries({ queryKey: claves.contratacion(variables.idSolicitud) });
      void cliente.invalidateQueries({ queryKey: ['recibidas'] });
    },
  });
}

// ─── Avisos ─────────────────────────────────────────────────────────────────

export function useAvisos(estado?: 'NO_LEIDA' | 'LEIDA') {
  return useQuery({
    queryKey: claves.avisos(estado),
    queryFn: () =>
      pedir('/api/v1/notifications', e.bandejaAvisos, { consulta: { estado } }),
  });
}

/**
 * Contador de no leidas, para el distintivo de la cabecera.
 *
 * Se refresca cada minuto y NO en cada cambio de pantalla: un contador que se
 * pide treinta veces por sesion gasta datos de alguien para mostrar un numero
 * que casi nunca cambia.
 */
export function useNoLeidas() {
  return useQuery({
    queryKey: claves.noLeidas,
    queryFn: () => pedir('/api/v1/notifications/unread-count', e.contadorAvisos),
    refetchInterval: 60_000,
    staleTime: 55_000,
  });
}

export function useMarcarLeida() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => ejecutar(`/api/v1/notifications/${id}/read`, { metodo: 'POST' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['avisos'] });
      void cliente.invalidateQueries({ queryKey: claves.noLeidas });
    },
  });
}

export function useMarcarTodasLeidas() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: () =>
      pedir('/api/v1/notifications/read-all', z.object({ marcadas: z.number() }), {
        metodo: 'POST',
      }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['avisos'] });
      void cliente.invalidateQueries({ queryKey: claves.noLeidas });
    },
  });
}

// ─── Administracion ─────────────────────────────────────────────────────────

const esquemaPendientes = e.pagina(e.prestadorPrivado);

export function usePrestadoresPendientes() {
  return useQuery({
    queryKey: claves.pendientes,
    queryFn: () => pedir('/api/v1/providers/pending', esquemaPendientes),
  });
}

export function useValidarPrestador() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      pedir(`/api/v1/providers/${id}/validate`, e.prestadorPrivado, { metodo: 'POST' }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: claves.pendientes });
      // El catalogo tambien cambia: sus servicios pasan a ser visibles.
      void cliente.invalidateQueries({ queryKey: ['servicios'] });
    },
  });
}

export function useRechazarPrestador() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: { id: number; motivo: string }) =>
      pedir(`/api/v1/providers/${datos.id}/reject`, e.prestadorPrivado, {
        metodo: 'POST',
        cuerpo: { motivo: datos.motivo },
      }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: claves.pendientes }),
  });
}

const esquemaActividad = z.object({
  desde: z.string().nullable(),
  hasta: z.string().nullable(),
  totalAsientos: z.number(),
  porAccion: z.array(
    z.object({ accion: z.string(), resultado: z.string(), total: z.number() })
  ),
  porDia: z.array(z.object({ fecha: z.string(), total: z.number() })),
});

export type Actividad = z.infer<typeof esquemaActividad>;

export function useActividad() {
  return useQuery({
    queryKey: ['actividad'],
    queryFn: () => pedir('/api/v1/admin/reports/activity', esquemaActividad),
  });
}

const esquemaAsiento = z.object({
  id: z.number(),
  ocurridoAt: z.string(),
  registradoAt: z.string(),
  idActor: z.number().nullable(),
  actorRol: z.string().nullable(),
  accion: z.string(),
  recursoTipo: z.string(),
  recursoId: z.string().nullable(),
  resultado: z.string(),
  correlationId: z.string().nullable(),
  detalle: z.record(z.unknown()).nullable(),
  ipOrigen: z.string().nullable(),
});

export function useAuditoria(filtros: { accion?: string; resultado?: string }) {
  return useQuery({
    queryKey: ['auditoria', filtros],
    queryFn: () =>
      pedir('/api/v1/admin/audit', e.pagina(esquemaAsiento), {
        consulta: { accion: filtros.accion, resultado: filtros.resultado },
      }),
  });
}

const esquemaParametro = z.object({
  clave: z.string(),
  valor: z.string(),
  descripcion: z.string().nullable(),
  tipoDato: z.string(),
  actualizadoAt: z.string().nullable(),
  creadoPor: z.number().nullable(),
});

export function useParametros() {
  return useQuery({
    queryKey: ['parametros'],
    queryFn: () => pedir('/api/v1/admin/parameters', e.pagina(esquemaParametro)),
  });
}

export function useGuardarParametro() {
  const cliente = useQueryClient();

  return useMutation({
    mutationFn: (datos: {
      clave: string;
      valor: string;
      descripcion?: string | null;
      tipoDato: 'string' | 'number' | 'boolean';
    }) =>
      pedir('/api/v1/admin/parameters', esquemaParametro, {
        metodo: 'PUT',
        cuerpo: {
          clave: datos.clave,
          valor: datos.valor,
          descripcion: datos.descripcion ?? null,
          tipoDato: datos.tipoDato,
        },
      }),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ['parametros'] });
      // Cambiar un parametro deja asiento: la bitacora tambien cambio.
      void cliente.invalidateQueries({ queryKey: ['auditoria'] });
    },
  });
}
