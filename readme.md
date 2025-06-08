# Plataforma de Gestión de Agendas para Emprendedores y Negocios (Versión 3)

Este documento presenta la arquitectura funcional definitiva de una plataforma para gestionar agendas de emprendedores individuales y negocios con múltiples sucursales, incorporando todas las mejoras y correcciones propuestas en el análisis de errores. La plataforma permite a los emprendedores configurar agendas personales y a los negocios administrar agendas complejas con sucursales y trabajadores. Los usuarios finales reservan citas a través de una URL pública basada en el nombre de usuario (`miagenda.com/<username>`), con selección automática o manual de sucursales según corresponda. El diseño es robusto, escalable, y está optimizado para cumplir con las restricciones de usar tecnologías gratuitas (Node.js, Express, Prisma, PostgreSQL con Supabase, Nodemailer, node-cron) mientras se mantiene la simplicidad.

## Objetivos de la Plataforma
1. **Gestión de agendas**:
   - **Emprendedores individuales**: Configurar agendas personales con horarios y restricciones.
   - **Negocios**: Gestionar agendas con múltiples sucursales y trabajadores.
2. **Reserva de citas**:
   - Usuarios finales reservan citas mediante `miagenda.com/<username>`.
   - Para emprendedores: Seleccionar día y hora.
   - Para negocios: Mostrar sucursales disponibles; seleccionar automáticamente si hay una sola.
3. **Autenticación y verificación**:
   - Emprendedores/negocios se registran, verifican por correo, y se autentican.
   - Usuarios finales proporcionan nombre, correo y teléfono.
4. **Restricciones**:
   - Tecnologías gratuitas: Node.js, Express, Prisma, PostgreSQL (Supabase), Nodemailer, node-cron.
   - Endpoints autenticados retornan solo token JWT; datos vía `/auth/me`.
   - Diseño simple y escalable.

## 1. Diseño de la Base de Datos
La base de datos usa **PostgreSQL** en Supabase, modelada con **Prisma**. Se incorporan todas las mejoras propuestas.

### Modelos
1. **User**:
   - Representa emprendedores o administradores.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `email`: String, único, obligatorio, @db.VarChar(255).
     - `password`: String, obligatorio, @db.VarChar(255).
     - `name`: String, obligatorio para `isBusiness: false`, opcional para `isBusiness: true`, @db.VarChar(100).
     - `phone`: String, opcional, @db.VarChar(20).
     - `username`: String, único, obligatorio, @db.VarChar(50) (URL pública).
     - `isVerified`: Boolean, por defecto `false`.
     - `isBusiness`: Boolean, por defecto `false`.
     - `createdAt`: DateTime, por defecto `now()`.
     - `updatedAt`: DateTime, actualizado automáticamente.
   - **Validaciones**:
     - `username`: Solo alfanuméricos y guiones (`^[a-zA-Z0-9-]+$`), longitud 3-50, normalizado a minúsculas.
     - `email`: Validar formato con expresión regular.
     - `name`: Obligatorio para emprendedores para sincronizar con `Worker.workerName`.
   - **Índices**:
     - `@unique(fields: [email], map: "email_idx", caseSensitive: false)`.
     - `@unique(fields: [username], map: "username_idx", caseSensitive: false)`.
   - **Relaciones**:
     - Uno a uno con `Business` (vía `userId`).
     - Uno a muchos con `VerificationToken`, `RefreshToken`.

2. **Business**:
   - Representa negocio o agenda personal.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `userId`: Int, único, obligatorio.
     - `name`: String, obligatorio, @db.VarChar(100) (personalizable, por defecto "Agenda de [name]").
     - `logo`: String, opcional, @db.VarChar(255).
     - `timezone`: String, opcional, @db.VarChar(50) (por defecto "UTC").
     - `createdAt`: DateTime, por defecto `now()`.
     - `updatedAt`: DateTime, actualizado automáticamente.
   - **Validaciones**:
     - `name`: No depende de `User.username` para negocios; personalizable.
   - **Índices**:
     - `@unique(userId)`.
   - **Relaciones**:
     - Uno a uno con `User`.
     - Uno a muchos con `Branch`, `Worker`, `Schedule`, `Appointment`, `Exception`, `AvailableSlots`.
   - **Eliminación**: `onDelete: Restrict` si existen `Branch`, `Worker`, `Schedule`, `Appointment`, o `Exception`; opcional `onDelete: Cascade` para entornos de prueba con confirmación.

