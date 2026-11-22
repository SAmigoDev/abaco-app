# Validación 008 en staging operativo y volumen local

## Cierre con ejecución de las versiones finales · 22 de noviembre de 2026

El test alojado final terminó con **6 pruebas/subpruebas aprobadas, 0 fallidas y 0 omitidas**, en **27.966,564 ms** (primera ejecución reutilizada: 26.708,796 ms; repetición final tras normalizar el EOF: 27.966,564 ms). Esta ejecución incluye el cierre defensivo dentro del propio test y sus comprobaciones de revocación, rol usuario, bloqueo de login y ausencia de sesiones. Sustituye el pendiente anterior de volver a ejecutar la versión modificada.

Se reutilizó el último fixture TEST008 mediante un manifiesto privado: **2 usuarios, 4 cuentas, 4 aperturas y el vínculo existente**. No aumentaron los usuarios sintéticos (4 en total), cuentas (8), aperturas (8), instrumentos ni vínculos. En las dos ejecuciones se añadieron seis recibos legítimos de prueba (100 + 10 + 10 por ejecución), pasando de 8 a 14 recibos sintéticos; los ocho reintentos REST de cada gasto de 100 devolvieron un único ID. Las cuatro credenciales nuevas se revocaron, sin reactivar ninguna antigua. El saldo sintético principal pasó de 9.780 a 9.540 por el motor vigente; la apertura original permaneció en 9.900. Los registros y saldos originales se conservaron, sin aperturas para sus propietarios.

Para repetir el enrolamiento con JWT/TOTP reales se reinicializaron exclusivamente las identidades ficticias incluidas en ese manifiesto: factores de Auth, sesiones, contraseña aleatoria y marca privada de MFA. Antes de cualquier reinicio se comprobaron el dominio .invalid, prefijo TEST008, UUID, nombre del perfil, propietario de cada cuenta y exclusión de los UUID originales. **Es preparación de fixtures por el operador; no es recuperación de cuenta ni un mecanismo utilizable por usuarios.** Al finalizar se verificó MFA de nuevo; los actores quedaron bloqueados, con rol usuario y sin sesiones. No se aplicó ese procedimiento a las cuentas originales.

Las aperturas se repiten con su solicitud original: no se reinician saldos ni se insertan aperturas adicionales. Los gastos sintéticos anteriores aún no reflejados se incorporan mediante el espejo privado idempotente, sin escribir saldos. Los gastos nuevos vuelven a dejar la foto de ensayo obsoleta hasta un reflejo explícito, como exige esta fase inactiva.

### Reproducción del ensayo alojado sin acumular cuentas

Además de los ACK y rutas del contexto aislado ya documentados, definir:

- ABACO_008_REUSE_MANIFEST: manifiesto privado del fixture TEST008 que contiene prefix, users, cards y books.
- ABACO_008_ORIGINAL_BASELINE: manifiesto privado de UUID originales para excluirlos del reinicio sintético.
- ABACO_008_RESULT_MANIFEST: archivo de salida distinto del manifiesto de entrada; no almacena contraseñas, secretos de credenciales ni claves TOTP.

Ejecutar node --test tests/integration/libro-staging-hosted.test.mjs. Sin manifiesto, el modo histórico crea un fixture nuevo; **no usarlo para repetir esta validación operativa**. No versionar manifiestos, claves ni salidas privadas. El benchmark local sigue creando y eliminando una única base desechable por ejecución; no reutiliza ni carga el Supabase operativo.

### Benchmark final ejecutado

La versión final de libro-volumen-postgres.test.mjs pasó **1/1 pruebas, sin omisiones**, en **366.246,613 ms**. El assert de filas se ejecutó en los seis intentos: tres con exactamente 100.000 filas y tres con 1.000.000. La carga usó 1.000 cuentas locales sintéticas; la base temporal se eliminó al finalizar. Se mantuvieron las mismas limitaciones de distribución, versión y buffers descritas en el ensayo histórico. Durante la carga solo se consultó puntualmente pg_stat_activity para observar progreso; no se ejecutaron otras suites locales concurrentes.

| Filas verificadas | DDL servidor, tres intentos (ms) | Mediana servidor (ms) | Pared local, tres intentos (ms) |
| --- | --- | --- | --- |
| 100.000 | 284,047 / 274,055 / 283,539 | 283,539 | 805,266 / 630,247 / 630,876 |
| 1.000.000 | 7.289,390 / 4.088,000 / 2.818,078 | 4.088,000 | 9.991,055 / 4.936,103 / 3.612,634 |

