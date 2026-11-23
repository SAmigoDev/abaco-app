# Reproducibilidad local de 008

## Requisitos y alcance

Windows con PowerShell 5.1 o posterior, Git, Node.js 20+ (validado con 24.18.1) y binarios PostgreSQL locales con `initdb.exe`, `pg_ctl.exe` y `psql.exe`. La comprobación local usa PostgreSQL 18.4; no acredita otras versiones locales. No necesita Docker, npm install, node_modules, variables de Supabase, SMTP, PAT ni .env.local.

La suite reconstruye una base vacía usando exclusivamente definiciones y datos sintéticos versionados. El esquema Auth local simula roles, JWT, sesiones y factores para probar las políticas SQL: no ejecuta GoTrue ni verifica códigos TOTP reales. Las pruebas alojadas con JWT/TOTP reales del cierre anterior siguen documentadas por separado. No se contacta con Supabase ni se aplican migraciones remotas en esta entrega.

## Ejecutar desde un checkout limpio

El cierre permanece local hasta un push autorizado. Antes de publicarlo, obtener un checkout limpio mediante git clone --no-hardlinks desde el repositorio local hacia una carpeta nueva. El remoto todavía no contiene estos commits. Desde la raíz de ese checkout, en PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-libro008-local.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin'
```

Para incluir la prueba de volumen de 100.000 y 1.000.000 de transacciones, después de la suite funcional:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-libro008-local.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin' -IncludeVolume
```

Opcionales: `-WorkRoot 'C:\ruta\nueva\prueba008'` y `-Port 55442`. WorkRoot debe ser una ruta nueva fuera del checkout; el puerto debe estar libre, entre 50000 y 59999. El ejecutor rechaza rutas existentes y puertos ocupados, nunca adopta un servidor preexistente. El runner SQL comprueba además el data_directory efectivo del servidor antes de crear una base aleatoria.

Se inicializa un clúster desechable propio bajo WorkRoot/work/staging-pg/data, con confianza local sin contraseña y escucha solo en 127.0.0.1, shared_buffers=32MB y max_connections=20. No usar este clúster para datos reales ni exponer su puerto. El script restaura las variables de prueba, detiene únicamente su servidor en finally y conserva el clúster detenido y postgres.log para inspección. Las bases temporales de cada suite se eliminan en finally. No hay borrado recursivo automático. Las métricas se escriben fuera del checkout, en WorkRoot/008-volume-result.json; una ejecución manual del test puede indicar ABACO_008_VOLUME_RESULT_FILE.

## Dependencias incorporadas y orden

1. tests/integration/local_auth.sql: simulador Auth solo local. Nunca ejecutarlo en Supabase alojado.
2. supabase/staging/00_base_public.sql: reconstrucción del esquema público anterior a 001, no un dump. Exige confirmación explícita y base sin usuarios ni perfiles. No contiene filas de cuentas, transacciones ni credenciales.
3. supabase/tests/auditoria_previa.sql: auditoría de catálogo, privilegios e integridad.
4. Migraciones 202611130001, 002, 003, 004, 202611190005 y 006; después 202611220007 y 008 ya versionadas. Las versiones intermedias no representan un estado para publicar: se reconstruye la cadena completa.
5. supabase/tests/auditoria_auth_mfa.sql y auditoria_multitarjeta.sql: comprobaciones de estructura/permisos.
6. tests/integration/libro-ensayo-postgres.test.mjs y libro-volumen-postgres.test.mjs: usan solo módulos internos de Node y conexiones psql independientes. No se requieren los cambios locales pendientes de package.json ni su lockfile.

Las seis migraciones históricas se incorporan sin modificar su contenido. Tampoco se modifican 007 ni 008. Se revisaron RLS, grants/revokes, referencias, funciones SECURITY DEFINER y orden de traslado de los registradores al esquema privado. No contienen llaves, datos personales, cron ni despliegues. La reconstrucción usa el motor actual y la expansión de ensayo inactiva; no activa un escritor financiero nuevo.

También se incorporan hosted-client.mjs y staging-target.mjs para resolver las importaciones del test alojado ya versionado. Ese recorrido separado requiere npm ci con el package-lock versionado y configuración privada fuera de Git: marcadores del proyecto autorizado, claves y PAT, además del manifiesto sintético si se reutilizan identidades. No se incluyen esos archivos privados ni se ejecuta el recorrido alojado en esta comprobación. No usar el esquema base ni local_auth.sql sobre el staging operativo.

## Evidencia de la comprobación