3. **Branch**:
   - Representa una sucursal.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `businessId`: Int, obligatorio.
     - `name`: String, obligatorio, @db.VarChar(100).
     - `address`: String, opcional, @db.VarChar(255).
     - `createdAt`: DateTime, por defecto `now()`.
     - `updatedAt`: DateTime, actualizado automáticamente.
   - **Validaciones**:
     - Crear `Branch` predeterminada (`name: "Sucursal Principal"`) para `isBusiness: true`.
   - **Índices**:
     - `@index(businessId)`.
   - **Relaciones**:
     - Muchos a uno con `Business`.
     - Uno a muchos con `Worker`, `Schedule`, `Appointment`.

4. **Worker**:
   - Representa trabajador o emprendedor.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `businessId`: Int, obligatorio.
     - `branchId`: Int, opcional.
     - `workerName`: String, obligatorio, @db.VarChar(100).
     - `isOwner`: Boolean, por defecto `false`.
     - `createdAt`: DateTime, por defecto `now()`.
     - `updatedAt`: DateTime, actualizado automáticamente.
   - **Validaciones**:
     - Para `isBusiness: false`, crear `Worker` con `workerName = User.name`, `isOwner: true`.
     - Sincronizar `workerName` con `User.name` para `isOwner: true`.
     - Prohibir eliminación si `isOwner: true` (error 403: "Cannot delete owner worker").
   - **Índices**:
     - `@index([businessId, branchId])`.
   - **Relaciones**:
     - Muchos a uno con `Business`, `Branch`.
     - Uno a muchos con `Schedule`, `Appointment`.

5. **Schedule**:
   - Representa horarios.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `businessId`: Int, obligatorio.
     - `branchId`: Int, opcional.
     - `workerId`: Int, opcional.
     - `dayOfWeek`: Int, obligatorio (0-6).
     - `startTime`: Time, obligatorio.
     - `endTime`: Time, obligatorio.
     - `slotDuration`: Int, obligatorio (5-120, múltiplo de 5).
     - `createdAt`: DateTime, por defecto `now()`.
     - `updatedAt`: DateTime, actualizado automáticamente.
   - **Validaciones**:
     - `startTime < endTime`.
     - `slotDuration`: Validar en backend (Joi/Zod).
     - Evitar superposiciones de horarios para el mismo `workerId`, `dayOfWeek`:
       ```sql
       SELECT * FROM Schedule
       WHERE workerId = :workerId AND dayOfWeek = :dayOfWeek
       AND (startTime <= :newEndTime AND endTime >= :newStartTime);
       ```
   - **Índices**:
     - `@index([businessId, dayOfWeek])`.

6. **Appointment**:
   - Representa citas.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `businessId`: Int, obligatorio.
     - `branchId`: Int, opcional.
     - `workerId`: Int, opcional.
     - `clientName`: String, obligatorio, @db.VarChar(100).
     - `clientEmail`: String, obligatorio, @db.VarChar(255).
     - `clientPhone`: String, obligatorio, @db.VarChar(20).
     - `startTime`: DateTime, obligatorio.
     - `endTime`: DateTime, obligatorio.
     - `status`: String, obligatorio, @db.VarChar(20) (`pending`, `confirmed`, `cancelled`).
     - `createdAt`: DateTime, por defecto `now()`.
     - `updatedAt`: DateTime, actualizado automáticamente.
   - **Validaciones**:
     - `clientEmail`: Validar formato.
     - `endTime - startTime`: Igual a `slotDuration` (extensible a múltiplos en el futuro).
     - **Máquina de estados**:
       - `pending` → `confirmed` (por negocio).
       - `pending` → `cancelled` (por cliente o negocio).
       - `confirmed` → `cancelled`.
   - **Índices**:
     - `@index([businessId, startTime])`.

