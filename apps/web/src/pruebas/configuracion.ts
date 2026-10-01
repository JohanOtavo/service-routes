/**
 * Preparacion de las pruebas del cliente.
 *
 * Sin `@testing-library/jest-dom`: sus comparadores son comodidad, y en este
 * monorepo quedaba elevado a la raiz mientras vitest se instalaba anidado, de
 * modo que no se encontraban. Las aserciones nativas de vitest dicen lo mismo
 * con una dependencia menos.
 */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin esto, un componente de una prueba sigue montado en la siguiente y los
// selectores encuentran dos copias de todo.
afterEach(() => {
  cleanup();
});