Preparación: 33.527,061 ms para 100.000 filas y 302.982,229 ms adicionales hasta el millón. Índice nuevo: 6.791.168 y 67.690.496 bytes respectivamente. Relación completa, incluidos índices/bloat: 136.019.968 y 1.198.415.872 bytes. Instalación de la 008 completa sobre el millón de filas con caché calentada: **3.538,442 ms de pared local**. No es una medición de Supabase ni una garantía de su duración de bloqueo.

Métricas exactas de esta ejecución: [VALIDACION_008_METRICAS_FINALES_2026-11-22.json](./VALIDACION_008_METRICAS_FINALES_2026-11-22.json). La suite histórica de 13 pruebas locales de bloqueos no se modificó ni se volvió a ejecutar en este cierre; sus resultados aprobados se conservan más abajo como evidencia anterior. ESLint y sintaxis de los dos tests finales aprobados. No se alteró su lógica después de estas ejecuciones finales.

### Alcance del commit de cierre

Se incluyen únicamente los dos tests de esta validación, este informe, las métricas finales sin secretos y el aviso actualizado del informe de fase 008. El SQL 008 permanece idéntico a f319928. El resto del trabajo local previo se conserva fuera de este commit, incluidas las bases y utilidades de integración históricas sin versionar. **La ejecución requiere ese entorno preparado; este commit por sí solo no reconstruye un checkout limpio**, dado que las migraciones 001–006, el esquema base y helpers compartidos siguen perteneciendo a la entrega previa. Su incorporación al historial queda pendiente de una revisión separada.

No se publica el commit ni se despliega nada. No hay nueva aplicación de migraciones, cambio de motor, producción, cron ni Atajos del iPhone.

## Resultados históricos de la primera validación

Por autorización expresa del titular, se usó exclusivamente Supabase **abaco-staging**, ref **bikubreyffppuxfxzxew**, sin contratar recursos. Se instaló la expansión 008 exacta del commit **f3199284569d9d7c1466d36989495241efd03ef2**. **El libro sigue inactivo:** sin nuevo escritor de saldo, corte, conciliación o importación. No se desplegó web ni Edge ni se modificó producción, cron o el iPhone. Los nuevos tests y este informe permanecen locales, sin commit/push adicional.

La instrucción actual permite instalar 008 en staging y sustituye la restricción de solo-local de la entrega anterior. No se ejecutó allí el guion que recorre todas las cuentas. Las aperturas alojadas se limitaron a cuentas creadas por esta validación, identificadas como TEST008 y con manifiesto privado de UUID.

## Preflight y preservación

Preflight alojado: PostgreSQL 17.11, historial 001→007, functions del motor propiedad postgres y sin locks ajenos sobre las tablas afectadas en el instante consultado. Antes de 008 había 2 usuarios, 2 cuentas, 20 transacciones, 9 credenciales, 3 vínculos y 3 instrumentos. La relación transacciones ocupaba 147456 bytes en total. No se usó una copia de datos de producción ni se exportaron filas personales.

Se comparó la 008 local con git show del commit antes de ejecutar. SHA256 del texto normalizado de la migración: `7d2120d459455fefcf2ddd7e53e7ac06413f25b455e5e59ef9fe7caeb0388053`. Se registró su contenido y versión en el historial en la misma transacción de instalación. El refresh de metadatos PostgREST se notificó después del DDL.

Tiempo total de la llamada Management API de instalación: **508,619 ms**. Incluye red/API, migración e historial; NO es una medición del tiempo exclusivo de construcción de la constraint o de retención del lock. No se indujeron bloqueos ni cargas intensivas en staging. Los límites de 008 siguieron en 2 s para cada espera de lock y 30 s para cada sentencia.

Postflight: comparación de IDs, recuentos y digest MD5 del contenido completo de las filas originales de las seis tablas, sin imprimir ni copiar sus datos. Todas las filas originales permanecieron iguales tras instalación y pruebas. Las definiciones de registrador/confirmador/función de saldo conservan su digest. **Cero aperturas para los dos usuarios originales.** El historial quedó 001→008. Es una comprobación de conservación durante el ensayo, no una promesa de que el usuario no pueda registrar movimientos posteriores.

## Pruebas alojadas con JWT y TOTP reales

