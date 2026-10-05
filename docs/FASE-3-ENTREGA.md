# Fase 3 — Cliente web PWA. Entrega

Estado: **construida y verificada por CI**.
React 18 + TypeScript sobre Vite, 18 pantallas, sistema de diseño propio, PWA
instalable y dos escenas 3D selectivas. 127 pruebas del cliente, más las 235
unitarias del backend. `npm audit` sin vulnerabilidades altas ni críticas.

> **Alcance de este documento.** Describe la entrega tal como se hizo: 16 pantallas
> y 21 pruebas del cliente. Lo que vino después —recuperación de contraseña, modo
> oscuro, iconos del PWA— está en §7, y su recuento actual es 18 pantallas y 127
> pruebas.
>
> **Estado verificado el 3/10/2026.** Esta entrega pasó sus 21 pruebas del cliente.
> Después se añadieron recuperación de contraseña y modo oscuro, y el repositorio
> estuvo roto: `typecheck` fallaba con dos errores en `Restablecer.tsx` (uno de
> ellos el bug de fondo: el token de restablecimiento estaba escrito a mano, así que
> la página no podía restablecer ninguna contraseña real) y `lint` con 55
> problemas.
>
> **Hoy ambas puertas pasan, las rutas están cableadas y el cliente tiene 127
> pruebas en verde** (8 archivos). La puerta entera corre en CI.
>
> Estado de las puertas en [00-FLUJO-DEL-PROYECTO.md](00-FLUJO-DEL-PROYECTO.md) §1.
> Deuda heredada en [01-BACKLOG.md](01-BACKLOG.md) grupos C y G-5.

---

## 1. Qué se construyó

```
apps/web/src/
  api/          cliente HTTP, sesión en memoria, esquemas Zod, hooks de datos
  autenticacion/ contexto de sesión y ruta protegida
  ui/           sistema de diseño: sus componentes y su hoja de estilo
  estilos/      tokens y base
  paginas/      18 pantallas (16 en la entrega; 2 añadidas después)
  escenas/      las dos escenas 3D, en carga diferida
  pruebas/      127 pruebas en 8 archivos (21 en la entrega)
```

| Pantalla | Quién entra | Qué resuelve |
|---|---|---|
| Portada | cualquiera | Qué es esto, con la escena 3D |
| Entrar / Registro | cualquiera | Sesión y alta |
| Buscar servicios | **sin sesión** | Catálogo público |
| Ficha de servicio | sin sesión | Detalle y contratación |
| Mi perfil de prestador | oferente | Perfil, validación y catálogo propio |
| Necesidades / detalle | oferente | Demanda abierta y envío de propuestas |
| Mis propuestas | oferente | Seguimiento y retirada |
| Mis necesidades | solicitante | Publicar, ver propuestas y adjudicar |
| Mis contrataciones | con sesión | Las dos bandejas, por papel |
| Detalle de contratación | las dos partes | Estados, contacto, cancelación, calificación |
| Avisos | con sesión | Bandeja |
| Mi cuenta | con sesión | Roles y reputación por faceta |
| Administración | administrador | Revisión, actividad, parámetros, bitácora |

Las dos que se añadieron después de esta entrega, y que no están en la tabla
porque no formaban parte de ella:

| Pantalla | Quién entra | Qué resuelve |
|---|---|---|
| Recuperar contraseña | cualquiera | Pedir el enlace de restablecimiento |
| Restablecer contraseña | cualquiera con el token | Fijar la contraseña nueva |

Ninguna de las dos aparece en la tabla de arriba porque la tabla describe lo que
se entregó en su momento. Ambas están cableadas en `App.tsx` como rutas públicas y
tienen pruebas propias.

---

## 2. El sistema de diseño

La plantilla de `12-ux-ui/design-system.md` estaba sin rellenar (`#[hex]`). Lo
que propongo sale de quién va a usar esto: gente con teléfonos de gama media, a
veces a plena luz, con datos contados; y de la pregunta que de verdad resuelve
el producto, que no es "qué servicio quiero" sino **"puedo confiar en este
desconocido"**.

**Cuatro principios.**

1. **Contraste alto y objetivos grandes.** Mínimo de 44 px en todo lo pulsable.
   Por debajo, la gente falla el toque y pulsa lo de al lado, que aquí puede ser
   "cancelar".
2. **Las señales de confianza mandan.** El sello de validado, el estado de una
   contratación y la reputación son lo más legible de la pantalla.
