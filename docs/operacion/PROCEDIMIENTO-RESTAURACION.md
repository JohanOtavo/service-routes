# Procedimiento de restauración de respaldos (AT-004)

**Estado:** Completado con procedimiento verificable.  
**Origen:** Deuda técnica AT-004 (High). `09-ops/backup-strategy.md` y tabla `pa_admin.backup_record`.

## 1. Objetivo

Definir un procedimiento reproducible para restaurar un respaldo (`.sql.gz` o export válido) en un entorno objetivo, verificar su integridad, actualizar el registro de respaldo y documentar el resultado. El objetivo es que `backup_record.restauracion_probada_at` refleje una restauración **probada**, no meramente registrada.

## 2. Alcance

- Restauraciones de desarrollo/staging para validación.
- Restauraciones de producción (requieren aprobación previa y ventana de mantenimiento).
- No cubre recuperación de instancias completas (snapshots de infraestructura), solo restauración de datos vía dump SQL generado por la estrategia de respaldo.

## 3. Prerrequisitos

- Respaldo válido disponible (ruta/objeto de almacenamiento). Verificar checksum/fecha.
- Acceso a base de datos destino con permisos suficientes para crear/esquemas y restaurar (usuario con `CREATE`, `DROP`, `INSERT`, `ALTER`, etc., según esquema).
- Espacio en disco suficiente para descomprimir y cargar.
- Ventana de mantenimiento acordada si es producción.
- Bitácora de cambios (incidente/orden de trabajo).

## 4. Preparación

1. **Identificar respaldo**: localizar `backup_record` con `ruta_respaldo` y `checksum` conocidos. Registrar `id_backup` a restaurar.
2. **Hacer respaldo del estado actual** (si aplica): generar un respaldo incremental/previo antes de sobrescribir destino.
3. **Notificar**: avisar a responsables (Tech Lead + DevOps). En producción, requiere aprobación escrita.
4. **Congelar escrituras** (recomendado): detener consumidores/procesos que escriban en las bases afectadas durante la restauración.
5. **Verificar integridad**: comprobar tamaño, fecha y checksum del archivo.

## 5. Procedimiento de restauración

### 5.1 Desarrollo/Staging (validación)

```bash
# Descomprimir (si .gz)
gunzip -c /ruta/backup_YYYYMMDD_HHMMSS.sql.gz > /tmp/restore.sql

# Restaurar (ejemplo MySQL)
mysql -h $MYSQL_HOST -u $MYSQL_USER -p$MYSQL_PASSWORD < /tmp/restore.sql
```

### 5.2 Consideraciones para MySQL/Multi-esquema

- Restaurar en orden si hay dependencias (esquemas base primero). Los dumps generados por estrategia deben preservar orden.
- Si el destino tiene datos, evaluar estrategia: **restaurar sobre BD limpia** (drop/create database) vs **restauración parcial**. Para validación de procedimiento, preferir BD limpia.
- Verificar variables (`FOREIGN_KEY_CHECKS`, `sql_mode`) si aparecen errores de FK durante carga.

## 6. Verificación post-restauración

Obligatorio antes de marcar como probada:

1. **Conteo de tablas/esquemas**: comparar número de tablas por esquema vs esperado.
2. **Conteos críticos**: verificar al menos una tabla por dominio (`usuario`, `necesidad`, `propuesta`, `prestador_ref`, `servicio`, `calificacion`) tiene filas coherentes.
3. **Integridad referencial**: ejecutar chequeos básicos (sin órbitas huérfanas evidentes). Si existen migraciones, confirmar versión aplicada (`knex_migrations`).
4. **Smoke tests**: ejecutar `npm run test:integration --maxTests=50` o suite mínima de lectura sobre datos restaurados.
5. **Servicios**: levantar servicios y verificar healthchecks. Confirmar que `admin-reporting-service` puede leer réplicas y que el cálculo de estadísticas no falla con datos restaurados.

## 7. Registro y cierre

1. **Marcar restauración probada**: actualizar `pa_admin.backup_record`
   ```sql
   UPDATE pa_admin.backup_record
   SET restauracion_probada_at = NOW(),
       notas = CONCAT(COALESCE(notas,''), ' | Restauración probada en staging el YYYY-MM-DD HH:MM:SS')
   WHERE id_backup = <ID>;
   ```

2. **Registrar bitácora**: anotar en registro de incidentes/despliegue: quién, cuándo, respaldo usado, resultado, tiempo y observaciones.
3. **Limpiar temporales**: borrar dumps temporales y credenciales en memoria.
4. **Reanudar escrituras**: volver a levantar consumidores una vez verificada la estabilidad.

## 8. Criterio de aceptación (AT-004)

AT-004 se considera **cerrado** cuando:

- Existe este procedimiento, versionado en el repositorio.
- Ha sido ejecutado al menos **una vez en staging** sobre un respaldo real.
- `backup_record.restauracion_probada_at` queda **rellenado** para ese `id_backup` con la fecha/hora de la validación.
- Queda registrada la evidencia (bitácora/commit) de dicha prueba.

## 9. Rollback

Si la verificación falla: detener servicios, restaurar el respaldo previo (tomado en paso 4.2), reanudar y documentar fallo (causa + acción correctiva).

## 10. Notas

- Nunca restaurar producción sin ventana aprobada y plan de rollback.
- Proteger archivos de respaldo (permisos, cifrado en tránsito/reposo según política de seguridad).
- Este procedimiento no sustituye a snapshots de infraestructura, pero valida la **restaurabilidad de los dumps SQL** exigida por AT-004.