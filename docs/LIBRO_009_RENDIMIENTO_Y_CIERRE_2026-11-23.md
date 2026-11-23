# Cierre local de 009: rendimiento y requisitos de instalación

## Estado actual — 23 de noviembre de 2026

Entrega en commit local dedicado sobre **81611e0**. No se aplicó 009 a Supabase, no hubo despliegues web/Edge, push, cambios de cron ni cambios en los Atajos del iPhone. Staging y producción no se consultaron ni modificaron. El trabajo previo ajeno a 009 se conserva fuera de esta entrega.

La publicación normal se corrigió: aplica incrementalmente el apunte canónico nuevo con control de secuencia, en lugar de sumar todos los apuntes en cada gasto. Se mantiene la reconstrucción completa, la atomicidad y el único escritor. Instalar 009 deja modo legacy pero ya sustituye los escritores anteriores: **instalar y activar son pasos diferentes y ambos requieren revisión previa**.

Resultados finales: **38 pruebas/subpruebas aprobadas, ninguna fallida u omitida**. Se incluyen 13 de regresión 008, 23 funcionales de 009, 1 benchmark y 1 modelo local del instalador sin SUPERUSER. [Evidencia y huellas finales](./LIBRO_009_PRUEBAS_2026-11-23.json). [Procedimiento de corte, pausa y recuperación](./LIBRO_009_ESCRITOR_Y_CORTE_LOCAL_2026-11-23.md).

## Medición y decisión

Se usaron dos cuentas ficticias de propietarios diferentes: cuenta corriente CLP y crédito CLP. Se escaló a 0, 1.000, 10.000 y **100.000 gastos operativos por cuenta**; en el último escalón hay al menos 200.000 recepciones y operaciones de gasto entre ambas, más aperturas y pruebas. Cada gasto tiene un apunte. No son 100.000 históricos incluidos en la apertura: es historial operativo posterior al corte. Los recuentos exactos al iniciar cada lote están en el [JSON reproducible](./LIBRO_009_RENDIMIENTO_2026-11-23.json), incluidos los gastos adicionales de calentamiento y medición.

PostgreSQL 18.4 x64 Windows, Node 24.18.1, shared_buffers 32 MB, work_mem 4 MB, maintenance_work_mem 64 MB, máximo 20 conexiones; loopback, sin carga de otro benchmark. No es una estimación del hardware, red ni rendimiento de Supabase.

Primer experimento histórico: algoritmo original, backend nuevo por muestra, cinco muestras de gasto por cuenta/escalón y tres reconstrucciones globales. La mediana pasó de 42,469/38,081 ms sin historial a 71,134/72,300 ms con 100.000 gastos por cuenta. El tiempo de conexión se excluye del cronómetro interno, pero cada backend nuevo vuelve a preparar PL/pgSQL y planes. No se usa esa serie para calcular la mejora frente al algoritmo final.

La comparación final utiliza **el mismo esquema final, datos, índices y conexiones persistentes independientes**. Solo reemplaza el cuerpo del único proyector en la base desechable: fixture congelado de suma completa frente a cuerpo incremental de la migración. No instala dos escritores simultáneos. Se alternan lotes suma → incremental → incremental → suma; un calentamiento por lote/cuenta y cinco muestras posteriores, diez muestras medidas por cuenta/método/escalón. Cada muestra tiene BEGIN/COMMIT propios y ejecuta el RPC público registrar_gasto bajo rol authenticated con claims SQL simulados. No se mide una suma aislada como si fuera el gasto completo.

Medianas del tiempo dentro del servidor, en milisegundos:

| Gastos iniciales por cuenta | Gasto corriente, suma | Gasto corriente, incremental | Gasto crédito, suma | Gasto crédito, incremental | Reconstrucción global final |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 2,643 | 1,747 | 1,934 | 1,785 | 2,631 |
| 1.000 | 1,846 | 1,636 | 1,952 | 1,620 | 24,130 |
| 10.000 | 3,797 | 1,612 | 3,860 | 1,649 | 231,723 |
| 100.000 | 23,865 | 1,890 | 25,342 | 1,874 | 3.742,698 |

A 100.000 gastos por cuenta, la mediana del gasto mejora aproximadamente **12,6 veces en corriente y 13,5 en crédito**. Los p95 pasan de 31,082/38,702 ms a 2,086/2,054 ms. Con solo diez muestras estos p95 son los máximos observados, no percentiles de carga sostenida. El JSON conserva también wallMs por muestra: incluye el intercambio local con psql y COMMIT; serverMs termina antes de COMMIT y no representa latencia HTTP ni de red.

Se lanzaron además ocho gastos distintos simultáneos sobre la misma cuenta mediante ocho backends independientes, comprobando ocho PID diferentes y exactamente ocho operaciones nuevas. Con unas 100.000 operaciones previas, la mediana que incluye espera en el servidor fue 124,791 ms con suma y 23,243 ms incremental; p95 234,071 y 46,552 ms. El lote completo observado duró 398,845 y 206,413 ms respectivamente, incluyendo el recuento de verificación. La serialización por usuario/cuenta es intencionada y sigue existiendo. No es un ensayo prolongado de saturación ni de equidad entre clientes.