Archivo: `tests/integration/libro-staging-hosted.test.mjs`. Requiere opt-in adicional `ABACO_008_OPERATIONAL_TEST_ACK=bikubreyffppuxfxzxew:identified-synthetic-only` y el contexto de staging conocido. El contexto histórico que autorizó el proyecto inicialmente vacío no se interpreta como estado actual: el preflight reconoció sus registros existentes. Cada cuenta ensayada pertenece al conjunto de UUID creados por el test; no se pasa una cuenta del titular al preparador.

**Resultado final: 6 pruebas/subpruebas aprobadas, unos 18,2 s de ejecución de la suite.**

| Caso | Resultado observado |
| --- | --- |
| Alta, histórico y apertura | Cuenta sintética 10000; gasto 100 deja 9900; apertura 9900 y un histórico incluido. Cuatro solicitudes concurrentes de apertura devuelven una sola identidad. Repetir recepción no descuenta otra vez |
| Desconocido y cero | Cuentas USD sintéticas mantienen null y 0 respectivamente |
| Ocho reintentos REST | Un ID de gasto y saldo 9800, no ocho descuentos. Ensayo queda obsoleto hasta reflejar explícitamente ese gasto; espejo 9800 sin tocar la cuenta |
| FK e inmutabilidad | Una referencia cruzada de propietario/cuenta se rechaza por FK real. Un UPDATE de apertura se rechaza. Reflejar un histórico incluido genera conflicto |
| RLS/permisos | Otro usuario no lee filas ajenas; authenticated no inserta en las cuatro tablas y service_role no puede leerlas. La vista no filtra filas ajenas hacia el lector. Las cuatro funciones privadas no tienen EXECUTE para anon/authenticated/service_role y el esquema privado no está expuesto como RPC |
| V1/v2 por Edge existente | Nuevas credenciales sintéticas: recepción/repetición con mismo ID, un efecto de 10 por contrato y 401 después de revocar. Los tokens originales no se tocaron |
| MFA real | Usuario con TOTP verificado: nueva sesión AAL1 sin datos del libro, AAL2 con acceso propio. Administrador sintético sin completar MFA también queda bloqueado; al verificar TOTP accede |

La primera ejecución pasó 4 subpruebas pero falló el caso de FK porque su fixture chocaba antes con el índice de apertura única. Se cambió a una operación de gasto cruzada para probar específicamente la FK; la ejecución posterior quedó completamente aprobada. No fue una corrección a la migración 008. El primer intento del generador local de volumen también corrigió una referencia de columna ambigua antes de obtener resultados; no se cuenta como benchmark aprobado.

### Datos sintéticos retenidos y retiro de accesos

Las dos ejecuciones dejaron 4 usuarios de prueba, 8 cuentas, 8 transacciones y 8 aperturas de ensayo. Prefijo TEST008, emails `@abaco-test.invalid`, nombres/alias de prueba y UUID guardados solo en manifiestos privados fuera de Git. No se borran ensayos inmutables ni se deshabilitan sus triggers para limpiar.

Las 4 credenciales nuevas quedaron revocadas, sin credenciales de prueba activas. Los 4 usuarios están bloqueados para login; se retiró el rol admin de los usuarios creados para esa prueba y se eliminaron únicamente sus sesiones Auth. Verificado: 0 sesiones para esos 4 UUID. No se retiraron factores ni se rebajó la obligación MFA. El retiro de roles/sesiones se guardó en el registro privado y el test incorpora el cierre defensivo para futuras ejecuciones.

Estos son ensayos, no saldos para mostrar en la cuenta del titular. Los gastos v1/v2 posteriores no se reflejan automáticamente en el libro; por diseño una foto puede quedar obsoleta. No se usa ningún resultado como autorización de activar el escritor.

## Volumen e impactos intensivos: solo PostgreSQL local

Archivo: `tests/integration/libro-volumen-postgres.test.mjs`. Clúster explícito 127.0.0.1:55439, data_directory comprobado bajo work/staging-pg/data; base única por ejecución y eliminación de esa base al finalizar. Se reconstruyeron esquema sintético y 001→007. Ninguna consulta de este benchmark se envía a Supabase.

Entorno observado: PostgreSQL 18.4 x86_64 Windows, maintenance_work_mem 64 MB, work_mem 4 MB y shared_buffers 400 kB. El acceso CIM no permitió identificar hardware. Es un clúster de pruebas con buffers muy reducidos, diferente del PostgreSQL 17.11 alojado. No extrapolar los tiempos a una VM de Supabase.

Datos: 1000 cuentas sintéticas, un propietario sintético, UUID aleatorios de eventos/transacciones y comercios con unos 100 caracteres. Se probaron 100000 y 1000000 de filas existentes, frente a las 20 del staging antes de 008. Los niveles son escenarios de estrés, no una estimación de uso real ni una réplica de producción. La distribución de múltiples usuarios/monedas no está representada por esta carga.