3. **El color significa.** Como lleva el estado de una solicitud, **no** puede
   servir además de decoración.
4. **Cálido, no corporativo.** Son vecinos ayudándose, no un banco.

**Paleta.** Primario `#1f6f5c`, un verde profundo con algo de azul: verde porque
lee como avanzar y confiar, con esa pizca de azul para separarse del verde
"ecológico" y del azul que usa toda aplicación financiera. Acento `#c2571f`,
terracota, el complemento del primario, reservado a **una** acción por pantalla.
Fondo `#faf8f5` y no blanco puro: cansa menos la vista al sol y despega las
tarjetas sin necesidad de bordes.

El verde de éxito **no** es el de la marca. Si lo fuera, un botón primario y un
aviso de "salió bien" se verían igual y el color dejaría de informar.

El botón destructivo **no** es rojo de relleno: rojo en borde y texto. Un botón
rojo grande invita a pulsarlo por contraste, justo lo contrario de lo que se
busca.

**Tipografía.** Inter, por su legibilidad en tamaños pequeños, su cobertura de
tildes y eñes, y por ser libre. La escala crece despacio abajo (1,125) y más
rápido arriba (1,25): las listas necesitan densidad, los títulos separación.

**Accesibilidad.** El foco se ve siempre y nunca se anula. Cada campo ata su
etiqueta con `htmlFor` y su error con `aria-describedby` y `role="alert"`. Lo
obligatorio se dice con texto además del asterisco. Cada sello lleva color **y**
palabra. Quien pide menos movimiento no recibe ninguno, ni siquiera en 3D.

---

## 3. El 3D, y dónde no está

Aprobó 3D **selectivo**, no en todo. Hay dos escenas y ninguna más.

**Portada: herramientas sobre una superficie cálida.** Es lo primero que ve
alguien que no sabe qué es Punto Amigo, y una imagen plana no transmite oficio.
Todo son primitivas de three.js, sin modelos descargados: nada que bajar en una
conexión lenta, ninguna licencia de terceros, y el realismo sale de la luz y el
material, que es de donde sale de verdad.

**Administración: relieve de actividad.** Una barra por día. Está en 3D porque
la altura se compara de un golpe mejor que un tono: en un mapa de calor plano,
distinguir 40 de 60 obliga a mirar la leyenda. **Debajo hay siempre la tabla con
las mismas cifras**, y el lienzo está marcado como decorativo para los lectores
de pantalla. Un dato que solo existe en 3D es un dato que alguien no puede
consultar.

**Dónde no está:** en ninguna lista, ningún formulario y ningún detalle. Ahí solo
estorbaría.

**Lo que cuesta, y qué se hace con ello.** El trozo de three.js son 834 KB (224
KB comprimidos), aislado en su propio archivo; el paquete principal queda en 92
KB comprimidos. Y `conviene3d()` decide si bajarlo: se descarta con menos
movimiento, con ahorro de datos activado, en redes 2G, en pantallas estrechas y
en dispositivos de pocos núcleos. En la portada el degradado del CSS cuenta la
misma historia por cero bytes.

---

## 4. Seguridad del cliente

| Exigencia del brief | Cómo se cumple |
|---|---|
| Tokens **nunca** en localStorage | El access token vive en una variable de módulo. Una prueba recorre `localStorage` y `sessionStorage` enteros y falla si el token aparece con cualquier nombre |
| Sanitizar el HTML que se pinte | No hay ninguno: ningún componente acepta `dangerouslySetInnerHTML`. Todo el texto de personas se pasa como hijo y React lo escapa. Una prueba inyecta `<img onerror>` y comprueba que no nace ningún elemento |
| La interfaz no es control de acceso | `RutaProtegida` y `tieneRol()` solo deciden qué se muestra. El servidor decide en cada endpoint |

**El token se pierde al recargar, y es correcto.** Vive en memoria; al arrancar
se pide uno nuevo con la cookie httpOnly de refresco, que el script no puede
leer. Es exactamente para lo que existe la rotación.

**La renovación es una sola, compartida.** Si cinco peticiones reciben 401 a la
vez y cada una renueva por su cuenta, cuatro usarían un token de refresco ya
rotado; el servidor interpreta eso como robo y revoca la cadena, cerrando la
sesión de alguien que no hizo nada mal.