EXPLAIN ANALYZE con el rol financiero en el mayor escalón: obtener la última secuencia usó libro_secuencia_por_apertura, Index Only Scan de **una fila**, cinco buffers encontrados en caché, 0,247 ms. Sumar apuntes leyó **100.057 filas**, 1.420 buffers encontrados en caché, 22,232 ms. Las mediciones y planes justifican retirar el recorrido lineal de la publicación normal. El plan diagnóstico no incluye condiciones con identificadores de cuentas en el artefacto versionado.

La reconstrucción no se optimiza usando una caché que podría estar dañada. Sigue validando las recepciones, operaciones, apuntes, históricos y secuencias, suma desde el libro y materializa ambas cuentas bajo barrera exclusiva. Se midieron cuatro reconstrucciones por método/escalón, con calentamientos excluidos. A 100.000 operaciones por cuenta la mediana final es **3,743 s** y el máximo 3,868 s. Se bloquearán escritores durante esa operación de mantenimiento; hay que dimensionar una ventana real antes de usarla alojada. Su coste sigue creciendo con el historial. No se oculta ese trabajo dentro de cada gasto.

## Integridad del cambio

La secuencia pertenece al libro inmutable, no a un contador aceptado del cliente ni a la caché. Apertura=1; cada nueva operación recibe la última secuencia canónica más uno bajo los bloqueos financieros existentes. CHECK e índice parcial UNIQUE protegen las secuencias operativas y conservan sin cambios los ensayos de 008. La verificación completa comprueba cantidad=máximo, además de las relaciones económicas del libro.

El proyector incremental carga la operación y su apunte, exige propietario/cuenta/apertura correctos, última secuencia y versión anterior exacta. Verifica también que caché y espejo concuerden y que un saldo desconocido siga siendo NULL. El argumento numérico privado no decide el incremento en modo libro. Repetir la operación directamente falla sin efecto; repetir el evento por v1/v2 devuelve la recepción original. Si falta la caché o su versión está dañada, el gasto falla y se revierte íntegro; tras reconstrucción, el mismo evento puede registrarse una vez. La reconstrucción deriva nuevamente el saldo y versión de los apuntes/operaciones y no crea un movimiento financiero.

Las firmas públicas, IDs, permisos, aislamiento entre usuarios/cuentas, revocación, confirmación concurrente de pendientes y cuotas con un solo efecto de capital permanecen. Un fallo tras el UPDATE de saldo o tras crear cuotas revierte recepción, operación, apunte, caché y saldo. Las pruebas comprueban que solo una función instalada hace UPDATE de saldo; las rutas antiguas se retiran en la misma transacción de instalación.

## Pruebas finales y reproducibilidad

Las suites funcionales se ejecutaron desde un checkout limpio de 81611e0 más las diez fuentes de esta entrega: árbol **60b5d5eb99485cc098b2526fbfbf1cd0799ed90a**. Sin .env, manifiestos privados ni node_modules. Las fuentes medidas y las del modelo de permisos coinciden byte por byte con ese checkout. La suite 008 tardó 22.467,990 ms; la de 009 41.554,673 ms. El benchmark completo, incluyendo preparación sintética, tardó 145.091,467 ms; el test de permisos 5.324,047 ms. El coste de preparar datos no se presenta como throughput de registrar_gasto.

El generador de volumen solo opera en la base local aleatoria verificada. Inserta recepciones pendientes por lotes, suspende el trigger de publicación únicamente dentro de la transacción sintética, las marca confirmadas, inserta sus operaciones/apuntes canónicos y luego reconstruye con la función real. Las muestras medidas siempre usan registrar_gasto y el trigger habilitado. Se ejecuta VACUUM ANALYZE tras preparar cada escalón; no se vacía la caché del sistema operativo y autovacuum conserva sus valores predeterminados. Un intento inicial del generador falló por eventos de triggers pendientes: se resolvió vaciando las constraints diferidas antes de rehabilitar el trigger y se repitió la medición completa. Ese intento no se cuenta como aprobación.

El modelo de permisos usa un superusuario local abaco_labroot solo para proporcionar Auth/roles ficticios equivalentes al proveedor y verificar el clúster. Todas las migraciones públicas y la instalación 009 se ejecutan como **postgres NOSUPERUSER CREATEROLE CREATEDB NOBYPASSRLS**. Pasa instalación, auditoría, corte sintético, gasto, reintento, pausa, reconstrucción y reanudación. No demuestra compatibilidad completa con Supabase administrado.

Los ejecutores requieren Windows, Node 20+ y PostgreSQL 17+ con binarios en una ruta explícita; las ejecuciones registradas usaron 18.4, no se acreditó otra versión. Solo enlazan loopback y verifican data_directory, nombre de base aleatorio y consentimiento synthetic-only; ignoran variables PG de conexión en el helper y no leen .env. WorkRoot debe ser nuevo y quedar fuera del repositorio. Crear solo clústeres locales sintéticos, nunca apuntarlos al alojamiento. Los ejecutores conservan logs y el clúster detenido fuera de Git; cada suite elimina su base en finally.

