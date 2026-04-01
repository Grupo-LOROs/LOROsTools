# Railway

Configuración recomendada para subir este repo a Railway sin romper el flujo batch actual.

## Arquitectura sugerida

- `postgres`: base de datos administrada por Railway
- `api-worker`: un solo servicio que levanta FastAPI y el worker al mismo tiempo
- `portal`: servicio separado para Next.js

El `api-worker` va junto porque `api` y `worker` comparten archivos generados en `FILES_ROOT`. En Railway eso se resuelve mejor con un solo servicio y un solo Volume montado en `/data/files`.

## Servicios

### 1. Postgres

Agrega una base `Postgres` desde Railway.

### 2. API + Worker

Servicio sugerido: `loros-api-worker`

Variables base:

- `RAILWAY_DOCKERFILE_PATH=/infra/railway/Dockerfile.api-worker`
- `DATABASE_URL=...`
- `JWT_SECRET=...`
- `DEFAULT_ADMIN_PASS=...`
- `FILES_ROOT=/data/files`
- `COOKIE_SECURE=true`
- `COOKIE_SAMESITE=none`
- `COOKIE_DOMAIN=`
- `CORS_ALLOWED_ORIGINS=https://tu-portal.up.railway.app`
- `WORKER_POLL_SECONDS=2`

Además:

- agrega un `Volume`
- móntalo en `/data/files`

Notas:

- Para dominios temporales de Railway conviene `COOKIE_SAMESITE=none` y `COOKIE_DOMAIN=` vacío.
- Si después usas dominios propios del mismo sitio, puedes volver a `COOKIE_SAMESITE=lax` y definir `COOKIE_DOMAIN=.grupo-loros.com`.

### 3. Portal

Servicio sugerido: `loros-portal`

Variables base:

- `RAILWAY_DOCKERFILE_PATH=/infra/railway/Dockerfile.portal`
- `NEXT_PUBLIC_API_URL=https://tu-api.up.railway.app`
- `NEXT_PUBLIC_BASE_PATH=/tools`
- `PORT=3000`

Notas:

- La app queda servida bajo `/tools`.
- En el dominio temporal de Railway la ruta esperada será algo como `https://tu-portal.up.railway.app/tools`.

## Flujo sugerido en Railway

1. Crea un proyecto nuevo.
2. Agrega `Postgres`.
3. Agrega el servicio `loros-api-worker` desde este repo.
4. Configura sus variables y el Volume en `/data/files`.
5. Agrega el servicio `loros-portal` desde este repo.
6. Configura `NEXT_PUBLIC_API_URL` apuntando al dominio público del servicio `api-worker`.
7. Ajusta `CORS_ALLOWED_ORIGINS` en `api-worker` para que coincida exactamente con el dominio público del `portal`.
8. Despliega ambos servicios.

## Verificación mínima

- API: `/health`
- Portal: `/tools/login`
- Login: probar autenticación con el admin sembrado por `DEFAULT_ADMIN_PASS`
