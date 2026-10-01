import { z } from 'zod';

/**
 * Forma de lo que devuelve el backend, validada en el borde.
 *
 * Cada respuesta se valida al entrar. Parece de mas hasta que un servicio
 * renombra un campo y la interfaz pinta `undefined` en mitad de una pantalla
 * sin que nada falle. Validando, el fallo aparece aqui con el nombre del campo.
 *
 * Los importes llegan como CADENA a proposito: son DECIMAL en la base y
 * convertirlos a `number` pierde precision. Se formatean para mostrar, no se
 * calculan en el cliente.
 */

export const sinCuerpo = z.undefined();

/** Envoltura paginada que usan casi todos los listados. */
export function pagina<T extends z.ZodTypeAny>(elemento: T) {
  return z.object({
    elementos: z.array(elemento),
    total: z.number(),
    pagina: z.number(),
    tamano: z.number(),
  });
}

// ─── Catalogo ───────────────────────────────────────────────────────────────

export const categoria = z.object({
  id: z.number(),
  nombre: z.string(),
  descripcion: z.string().nullable(),
  activa: z.boolean(),
});

export const listaCategorias = z.object({ elementos: z.array(categoria) });

export const servicioListado = z.object({
  id: z.number(),
  nombre: z.string(),
  descripcion: z.string(),
  idPrestador: z.number(),
  idCategoria: z.number(),
  estado: z.string(),
  prestador: z
    .object({
      idPrestador: z.number(),
      nombre: z.string(),
      especialidad: z.string().nullable(),
    })
    .optional(),
  reputacion: z
    .object({
      puntuacionMedia: z.number(),
      totalCalificaciones: z.number(),
    })
    .optional(),
});

export const servicioPropio = z.object({
  id: z.number(),
  nombre: z.string(),
  descripcion: z.string(),
  idPrestador: z.number(),
  idCategoria: z.number(),
  estado: z.string(),
});

// ─── Prestadores ────────────────────────────────────────────────────────────

/**
 * Perfil publico. NO tiene telefono ni correo, y el tipo lo refleja: si el
 * backend empezara a enviarlos, esto no los mostraria igualmente.
 */
export const prestadorPublico = z.object({
  id: z.number(),
  nombre: z.string(),
  especialidad: z.string(),
  experiencia: z.string().nullable(),
  disponibilidad: z.string().nullable(),
  estado: z.string(),
  validado: z.boolean(),
});

/** Perfil propio o vista de administrador: aqui si viaja el contacto. */
export const prestadorPrivado = prestadorPublico.extend({
  idUsuario: z.number(),
  telefono: z.string().nullable(),
  correo: z.string().nullable(),
});

// ─── Demanda ────────────────────────────────────────────────────────────────

export const necesidadPublica = z.object({
  id: z.number(),
  titulo: z.string(),
  descripcion: z.string(),
  idCategoria: z.number(),
  presupuestoEstimado: z.string().nullable(),
  fechaDeseada: z.string().nullable(),
  ubicacionAproximada: z.string().nullable(),
  fechaPublicacion: z.string(),
  fechaVigencia: z.string(),
});

export const necesidadPropia = necesidadPublica.extend({
  estado: z.string(),
  idUsuario: z.number(),
});

export const propuesta = z.object({
  id: z.number(),
  idNecesidad: z.number(),
  idPrestador: z.number(),
  precio: z.string(),
  tiempoEstimado: z.number(),
  mensaje: z.string(),
  idServicio: z.number().nullable(),
  estado: z.string(),
});

// ─── Contrataciones ─────────────────────────────────────────────────────────

export const solicitud = z.object({
  id: z.number(),
  estado: z.string(),
  origen: z.string(),
  descripcionProblema: z.string(),
  idUsuario: z.number(),
  idPrestador: z.number(),
  idServicio: z.number().nullable(),
  idNecesidad: z.number().nullable(),
  idPropuesta: z.number().nullable(),
  valorAcordado: z.string().nullable(),
  plazoAcordado: z.number().nullable(),
  fechaSolicitud: z.string(),
  /**
   * El contacto llega null mientras no haya acuerdo. Es la frontera que
   * sostiene la intermediacion, y por eso es un campo nullable y no la ausencia
   * del campo: asi la interfaz puede distinguir "todavia no" de "no vino".
   */
  contacto: z
    .object({
      idUsuario: z.number(),
      nombre: z.string().nullable(),
      telefono: z.string().nullable(),
      correo: z.string().nullable(),
    })
    .nullable(),
});

export const resultadoCancelacion = z.object({
  idCancelacion: z.number(),
  estado: z.string(),
  franja: z.string(),
  peso: z.number(),
  computa: z.boolean(),
  enRevision: z.boolean(),
});

// ─── Reputacion ─────────────────────────────────────────────────────────────

const facetaReputacion = z.object({
  puntuacionMedia: z.number(),
  totalCalificaciones: z.number(),
  tasaCancelacion: z.number().optional(),
  umbralAlcanzado: z.number().optional(),
});

export const reputacionUsuario = z.object({
  idUsuario: z.number(),
  facetas: z.object({
    COMO_OFERENTE: facetaReputacion,
    COMO_SOLICITANTE: facetaReputacion,
  }),
});

export const calificacion = z.object({
  id: z.number(),
  idSolicitud: z.number(),
  direccion: z.string(),
  idReceptor: z.number(),
  idServicio: z.number().nullable(),
  puntuacion: z.number(),
  comentario: z.string().nullable(),
  fecha: z.string(),
  visibleAt: z.string().nullable(),
});

// ─── Avisos ─────────────────────────────────────────────────────────────────

export const aviso = z.object({
  id: z.number(),
  tipo: z.string(),
  titulo: z.string(),
  mensaje: z.string(),
  recursoTipo: z.string().nullable(),
  recursoId: z.number().nullable(),
  estado: z.string(),
  leidaAt: z.string().nullable(),
  fecha: z.string(),
});

export const bandejaAvisos = pagina(aviso).extend({ noLeidas: z.number() });
export const contadorAvisos = z.object({ noLeidas: z.number() });

export type Categoria = z.infer<typeof categoria>;
export type ServicioListado = z.infer<typeof servicioListado>;
export type PrestadorPublico = z.infer<typeof prestadorPublico>;
export type PrestadorPrivado = z.infer<typeof prestadorPrivado>;
export type NecesidadPublica = z.infer<typeof necesidadPublica>;
export type NecesidadPropia = z.infer<typeof necesidadPropia>;
export type Propuesta = z.infer<typeof propuesta>;
export type Solicitud = z.infer<typeof solicitud>;
export type Calificacion = z.infer<typeof calificacion>;
export type Aviso = z.infer<typeof aviso>;