```powershell
# Funcionales 008/009 y benchmark comparativo opcional de 009:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-libro008-local.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin' -WorkRoot 'C:\ruta\nueva\revision009' -Port 55442 -Include009Performance

# Modelo separado del instalador sin SUPERUSER:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-libro009-rol-local.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin' -WorkRoot 'C:\ruta\nueva\rol009' -Port 55443
```

Omitir -Include009Performance y usar -Include009 para ejecutar solo funcionales. El fixture tests/fixtures/libro009-proyector-suma.sql es exclusivamente un comparador de benchmark; **no debe instalarse en staging**. Es una adaptación de la firma privada original al ABI final, manteniendo el algoritmo anterior; no es una migración ni una recuperación.

ESLint y sintaxis de Node/PowerShell pasaron. Las migraciones 001–008 no se reescribieron. Los resultados de la revisión anterior (34 pruebas, otro árbol y otra huella de SQL) quedan como históricos, sustituidos para la entrega final por el JSON de pruebas actual.

## Requisitos pendientes: postgres administrado de Supabase

Supabase documenta que postgres administrado [no es superusuario](https://supabase.com/docs/guides/database/postgres/roles-superuser). El modelo local reduce ese riesgo, pero falta verificar las restricciones y ownership efectivos del proyecto antes de instalar. La versión alojada se debe consultar de nuevo; la referencia histórica del proyecto era 17.11. No se conectó a Supabase en este cierre.

Antes de autorizar la instalación:

1. Verificar que postgres pueda crear el rol privado (CREATEROLE), administrarlo (ADMIN sobre el rol si ya existe), concederse SET e INHERIT, transferir la propiedad de la función y administrar sus ACL. PostgreSQL 16+ distingue estas opciones; tener ADMIN no acredita SET/INHERIT. La migración los declara explícitamente en dos GRANT separados. [Semántica oficial de GRANT en PostgreSQL 17](https://www.postgresql.org/docs/17/sql-grant.html).
2. Comprobar propiedad/privilegios reales para crear y alterar objetos en public/abaco_privado, cambiar los triggers/funciones anteriores, añadir FK/índices/policies y conceder SELECT, UPDATE(saldo_actual), DML de caché y EXECUTE necesarios. La transferencia requiere CREATE temporal en abaco_privado para el nuevo propietario y luego se revoca. Verificar acceso a catálogos de roles, membresías y pg_shdepend. No asumir que un rol administrativo de la aplicación tenga estos poderes SQL.
3. Confirmar que abaco_financiero sea dedicado, NOLOGIN, NOINHERIT, sin SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB/REPLICATION, sin objetos propios previos en ninguna base y sin pertenencias ajenas a las previstas. Ningún rol API debe heredarlo. El preflight rechaza un rol preexistente no revisado: no hay que sortearlo otorgando superusuario, BYPASSRLS o permisos API adicionales.
4. Revalidar los grants predeterminados del proyecto alojado. Al crear tablas, vistas y funciones, 009 revoca explícitamente permisos de PUBLIC/anon/authenticated/service_role y aplica RLS/MFA y grants mínimos. Ejecutar la auditoría después de instalar. Confirmar desde HTTP real que service_role no exponga funciones privadas ni permita escribir saldo/caché. No basta una prueba con claims SQL simulados.
5. Drenar escrituras y lectores largos; instalación transaccional con ACCESS EXCLUSIVE NOWAIT en tarjetas/transacciones, lock_timeout 2 s y statement_timeout 30 s. La columna CHECK y los índices se crean también sobre los libros existentes: con ensayos voluminosos deben medirse en copia sintética equivalente antes de la ventana. El benchmark de este cierre midió el coste posterior al corte, no el coste DDL sobre una tabla de ensayos masiva ni locks remotos. No ejecutar instalación parcial si el proveedor rechaza un permiso o se agota un timeout: abortar, revisar y preparar corrección.
6. Validar en el entorno alojado las APIs/Edge existentes, JWT reales, AAL1/AAL2, administrador sin factor, credenciales de máquina, pendientes, cuotas, reintentos y revocación. Las pruebas locales de Auth son una simulación SQL y no verifican auth.sessions/auth.mfa_factors del proveedor ni su pipeline HTTP.
7. Resolver antes del corte la representación web de saldo desconocido (actualmente hay lectores que normalizan NULL a cero), el archivo de cuentas con historia y una ventana de pausa/reconstrucción acorde al volumen real. Mantener cron inactivo. Aprobar por separado instalación, activación y despliegues necesarios; este commit local no autoriza ninguno.

No se requieren ni almacenan contraseñas para el rol financiero NOLOGIN. No se versionan claves, tokens, manifiestos privados, enlaces de recuperación ni datos personales. La recuperación segura sigue siendo pausa → verificar libro → reconstruir → auditar → reanudar; no activar un segundo escritor ni restaurar únicamente saldos. La conciliación, importaciones y nuevos tipos de movimientos permanecen fuera de esta fase.
