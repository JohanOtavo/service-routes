import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import './componentes.css';

/**
 * Componentes del sistema de diseno.
 *
 * NINGUNO acepta `dangerouslySetInnerHTML`, y eso es una decision de seguridad,
 * no de estilo. Todo el texto de esta aplicacion viene de personas: la
 * descripcion de un servicio, el mensaje de una propuesta, el comentario de una
 * calificacion. React escapa el texto que se pasa como hijo, asi que mientras
 * no exista una via para inyectar HTML, no hay XSS que inyectar.
 */

type Variante = 'primario' | 'acento' | 'secundario' | 'peligro' | 'fantasma';

interface PropsBoton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  completo?: boolean;
  cargando?: boolean;
}

export const Boton = forwardRef<HTMLButtonElement, PropsBoton>(function Boton(
  { variante = 'primario', completo = false, cargando = false, className, children, ...resto },
  ref
) {
  return (
    <button
      // `resto` va PRIMERO a proposito. Si fuera despues, un `className` o un
      // `disabled` que pase quien lo usa pisaria lo de aqui: el `disabled` de
      // `cargando` —que evita el doble clic que manda la operacion dos veces— y
      // las clases de la variante. Un componente del sistema de diseno que no
      // se puede ampliar con una clase deja de ser un componente.
      {...resto}
      ref={ref}
      type={resto.type ?? 'button'}
      className={[
        'pa-boton',
        `pa-boton--${variante}`,
        completo ? 'pa-boton--completo' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={resto.disabled === true || cargando}
      // `aria-busy` es lo que le dice a un lector de pantalla que espere, ya
      // que el cambio de texto solo no se anuncia.
      aria-busy={cargando}
    >
      {cargando ? 'Un momento…' : children}
    </button>
  );
});

interface PropsCampoBase {
  etiqueta: string;
  error?: string | undefined;
  ayuda?: string | undefined;
  requerido?: boolean | undefined;
}

/**
 * Envoltura comun de los campos.
 *
 * Ata la etiqueta al control con `htmlFor`, y el error y la ayuda con
 * `aria-describedby`. Hecho a mano se olvida una de las tres la mitad de las
 * veces, y entonces el formulario queda inservible con lector de pantalla.
 */
function Envoltura({
  id,
  etiqueta,
  error,
  ayuda,
  requerido,
  children,
}: PropsCampoBase & { id: string; children: ReactNode }): ReactElement {
  return (
    <div className="pa-campo">
      <label className="pa-campo__etiqueta" htmlFor={id}>
        {etiqueta}
        {requerido === true && (
          <span className="pa-campo__requerido" aria-hidden="true">
            *
          </span>
        )}
        {requerido === true && <span className="solo-lectores"> (obligatorio)</span>}
      </label>
      {ayuda !== undefined && (
        <span className="pa-campo__ayuda" id={`${id}-ayuda`}>
          {ayuda}
        </span>
      )}
      {children}
      {/* `role="alert"` para que el error se anuncie al aparecer, no solo al
          llegar navegando hasta el. */}
      {error !== undefined && (
        <span className="pa-campo__error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function describe(id: string, error?: string, ayuda?: string): string | undefined {
  const partes = [
    ayuda !== undefined ? `${id}-ayuda` : '',
    error !== undefined ? `${id}-error` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return partes === '' ? undefined : partes;
}

type PropsCampo = PropsCampoBase & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>;

export const Campo = forwardRef<HTMLInputElement, PropsCampo>(function Campo(
  { etiqueta, error, ayuda, requerido, ...resto },
  ref
) {
  const generado = useId();
  const id = resto.name ?? generado;

  return (
    <Envoltura id={id} etiqueta={etiqueta} error={error} ayuda={ayuda} requerido={requerido}>
      <input
        ref={ref}
        id={id}
        className="pa-campo__control"
        aria-invalid={error !== undefined}
        aria-describedby={describe(id, error, ayuda)}
        required={requerido}
        {...resto}
      />
    </Envoltura>
  );
});

type PropsArea = PropsCampoBase & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'>;

export const AreaTexto = forwardRef<HTMLTextAreaElement, PropsArea>(function AreaTexto(
  { etiqueta, error, ayuda, requerido, ...resto },
  ref
) {
  const generado = useId();
  const id = resto.name ?? generado;

  return (
    <Envoltura id={id} etiqueta={etiqueta} error={error} ayuda={ayuda} requerido={requerido}>
      <textarea
        ref={ref}
        id={id}
        className="pa-campo__control pa-campo__control--area"
        aria-invalid={error !== undefined}
        aria-describedby={describe(id, error, ayuda)}
        required={requerido}
        {...resto}
      />
    </Envoltura>
  );
});

type PropsSelector = PropsCampoBase &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
    opciones: readonly { valor: string; texto: string }[];
    vacio?: string;
  };

export const Selector = forwardRef<HTMLSelectElement, PropsSelector>(function Selector(
  { etiqueta, error, ayuda, requerido, opciones, vacio, ...resto },
  ref
) {
  const generado = useId();
  const id = resto.name ?? generado;

  return (
    <Envoltura id={id} etiqueta={etiqueta} error={error} ayuda={ayuda} requerido={requerido}>
      <select
        ref={ref}
        id={id}
        className="pa-campo__control"
        aria-invalid={error !== undefined}
        aria-describedby={describe(id, error, ayuda)}
        required={requerido}
        {...resto}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </Envoltura>
  );
});

// ─── Presentacion ───────────────────────────────────────────────────────────

export function Tarjeta({
  children,
  pulsable = false,
  ...resto
}: {
  children: ReactNode;
  pulsable?: boolean;
} & React.HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div className={`pa-tarjeta${pulsable ? ' pa-tarjeta--pulsable' : ''}`} {...resto}>
      {children}
    </div>
  );
}

type TonoSello = 'neutro' | 'exito' | 'aviso' | 'error' | 'info' | 'validado';

export function Sello({
  tono = 'neutro',
  children,
}: {
  tono?: TonoSello;
  children: ReactNode;
}): ReactElement {
  return <span className={`pa-sello pa-sello--${tono}`}>{children}</span>;
}

/**
 * Sello de estado de una contratacion.
 *
 * El color sale del estado, no de quien lo pinta: asi el mismo estado se ve
 * igual en el listado, en el detalle y en la bandeja. Que cada pantalla eligiera
 * su color es como se acaba con un ACEPTADA verde en un sitio y azul en otro.
 */
const TONO_POR_ESTADO: Record<string, TonoSello> = {
  PENDIENTE: 'aviso',
  ACEPTADA: 'info',
  COMPLETADA: 'exito',
  RECHAZADA: 'neutro',
  CANCELADA: 'error',
  ABIERTA: 'info',
  ADJUDICADA: 'exito',
  VENCIDA: 'neutro',
  CERRADA: 'neutro',
  ENVIADA: 'info',
  DESCARTADA: 'neutro',
  RETIRADA: 'neutro',
  ACTIVE: 'exito',
  PENDING_VALIDATION: 'aviso',
  SUSPENDED: 'error',
  INACTIVE: 'neutro',
};

/** Texto en castellano de los estados que el backend nombra en ingles. */
const TEXTO_POR_ESTADO: Record<string, string> = {
  PENDING_VALIDATION: 'En revision',
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  INACTIVE: 'Retirado',
};

export function SelloEstado({ estado }: { estado: string }): ReactElement {
  return (
    <Sello tono={TONO_POR_ESTADO[estado] ?? 'neutro'}>
      {TEXTO_POR_ESTADO[estado] ?? estado.toLowerCase()}
    </Sello>
  );
}

type TonoAviso = 'exito' | 'aviso' | 'error' | 'info';

export function Aviso({
  tono = 'info',
  titulo,
  children,
}: {
  tono?: TonoAviso;
  titulo?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`pa-aviso pa-aviso--${tono}`}
      // Un error se anuncia al momento; el resto espera a que el lector
      // termine lo que esta diciendo.
      role={tono === 'error' ? 'alert' : 'status'}
    >
      <div>
        {titulo !== undefined && <div className="pa-aviso__titulo">{titulo}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

/** Esqueleto con la forma del contenido, para que la pagina no salte al cargar. */
export function Esqueleto({
  lineas = 3,
  ancho = '100%',
}: {
  lineas?: number;
  ancho?: string;
}): ReactElement {
  return (
    <div className="pa-pila pa-pila--2" aria-hidden="true">
      {Array.from({ length: lineas }, (_, i) => (
        <div
          key={i}
          className="pa-esqueleto"
          // La ultima linea mas corta: asi parece texto y no barras.
          style={{ width: i === lineas - 1 ? '60%' : ancho }}
        />
      ))}
    </div>
  );
}

export function Cargando({ que }: { que: string }): ReactElement {
  return (
    <div className="pa-pila pa-pila--4">
      <span className="solo-lectores" role="status">
        Cargando {que}
      </span>
      <Esqueleto lineas={4} />
    </div>
  );
}

/**
 * Estado vacio con salida.
 *
 * Siempre lleva una accion, porque un "no hay nada" sin nada que hacer deja a
 * la persona atascada mirando una pantalla en blanco.
 */
export function Vacio({
  titulo,
  children,
  accion,
}: {
  titulo: string;
  children?: ReactNode;
  accion?: ReactNode;
}): ReactElement {
  return (
    <div className="pa-vacio">
      <div className="pa-vacio__titulo">{titulo}</div>
      {children !== undefined && (
        <p className="pa-texto-medida" style={{ margin: '0 auto' }}>
          {children}
        </p>
      )}
      {accion !== undefined && <div style={{ marginTop: 'var(--esp-4)' }}>{accion}</div>}
    </div>
  );
}

/** Dinero en pesos colombianos, sin decimales: nadie cobra centavos. */
export function formatearDinero(valor: string | number | null): string {
  if (valor === null) return 'Sin precio indicado';
  const numero = typeof valor === 'string' ? Number(valor) : valor;
  if (!Number.isFinite(numero)) return 'Sin precio indicado';

  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(numero);
}

export function formatearFecha(valor: string | Date | null): string {
  if (valor === null) return '—';
  const fecha = typeof valor === 'string' ? new Date(valor) : valor;
  if (Number.isNaN(fecha.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(fecha);
}

/**
 * Vive en su propio archivo porque arrastra la justificacion de sus decisiones
 * de accesibilidad, y mezclarla aqui la enterraria. Se reexporta para que quien
 * importa del sistema de diseno lo haga siempre por aqui.
 */
export { ConmutadorModo, MODOS, type Modo } from './ConmutadorModo';
