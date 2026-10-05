# Política de conservación y anonimización de datos personales

**Estado:** Decisión pendiente (requiere aprobación de PO/Seguridad). No bloquea cierre técnico de Fase 5.  
**Origen:** SRS — decisión abierta marcada como bloqueante para producción.

## 1. Alcance

Aplica a datos personales almacenados en bases de datos, backups, logs, eventos (outbox), réplicas de lectura y cualquier export. Cubre ciclo de vida: recolección, uso, retención, anonimización, supresión y trazabilidad para auditoría.

## 2. Principios

1. **Mínimo necesario**: solo se conserva lo imprescindible para el propósito para el que fue recolectado.
2. **Finalidad determinada**: la retención debe estar justificada por funcionalidad del MVP o cumplimiento legal.
3. **Separación entre identificadores y trazas**: para fines estadísticos/auditoría se prioriza **anonimización** sobre borrado completo cuando debe conservarse evidencia no reversible para fraude o cumplimiento.
4. **Borrado lógico primero**: el sistema usa `deleted_at` (soft delete). La eliminación física requiere validación de dependencias y política explícita.
5. **Trazabilidad sin PII**: los logs y correlaciones (`correlation_id`) no deben incluir PII en texto libre.

## 3. Plazos de conservación propuestos (para aprobación)

| Datos | Base de retención | Justificación |
|---|---|---|
| **Usuarios y credenciales** | Activo mientras cuenta vigente. Tras cierre: 30–90 días para soporte/reclamos, luego anonimización o supresión según aprobación. | Autenticación, soporte, prevención de abuso. |
| **Necesidades, propuestas, solicitudes** | 12–24 meses tras cierre/expiración (estado final). | Auditoría de transacciones, resolución de disputas, métricas históricas. |
| **Calificaciones y reputación** | Mínimo 12 meses tras última actualización. | Reputación agregada puede conservarse **anonimizada/agregada** aun tras baja de usuarios. |
| **Réplica (`usuario_ref`, `prestador_ref`, `servicio_ref`)** | Sincronizada con fuente. Se reconstruye vía outbox (re-emisión). No requiere retención independiente. | Réplicas derivadas, pueden regenerarse. |
| **Backups** | 30–90 días (rotación). Backups antiguos con PII: **anonimizar antes de destrucción** o destruir conforme política aprobada. | Recuperación ante incidentes (RPO). |
| **Logs operativos** | 90–180 días. No incluir PII (nombres, correos, teléfonos completos). | Observabilidad, debugging, seguridad. |
| **Eventos Outbox** | Tras consumo confirmado + checkpoint: eliminar (o retener 7–30 días máximo para troubleshooting). | No histórico permanente. |
| **Estadísticas (`statistics_snapshot`)** | Agregadas por fecha/métrica/dimensión (sin PII). Retención indefinida **agregada** o 36 meses (definir). | Reportes históricos. Agregados no son datos personales. |

## 4. Anonimización

- **Agregación**: cuando se conserva para analítica, usar totales/agregados (dimensiones) sin filas individuales identificables.
- **Pseudonimización**: reemplazar identificadores directos por IDs no correlacionables cuando debe conservarse trazabilidad técnica.
- **Anonimización irreversible**: para backups fuera de ventana o exports históricos, eliminar/quitar campos PII antes de conservación a largo plazo.
- **Réplicas**: al anonimizar fuente, las réplicas se actualizan vía eventos (consumo). No mantener copias desconectadas con PII.

## 5. Derecho al olvido (propuesta)

1. Solicitud registrada (canal definido). Validar identidad y alcance.
2. Aplicar **borrado lógico** sobre entidades principales (`usuario`, solicitudes asociadas según estado). 
3. **Anonimizar** registros de auditoría/transacciones que deban conservarse por obligación legal (mantener trazas no identificables: timestamps, estados, montos agregados).
4. Confirmar que réplicas se actualizan (event-driven). Verificar con re-emisión si procede.
5. Registrar acción con `correlation_id`, sin guardar PII en bitácora.

## 6. Backups

- **Rotación definida**: aplicar retención por ciclo (diarios/semanales/mensuales) conforme §3.
- **Antes de destruir backup fuera de ventana**: ejecutar proceso de **anonimización de PII** o validar que no contiene datos sujetos a borrado pendiente no aplicable.
- **Restauración probada**: marcar `backup_record.restauracion_probada_at` tras validación exitosa (ver [PROCEDIMIENTO-RESTAURACION.md](../operacion/PROCEDIMIENTO-RESTAURACION.md), AT-004).

## 7. Logs

- Prohibido loguear: contraseñas, tokens, correos completos, teléfonos, DNI/documentación, direcciones completas.
- Usar truncado/máscaras (`***`) si fuera imprescindible para diagnóstico.
- Cumplir retención §3. Aplicar rotación por tamaño/tiempo.

## 8. Criterio de cierre (para aprobar esta política)

Esta política se considera **aprobada y cerrada** cuando:

1. Recibe **aprobación escrita** de PO y Responsable de Seguridad (o Tech Lead con acta).
2. Se registra fecha de aprobación y aprobadores en este documento (sección 9).
3. Se refleja la decisión en `docs/01-BACKLOG.md` (elemento de Fase 5) marcando **DECISIÓN TOMADA** con enlace a este documento.
4. Se verifica aplicabilidad con implementación (logs, borrado lógico, backups) en una revisión de producción-readiness.

**Mientras no se cumplan 1–3, permanece como DECISIÓN PENDIENTE.**

## 9. Registro de aprobación

- **Estado:** PENDIENTE
- **Aprobadores requeridos:** Product Owner, Seguridad/Compliance
- **Fecha propuesta de revisión:** [Definir]
- **Aprobación:** ___ / ___ / ___ — Firmado por: __________

## 10. Referencias

- [09-ops/backup-strategy.md](../../09-ops/backup-strategy.md)
- [docs/operacion/PROCEDIMIENTO-RESTAURACION.md](../operacion/PROCEDIMIENTO-RESTAURACION.md)
- [docs/adr/ADR-005-estadisticas-lectura-cruzada.md](../adr/ADR-005-estadisticas-lectura-cruzada.md)
- [docs/01-BACKLOG.md](../01-BACKLOG.md) — Fase 5, elemento de conservación/anonimización