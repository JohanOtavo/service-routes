# Runbook — respaldo y restauración

Cierra **AT-004**, el único elemento de severidad `High` del proyecto.

- Herramienta: [`db/respaldo.sh`](../db/respaldo.sh)
- Primera restauración verificada: **3 de octubre de 2026**
- Registro: `pa_admin.backup_record`, columna `restauracion_probada_at`

> **Por qué AT-004 era `High`.** `backup_record` existía desde la Fase 1 con una
> columna `restauracion_probada_at` que **nadie escribía**, porque no había ni
> procedimiento ni herramienta. Un respaldo que nunca se ha restaurado no es un
> respaldo: es un archivo del que se supone algo. El SRS lo exige en RNF74.

---

## 1. Lo que se ejecutó, y qué salió

Los tres subcomandos funcionan y la verificación completa pasó sobre los siete
esquemas:

| Esquema | Tablas comparadas | Tamaño del volcado | Restauración verificada |
|---|---|---|---|
| `pa_auth` | 12 | 4 076 B | 2026-10-03 22:08:35 UTC |
| `pa_provider` | 7 | 2 150 B | 2026-10-03 22:08:45 UTC |
| `pa_catalog` | 8 | 2 749 B | 2026-10-03 22:08:56 UTC |
| `pa_request` | 18 | 5 693 B | 2026-10-03 22:09:16 UTC |
| `pa_rating` | 10 | 2 985 B | 2026-10-03 22:09:28 UTC |
| `pa_notification` | 6 | 1 862 B | 2026-10-03 22:09:38 UTC |
| `pa_admin` | 8 | 6 888 B | 2026-10-03 22:09:48 UTC |

**69 tablas comparadas, fila por fila.** Los tamaños son pequeños porque es un
entorno de desarrollo con semillas; lo que se valida es el procedimiento, no el
volumen.

### Los dos defectos que la primera versión del script tenía

Se dejan escritos porque los dos son el mismo tipo de error —una comprobación
que dice «verificado» sin haber comprobado nada— y es exactamente contra eso que
existe AT-004.

**1. La huella salía casi vacía y la comparación pasaba por vacuidad.** La
función que cuenta filas por tabla ejecutaba `docker exec -i` dentro de un
`while read`. `-i` hace que el proceso lea la entrada estándar, y dentro del
bucle se comía las líneas que le quedaban por leer. El resultado: la huella del
original traía **una** tabla en lugar de siete, la del esquema restaurado traía
la misma cantidad truncada, las dos coincidían, y el script anunciaba
`restauracion VERIFICADA (1 tablas)`. Corregido quitando `-i` de las consultas
—solo lo necesitan el volcado y la restauración, que sí canalizan datos— y
añadiendo una guarda explícita: una huella con menos de una tabla **no** es una
verificación, es un resultado no concluyente.

**2. `probar pa_admin` no podía pasar nunca.** `crear` inserta en
`backup_record` la fila del propio respaldo *después* de volcar, así que el
esquema original gana una fila que el volcado no puede contener. La diferencia
era de exactamente 1 y era sistemática. `backup_record` queda excluida de la
comparación: la tabla que registra un respaldo no puede formar parte de la
verificación de ese respaldo.

---

## 2. Los tres subcomandos

### Crear un respaldo

```bash
./db/respaldo.sh crear            # los siete esquemas
./db/respaldo.sh crear pa_auth    # solo uno
```

Escribe en `./dumps/` —configurable con `PA_BACKUP_DIR`— un
`<esquema>-<AAAAMMDD>T<HHMMSS>Z.sql.gz`, y registra la fila en `backup_record`
con su tamaño y su ubicación. Si el volcado falla, **también** se registra, con
`exitoso = 0`: un fallo que no deja rastro es un fallo que nadie revisa.

Dos opciones del volcado que no son adornos:

- `--single-transaction` — volcado consistente sin bloquear escrituras.
- `--routines --triggers --events` — `audit_record` es inmutable **gracias a dos
  disparadores**. Un volcado sin ellos restauraría una tabla de auditoría que se
  puede modificar, lo cual es peor que no tener respaldo.

### Restaurar

```bash
./db/respaldo.sh restaurar dumps/pa_auth-20261003T220830Z.sql.gz pa_auth_recuperado
```

**Exige el esquema de destino y nunca lo deduce.** El volcado lleva
`CREATE DATABASE` del esquema original, así que restaurar sobre otro nombre
implica reescribir esas sentencias; se hace sobre el flujo con `sed`, sin tocar
el archivo de respaldo.

