# FASE 6 - ENTREGA Y CIERRE (documentación)

## Estado
**Estado:** EN CURSO (documentado)
**Fecha de documentación:** 2025-10-05
**Responsable:** Equipo técnico

## Objetivo de Fase 6
Experiencia del cliente: teléfono en detalle de contratación, recuperación de contraseña, y E2E del recorrido completo.

## Pendientes identificados

### C-1. Recuperación de contraseña sin interfaz (actualizado)
- Backend completo (/auth/password-recovery, /auth/password-reset).
- UI (Recuperar.tsx, Restablecer.tsx) existe y está cableada en App.
- Falta validar flujo completo E2E (incluye integración con correo en entorno real, fuera de MVP para envío - Fase 7).

### C-2. Faltan iconos del PWA
- Iconos generados, manifest.webmanifest declara iconos (incluye maskable-512), index.html enlazado, apple-touch-icon presente.
- Solo queda confirmación visual en pantalla de inicio (paso manual).

### C-3. No hay pruebas de extremo a extremo
- Requerido por 11-quality/testing-strategy.md §E2E.
- Recorrido crítico: publicar necesidad → recibir propuestas → adjudicar → cancelar.
- Cubierto parcialmente por unitarias/integración; falta E2E completo ejecutable en navegador/CI.

### C-4. Teléfono sigue sin llegar (duplicado con B-1)
- Debe mostrarse teléfono del prestador en detalle de contratación.
- Requiere decisión de implementación (tomarlo del perfil de prestador).

### Otras referencias
- B-1: Teléfono tras el acuerdo (coincide con C-4).
- Ver 00-FLUJO-DEL-PROYECTO.md §Fase 6.

## Criterios de cierre de Fase 6
- [ ] C-1: Flujo completo validado (solicitud, token válido, restablecimiento, login con nueva contraseña) con pruebas.
- [ ] C-2: Confirmación visual de iconos en pantalla de inicio (documentada).
- [ ] C-3: E2E del recorrido completo pasa en CI (Playwright u otra herramienta según estrategia).
- [ ] C-4/B-1: Teléfono visible en detalle de contratación, con cobertura/validación.
- [ ] Documentación de cierre registrada (FASE-6-ENTREGA.md).

## Notas
- Envío de correo para recuperación queda fuera de MVP (Fase 7) según backlog.
- Pruebas unitarias actuales verdes (246/246); estadísticas integración verdes (15/15).

## Siguiente paso
Ejecutar pruebas E2E existentes si las hay, o crear esqueleto mínimo de E2E para recorrido crítico alineado con testing-strategy.md.
