# Registro por invitación y blindaje de la API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el registro público de propietarios con invitaciones one-time y reforzar los límites de la API antes del despliegue de la demo.

**Architecture:** Una tabla `owner_invitations` almacena únicamente hashes de tokens. Un comando CLI crea invitaciones y muestra el token una vez; el endpoint de registro consume la invitación dentro de la transacción que crea tenant, usuario, membership y sesión. Las rutas existentes conservan sus middlewares de autorización; se agregan límites HTTP y rate limit mínimos sin dependencias nuevas.

**Tech Stack:** Node.js, TypeScript, Express 5, PostgreSQL, `node:crypto`, `tsx`, `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-09-19-invite-only-auth-design.md`

## Global Constraints

- El registro de propietarios exige una invitación válida de un solo uso.
- El token plano nunca se guarda ni se escribe en logs.
- Las invitaciones de conductores mantienen su flujo actual.
- Vencimiento por defecto: 48 horas.
- Sesiones: access token 15 minutos y refresh token 30 días.
- No agregar dependencias npm nuevas.
- Sin email, OAuth, recuperación de contraseña, panel global ni rate limiting distribuido.
- Ningún endpoint de tenant devuelve datos sin sesión y membership.

## Review Focus

1. Dos requests concurrentes con el mismo token: exactamente una crea la cuenta.
2. Token válido con email diferente: rechazo genérico sin enumeración.
3. Invitación vencida, aceptada o cancelada: rechazo sin efectos.
4. JSON inválido o mayor a 100 KB: `400`/`413`, nunca `503`.
5. Ruta `/api` desconocida: `404` JSON, nunca HTML de la SPA.

---

### Task 1: Esquema y primitivas de invitación

**Files:**
- Create: `api/db/migrations/010_owner_invitations.sql`
- Create: `api/owner-invitation.ts`
- Create: `api/owner-invitation.integration.ts`
- Modify: `package.json` (`test:api:owner-invitation`)

**Interfaces:** `OWNER_INVITATION_TTL_SECONDS = 48 * 60 * 60`, `createOwnerInvitationToken(): string`, `hashOwnerInvitationToken(token: string): string`, `parseOwnerInvitationArgs(argv: string[]): { email: string; organizationName: string; expiresHours: number }`.

- [ ] **Step 1: Write the failing test.** En `api/owner-invitation.integration.ts`, importar los cuatro símbolos y comprobar normalización de email, token de al menos 40 caracteres, hash determinista y error cuando faltan flags. Agregar `"test:api:owner-invitation": "tsx api/owner-invitation.integration.ts"`.
- [ ] **Step 2: Verify RED.** Ejecutar `npm run test:api:owner-invitation`; esperar fallo porque el módulo no existe.
- [ ] **Step 3: Implement minimal primitives.** Crear la migración:

```sql
CREATE TABLE IF NOT EXISTS owner_invitations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(email) AND length(trim(email)) > 3),
  organization_name TEXT NOT NULL CHECK (length(trim(organization_name)) BETWEEN 2 AND 80),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_invitations_email_idx ON owner_invitations (email, status, created_at DESC);
CREATE INDEX IF NOT EXISTS owner_invitations_expires_at_idx ON owner_invitations (expires_at) WHERE status = 'pending';
```

Implementar el helper con `randomBytes(32).toString('base64url')`, SHA-256 y `normalizeEmail`. `parseOwnerInvitationArgs` debe exigir `--email` y `--organization`, aceptar `--expires-hours` opcional, normalizar email, validar organización de 2–80 caracteres y horas enteras entre 1 y 168; default 48.
- [ ] **Step 4: Verify GREEN.** Ejecutar `npm run test:api:owner-invitation` y `npm run db:migrate` dos veces; ambos deben terminar correctamente.
- [ ] **Step 5: Commit.** `git add api/db/migrations/010_owner_invitations.sql api/owner-invitation.ts api/owner-invitation.integration.ts package.json && git commit -m "feat: add owner invitation primitives"`.

