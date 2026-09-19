# Registro por invitación y blindaje de la API

Esta especificación cierra el alta pública de propietarios y deja el backend preparado para una demo privada segura, sin incorporar todavía un proveedor de correo ni un panel de administración de plataforma.

## Decisión

El registro de propietarios será **solo por invitación de un solo uso**. Las invitaciones se crearán mediante un comando interno contra la base de datos; el token en texto plano se mostrará una sola vez y nunca se almacenará.

Las invitaciones de conductores existentes mantienen su flujo independiente.

## Alcance

### Incluido

- Invitaciones de propietario con token hasheado, vencimiento y consumo atómico.
- Registro condicionado a una invitación válida.
- Auditoría y pruebas de autenticación, autorización y aislamiento entre tenants.
- Límite de payload JSON y rate limit básico para endpoints de autenticación.
- Conservación de sesiones actuales: access token de 15 minutos y refresh token de 30 días.

### Fuera de alcance

- Envío de emails.
- Panel global de administración.
- Recuperación de contraseña.
- OAuth o login social.
- Rate limiting distribuido para múltiples réplicas.

## Flujo principal

1. Un operador con acceso al entorno ejecuta el comando de invitación con email y nombre de organización.
2. El backend genera un token aleatorio, guarda únicamente su SHA-256 y muestra el token/link una vez.
3. El invitado abre el formulario de registro y envía email, contraseña, nombre de organización y token.
4. El backend inicia una transacción y bloquea la invitación pendiente.
5. Valida hash, estado, expiración y email exacto.
6. Crea tenant, aplicaciones iniciales, usuario y membership `owner`.
7. Marca la invitación como `accepted`, crea la sesión y confirma el registro.
8. Ante cualquier error, la transacción completa hace rollback y el token permanece pendiente.

## Modelo de datos

Nueva tabla `owner_invitations`:

| Campo | Regla |
|---|---|
| `id` | Identidad numérica |
| `email` | Normalizado a minúsculas |
| `organization_name` | Nombre que se usará al crear el tenant |
| `token_hash` | SHA-256, único; nunca guardar el token plano |
| `status` | `pending`, `accepted` o `cancelled` |
| `expires_at` | Por defecto, 48 horas |
| `accepted_at` | `NULL` hasta consumirla |
| `created_at` | Fecha de creación |

Índices y restricciones:

- Índice único sobre `token_hash`.
- Índice para invitaciones pendientes por email.
- El consumo requiere `SELECT ... FOR UPDATE`.
- No se permite reutilizar una invitación aceptada, cancelada o vencida.

## Comando interno

Se agregará un comando equivalente a:

```text
npm run auth:invite-owner -- --email dueno@example.com --organization "Mi Flota" --expires-hours 48
```

El comando debe:

- Validar email, nombre y vencimiento.
- Generar un token criptográficamente aleatorio.
- Guardar solo el hash.
- Imprimir el token/link una única vez.
- No escribir el token en logs ni en la base de datos.

## Matriz de endpoints

| Grupo | Acceso |
|---|---|
| `GET /api/health` | Público, sin datos de negocio |
| `POST /api/auth/login` | Público; crea sesión solo con credenciales válidas |
| `POST /api/auth/register` | Público técnicamente, pero exige `inviteToken` válido |
| `GET /api/auth/me` | Requiere sesión; sin sesión responde `401` |
| `POST /api/auth/refresh` | Requiere refresh token válido |
| `POST /api/auth/logout` | Idempotente; revoca tokens presentes y limpia cookies |
| `POST /api/driver-invitations/accept` | Público solo con token de invitación de conductor válido |
| `/api/tenants/:tenantId/**` | Requiere sesión y membership del tenant |
| Escrituras de flota/operaciones | Además requieren rol `owner` u `operator` |
| Rutas `/api` desconocidas | `404` JSON; no deben servir HTML |

El frontend seguirá siendo accesible como aplicación web, pero ningún dato de negocio se entrega sin pasar por la autorización del backend.

## Endurecimiento HTTP

- `express.json` con límite de payload de 100 KB.
- Rate limit básico por IP para login, registro e invitaciones; se documenta como límite de una sola instancia.
- Respuestas de autenticación con `Cache-Control: no-store`.
- Cookies actuales se mantienen `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- No habilitar CORS abierto.
- Errores de autenticación e invitación no deben revelar si un email existe o qué parte del token falló.

## Criterios de aceptación

- [ ] Un registro sin token devuelve `403` y no crea usuario ni tenant.
- [ ] Un token inválido, vencido, cancelado o reutilizado no permite registrarse.
- [ ] Una invitación válida crea exactamente un tenant, un usuario owner y una sesión.
- [ ] Dos solicitudes concurrentes no pueden consumir la misma invitación.
- [ ] Las invitaciones de conductores siguen funcionando.
- [ ] Un endpoint de tenant sin sesión devuelve `401`.
- [ ] Un usuario autenticado en otro tenant devuelve `403`.
- [ ] Un conductor no puede ejecutar operaciones de owner/operator.
- [ ] Los endpoints de autenticación tienen payload y respuestas no cacheables.
- [ ] La suite API existente continúa pasando.

## Archivos previstos

- `api/db/migrations/010_owner_invitations.sql` — esquema e índices.
- `api/owner-invitation.ts` — validación y generación del token para el comando.
- `api/db/invite-owner.ts` — comando CLI interno.
- `api/auth.ts` — helpers de invitación y middleware de protección común.
- `api/app.ts` — registro cerrado y endurecimiento HTTP.
- `api/registration.integration.ts` y `api/auth.integration.ts` — regresiones.
- `package.json` — script `auth:invite-owner`.
- `docs/DEPLOY_DEMO.md` — procedimiento para generar la primera invitación.

## Próximo paso

Revisar esta especificación. Con tu aprobación preparo el plan de implementación por tareas y luego lo ejecuto con tests primero.
