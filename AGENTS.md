# AGENTS.md

## Propósito
Este archivo es el punto de arranque para nuevos hilos de trabajo en este repo. Debe evitar recontextualizar el proyecto desde cero.

## Fuente de verdad actual
- Usa este archivo como contexto operativo actual.
- `runbook.md` está desactualizado: describe un flujo viejo con ngrok/GoDaddy y además tiene problemas de codificación. No lo uses como fuente principal para el despliegue actual.

## Arquitectura real del proyecto
- Repo raíz: `C:\Users\jjda1\Documents\LOROs\LOROsTools`
- Backend API: `apps/api` con FastAPI
- Worker batch: `apps/worker`
- Portal web: `apps/portal` con Next.js
- Infra local: `infra/docker-compose.yml`
- Persistencia:
  - PostgreSQL en `data/postgres`
  - archivos generados/subidos en `data/files`

## Publicación actual
- `https://tools.grupo-loros.com/` existe por separado y su raíz se reserva para otra cosa.
- El portal de herramientas vive en `https://tools.grupo-loros.com/tools`
- `https://tools.grupo-loros.com/tools/*` se atiende desde Vercel mediante rewrite hacia un origen técnico
- Origen técnico del portal: `https://tools-origin.grupo-loros.com/tools/*`
- `tools-origin.grupo-loros.com` entra por Cloudflare Tunnel a este equipo, al contenedor `portal`
- API pública: `https://api.grupo-loros.com`
- La API también entra por Cloudflare Tunnel a este equipo
- No crear un proyecto nuevo de Vercel para cada herramienta
- No mover el portal a la raíz del subdominio salvo instrucción explícita del usuario

## Restricciones y preferencias del usuario
- El idioma principal es español
- Todo texto visible debe usar acentos, signos y `ñ` correctamente
- No dejar texto con mojibake tipo `Ã`, `Â` o `�`
- No hacer que el usuario tenga que volver a recordar este punto
- Mantener las herramientas centralizadas en el mismo portal/sitio
- Evitar servicios web separados para apps pequeñas; integrar dentro del backend/portal existente siempre que sea razonable
- Preferir vistas nativas dentro del portal en lugar de redirecciones o experiencias aisladas
- Priorizar funcionalidad, usabilidad y centralización por encima de separar demasiado los módulos

## Operación local actual
- Esta laptop funciona como servidor del área
- Docker Desktop es obligatorio para que el stack responda
- El stack principal corre con `docker compose -f infra/docker-compose.yml up -d`
- Servicios principales del compose:
  - `postgres`
  - `api`
  - `portal`
  - `worker`
  - `caddy`
  - `cloudflared`
- `infra/docker-compose.yml` ya usa `restart: unless-stopped` en los servicios relevantes

## Recuperación automática
- Se configuró arranque automático de Docker Desktop en Windows
- Existe una tarea programada de Windows llamada `LOROs Stack Recovery`
- Esa tarea corre al iniciar sesión, espera a que Docker estabilice y levanta el stack
- Script de recuperación: `infra/scripts/recover-loros-stack.ps1`
- Log de recuperación: `infra/logs/recover-loros-stack.log`
- Si el portal devuelve `failed to fetch`, revisar primero:
  - Docker Desktop
  - estado del task `LOROs Stack Recovery`
  - log `infra/logs/recover-loros-stack.log`
- La tarea `LOROs Post-Reboot Verification` quedó deshabilitada para no competir con la recuperación; la verificación quedó integrada en el flujo de recuperación

## Estado funcional por módulo

### Autenticación y administración
- Ya existe cambio de contraseña dentro del portal
- Ya existe administración de usuarios y permisos
- Ya existe endpoint de borrado
- Archivos relevantes:
  - `apps/api/app/routes/auth.py`
  - `apps/api/app/routes/users.py`
  - `apps/portal/app/account/password/page.tsx`
  - `apps/portal/app/admin/users/page.tsx`

### GI - Cotizador ERA/GI
- Ya está integrado de forma nativa en el portal
- No usa un servicio web separado
- El procesamiento base vive en la API actual
- Archivos relevantes:
  - `apps/api/app/routes/gi_tools.py`
  - `apps/portal/app/tools/gi/cotizador-era-gi/page.tsx`

