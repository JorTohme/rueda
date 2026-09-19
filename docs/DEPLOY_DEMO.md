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

## 4. Habilitar registro por invitación

El registro de propietarios está cerrado por defecto: no alcanza con conocer la URL. Para crear un alta inicial desde un entorno con acceso a la base, ejecutá:

```bash
npm run auth:invite-owner -- --email dueno@example.com --organization "Mi Flota" --expires-hours 48
```

El comando imprime el token una sola vez. Compartilo por un canal privado y no lo pegues en logs, tickets o capturas públicas. El registro consume la invitación de forma atómica; después de aceptarla no puede reutilizarse.

Todavía no hay envío automático de emails. Si un token se filtra, cancelalo desde PostgreSQL:

```sql
UPDATE owner_invitations
SET status = 'cancelled'
WHERE token_hash = '<hash-del-token>' AND status = 'pending';
```

## 5. Probar la demo

Después del deploy, abrí el dominio generado por Railway y entrá con `DEMO_EMAIL` y `DEMO_PASSWORD`. La cuenta demo carga tres vehículos, aplicaciones Uber y movimientos iniciales.

Antes de compartirla, cambiá la contraseña demo y no expongas `DATABASE_URL`.

## Alcance

Esta publicación es una demo funcional. Mercado Pago, dominio propio, backups y observabilidad quedan para la etapa posterior.
