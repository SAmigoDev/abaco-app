# Protección de edición de cuentas del22 de noviembre de2026

## Estado actual

**Local:** formulario, constructor de payload, migración007 y pruebas nuevas guardados en el repositorio; incluidos en un commit dedicado de cierre, sin push y conservando el trabajo local previo.

**Aplicado en staging:** 202611220007 en Supabase bikubreyffppuxfxzxew, registrada en el historial en la misma transacción. **Publicado en staging:** formulario corregido en https://abaco-staging.vercel.app, proyecto prj_a1dlAyeUdxWjWag01sI8ZzHzbGJn, despliegue dpl_CVMWpczCX9AULx7GsvQGZtn2LVKr READY. Ninguna Edge Function requirió cambios ni despliegue.

## Alcance

Corrección limitada a impedir que una edición descriptiva imponga un saldo antiguo. No hay libro de movimientos, conciliación, corte, cambio de trigger ni nuevo motor financiero. Contratos v1/v2, credenciales, vínculos e IDs existentes se conservan. Sin cambios en producción, cron o Atajos del iPhone.

## Cambios locales

- TarjetaForm construye el UPDATE con `datosCuenta(form, true)`, una lista explícita sin saldo_actual. El campo de saldo solo aparece al crear, rotulado «Saldo inicial». La edición explica que no modifica saldo. No se usa un spread del snapshot de cuenta.
- La creación conserva INSERT con saldo inicial y los demás datos existentes; no pasa por UPDATE ni requiere permisos nuevos.
- Nueva migración `202611220007_edicion_cuentas.sql`: retira UPDATE de tabla y de cada columna a PUBLIC/anon/authenticated/service_role y concede solo la lista de campos editables anterior, excluyendo saldo_actual, id y propietario. Revisar grants de columna es necesario: revocar el grant de tabla solamente no los elimina.
- RLS de propietario y MFA004 siguen aplicándose a usuarios. service_role ya no puede imponer saldo por REST directo, aunque omita RLS. No se cambia la autorización de roles SQL propietarios/operadores de base de datos.
- Las únicas escrituras de saldo en las rutas SQL revisadas son el trigger002 y el confirmador003, invocados bajo el contexto de las RPC SECURITY DEFINER protegidas por004/005 y propiedad postgres en staging. Mantienen su permiso interno y comportamiento. No se añade una RPC genérica para editar saldo ni un bypass configurable por el cliente.
- No se modifica001→006.007 queda ocupada por esta corrección; la propuesta anterior de usar007 para ledger queda sustituida en numeración. Cualquier futura implementación del ledger empezará en una migración posterior y requiere alcance propio.

La sesión vieja de una web anterior que siga enviando saldo en UPDATE recibirá rechazo del servidor; debe recargarse la versión corregida. El rechazo es atómico: no se guarda alias ni saldo del payload prohibido. Despliegue coordinado: publicar primero la web que omite saldo y luego restringir permisos, sin tocar registros del titular.

## Verificación local real

- `npm test`:29 pruebas/subpruebas aprobadas. Incluye comprobación del payload usado por el formulario: snapshot con saldo10000 produce UPDATE sin la propiedad; INSERT conserva10000. Las pruebas de SQL embebido anteriores mantienen su alcance de fixtures/Auth simulado.
- ESLint aprobado.
- PostgreSQL18.4 aislado, esquema completo y001→007:10 pruebas/subpruebas aprobadas. Nueva prueba usa procesos/conexiones independientes: lectura de saldo previo, UPDATE de alias con lock y pausa transaccional mientras se registra gasto; quedan alias y cargo, sin pérdida. Payload con saldo antiguo rechazado para authenticated y service_role; alta propia con1234 conservada y edición de cuenta ajena sin filas afectadas. Las suites incluidas mantienen concurrencia/idempotencia, v1, v2, pendientes, cuotas y MFA simulado.
- No se atribuyen estos resultados a la instancia alojada ni al iPhone. No se prueba alteración manual de privilegios por un operador postgres: ese rol debe seguir pudiendo ejecutar las funciones internas legítimas.

## Estado remoto

Preflight y aplicación completados. Preflight verificó proyecto Supabase bikubreyffppuxfxzxew, historial001→006, propietarios reales de funciones y proyecto/equipo Vercel sin Git. Snapshot web sin .env.local ni secretos privados. Ninguna solicitud a producción.

## Resultados alojados reales

Diez pruebas/subpruebas aprobadas de tres suites: edición007, multitarjeta y Supabase Auth/Edge. La prueba007 crea su propia cuenta ficticia por INSERT autenticado con saldo10000; envía PATCH de alias y RPC de gasto100 por solicitudes HTTP concurrentes: quedan alias nuevo y saldo9900. PATCH con alias y snapshot de saldo10000 rechazado para cliente autenticado y service_role; quedan ambos campos anteriores intactos. Repetir el gasto mantiene9900. Usuarios/filas sintéticos eliminados por su UUID al finalizar; no se probaron cargos con cuentas o credenciales del titular.

La suite previa verifica cuotas, pendientes y confirmación legítima, rollback, AAL1/AAL2, administradores, revocación, reintentos y v1/v2 con JWT/TOTP reales. El solapamiento controlado con lock se demuestra en PostgreSQL local; la prueba alojada acredita solicitudes HTTP lanzadas concurrentemente, sin prometer el orden exacto del planificador alojado.

No se repitió interacción manual desde Safari/iPhone. La integración del formulario se verifica por constructor usado realmente en TarjetaForm, ESLint y build final READY; las pruebas HTTP verifican servidor y rutas protegidas, no pulsaciones del navegador.

Postflight de privilegios alojados aprobado: authenticated/service_role sin UPDATE de saldo, authenticated conserva UPDATE de alias e INSERT de saldo inicial. Cinco pruebas/subpruebas HTTPS sobre el despliegue final aprobadas (cookies/callbacks/MFA/logout).

## Cierre en Git

Commit incremental limitado al formulario/helper, migración007, pruebas específicas y este informe. La prueba concurrente se conserva también como `tests/integration/edicion-cuentas-postgres.test.mjs` para no incluir la suite general previa sin seguimiento. No se incluyen001→006, fixtures, helpers de integración, cambios de package.json ni otras funcionalidades previas: permanecen en el checkout. Las pruebas de integración requieren esa base preparada anteriormente; este commit no convierte por sí solo HEAD en una instalación completa desde cero. Las actualizaciones del informe general y del plan futuro permanecen locales para no incorporar sus historiales anteriores en este commit.

Verificación del cierre en Git: prueba de payload1 aprobada, prueba PostgreSQL específica2 pruebas/subpruebas aprobadas, ESLint de los archivos incluidos aprobado. No se repitieron pruebas remotas ni despliegues para crear el commit.