7. **VerificationToken**:
   - Almacena tokens de verificación.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `token`: String, único, @db.VarChar(64).
     - `userId`: Int, obligatorio.
     - `expiresAt`: DateTime, obligatorio.
     - `createdAt`: DateTime, por defecto `now()`.
   - **Validaciones**:
     - Máximo 3 tokens por `userId`; borrar anteriores al crear nuevo.
   - **Índices**:
     - `@unique(token)`.

8. **Exception**:
   - Representa fechas especiales.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `businessId`: Int, obligatorio.
     - `branchId`: Int, opcional.
     - `workerId`: Int, opcional.
     - `date`: Date, obligatorio.
     - `isClosed`: Boolean, obligatorio.
     - `startTime`: Time, opcional (para cierres parciales).
     - `endTime`: Time, opcional.
     - `createdAt`: DateTime, por defecto `now()`.
     - `updatedAt`: DateTime, actualizado automáticamente.
   - **Validaciones**:
     - Si `isClosed: true`, ignorar `startTime`, `endTime`.
     - Si `startTime` presente, validar `startTime < endTime`.
   - **Índices**:
     - `@index([businessId, date])`.

9. **RefreshToken**:
   - Almacena tokens de renovación.
   - **Campos**:
     - `id`: Int, clave primaria, autoincremental.
     - `token`: String, único, @db.VarChar(64).
     - `userId`: Int, obligatorio.
     - `expiresAt`: DateTime, obligatorio (7 días).
     - `createdAt`: DateTime, por defecto `now()`.
   - **Relaciones**:
     - Muchos a uno con `User` (`onDelete: Cascade`).
   - **Índices**:
     - `@unique(token)`.

10. **TemporaryToken**:
    - Almacena tokens para reprogramar/cancelar citas.
    - **Campos**:
      - `id`: Int, clave primaria, autoincremental.
      - `token`: String, único, @db.VarChar(64).
      - `appointmentId`: Int, obligatorio.
      - `clientEmail`: String, obligatorio, @db.VarChar(255).
      - `expiresAt`: DateTime, obligatorio (10 minutos).
      - `used`: Boolean, por defecto `false`.
      - `createdAt`: DateTime, por defecto `now()`.
    - **Relaciones**:
      - Muchos a uno con `Appointment` (`onDelete: Cascade`).
    - **Índices**:
      - `@unique(token)`.

11. **AvailableSlots**:
    - Almacena slots precalculados para optimizar disponibilidad.
    - **Campos**:
      - `id`: Int, clave primaria, autoincremental.
      - `businessId`: Int, obligatorio.
      - `branchId`: Int, opcional.
      - `workerId`: Int, opcional.
      - `date`: Date, obligatorio.
      - `startTime`: Time, obligatorio.
      - `endTime`: Time, obligatorio.
      - `createdAt`: DateTime, por defecto `now()`.
    - **Índices**:
      - `@index([businessId, date, startTime])`.

12. **AuditLog**:
    - Registra acciones críticas.
    - **Campos**:
      - `id`: Int, clave primaria, autoincremental.
      - `action`: String, obligatorio, @db.VarChar(50) (`create`, `update`, `delete`).
      - `entity`: String, obligatorio, @db.VarChar(50) (`User`, `Appointment`, etc.).
      - `entityId`: Int, obligatorio.
      - `userId`: Int, opcional (null para acciones públicas).
      - `createdAt`: DateTime, por defecto `now()`.
    - **Índices**:
      - `@index([entity, entityId])`.

## 2. Endpoints
### 2.1. Endpoints de Autenticación
- **POST /auth/register**
  - **Descripción**: Registra usuario, negocio, trabajador (emprendedores), sucursal y horario predeterminados (negocios).
  - **Entrada**:
    - `email`: String, obligatorio.
    - `password`: String, obligatorio.
    - `name`: String, obligatorio para `isBusiness: false`.
    - `phone`: String, opcional.
    - `username`: String, obligatorio (3-50, alfanuméricos/guiones, minúsculas).
    - `businessName`: String, opcional.
    - `logo`: String, opcional.
    - `isBusiness`: Boolean, opcional (`false` por defecto).
  - **Salida**: `{ token: String }` (JWT con `userId`, `isBusiness`, `username`).
  - **Lógica**:
    - Validar entradas (Joi/Zod).
    - Normalizar `username` a minúsculas.
    - Verificar unicidad de `email`, `username`.
    - Hashear contraseña.
    - Crear `Business` (`name: businessName || "Agenda de [name || username]"`).
    - Crear `User`.
    - Si `isBusiness: false`, crear `Worker` (`workerName: name`, `isOwner: true`).
    - Si `isBusiness: true`, crear `Branch` ("Sucursal Principal").
    - Crear `Schedule` predeterminado (lunes-viernes, 9:00-17:00, `slotDuration: 30`).
    - Borrar tokens anteriores, crear `VerificationToken` (expira en 30 minutos).
    - Enviar correo (reintentar 3 veces: 1s, 5s, 10s).
    - Generar token JWT.
  - **Errores**:
    - 400: Entradas inválidas, `email`/`username` ocupados.
    - 500: Error persistente al enviar correo.