### ERA Ventas - Cotizador de catálogo
- Ya está funcional en backend y vista nativa
- Mantener el manejo de tiers exactamente como la app original
- Archivos relevantes:
  - `apps/api/app/routes/catalog_quote.py`
  - `apps/portal/app/tools/era/ventas/cotizador-catalogo/page.tsx`

### ERA Importaciones - Cartas complementarias desde órdenes de compra
- Es una app distinta a Compras
- Flujo actual: PDF/orden de compra y plantilla Excel para generar salida tipo carta complementaria y Excel actualizado
- Se cambió la salida para usar formato carta
- El nombre mostrado del proveedor puede ser vendedor/nombre operativo; falta completar la relación automática empresa -> nombre mostrado cuando el usuario la entregue
- Archivos relevantes:
  - `apps/worker/processors/era_importaciones_oc.py`
  - `apps/portal/app/tools/era/importaciones/generador-oc/page.tsx`

### ERA Compras - Seguimiento de importaciones
- Vista interactiva tipo tracking
- Muestra embarques del más nuevo al más antiguo
- Hoy prioriza trazabilidad con los datos disponibles; no depende de cierre real completo
- Ya reutiliza la información normalizada que se genera desde Importaciones sin exigir subir PDFs manuales para lo nuevo
- Archivos relevantes:
  - `apps/api/app/routes/compras_tracking.py`
  - `apps/portal/app/tools/era/compras/seguimiento-importaciones/page.tsx`

### Tesorería - Captura de movimientos bancarios
- Primera versión ya funcional
- Lee PDFs de distintos bancos y muestra movimientos normalizados para copiar/pegar a Excel
- Bancos contemplados: BBVA, Banregio, Bajío, Monex y Santander
- Archivos relevantes:
  - `apps/api/app/routes/treasury_bank_movements.py`
  - `apps/portal/app/tools/tesoreria/movimientos-bancarios/page.tsx`

### Tesorería - Formato asistido
- Aún pendiente
- Ya existe un placeholder para continuar después
- Falta que el usuario entregue reglas por fila y formato final
- Archivo relevante:
  - `apps/portal/app/tools/tesoreria/formato-asistido/page.tsx`

### ERA Cuentas por Pagar - Autorización de pagos
- Nombre correcto del área: `ERA Cuentas por Pagar`
- App batch ya creada
- Flujo actual: Excel de provisión -> PDF de autorización de pagos
- Se corrigió el nombre del área y se limpiaron textos visibles con caracteres dañados
- Archivos relevantes:
  - `apps/worker/processors/cxp_autorizacion_pagos.py`
  - `apps/api/app/db/seed.py`

## Validaciones y pruebas que ya existen
- Hay pruebas unitarias agregadas en varios módulos nuevos
- Se ha usado `python -m py_compile` y `npx tsc --noEmit` para validar cambios
- Se han hecho varias pruebas reales contra `https://api.grupo-loros.com`
- Para problemas de despliegue, siempre validar:
  - `docker compose -f infra/docker-compose.yml ps`
  - `https://api.grupo-loros.com/health`
  - `https://tools.grupo-loros.com/tools/login`

## Pendientes importantes
- Completar la relación automática `empresa/proveedor -> nombre mostrado/vendedor` en Importaciones cuando el usuario entregue esa tabla
- Desarrollar `Tesorería - Formato asistido`
- Validar con archivos reales actuales algunas apps batch heredadas:
  - ERA Compras - generador existente
  - ERA Proyectos - Comisionador CFE
- ERA Ventas - Comisionador se deja como está por ahora; las correcciones se harán después con los dueños de la app

## Convenciones útiles para nuevos hilos
- Antes de proponer infraestructura nueva, revisar si la necesidad cabe en `api + worker + portal` ya existentes
- Si una herramienta es interactiva, preferir una ruta nativa dentro de `apps/portal/app/tools/...`
- Si una herramienta es batch, preferir integrarla en el flujo de jobs existente salvo que el caso requiera otra cosa
- Si se toca texto visible, revisar codificación y español profesional antes de cerrar el trabajo