La carga masiva se insertó pendiente y luego se marcó confirmada directamente en SQL para separar el coste de preparar el dataset del registro RPC. Por ello NO se usa este dataset para acreditar saldos o throughput de negocio. Las propiedades financieras se probaron por separado con el motor legítimo. La preparación produjo actualizaciones/bloat y pudo convivir con autovacuum; no se borraron cachés entre repeticiones.

### Nueva constraint UNIQUE(usuario_id,id,tarjeta_id)

Tiempo servidor: clock_timestamp alrededor del ALTER TABLE ADD CONSTRAINT. Tiempo de pared local adicional incluye psql y comprobaciones. Se creó y retiró únicamente esa constraint nueva dentro de la base desechable tres veces por nivel, sin cambiar las migraciones anteriores.

| Filas comprobadas | DDL servidor, tres intentos | Pared local, tres intentos | Tamaño nuevo índice |
| --- | --- | --- | --- |
|100000|435,989 /287,982 /299,020 ms|884,170 /641,885 /681,786 ms|6791168 bytes, aproximadamente 6,48 MiB|
|1000000|8884,783 /3419,404 /3536,351 ms|10933,243 /4296,403 /4405,525 ms|67690496 bytes, aproximadamente 64,55 MiB|

Medianas servidor: 299,020 ms y 3536,351 ms. El primer millón fue notablemente más lento; no se atribuye causalidad exacta sin perfil de I/O/cachés. Tamaños totales de la relación al medir, incluidos índices/bloat: 135544832 bytes y 1209704448 bytes. Preparación de 100000 filas:34,947 s; incremento a un millón:298,630 s, separados del DDL.

Después de retirar el índice del último intento se aplicó la 008 completa al millón de filas: **3299,998 ms de pared local**, con caché calentada. Benchmark completo aprobado, alrededor de 364,3 s. Esto no es una medición de instalar 008 en Supabase con un millón de filas.

### Bloqueos y regresión local

Se volvió a ejecutar `tests/integration/libro-ensayo-postgres.test.mjs`: **13 pruebas/subpruebas aprobadas**, unos 27,7 s. Observados ACCESS EXCLUSIVE en transacciones y SHARE ROW EXCLUSIVE en tarjetas/usuarios durante DDL, además de locks de lectura/índice. La espera inducida supera 2 s y aborta sin dejar esquema/constraint parcial. Una apertura serializa al escritor del mismo usuario, sin impedir un gasto de otro usuario; se observan los bloqueadores y se cancela solo el holder de la base local. Rollback, FK, importes incorrectos compensados, cuotas, históricos, null y v1/v2 mantienen sus invariantes.

El lock_timeout limita espera, no cuánto dura construir el índice después de adquirirlo. Incluso el DDL de 3–9 s observado bloquea transacciones durante ese intervalo; statement_timeout 30 s es por sentencia, no duración total de la transacción. Para un staging/producción grande haría falta ventana compatible o diseño revisado con índice concurrente y asociación posterior. No se implementó ni ensayó aquí esa alternativa.

## Correcciones y límites de esta entrega

No se cambió el SQL 008 del commit, el motor, las Edge Functions ni la web. Se añadieron el test alojado de scope sintético y el benchmark local; se corrigieron únicamente sus fixtures/instrumentación. ESLint y comprobación de sintaxis de los nuevos tests aprobados. Después de las ejecuciones aprobadas se añadió un assert explícito del recuento de filas del benchmark y un cierre defensivo de roles/sesiones/credenciales al test alojado. No se repitieron las suites completas tras esos dos ajustes; los recuentos se comprobaron en el artefacto y el retiro se ejecutó y verificó por separado contra los UUID sintéticos.

Compatibilidad alojada 17.11, RLS/MFA y concurrencia por HTTP quedaron validados con la carga pequeña indicada; no hubo estrés alojado ni medición representativa de locks del proveedor. El ensayo local usa claims Auth simulados, el alojado JWT/TOTP reales. No se comparan los tiempos como si fueran el mismo hardware.

Quedan pendientes el escritor/proyección/corte y recuperación operativa de una activación futura; 008 continúa inactiva. Conciliación e importación siguen fuera de alcance. No se compraron servicios, no se crearon ramas/proyectos adicionales y no hubo cambios de producción. Los resultados no autorizan por sí solos activar el libro.