Que el destino sea explícito es deliberado: restaurar sobre el esquema de
producción «para comprobar» destruiría justo lo que se intenta proteger.

### Probar (el que cierra AT-004)

```bash
./db/respaldo.sh probar           # los siete
./db/respaldo.sh probar pa_admin  # solo uno
```

1. Crea el respaldo
2. Lo restaura en `<esquema>_verificacion`, un esquema aparte
3. Compara tabla por tabla el número de filas contra el original
4. Si coincide, escribe `restauracion_probada_at` en la fila de ese respaldo
5. Tira el esquema de verificación, pase o falle

El paso 5 no es limpieza por orden: dejarlo sería una copia de los datos
personales sin dueño, sin usuario propio y sin política de conservación.

---

## 3. Recuperación ante desastre

El orden importa, y el paso 4 es el que no es obvio.

1. **Levantar la infraestructura.** `docker compose up -d mysql redis rabbitmq`,
   o el equivalente del entorno. Los esquemas y los siete usuarios los crea
   `db/init/01-schemas-and-users.sh`.
2. **Restaurar cada esquema sobre su nombre real**, desde el respaldo más
   reciente cuyo `exitoso = 1`:
   ```bash
   ./db/respaldo.sh restaurar dumps/pa_auth-<sello>.sql.gz pa_auth
   ```
3. **Comprobar los invariantes.** `db/verify-invariants.sh` ejecuta 31 pruebas
   negativas contra MySQL real. Si alguna falla, el respaldo está corrupto y hay
   que ir al anterior.
4. **Reconstruir las réplicas si se perdió el estado de los eventos.**
   ```bash
   npm run db:reemit
   ```
   Hace falta cuando se restaura un esquema a un punto anterior al de otro: las
   tablas `*_ref` se alimentan de eventos consumidos, y `processed_event` guarda
   cuáles ya se procesaron. Sin este paso, el catálogo puede quedarse sin
   prestadores y nada volvería a poblarlo. El detalle está en
   [01-BACKLOG.md](01-BACKLOG.md) A-2.
5. **Arrancar los servicios.** El relevo del outbox publica lo que quedó
   pendiente, incluidos los eventos de la re-emisión.

### Lo que `reemit` NO reconstruye

`cancelacion_ref`. Su evento, `ServiceRequestCancelled`, no solo replica: imputa
la cancelación a la tasa de un usuario. Re-emitirlo contaría dos veces
cancelaciones reales y podría cruzar el umbral que suspende a un prestador.
Queda abierto en el backlog en lugar de resuelto a medias.

---

## 4. Lo que este runbook todavía NO cubre

Para que no se lea como «los respaldos ya están resueltos». AT-004 pedía un
procedimiento escrito y una restauración probada, y eso está; la operación de
respaldos en producción es más que eso y es trabajo de la Fase 8.

| Falta | Por qué importa | Fase |
|---|---|---|
| **Programación automática** | Hoy `crear` se invoca a mano. Un respaldo que depende de que alguien se acuerde no es una garantía | 8 |
| **Copia fuera del servidor** | `./dumps/` vive en la misma máquina que la base. Un fallo de disco se lleva las dos | 8 |
| **Cifrado en reposo** | Los volcados contienen datos personales en claro: nombres, correos y teléfonos | 8 · depende de §5 de la política |
| **Recuperación a un punto en el tiempo** | Con volcados periódicos, el daño máximo es todo lo ocurrido desde el último. Requiere el log binario | 8 |
| **RPO y RTO declarados** | Nadie ha fijado cuántos datos se acepta perder ni en cuánto tiempo hay que estar en pie | decisión |
| **Prueba periódica** | La restauración se verificó una vez. Un respaldo verificado en octubre no dice nada de diciembre | 8 |

---

## 5. Relación con la política de datos personales

Un volcado de `pa_auth` contiene nombres, correos y teléfonos sin cifrar. La
política de conservación y anonimización —bloqueante de producción según el
SRS— tiene que decir **cuánto se conservan los respaldos** y **qué pasa con los
datos de alguien que pide su borrado y sigue dentro de un volcado antiguo**.

Ese documento no existe todavía: es el otro elemento de la Fase 5, y es el que
convierte este runbook en algo que se puede ejecutar en producción sin
incumplir una obligación legal.