- **GET /auth/verify**
  - **Descripción**: Verifica cuenta.
  - **Entrada** (query): `token`: String.
  - **Salida**: `{ message: String }`.
  - **Lógica**:
    - Buscar `VerificationToken`.
    - Si inválido, error 400.
    - Si expirado, permitir reenvío vía `/auth/resend-verification`.
    - Actualizar `isVerified: true`, eliminar token.
  - **Errores**:
    - 400: Token inválido/expirado.

- **POST /auth/resend-verification**
  - **Descripción**: Reenvía token de verificación.
  - **Entrada**: `email`: String.
  - **Salida**: `{ message: String }`.
  - **Lógica**:
    - Buscar `User` (`isVerified: false`).
    - Limitar 3 reenvíos/día (rate-limiting).
    - Borrar tokens anteriores, crear nuevo.
    - Enviar correo.
  - **Errores**:
    - 400: Email no registrado o verificado.
    - 429: Límite de reenvíos excedido.

- **POST /auth/login**
  - **Descripción**: Autentica usuario.
  - **Entrada**:
    - `email`: String.
    - `password`: String.
  - **Salida**: `{ token: String, refreshToken: String }`.
  - **Lógica**:
    - Validar entradas.
    - Verificar `email`, `password`, `isVerified`.
    - Crear `RefreshToken` (7 días).
    - Retornar JWT (1 hora) y refresh token.
  - **Errores**:
    - 400: Credenciales inválidas.
    - 403: Cuenta no verificada.

- **POST /auth/refresh**
  - **Descripción**: Renueva token JWT.
  - **Entrada**: `refreshToken`: String.
  - **Salida**: `{ token: String, refreshToken: String }`.
  - **Lógica**:
    - Validar `RefreshToken`.
    - Rotar token (crear nuevo, invalidar anterior).
    - Retornar nuevo JWT y refresh token.
  - **Errores**:
    - 401: Token inválido/expirado.

### 2.2. Endpoints de Gestión (Autenticados)
- **GET /auth/me**
  - **Descripción**: Obtiene datos del usuario.
  - **Salida**:
    ```json
    {
      id: Int, email: String, name: String | null, phone: String | null,
      username: String, isBusiness: Boolean,
      business: { id: Int, name: String, logo: String | null, timezone: String },
      worker: { id: Int, workerName: String, isOwner: Boolean } | null
    }
    ```
  - **Lógica**:
    - Retornar `User`, `Business`, `Worker` (si `isOwner: true`).
  - **Errores**:
    - 401: No autenticado.

- **PUT /user/update**
  - **Descripción**: Actualiza usuario.
  - **Entrada**:
    - `name`: String, opcional.
    - `phone`: String, opcional.
  - **Salida**: `{ token: String }`.
  - **Lógica**:
    - Validar entradas.
    - Actualizar `User`.
    - Sincronizar `workerName` si `isOwner: true`.
    - Registrar en `AuditLog`.
  - **Errores**:
    - 400: Entradas inválidas.
    - 401: No autenticado.

- **PUT /business/update**
  - **Descripción**: Actualiza negocio.
  - **Entrada**:
    - `name`: String, opcional.
    - `logo`: String, opcional.
    - `timezone`: String, opcional.
  - **Salida**: `{ token: String }`.
  - **Lógica**:
    - Validar entradas.
    - Actualizar `Business`.
    - Registrar en `AuditLog`.
  - **Errores**:
    - 400: Entradas inválidas.
    - 401: No autenticado.