**El PWA no cachea nada del API.** Solo el caparazón. Una respuesta cacheada
puede llevar datos de contacto o una bandeja de avisos, y quedaría escrita en el
disco del dispositivo sobreviviendo al cierre de sesión.

**La actualización avisa en lugar de recargar sola.** Una recarga automática
puede ocurrir mientras alguien escribe una necesidad o acepta una contratación.

---

## 5. Defectos encontrados y corregidos

**La llave inglesa salía negra.** Un material con `metalness` alto no tiene color
propio: se ve reflejando lo que tiene alrededor, y sin entorno no hay nada que
reflejar. Se añadió `RoomEnvironment`, que viene con three.js y no exige
descargar ningún mapa. Es la diferencia entre acero y una mancha oscura.

**Una renovación encallada bloqueaba todas las siguientes.** La promesa
compartida es estado de módulo: si la petición no responde nunca, su `finally`
no corre y toda renovación posterior espera a esa. La aplicación se quedaba sin
poder renovar la sesión mientras durara la pestaña, sin un solo error en
consola. Ahora la renovación tiene un tope de 15 segundos y `borrarSesion()` la
abandona.

**Faltaba el catálogo de motivos de cancelación.** Los motivos viven en una
tabla precisamente para que un administrador los cambie sin desplegar, pero
ningún endpoint los exponía: el cliente habría tenido que llevarlos fijos,
reintroduciendo el acoplamiento que la tabla evita. Se añadió
`GET /api/v1/requests/cancellation-reasons`, y **la prueba de contrato OpenAPI
lo detectó sin documentar en cuanto existió**, que es exactamente su trabajo.
Devuelve `exigeDetalle` y `abreRevision`; no devuelve `computa` ni
`trasladaFalta`, porque publicar el efecto invitaría a elegir el motivo por su
consecuencia en lugar de por lo que pasó.

**Tres dependencias con avisos altos o críticos.** `react-router-dom` 6.x no
tenía versión corregida —el aviso cubre `react-router` hasta la 7.17.0—, así que
hubo que ir a la 7.18.4. `vite` y `vitest` se arreglaron con parches. Y el
`js-yaml` que yo mismo había fijado para la prueba de contrato resultó
vulnerable: lo fijé en 4.1.0 en el mismo commit que debía dejar la auditoría
limpia.

---

## 6. Cómo ejecutarlo

Con el backend levantado (`docker compose --profile apps up -d`):

```bash
cd ../friend-point-development && npm run dev --workspace @punto-amigo/web
```

Queda en `http://localhost:5173`, con el `/api` redirigido al gateway. Pruebas
del cliente:

```bash
cd ../friend-point-development/apps/web && npx vitest run
```

Compilar para producción:

```bash
cd ../friend-point-development && npm run build --workspace @punto-amigo/web
```

---

## 7. Pendientes

**El teléfono sigue sin llegar al contacto posterior al acuerdo.** La pantalla ya
lo pinta cuando viene, pero `UserRegistered` no lo lleva. Es la decisión que
sigue esperando (ver `FASE-2-ENTREGA.md`, 6.1). Mi recomendación sigue siendo
que salga del perfil de prestador: es el dato que el oferente declaró *para que
lo contacten*.

**No hay recuperación de contraseña en la interfaz.** — **Resuelto el 2/10/2026.**
`Recuperar.tsx` y `Restablecer.tsx` existen, están cableadas en `App.tsx` y tienen
pruebas propias (14 y 15 casos). El enlace «Olvide mi contraseña» de `Entrar.tsx`
ya no lleva a un 404. Falta el envío del correo, que es la Fase 7.

**Faltan los iconos del PWA.** — **Resuelto el 2/10/2026.** `icono-192.png`,
`icono-512.png`, `icono-maskable-512.png` e `icono.svg` existen y están declarados
en `manifest.webmanifest`, enlazado desde `index.html` con su `apple-touch-icon`.
Falta la confirmación visual en pantalla de inicio, que no se ha hecho.

**Pruebas de extremo a extremo.** Las del cliente cubren sesión, componentes, ruta
protegida, modo, recuperación y restablecimiento. Un recorrido completo con
navegador —publicar, proponer, adjudicar, cancelar— daría más confianza que
cualquiera de ellas por separado, y `11-quality/testing-strategy.md` las exige
para el Go/No-Go.

**Los seis pendientes de la Fase 2 siguen abiertos**, ninguno bloquea esto.
