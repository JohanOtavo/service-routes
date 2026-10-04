import type { Request } from 'express';
import { claveDeLimite } from '../src/http';

/**
 * Pruebas de la clave del limitador de peticiones (hallazgo J-1).
 *
 * El defecto que vigilan: los ocho servicios de dentro reciben TODAS sus
 * peticiones desde una sola direccion, la del gateway, asi que un limitador por
 * IP no limita por cliente sino por proxy. Con 100 por minuto, el techo
 * efectivo de todo el sistema eran 100 peticiones por minuto, y dos usuarios
 * activos podian agotar el cupo de los demas. Se descubrio midiendo: la prueba
 * de carga recibia 429 desde catalog-service con el limite del gateway ya
 * elevado.
 *
 * Lo que tiene que quedar fijo es que dos usuarios distintos NO comparten cupo,
 * y que un valor que no sea un identificador no se usa como clave.
 */

function peticion(cabecera?: string, ip = '172.18.0.9'): Request {
  return {
    ip,
    header: (nombre: string) =>
      nombre.toLowerCase() === 'x-internal-user-id' ? cabecera : undefined,
  } as unknown as Request;
}

describe('clave del limitador', () => {
  it('da claves distintas a usuarios distintos aunque vengan de la misma IP', () => {
    // Arrange y Act
    const uno = claveDeLimite(peticion('34'));
    const otro = claveDeLimite(peticion('35'));

    // Assert: es el punto del arreglo. Con la clave por IP los dos caian en la
    // misma cuenta, que es la del gateway.
    expect(uno).not.toBe(otro);
    expect(uno).toBe('u:34');
  });

  it('cae a la IP cuando no hay identidad', () => {
    // Las rutas publicas no traen identidad. A este lado esa IP es la del
    // gateway, asi que el trafico anonimo comparte cupo: es el caso que el
    // limitador por IP del gateway ya controla cliente a cliente, antes.
    expect(claveDeLimite(peticion(undefined, '10.0.0.4'))).toBe('ip:10.0.0.4');
  });

  it('ignora una cabecera que no sea un identificador', () => {
    // La cabecera la escribe el gateway, pero la clave del limitador no es
    // sitio para confiar en un formato: un valor arbitrario crearia una entrada
    // nueva en el contador por cada variante enviada.
    for (const basura of ['0', '-1', 'abc', '12a', '', ' 34 ']) {
      expect(claveDeLimite(peticion(basura, '10.0.0.5'))).toBe('ip:10.0.0.5');
    }
  });

  it('no confunde un identificador con una direccion', () => {
    // Sin prefijo, el usuario 34 y una IP llamada "34" compartirian contador.
    expect(claveDeLimite(peticion('34'))).toBe('u:34');
    expect(claveDeLimite(peticion(undefined, '34'))).toBe('ip:34');
  });
});
