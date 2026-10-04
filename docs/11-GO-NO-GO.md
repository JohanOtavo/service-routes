# Expediente Go/No-Go — Punto Amigo

Lo que el sistema cumple hoy, con su evidencia, y lo que falta para que alguien
pueda decir «sí» o «no» con fundamento. Es la puerta que `00-sdd-guide.md`
§Review gates pone antes de producción: *«DoD, DoR, NFRs all satisfied?»*,
aprobada por Tech Lead y Product Owner.

- Fecha: **4 de octubre de 2026**
- Fase: **10 de 10** — preparación de producción. No es trabajo nuevo: es la
  comprobación de que lo anterior está resuelto
- **Veredicto a día de hoy: NO-GO.** Y no por el software

---

## 1. El veredicto, en cuatro líneas

| | |
|---|---|
| **Lo que funciona** | Nueve procesos, 282 requisitos con 164 trazados, 368 pruebas de Jest y 129 de Vitest en verde, el recorrido crítico pasando en un navegador real **en CI**, P95 de 6,98 ms contra un umbral de 300 ms, y una restauración de respaldo probada sobre los siete esquemas |
| **Lo que bloquea** | **Tres cosas, y ninguna es código**: la política de datos personales (seis decisiones), la elección de nube (AT-001) y la revisión por Pull Request, que el *Definition of Done* exige y que ninguna de las nueve fases ha cumplido |
| **Lo que no bloquea pero conviene saber** | No hay alertas, ni registros centralizados, ni trazas distribuidas. Hay paneles: una caída se descubre mirando |
| **Quién tiene que decidir** | Tú. Las tres cosas que bloquean son decisiones, no implementaciones |

## 2. Definition of Done, bloque por bloque

Evaluado sobre el sistema entero, no sobre una historia de usuario.

### Requisitos y criterios de aceptación

| Criterio | Estado | Evidencia |
|---|---|---|
| La implementación satisface los criterios de aceptación | **Parcial** | Los recorridos crítico y de recuperación pasan en navegador real en CI. No existe un registro de criterios de aceptación por historia contra el que marcar uno a uno: nueve historias no tienen ni código RF asignado (**O-06**) |
| Es coherente con los requisitos funcionales y no funcionales | **Parcial** | [10-TRAZABILIDAD.md](10-TRAZABILIDAD.md): 164 de 282 requisitos citados por el código, 57 con una prueba que los nombra. Los 118 restantes no están clasificados entre «es código» y «es proceso» |
| El comportamiento no contradice la documentación existente | **NO** | Contradicciones conocidas y escritas: `02-auth-service` declara PostgreSQL y puerto 8081 (**O-11**, bloqueante), `service-catalog.md` marca los ocho servicios como *Planned* (**TD-011**), y `10-devops/environments.md` difiere en tres puntos (**TD-008**) |
| Mantiene trazabilidad al requisito | **Sí**, para lo que está trazado | La matriz se regenera desde el código, con cero citas a identificadores inexistentes |

### Código

| Criterio | Estado | Evidencia |
|---|---|---|
| Implementa la funcionalidad correctamente | **Sí**, en lo cubierto | 368 + 129 pruebas, 4 recorridos E2E en CI |
| Sigue los estándares de formato del proyecto | **Sí** | `npm run format:check` y `npm run lint --max-warnings=0` en la puerta |
| **Revisado por al menos otra persona mediante Pull Request** | **NO** | Ninguna de las nueve fases. Es un criterio **obligatorio** |
| Sin secretos en el código ni en el repositorio | **Sí** | Los secretos entran por entorno; `assertProductionSafety` rechaza el valor de ejemplo de `INTERNAL_SERVICE_SECRET` en producción, y `.dockerignore` impide que el `.env` entre en una imagen |
| No introduce deuda técnica innecesaria | **Sí** | En esta fase se borraron 222 líneas de middleware duplicado y nueve copias del mismo logger |
| La deuda que no se resuelve queda documentada | **Sí** | [08-BACKLOG-TECNICO.md](08-BACKLOG-TECNICO.md), con impacto, esfuerzo y prioridad |

### Pruebas

