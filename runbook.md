# Runbook de Despliegue (VM + Docker) — Portal Vercel + API Local (ngrok + GoDaddy)

Este runbook aterriza el blueprint para que **portal (Vercel)** consuma una **API/worker/DB** que viven en una **VM en tu laptop**, expuestos por un **túnel ngrok** con dominio **GoDaddy**.

---

## 0) Resultado esperado

- `portal.tu-dominio.com` → Vercel (Next.js)
- `api.tu-dominio.com` → ngrok (custom domain) → VM (reverse proxy) → API (FastAPI)

**Restricción clave:** Vercel no puede hablar con `localhost`, por eso `api.tu-dominio.com` debe ser accesible públicamente (aunque esté protegido por tu auth).

---

## 1) Prerrequisitos

### En tu laptop
- VM Linux (Ubuntu Server recomendado)
- Docker + Docker Compose dentro de la VM

### Cuentas
- GoDaddy (DNS del dominio)
- ngrok (cuenta y plan con dominio propio)

---

## 2) Compatibilidad GoDaddy ↔ ngrok (lo que hay que validar)

### 2.1 GoDaddy no soporta CNAME en apex
GoDaddy no soporta CNAME en el “naked domain” (`tu-dominio.com`). Por eso **el dominio para la API debe ser subdominio**, p.ej. `api.tu-dominio.com`. :contentReference[oaicite:0]{index=0}

### 2.2 Plan de ngrok que soporte “Bring your own domain”
Para usar un dominio propio (tu dominio de GoDaddy) con ngrok, necesitas un plan que incluya “Bring your own custom domains”. En la tabla de precios, esto aparece en **Pay-as-you-go**. :contentReference[oaicite:1]{index=1}

> Recomendación práctica: confirmar en el panel de ngrok que tu plan permite **Reserved Domains / Bring your own domain** antes de avanzar.

---

## 3) Preparación de la VM (Docker)

### 3.1 Estructura de carpetas recomendada
En la VM:
- `/opt/automations/`
  - `docker-compose.yml`
  - `.env`
  - `data/`
    - `postgres/`
    - `files/`

### 3.2 Docker Compose mínimo (plantilla)
> Ajusta imágenes, puertos internos y envs conforme a tu repo.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: automations
      POSTGRES_USER: automations
      POSTGRES_PASSWORD: change_me
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    networks: [internal]

  api:
    build: ./api
    environment:
      DATABASE_URL: postgresql://automations:change_me@postgres:5432/automations
      FILES_ROOT: /data/files
      JWT_SECRET: change_me_long
      CORS_ALLOWED_ORIGINS: https://portal.tu-dominio.com
      COOKIE_DOMAIN: .tu-dominio.com
      COOKIE_SECURE: "true"
    volumes:
      - ./data/files:/data/files
    depends_on: [postgres]
    networks: [internal]

  worker:
    build: ./worker
    environment:
      DATABASE_URL: postgresql://automations:change_me@postgres:5432/automations
      FILES_ROOT: /data/files
      TMP_ROOT: /tmp/automation
    volumes:
      - ./data/files:/data/files
    depends_on: [postgres]
    networks: [internal]

  reverse-proxy:
    image: caddy:2
    ports:
      - "80:80"
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
    depends_on: [api]
    networks: [internal]

  ngrok:
    image: ngrok/ngrok:latest
    command: ["http", "reverse-proxy:80", "--url=api.tu-dominio.com"]
    environment:
      NGROK_AUTHTOKEN: ${NGROK_AUTHTOKEN}
    depends_on: [reverse-proxy]
    networks: [internal]

networks:
  internal:
    driver: bridge
