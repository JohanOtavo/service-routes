import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Aviso, Boton, Campo, SelloEstado, formatearDinero } from '../ui';

/**
 * Pruebas del sistema de diseno.
 *
 * Se centran en lo que se rompe en silencio: la accesibilidad de los
 * formularios y el escapado del texto. Que un boton sea verde se ve de un
 * vistazo; que un campo haya perdido su etiqueta, no, y deja el formulario
 * inservible con lector de pantalla.
 */

describe('Campo', () => {
  it('ata la etiqueta al control', () => {
    render(<Campo etiqueta="Correo" name="correo" />);

    // `getByLabelText` falla si la etiqueta no apunta al control, que es
    // justo el defecto que se busca.
    const control = screen.getByLabelText(/Correo/u);
    expect(control.id).toBe('correo');
  });

  it('un campo con error lo anuncia y queda marcado como invalido', () => {
    render(<Campo etiqueta="Correo" name="correo" error="Ese correo no parece valido." />);

    const control = screen.getByLabelText(/Correo/u);
    expect(control.getAttribute('aria-invalid')).toBe('true');
    // El error se ata con `aria-describedby`: sin eso, el lector lee el campo y
    // no dice por que esta mal.
    expect(control.getAttribute('aria-describedby')).toContain('correo-error');

    // Y con `role="alert"` para que se anuncie al aparecer, no solo al llegar
    // navegando hasta el.
    expect(screen.getByRole('alert').textContent).toBe('Ese correo no parece valido.');
  });

  it('lo obligatorio se dice con texto, no solo con un asterisco', () => {
    render(<Campo etiqueta="Nombre" name="nombre" requerido />);
    // Un asterisco no se lee en voz alta de forma util.
    expect(screen.getByText('(obligatorio)')).toBeDefined();
  });
});

describe('Boton', () => {
  /** Sin esto, un doble clic manda la operacion dos veces. */
  it('mientras carga queda deshabilitado y marcado como ocupado', () => {
    render(<Boton cargando>Aceptar</Boton>);

    const boton = screen.getByRole('button');
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    expect(boton.getAttribute('aria-busy')).toBe('true');
  });

  it('su tipo por omision es button, no submit', () => {
    // Dentro de un formulario, un boton sin tipo lo envia. Mas de un dialogo de
    // confirmacion se ha enviado solo por esto.
    render(<Boton>Cancelar</Boton>);
    expect(screen.getByRole('button').getAttribute('type')).toBe('button');
  });
});

describe('SelloEstado', () => {
  /** El mismo estado se ve igual en el listado, el detalle y la bandeja. */
  it('traduce los estados que el backend nombra en ingles', () => {
    render(<SelloEstado estado="PENDING_VALIDATION" />);
    expect(screen.getByText('En revision')).toBeDefined();
  });

  it('un estado desconocido se muestra tal cual en vez de desaparecer', () => {
    render(<SelloEstado estado="ALGO_NUEVO" />);
    expect(screen.getByText('algo_nuevo')).toBeDefined();
  });
});

describe('escapado del texto', () => {
  /**
   * Todo el texto de esta aplicacion lo escribe gente: descripciones de
   * servicios, mensajes de propuestas, comentarios de calificaciones. Ningun
   * componente acepta HTML, asi que React lo escapa y no hay XSS que inyectar.
   */
  it('el texto de una persona se pinta como texto, no como HTML', () => {
    const malicioso = '<img src=x onerror="alert(1)">';
    const { container } = render(<Aviso>{malicioso}</Aviso>);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain(malicioso);
  });
});

describe('formato de dinero', () => {
  it('muestra pesos sin decimales', () => {
    // Nadie cobra centavos en este dominio.
    expect(formatearDinero('150000.00')).toContain('150.000');
    expect(formatearDinero('150000.00')).not.toContain(',00');
  });

  it('un importe ausente o invalido no imprime NaN', () => {
    expect(formatearDinero(null)).toBe('Sin precio indicado');
    expect(formatearDinero('no es un numero')).toBe('Sin precio indicado');
  });
});