---

### Task 2: Comando interno para generar invitaciones

**Files:**
- Create: `api/db/invite-owner.ts`
- Modify: `package.json` (`auth:invite-owner`)
- Modify: `api/owner-invitation.integration.ts`

**Interface:** `npm run auth:invite-owner -- --email <email> --organization <name> [--expires-hours <hours>]`.

- [ ] **Step 1: Write failing persistence test.** Ejecutar el comando con `execFile`, comprobar stdout con email y `token=`, consultar `owner_invitations` y comprobar `status = 'pending'` y que el valor almacenado no es el token plano. Borrar la fila en `finally`.
- [ ] **Step 2: Verify RED.** Ejecutar `npm run test:api:owner-invitation`; esperar fallo porque falta el CLI/script.
- [ ] **Step 3: Implement CLI.** Parsear argumentos, generar token/hash, insertar `email`, `organization_name`, `token_hash` y `expires_at = now() + ($3 * interval '1 hour')`, imprimir una única línea con email, expiración y `token=<token>`, no imprimir hash, cerrar pool en `finally`, terminar con código 1 ante input inválido. Agregar `"auth:invite-owner": "tsx api/db/invite-owner.ts"`.
- [ ] **Step 4: Verify GREEN.** Ejecutar `npm run test:api:owner-invitation`; debe confirmar persistencia del hash.
- [ ] **Step 5: Commit.** `git add api/db/invite-owner.ts api/owner-invitation.integration.ts package.json && git commit -m "feat: add owner invitation command"`.

---

### Task 3: Cerrar el registro y consumir invitaciones atómicamente

**Files:**
- Modify: `api/app.ts`
- Modify: `api/registration.integration.ts`

**Interface:** `POST /api/auth/register` sin token o con token inválido devuelve `403 { error: 'A valid invitation is required' }`; el registro válido conserva `201`, membership `owner` y cookies.

- [ ] **Step 1: Write failing tests.** En `registration.integration.ts`, comprobar que el registro sin `inviteToken` devuelve `403`; insertar una invitación vencida y comprobar `403`; insertar una pendiente, registrar con `inviteToken`, comprobar `201`, repetir el token y comprobar `403`. Agregar dos requests concurrentes con el mismo token y exigir un único `201`; limpiar invitaciones, tenants y usuarios en `finally`.
- [ ] **Step 2: Verify RED.** Ejecutar `npm run test:api:registration`; esperar que el registro actual sin token todavía devuelva `201`.
- [ ] **Step 3: Implement transactional check.** Extender `registrationInput` con `inviteToken` de 20–128 caracteres. Dentro de la transacción, antes de crear tenant, ejecutar:

```sql
SELECT id::text, email, organization_name
FROM owner_invitations
WHERE token_hash = $1 AND email = $2 AND status = 'pending' AND expires_at > now()
FOR UPDATE
```

Si no hay fila o el nombre no coincide, rollback y `403` genérico. Usar `organization_name` de la invitación para crear tenant. Después de crear membership y sesión, ejecutar `UPDATE owner_invitations SET status = 'accepted', accepted_at = now() WHERE id = $1 AND status = 'pending'`; exigir `rowCount = 1`. Mantener rollback ante errores y no exponer token.
- [ ] **Step 4: Verify GREEN.** Ejecutar `npm run test:api:registration` y `npm run test:api:auth`; ambos deben pasar y la cuenta demo sembrada debe seguir funcionando.
- [ ] **Step 5: Commit.** `git add api/app.ts api/registration.integration.ts && git commit -m "feat: require owner invitation for registration"`.

---

### Task 4: Endurecer límites y respuestas de la API

**Files:**
- Modify: `api/app.ts`
- Modify: `api/auth.integration.ts`
- Modify: `api/auth.ts` solo si se extrae el limiter

