# Publicar una demo en Railway

La demo usa un único servicio Node para servir la API y el frontend compilado, más un PostgreSQL administrado.

## 1. Subir el repositorio

Publicá `fleet-saas` en GitHub y conectalo desde Railway.

## 2. Crear los servicios

1. Creá un proyecto nuevo en Railway.
2. Agregá un servicio **PostgreSQL**.
3. Agregá el repositorio como servicio web.
4. Configurá:
   - **Build command:** `npm ci && npm run build`
   - **Start command:** `npm run start:demo`

`start:demo` ejecuta las migraciones, carga los datos de muestra y levanta Express. Express sirve `dist/` y deja disponibles las rutas `/api/*` en el mismo dominio.

## 3. Variables de entorno

Configurá en el servicio web:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
NODE_ENV=production
DEMO_EMAIL=demo@rueda.local
DEMO_PASSWORD=<contraseña-temporal-larga>
```

Railway provee `PORT`; no hace falta fijarlo manualmente.

## 4. Probar la demo

Después del deploy, abrí el dominio generado por Railway y entrá con `DEMO_EMAIL` y `DEMO_PASSWORD`. La cuenta demo carga tres vehículos, aplicaciones Uber y movimientos iniciales.

Antes de compartirla, cambiá la contraseña demo y no expongas `DATABASE_URL`.

## Alcance

Esta publicación es una demo funcional. Mercado Pago, dominio propio, backups y observabilidad quedan para la etapa posterior.