- **POST /branches**, **PUT /branches/:id**, **DELETE /branches/:id**:
  - Como descrito, con validación de `isBusiness: true`.
  - **Errores**:
    - 403: No es negocio.
    - 404: Sucursal no encontrada.

- **POST /workers**, **PUT /workers/:id**:
  - Usar `workerName`.
  - **Errores**:
    - 403: Intento de modificar `isOwner: true`.

- **DELETE /workers/:id**:
  - Prohibir si `isOwner: true`.
  - **Errores**:
    - 403: Cannot delete owner worker.

- **POST /schedules**, **PUT /schedules/:id**, **DELETE /schedules/:id**:
  - Validar superposiciones y `slotDuration`.
  - **Errores**:
    - 400: Horario inválido o superpuesto.

- **POST /exceptions**, **PUT /exceptions/:id**, **DELETE /exceptions/:id**:
  - Validar `startTime < endTime` si presentes.
  - **Errores**:
    - 400: Fecha/hora inválida.

- **PUT /appointments/:id**
  - **Descripción**: Modifica cita (negocio).
  - **Entrada**:
    - `startTime`: DateTime, opcional.
    - `endTime`: DateTime, opcional.
    - `status`: String, opcional.
  - **Salida**: `{ token: String }`.
  - **Lógica**:
    - Validar slot disponible.
    - Actualizar `Appointment`.
    - Notificar cliente por correo.
    - Registrar en `AuditLog`.
  - **Errores**:
    - 400: Slot ocupado.
    - 401: No autenticado.

- **GET /audit-logs**
  - **Descripción**: Consulta logs de auditoría.
  - **Entrada** (query): `entity`, `entityId`, `action`, `startDate`, `endDate`.
  - **Salida**: `{ logs: [{ id: Int, action: String, entity: String, entityId: Int, userId: Int | null, createdAt: DateTime }] }`.
  - **Lógica**:
    - Filtrar logs por parámetros.
    - Limitar a 100 registros.
  - **Errores**:
    - 401: No autenticado.

### 2.3. Endpoints Públicos
- **GET /public/business/:username**
  - **Descripción**: Obtiene negocio y sucursales.
  - **Salida**:
    ```json
    {
      business: { id: Int, name: String, logo: String | null, isBusiness: Boolean },
      branches: [{ id: Int, name: String, address: String | null }]
    }
    ```
  - **Lógica**:
    - Buscar `User` por `username` (insensible a mayúsculas).
    - Retornar `Business` y `Branch` (una sola si `isBusiness: false` o única).
    - Error si `isBusiness: true` y no hay sucursales.
    - Rate-limiting: 100/hora por IP.
  - **Errores**:
    - 400: No branches configured.
    - 404: Negocio no encontrado.

- **GET /public/business/:username/availability**
  - **Descripción**: Obtiene slots disponibles.
  - **Entrada** (query): `branchId`, `workerId`, `date` (YYYY-MM-DD).
  - **Salida**:
    ```json
    { availableSlots: [{ startTime: String, endTime: String, workerId: Int | null, workerName: String | null }] }
    ```
  - **Lógica**:
    - Consultar `AvailableSlots` o calcular desde `Schedule`.
    - Excluir `Appointment` (`status != cancelled`) y `Exception`.
    - Rate-limiting: 50/hora por IP.
  - **Errores**:
    - 400: Fecha inválida.
    - 404: Negocio no encontrado.

- **POST /public/business/:username/appointments**
  - **Descripción**: Reserva cita.
  - **Entrada**:
    - `branchId`: Int, opcional.
    - `workerId`: Int, opcional.
    - `startTime`: DateTime.
    - `endTime`: DateTime.
    - `clientName`: String.
    - `clientEmail`: String.
    - `clientPhone`: String.
  - **Salida**: `{ message: String, appointmentId: Int }`.
  - **Lógica**:
    - Validar entradas.
    - Verificar slot en transacción:
      ```sql
      SELECT * FROM Appointment WHERE businessId = :businessId
      AND startTime = :startTime AND status != 'cancelled' FOR UPDATE;
      ```
    - Crear `Appointment` (`status: pending`).
    - Enviar correo de confirmación.
    - Registrar en `AuditLog`.
    - Rate-limiting: 5/hora por IP o `clientEmail`.
  - **Errores**:
    - 400: Slot ocupado, entradas inválidas.
    - 429: Límite excedido.