**Interfaces:** JSON limitado a 100 KB; rate limit de 10 intentos por IP en 900 segundos para login/registro/aceptación; intento 11 devuelve `429` y `Retry-After: 900`; rutas API desconocidas devuelven `404` JSON.

- [ ] **Step 1: Write failing tests.** En `auth.integration.ts`, comprobar `/api/does-not-exist` → `404 { error: 'Not found' }`, login con password de 120.000 caracteres → `413`, once logins inválidos → primeros diez `401` y el undécimo `429` con `Retry-After: 900`; comprobar `Cache-Control: no-store` en login, me y refresh.
- [ ] **Step 2: Verify RED.** Ejecutar `npm run test:api:auth`; esperar fallos por fallback/error handler/rate limit ausentes.
- [ ] **Step 3: Implement minimum hardening.** Cambiar a `express.json({ limit: '100kb' })`. Agregar `Map<string, { count: number; resetAt: number }>` por IP, aplicado solo a los tres endpoints de autenticación, con `Retry-After: 900`. Marcar auth responses `Cache-Control: no-store`. Antes del error handler agregar `app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }))`. Mapear `entity.too.large` a `413 Payload too large` y `entity.parse.failed` a `400 Invalid JSON body`; conservar `503` para errores restantes. No agregar CORS abierto ni cambiar cookies.
- [ ] **Step 4: Verify GREEN.** Ejecutar `npm run test:api:auth` y `npm run test:api:registration`; ambos deben pasar sin que el limiter bloquee casos válidos.
- [ ] **Step 5: Commit.** `git add api/app.ts api/auth.ts api/auth.integration.ts && git commit -m "feat: harden authentication API boundaries"`.

---

### Task 5: Documentar operación y verificar todo el sistema

**Files:**
- Modify: `docs/DEPLOY_DEMO.md`
- Modify: `README.md` solo si duplica el flujo de demo

- [ ] **Step 1: Update docs.** Documentar migración, comando `npm run auth:invite-owner`, entrega segura del token, ausencia de email automático y cancelación manual de invitaciones filtradas.
- [ ] **Step 2: Run complete verification.** Ejecutar:

```text
npx tsc -p tsconfig.app.json --noEmit --incremental false
npx tsc -p tsconfig.node.json --noEmit --incremental false
npm run lint
npm run build
npm run test:api:owner-invitation
npm run test:api:deployment
npm run test:api
npm run test:api:db
npm run test:api:auth
npm run test:api:registration
npm run test:api:operations
npm run test:api:documents
npm run test:api:settlements
npm run test:api:driver-portal
npm run test:api:driver-invitation
```

Expected: todos terminan con código 0.
- [ ] **Step 3: Verify repository.** Ejecutar `git diff --check`, `git status --short` y `git log -5 --oneline`; no deben quedar errores de whitespace ni cambios accidentales.
- [ ] **Step 4: Commit docs.** `git add docs/DEPLOY_DEMO.md README.md && git commit -m "docs: document invite-only demo setup"`.

## Plan Self-Review

- **Spec coverage:** cubre hash, expiración, consumo atómico, registro cerrado, aislamiento, límites HTTP, rate limit, documentación y pruebas.
- **Placeholder scan:** no contiene marcadores incompletos ni pasos abiertos.
- **Type consistency:** migración, CLI, app y tests comparten `token_hash`, `organization_name` y `accepted_at`.
- **Review focus coverage:** los cinco casos de riesgo tienen pruebas en las tareas 3 y 4.

## Handoff

Plan completo y guardado en `docs/superpowers/plans/2026-09-19-invite-only-auth.md`. Revisalo y elegí:

- **Native:** lo implemento yo en esta sesión con TDD y verificación completa.
- **Subagent-driven:** se delega cada tarea con revisión independiente.

Recomiendo **Native**: las tareas comparten la misma transacción y contrato de autenticación; una sola ejecución reduce desalineaciones.