Cierre documentado el 23 de noviembre de 2026; ejecución iniciada el 22. Se exportó exclusivamente el árbol de Git **b1e2ac14543c98bf9bc13a99470d2d192a04396f** mediante git archive y se creó un repositorio independiente sobre esa exportación. Igualdad de árboles y git status vacío comprobados antes y después. No se copiaron archivos del working tree, node_modules, .env ni configuración privada. Las únicas diferencias posteriores respecto del árbol probado son documentación y métricas bajo docs/; se comprueba antes del commit que no cambió código.

El ejecutor con -IncludeVolume creó un clúster nuevo y reconstruyó Auth simulado + base + 001→008. PostgreSQL observado: **18.4, shared_buffers=32MB, max_connections=20**. Node: **24.18.1**. Resultado funcional: **13 pruebas/subpruebas, 0 fallidas y 0 omitidas**, en **22.728,807 ms**. Se probaron lock_timeout y rollback, locks reales del DDL, inmutabilidad, FK, ACL/RLS/MFA simulado, apertura neta sin doble descuento histórico, v1/v2, revocación y concurrencia mediante conexiones independientes.

Benchmark: **1/1 aprobado**, 0 omitidas, en **279.213,809 ms**. Los seis asserts comprobaron exactamente 100.000 y 1.000.000 de filas, sobre 1.000 cuentas y un propietario sintéticos, en una base temporal distinta.

| Filas | DDL servidor, tres intentos (ms) | Mediana (ms) |
| --- | --- | --- |
| 100.000 | 217,824 / 303,165 / 194,215 | 217,824 |
| 1.000.000 | 9.088,142 / 2.312,640 / 1.931,278 | 2.312,640 |

La 008 completa sobre el millón tardó **3.217,204 ms de pared local**, con caché calentada. [Métricas exactas](./REPRODUCIBILIDAD_008_METRICAS_2026-11-23.json). La carga marca pendientes como confirmados directamente para medir preparación/DDL; no acredita throughput financiero. Distribución, bloat, autovacuum y caché limitan la comparación. Los 32MB difieren de los 400kB del clúster anterior; no extrapolar a Supabase. Solo se consultó puntualmente pg_stat_activity para seguir progreso, sin otras suites SQL concurrentes.

Confirmado al terminar: servidor propio detenido y checkout sin modificaciones. El clúster sintético se conserva detenido; no se borra historia ni se toca el staging operativo. La salida del benchmark usa ahora ABACO_008_VOLUME_RESULT_FILE o una ruta derivada del PGDATA verificado, eliminando la dependencia de una carpeta personal fija.

Hallazgo corregido: Get-Command devolvía dos rutas de Node; el ejecutor selecciona explícitamente la primera. El primer intento falló antes de crear el clúster. La versión corregida se ejecutó con éxito desde el árbol limpio. No fue necesario corregir ninguna migración. ESLint de helpers/test modificado, sintaxis Node/PowerShell y diff --check aprobados. La revisión de literales no detectó claves/tokens ni correos reales en los SQL incorporados. No se versionan logs brutos, manifiestos ni datos de usuarios. También se ejecutaron las guardas del nuevo ejecutor: rechazó una ruta existente y un puerto ocupado; el rechazo del puerto no creó archivos ni otro clúster.



Verificación adicional del commit: se creó un bundle Git de main con historia completa y se clonó en otra carpeta nueva. La clonación directa por ruta de carpeta falló por un bloqueo de objetos MSYS del runtime Windows; el transporte bundle funcionó sin red. Desde ese clon limpio, sin .env ni node_modules, la suite volvió a reconstruir una base vacía en el clúster sintético propio y pasó **13/13**, 0 omitidas, en **21.332,026 ms**. Checkout limpio y servidor detenido comprobados al finalizar. Después de esa comprobación solo se añade esta explicación de documentación; el código es el mismo que se probó.

Si el runtime impide clonar por ruta de carpeta, desde el repositorio local usar git bundle create con una ruta de salida fuera del checkout y main como ref; después git clone desde el archivo bundle hacia una carpeta nueva. No requiere servicios, tokens ni datos sin versionar. El bundle de esta comprobación queda fuera de Git, junto con los logs, y no se publica.

## Historial y remoto

El cierre anterior de la validación es **bebd3654fece232bd0d623a82661bd832ed5e583**, en main, posterior a f319928. Esta entrega crea un commit independiente de reproducibilidad, conserva el resto del trabajo local y no realiza push ni despliegue. Consulta real de origin/main: **91d3f4631e18f09334e69e4543f488f810b63702**. No se publica el cierre de validación bebd365 ni este commit.
