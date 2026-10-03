/**
 * Carga y validacion de la configuracion por entorno.
 *
 * Un servicio debe fallar al arrancar si le falta una variable, no cuando la
 * necesite por primera vez a las tres de la madrugada (SRS-DIST-10). Por eso
 * todo se valida aqui, una vez, y el resto del codigo recibe un objeto tipado.
 */
import { z } from 'zod';

/** Entero que llega como cadena desde el entorno. */
const intFromEnv = (min: number, max?: number): z.ZodType<number> =>
  z.coerce
    .number()
    .int()
    .min(min)
    .pipe(max === undefined ? z.number() : z.number().max(max));

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGIN: z.string().min(1),

  MYSQL_HOST: z.string().min(1),
  MYSQL_PORT: intFromEnv(1, 65535).default(3306),

  RATE_LIMIT_WINDOW_MS: intFromEnv(1000).default(60000),
  RATE_LIMIT_MAX_PER_IP: intFromEnv(1).default(100),
  RATE_LIMIT_MAX_PER_USER: intFromEnv(1).default(300),
  REQUEST_BODY_LIMIT: z.string().default('100kb'),

  REDIS_HOST: z.string().min(1),
  REDIS_PORT: intFromEnv(1, 65535).default(6379),

  INTERNAL_SERVICE_SECRET: z.string().min(16),
});

/**
 * Valida el entorno contra un esquema y aborta el arranque si algo falta.
 *
 * No imprime el valor de ninguna variable: un mensaje de error que incluya la
 * cadena que fallo puede acabar filtrando un secreto al registro.
 */
export function loadEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env
): z.infer<T> {
  const result = schema.safeParse(source);

  if (!result.success) {
    const faltantes = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuracion invalida. Revise su .env:\n${faltantes}`);
  }

  return result.data;
}

/** En produccion, un origen comodin equivale a no tener CORS (SRS RNF26). */
export function assertProductionSafety(env: z.infer<typeof baseEnvSchema>): void {
  if (env.NODE_ENV !== 'production') return;

  if (env.CORS_ORIGIN === '*') {
    throw new Error('CORS_ORIGIN no puede ser "*" en produccion.');
  }
  if (env.INTERNAL_SERVICE_SECRET.startsWith('local-')) {
    throw new Error('INTERNAL_SERVICE_SECRET conserva el valor de ejemplo.');
  }
}