- **PUT /public/appointments/:id**
  - **Descripción**: Reprograma cita.
  - **Entrada**:
    - `token`: String (enviado por correo).
    - `startTime`: DateTime, opcional.
    - `endTime`: DateTime, opcional.
  - **Salida**: `{ message: String }`.
  - **Lógica**:
    - Validar `TemporaryToken` (`used: false`, no expirado).
    - Verificar slot disponible.
    - Actualizar `Appointment` (`status: pending`).
    - Marcar token como usado.
    - Rate-limiting: 5/hora por IP.
  - **Errores**:
    - 400: Token inválido, slot ocupado.
    - 429: Límite excedido.

- **DELETE /public/appointments/:id**
  - **Descripción**: Cancela cita.
  - **Entrada**: `token`: String.
  - **Salida**: `{ message: String }`.
  - **Lógica**:
    - Validar `TemporaryToken`.
    - Actualizar `Appointment` (`status: cancelled`).
    - Notificar negocio.
    - Marcar token como usado.
    - Registrar en `AuditLog`.
    - Rate-limiting: 5/hora por IP.
  - **Errores**:
    - 400: Token inválido.
    - 429: Límite excedido.

## 3. Seguridad
- **Rate-limiting** (`express-rate-limit`):
  - Públicos: 100/hora (`/business/:username`), 50/hora (`/availability`), 5/hora (`/appointments`).
  - Autenticados: 200/hora.
  - Reenvíos: 3/día por email.
- **Validación**: Joi/Zod para sanitizar entradas.
- **JWT**: 1 hora, con `userId`, `isBusiness`, `username`.
- **Refresh Tokens**: 7 días, rotación al usarse.
- **Temporary Tokens**: 10 minutos, uso único.

## 4. Proceso de Limpieza
- **Cron Job**: Cada hora, elimina usuarios no verificados (`expiresAt` vencido, `createdAt > 24 horas`).
  ```sql
  DELETE FROM User WHERE isVerified = false AND id IN (
    SELECT userId FROM VerificationToken WHERE expiresAt < NOW()
  ) AND createdAt < NOW() - INTERVAL '24 hours';
  ```
- Eliminar `AuditLog` > 90 días (cron mensual).

## 5. Notificaciones
- Correos para verificación, confirmación, recordatorios (24 horas antes), cancelaciones.
- Plantillas reutilizables con Nodemailer.

## 6. Escalabilidad y Rendimiento
- **Caché**: `AvailableSlots` precalculada por cron diario.
- **Índices**: Optimizados para consultas frecuentes.
- **Zonas horarias**: UTC en DB, conversión en API según `Business.timezone`.
- **Colas**: Opcional, usar `bull` para picos de tráfico (si permitido).

## 7. Pruebas
- **Jest**, **Supertest**: Cubrir endpoints, validaciones, disponibilidad.

## 8. Flujo de Uso
1. Registro → Verificación → Login.
2. Gestión de horarios, sucursales, trabajadores.
3. Cliente accede a `miagenda.com/<username>`, reserva cita.
4. Reprogramación/cancelación con token temporal.

## 9. Notas de Implementación
- **Estructura**:
  - `prisma/schema.prisma`: Modelos.
  - `index.js`: Servidor, cron.
  - `routes/auth.js`, `routes/business.js`, `routes/public.js`.
  - `middleware/authenticate.js`, `middleware/rateLimit.js`.
  - `.env`: `DATABASE_URL`, `JWT_SECRET`, `EMAIL_USER`, `EMAIL_PASS`, `FRONTEND_URL`.
  - `package.json`: Dependencias (`@prisma/client`, `prisma`, `express`, `bcrypt`, `jsonwebtoken`, `nodemailer`, `node-cron`, `express-rate-limit`, `joi`, `nodemon`, `jest`, `supertest`).

Este diseño es completo, seguro, y escalable, listo para implementación.