| Criterio | Estado | Evidencia |
|---|---|---|
| Hay pruebas para lo implementado | **Sí** | 216 unitarias, 152 de integración contra MySQL, RabbitMQ y Redis reales, 129 de interfaz, 4 E2E |
| La lógica de negocio nueva tiene cobertura | **Parcial** | Cobertura medida: 68,41 / 56,12 / 67,46 / 70,58. La estrategia pide 80/80/80/70 (**TD-007**); el trinquete está en 65/52/64/67 y se decidió mantenerlo con la brecha anotada |
| Todas las pruebas relevantes pasan | **Sí** | Y pasan **en CI**, que no es lo mismo: hasta la Fase 4 las de integración no se ejecutaban en ningún runner |
| Sin regresiones | **Sí** | La puerta completa corre en cada push |
| Los criterios de aceptación se verifican | **Parcial** | Lo verificado son recorridos, no una lista de criterios por historia |

### Seguridad

| Criterio | Estado | Evidencia |
|---|---|---|
| Autenticación y autorización respetadas | **Sí** | El gateway verifica firma, algoritmo y lista de denegación; los servicios exigen el secreto compartido y deniegan por defecto |
| Roles y permisos aplicados en el servidor | **Sí** | `requireRole` en el servidor; la interfaz solo oculta opciones, que es comodidad y no control (RNF23) |
| Entrada validada antes de procesarse | **Sí** | Zod en cuerpo y consulta, con `.strict()`: un campo no declarado se rechaza en vez de ignorarse |
| Información sensible tratada con cuidado | **Sí** | Contraseñas con argon2; el registro y las métricas no copian cuerpos ni cabeceras; el contacto se revela solo tras el acuerdo |
| Los cambios de seguridad se revisan | **NO** | Es el mismo hueco del Pull Request |

Tres defectos de seguridad reales encontrados y corregidos en estas dos últimas
fases, que conviene tener a la vista porque son el tipo de cosa que una revisión
busca: la **lista de denegación caducaba antes que el token** si alguien subía
el TTL, el **limitador por IP detrás del gateway** ponía un techo de 100
peticiones por minuto a todo el sistema, y el `.env` real **entraba en el
contexto de construcción** de las nueve imágenes por no existir un
`.dockerignore`.

### Integración

| Criterio | Estado | Evidencia |
|---|---|---|
| Integra correctamente con el sistema | **Sí** | Nueve contenedores, `up -d --wait` desde volúmenes vacíos, y el recorrido completo pasando después |
| Los cambios de API son coherentes con la estructura REST | **Parcial** | Hay ocho contratos OpenAPI y una prueba que falla si el código expone una ruta que el contrato no declara. Lo que falta es congelar la estructura definitiva (**AT-002**) y resolver los contratos duplicados (**TD-014**) |
| Los cambios de base de datos son coherentes con el modelo | **Sí** | Migraciones versionadas y reversibles, siete esquemas aislados, sin claves ajenas cruzadas (RNF53) |
| Sin errores de integración conocidos | **Sí** | Los siete que había quedaron corregidos y documentados en [FASE-8-ENTREGA.md](FASE-8-ENTREGA.md) §3 |

### Interfaz

| Criterio | Estado | Evidencia |
|---|---|---|
| Coherente con el diseño | **Sí** | Sistema de diseño propio, 18 pantallas |
| Formularios con validación y mensajes de error | **Sí** | Y el resultado de una cancelación **ya no desaparece** al cambiar el estado (I-6) |
| Las operaciones correctas dan confirmación | **Sí** | Con la excepción corregida arriba |
| Navegación y flujos funcionan | **Sí** | Verificado en navegador real, en CI |
| Responsiva en los dispositivos soportados | **Sin verificar automáticamente** | No hay prueba de puntos de ruptura; se comprobó a mano en la Fase 3 |
| Funcionalidad según rol | **Sí** | Y una carga en frío ya no pierde los roles: era un defecto real que encontró la primera E2E |

### Documentación

| Criterio | Estado | Evidencia |
|---|---|---|
| Se actualiza cuando el cambio afecta a comportamiento documentado | **Sí**, desde la Fase 4 | Cada fase entrega su documento, y la Fase 9 documentó los nueve procesos |
| La trazabilidad se actualiza | **Sí** | [10-TRAZABILIDAD.md](10-TRAZABILIDAD.md), regenerable |
| La documentación técnica se actualiza | **Sí** en este repositorio; **NO** en `friend-point-docs` | Está congelado, y qué hacer con él es **AT-003** |
| Las decisiones significativas se documentan | **Sí** | [02-DECISIONES.md](02-DECISIONES.md) y un `decisions.md` por servicio |
| La documentación obsoleta se corrige al detectarse | **Parcial** | Detectada y escrita; no corregida donde vive (O-11, TD-011, TD-015) |

