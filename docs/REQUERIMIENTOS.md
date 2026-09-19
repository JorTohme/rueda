# Requerimientos del producto

Este documento define el primer alcance de **Rueda**, un SaaS web responsive para que dueños de flotas pequeñas de vehículos gestionen operación, documentación, liquidaciones y rentabilidad.

## Camino rápido

1. Un dueño crea su organización y administra vehículos, conductores y movimientos.
2. Cada conductor tiene una cuenta de solo lectura dentro de esa misma organización.
3. La rentabilidad se calcula por período y por vehículo; la suscripción al SaaS se cobra al dueño con Mercado Pago.

## Principios de producto

| Tema | Decisión |
|---|---|
| Plataforma inicial | Web responsive; PWA y modo offline quedan fuera del primer alcance. |
| Cliente objetivo | Dueños con una flota pequeña (por ejemplo, 2–3 vehículos destinados a apps de movilidad). |
| Aislamiento SaaS | Cada organización sólo puede leer y modificar sus propios datos. |
| Carga operativa | En la primera versión la realizan dueño u operador. |
| Portal de conductor | Es de solo lectura; muestra información propia y liquidaciones, no datos de terceros. |
| Moneda inicial | Todos los importes se registran en ARS; multi-moneda queda fuera del MVP. |
| Cobros SaaS | Mercado Pago cobra la suscripción mensual al dueño de la flota. No procesa repartos entre conductores y dueño. |

## Roles y permisos

### Dueño

- Gestiona la organización, plan y facturación.
- Da de alta vehículos y conductores.
- Carga ingresos, gastos, documentos y liquidaciones.
- Invita a operadores y conductores.
- Cierra las liquidaciones del período.

### Operador

- Gestiona vehículos, conductores y movimientos operativos.
- No puede modificar plan, facturación ni propietarios de la organización.

### Conductor

- Consulta sus vehículos asignados y sus documentos.
- Consulta producción cargada a su nombre.
- Ve la liquidación estimada y la liquidación cerrada de sus propios períodos.
- No ve otros conductores, gastos internos ni configuración de la organización.

## Autenticación y sesiones

- El access token es opaco, se guarda en una cookie `HttpOnly` y dura 15 minutos.
- El refresh token también es opaco, se guarda en una cookie `HttpOnly`, rota en cada renovación y dura como máximo 30 días desde el inicio de la sesión.
- La API renueva la sesión automáticamente cuando el access token venció y el refresh token sigue vigente.
- Cerrar sesión revoca la sesión completa; no se almacenan tokens en `localStorage`.

## Módulos del MVP

### 1. Dashboard

- Ganancia neta, ingresos, gastos y vehículos activos del período.
- Resultado por vehículo y total de la flota.
- Gráfico mensual de ingresos y gastos.
- Alertas de documentación próxima a vencer.
- Liquidaciones y movimientos recientes.

### 2. Vehículos

- Alta y edición de datos básicos: patente, marca, modelo, estado y apps habilitadas.
- Estado operativo: activo, inactivo o en mantenimiento.
- Documentación y fecha de vencimiento.
- Historial de conductores asignados.
- Ingresos y gastos asociados.

### 3. Conductores

- Alta y edición de datos personales, estado y documentación.
- Asignación a uno o más vehículos con fecha de inicio y fin.
- Invitación para crear su cuenta de consulta.
- Producción, pagos y liquidaciones propias.

### 4. Operación: ingresos y gastos

#### Ingreso de producción

- Fecha, vehículo, conductor, app de movilidad y cantidad de viajes.
- Importe bruto y receptor del cobro (dueño o conductor).
- Observación opcional.

#### Gasto

- Fecha, vehículo, categoría, importe y quién lo afronta (dueño o conductor).
- Comprobante opcional en una fase posterior.

Categorías iniciales: combustible, mantenimiento, seguro, patente, multa, limpieza y otros.

### 5. Rentabilidad y liquidaciones

- Ingresos menos gastos para resultado operativo.
- Resultado por vehículo y resultado total.
- Liquidación por conductor para un período.
- Estado de la liquidación: borrador, cerrada, pagada o cobrada.

## Reglas de liquidación

Cada asignación conductor–vehículo guarda una política con vigencia. Puede combinar:

1. **Alquiler fijo:** importe definido por período.
2. **Reparto porcentual:** porcentaje sobre la facturación acordada.
3. **Ambos:** se aplican las dos reglas vigentes.

La liquidación siempre conserva una copia de las reglas y valores usados al cerrarse. Cambiar un acuerdo futuro nunca modifica una liquidación histórica.

Durante el período, el conductor ve un saldo **estimado**. Sólo dueño u operador pueden cerrar la liquidación; a partir de ese momento el conductor ve el resultado **cerrado**.

## Documentación

Vehículos y conductores tendrán documentos configurables con fecha de vencimiento. El sistema deriva estos estados:

- vigente;
- próximo a vencer;
- vencido;
- faltante.

Las aplicaciones de movilidad disponibles (Uber, Cabify, Maxim u otras) son configurables por organización. No habrá integraciones automáticas con esas plataformas en el MVP.

## SaaS y suscripción

- Una organización tiene un plan y una suscripción mensual.
- Mercado Pago es el único medio de cobro de la suscripción inicial.
- El backend registra la referencia de Mercado Pago y el estado interno de la suscripción.
- El acceso se actualiza desde notificaciones verificadas del backend; un retorno visual del checkout no es prueba de pago.
- Estados internos mínimos: pendiente, activa, con problema de pago y cancelada.

## Fuera del MVP

- PWA, instalación y funcionamiento offline.
- Integraciones con APIs de Uber, Cabify, Maxim u otras apps.
- Cobros, transferencias o división de dinero entre conductor y dueño mediante Mercado Pago.
- Carga operativa por parte del conductor.
- Multi-moneda, contabilidad fiscal y conciliación bancaria.

## Criterios de aceptación iniciales

- [x] Un dueño puede ver el dashboard de su organización en móvil y escritorio.
- [x] Los datos de una organización no son visibles para otra.
- [x] Se puede relacionar un conductor con un vehículo con vigencia.
- [x] Se puede cargar producción y gastos asociados a un vehículo.
- [x] Cada ingreso de producción registra aplicación, cantidad de viajes y quién cobró.
- [x] El resultado mensual se muestra por vehículo y consolidado con movimientos reales.
- [x] El conductor sólo puede consultar sus propios datos y su liquidación.
- [x] La organización puede configurar sus aplicaciones y asociarlas a cada vehículo.
- [ ] La suscripción SaaS está separada de la operación financiera de la flota.

## Estado actual

La base operativa ya está persistida en PostgreSQL: vehículos, conductores, asignaciones y movimientos financieros tienen API tenant-scoped y formularios responsive. La configuración de la organización, el catálogo de aplicaciones y la edición de vehículos también están persistidos. Los ingresos de producción guardan aplicación, cantidad de viajes y receptor del cobro; sólo se aceptan aplicaciones habilitadas para el vehículo. El alta SaaS y Mercado Pago quedan deliberadamente fuera de este corte.
También se incorporaron documentos con vencimiento derivado y liquidaciones con reglas fijas/porcentuales, preview y cierre histórico. El portal de conductor es de consulta y permite crear la cuenta desde una invitación de un solo uso.

## Próximo paso

El siguiente bloque es completar reportes y exportación de la operación; Mercado Pago queda para la etapa final.