### Git y Pull Request

| Criterio | Estado |
|---|---|
| Commits con las convenciones del proyecto | **Sí** |
| Mensajes en formato Conventional Commits | **Sí** |
| El PR describe los cambios | **NO: no hay PR** |
| El PR referencia la historia o el requisito | **NO** |
| Al menos una persona revisó y aprobó | **NO** |
| Conflictos resueltos y cambios verificados | **Sí**, en `develop` |
| Listo para integrarse en la rama correspondiente | **Sí** |

## 3. Las tres cosas que bloquean, y qué haría falta

### 3.1 La política de datos personales · **bloqueante por el SRS**

El inventario está hecho: qué dato personal vive en qué esquema, qué hace ya
bien el código, y las **seis decisiones** que faltan
([04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md)).

El SRS la marca como requisito bloqueante, y el propio *Definition of Done* dice
que **una excepción no puede usarse para ignorar un criterio crítico de
seguridad**. Así que no hay camino de «salir ahora y decidir después».

### 3.2 La nube · **AT-001**

Sin proveedor no hay red, ni registro de imágenes, ni gestor de secretos, ni
entorno dev, staging o producción. Lo que sí está listo es el inventario de lo
que el código espera encontrar, en
[06-ENTORNOS-Y-DESPLIEGUE.md](06-ENTORNOS-Y-DESPLIEGUE.md) §5, y las dos
decisiones que viajan con ella: la estrategia de despliegue —que el documento de
DevOps deja como `[Canary / Blue-Green / Rolling]`— y la retención de respaldos
con su RTO (**O-09**).

### 3.3 La revisión por Pull Request

Es un criterio obligatorio del DoD y **ninguna de las nueve fases lo cumple**.
Todo el trabajo entró directo a `develop`.

Esto tiene arreglo sin rehacer nada: abrir un Pull Request de `develop` a `main`
con el historial completo, que es lo que la Fase 10 necesita de todas formas
para llevar el trabajo a la rama de integración. Lo que hace falta es **alguien
que lo revise**, y eso es una decisión de equipo, no una tarea de código.

## 4. Deuda técnica: estado al cierre de la Fase 9

| Grupo | Total | Abiertos |
|---|---|---|
| Deuda registrada (AT-001 a AT-007) | 7 | **2** · AT-001 y AT-003, las dos decisiones |
| Backlog completo | 66 | **31** |
| Backlog técnico con formato de gobernanza | 15 ítems abiertos al abrirlo | **12** |

Cerrados en las dos últimas fases: AT-005, AT-006, AT-007, I-5, I-6, J-1, J-2 y
los nueve elementos de documentación ausente.

## 5. Lo que recomiendo

Por orden, y con el motivo:

1. **Decidir las seis de datos personales.** Es lo único que el SRS declara
   bloqueante y no depende de nada más.
2. **Abrir el Pull Request de `develop` a `main` y que alguien lo revise.** El
   criterio del DoD no se cumple con más código, y el trabajo ya está hecho.
3. **Elegir nube (AT-001)** y, con ella, estrategia de despliegue y retención de
   respaldos.
4. **Decidir AT-003**, que destraba de una vez O-11, TD-011, TD-014 y TD-015:
   cuatro pendientes que hoy no se pueden cerrar desde este repositorio.
5. **Antes del primer despliegue real, las alertas** (TD-012). Un sistema que se
   observa mirando un panel no se observa de noche.

## 6. Qué significaría «Go»

Para que este expediente diga «sí», hacen falta exactamente cuatro cosas, y
tres son firmas:

- [ ] Las seis decisiones de datos personales, tomadas y escritas
- [ ] Un Pull Request revisado y aprobado por alguien que no sea quien lo abrió
- [ ] Nube elegida, con la infraestructura creada y un despliegue probado
- [ ] Alertas con un destino y alguien que las reciba

Lo demás —los 118 requisitos sin clasificar, la cobertura por debajo del 80 %,
la responsividad sin prueba automática— es trabajo pendiente anotado, con su
riesgo escrito, y cabe dentro de las **excepciones permitidas** del DoD siempre
que se registren como tales. Las cuatro de arriba, no.
