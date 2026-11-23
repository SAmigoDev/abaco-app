# Fase 009: escritor financiero, proyección y corte

## Estado actual para revisión

Base: **81611e0c9b150050088a0fffecdbf029d09f07fd**. Siguiente versión disponible: **202611230009_escritor_financiero.sql**. Entrega exclusivamente local, en commit dedicado y sin push de esta fase. No se consultaron ni modificaron los proyectos de Supabase/Vercel, producción, cron o los Atajos del iPhone. Las migraciones 001–008 y el trabajo previo de la web/Edge se conservan.

La instalación de 009 deja `modo=legacy`: no corta ni crea aperturas operativas automáticamente sobre cuentas existentes. **Sí sustituye los escritores anteriores al instalarse**, incluso antes del corte: retira el trigger/función de saldo antiguo y cambia el confirmador privado. Desde ese instante solo `abaco_privado.escribir_proyeccion` puede ejecutar UPDATE de saldo. Por ello la futura instalación también requiere una ventana coordinada y revisión; no se propone aplicar 009 al staging operativo todavía.

## Archivos

| Archivo | Contenido |
| --- | --- |
| supabase/migrations/202611230009_escritor_financiero.sql | Esquema, rol privado, barrera de escritores, único proyector, disparador de contabilización y funciones de corte/recuperación |
| supabase/tests/auditoria_libro009.sql | Auditoría de catálogo, privilegios, RLS/MFA e invariantes en una transacción de lectura consistente |
| supabase/tests/ensayo_corte_libro009_local.sql | Corte de todas las cuentas de una base sintética local; confirmación explícita, comprobación de servidor/base y ROLLBACK integral |
| tests/integration/postgres-fixture.mjs | Base temporal aislada, Auth simulado, reconstrucción 001→008 y conexiones psql independientes |
| tests/integration/libro-escritor-postgres.test.mjs | Instalación 009, corte, permisos, concurrencia, fallos y recuperación |
| scripts/test-libro008-local.ps1 | Switches opcionales -Include009 y -Include009Performance; el comportamiento predeterminado de 008 permanece |
| docs/LIBRO_009_PRUEBAS_2026-11-23.json | Versiones, resultados finales y huellas de las fuentes ejecutadas |

## Un único escritor

Los RPC públicos y sus firmas se conservan: registrar_gasto, confirmar_gasto_pendiente y la gestión de instrumentos/vínculos/credenciales. El validador privado de gastos existente sigue produciendo la recepción con el mismo ID y validando propietario, destino, importe, versión y evento_id. No se cambian tablas de credenciales ni vínculos.

Un único trigger nuevo de transacciones atiende INSERT confirmado y transición pendiente→confirmado. Inserta la operación/apunte operativo cuando el libro está activo y llama al mismo proyector. Una recepción que ya está confirmada no vuelve a contabilizarse. El confirmador privado solo actualiza la recepción; el viejo UPDATE de saldo y el antiguo trigger de inserción se eliminan.

El proyector usa un rol de base **abaco_financiero**, NOLOGIN, NOINHERIT, sin SUPERUSER, BYPASSRLS ni privilegios de creación. La instalación rechaza roles preexistentes con objetos propios o membresías no revisadas. Solo ese rol puede cambiar saldo_actual o la caché, mediante guardas que verifican current_user nativo de PostgreSQL. Anon, authenticated y service_role no son miembros. La auditoría comprueba que el rol posea una sola función y que haya una sola función instalada con UPDATE de saldo. El operador postgres queda como miembro para administrar la función, sin conceder esa capacidad a usuarios de la aplicación.

El control de objetos propietarios usa [pg_shdepend de PostgreSQL](https://www.postgresql.org/docs/17/catalog-pg-shdepend.html), incluidas dependencias de otras bases del clúster; no se adopta un rol compartido con otra aplicación.

Las funciones nuevas son privadas, con search_path vacío y EXECUTE revocado a PUBLIC/API en la misma transacción. Es el patrón recomendado para SECURITY DEFINER y sus privilegios por defecto en [PostgreSQL 17](https://www.postgresql.org/docs/17/sql-createfunction.html). El rol del proyector tiene políticas RLS y grants explícitos para su tarea; no usa BYPASSRLS. Las tablas/vistas de lectura del usuario siguen propietario + MFA y security_invoker.

Service_role evita RLS según la [documentación de roles de Supabase](https://supabase.com/docs/guides/database/postgres/roles); por eso también se restringen grants, funciones privadas y pertenencia al rol escritor. Una credencial de Atajos sigue entrando por el validador existente, limitada a gastos y su destino. No adquiere facultades de cuenta, MFA, corte o reconstrucción. Un administrador de la aplicación tampoco obtiene funciones de operador SQL.

## Aperturas, operaciones y caché

Se conservan todos los ensayos de 008. La 009 amplía el modo con operativo y marca las operaciones operativas; un índice parcial garantiza una sola operación operativa por transaccion_id, incluso si hay ensayos anteriores de esa recepción.

El corte crea aperturas nuevas, lee el saldo comprometido dentro de la barrera y registra los IDs confirmados presentes como históricos incluidos. Estos IDs no reciben nuevos débitos. Los pendientes no forman parte de esa apertura; su primera confirmación posterior publica un solo apunte. No se usa la fecha Wallet como frontera de corte.

La relación privada libro_cuentas fija una única apertura operativa por cuenta y corte, mediante FK compuestas de propietario/cuenta/apertura. No se reabre una cuenta con otro corte. Repetir el mismo UUID de solicitud devuelve el corte existente; hacerlo durante una pausa no reanuda el motor.

La tabla pública libro_proyecciones contiene saldo y versión reconstruibles. La vista libro_saldos_calculados deriva el resultado de apertura/apuntes, bajo RLS. saldo_actual continúa siendo el espejo compatible para lectores existentes. La versión es la cantidad de operaciones canónicas representadas, incluida la apertura; reconstruir no crea otra versión financiera ni altera los IDs. actualizado_at es fecha de materialización, no fecha bancaria.

En modo legacy el proyector mantiene la aritmética previa. En modo libro, cada nueva operación tiene una secuencia positiva, contigua y única por apertura, obtenida del último asiento canónico mediante índice. La apertura usa secuencia 1. El proyector exige la operación nueva, su apunte inmutable y que la versión de caché sea exactamente la anterior; comprueba destino, propietario y concordancia con saldo_actual. Solo entonces suma ese apunte y publica caché y espejo en la misma transacción. No confía en un delta enviado por el cliente ni permite aplicar dos veces la operación. Si falta la caché o su versión es incorrecta, falla sin dejar recepción, operación, apunte ni cambio de saldo parciales: se requiere reconstrucción explícita.

La firma privada pasa a escribir_proyeccion(uuid,numeric,uuid); las firmas públicas v1/v2 permanecen. La llamada sin operación se reserva para apertura/reconstrucción y deriva el importe por suma completa de apuntes; verifica además cantidad y secuencia máxima. No usa el saldo de la caché como fuente de recuperación. La vista diagnóstica sigue calculando la suma completa. El coste lineal se retira de la ruta normal del gasto y permanece en mantenimiento. [Mediciones, decisión y límites](./LIBRO_009_RENDIMIENTO_Y_CIERRE_2026-11-23.md).

Las altas de cuentas conservan el contrato INSERT y su saldo inicial. En modo activo, la misma transacción crea apertura, vínculo privado y proyección. Si cualquier paso falla, también desaparece el INSERT de la cuenta. El importe inicial es una semilla explícita representada una sola vez en la apertura; no hay una ruta posterior para editar el saldo. Moneda/tipo quedan fijados por las FK de la apertura; el alias puede editarse concurrentemente sin imponer un saldo antiguo. La eliminación física con historia queda bloqueada por referencias; no se implementa aquí una interfaz de archivo de cuentas.

Null permanece desconocido tras el corte, aunque se registren apuntes posteriores. Cero, negativos, USD decimales y precisión legacy se conservan con numeric de PostgreSQL. No se inventa una base cero para cuentas desconocidas. En crédito, una compra en cuotas contabiliza el capital total una sola vez; el calendario no genera apuntes mensuales. Si falla crear el calendario, se revierte también la recepción, el apunte y el saldo.

## Barrera y bloqueos

La barrera es una fila privada de control: las entradas toman FOR SHARE antes del advisory por usuario y de las filas de credencial/evento/cuenta. Hay también triggers BEFORE STATEMENT en tarjetas/transacciones, que toman la barrera antes de bloquear filas. Esa anticipación está descrita en [PostgreSQL: comportamiento de triggers](https://www.postgresql.org/docs/17/trigger-definition.html).

El corte toma FOR UPDATE de control, espera las transacciones previas y excluye nuevos escritores mientras abre cuentas ordenadas por usuario/ID. Un gasto y una confirmación ya comprometidos entran en la apertura; los siguientes publican un apunte después. La pausa rechaza nuevas escrituras financieras/altas. La revocación y gestión de seguridad permanecen disponibles. Un reintento ya contabilizado puede devolver su recepción durante la pausa, sin nuevo efecto; una credencial revocada sigue rechazada.

La instalación DDL toma ACCESS EXCLUSIVE en transacciones/tarjetas con NOWAIT. Los ALTER de los libros de 008 también requieren locks de esquema y tienen lock_timeout=2s. El statement_timeout de instalación es 30s. Un lector o escritor concurrente puede hacer fallar la instalación; el fallo revierte toda la transacción, sin intentar instalar por partes. El corte usa un lock de fila, no esa ventana de DDL, y limita su espera de lock a 2s. No confundir espera de lock con duración total del corte.

## Pruebas reales locales y límites

**38 pruebas/subpruebas aprobadas en las ejecuciones finales, 0 fallidas y 0 omitidas:** 13 de regresión 008, 23 de escritor/corte 009, 1 benchmark comparativo y 1 modelo local sin SUPERUSER. PostgreSQL 18.4 real, Windows, Node 24.18.1, shared_buffers=32MB y max_connections=20. [Resultados y SHA256 finales](./LIBRO_009_PRUEBAS_2026-11-23.json).

Árbol del checkout limpio de código probado: **60b5d5eb99485cc098b2526fbfbf1cd0799ed90a**. SHA256 de 009: **79cb46ba5b3ffd97123cf315b349175a88e94947d5ac3731c8f3b113b98e59fa**. Las diez fuentes finales del checkout y las entregadas coinciden byte por byte. Las suites 008/009 se repitieron desde ese checkout limpio, sin node_modules ni .env. El benchmark y el ensayo sin superusuario usaron las mismas fuentes finales; sus resultados y requisitos están en el informe de cierre. ESLint y sintaxis Node/PowerShell aprobados. Las bases sintéticas se eliminan en finally y los servidores propios quedan detenidos. El snapshot de revisión es un repositorio local independiente, sin rama añadida al repositorio de Ábaco.

Resultados históricos: la revisión anterior tenía 34 pruebas/subpruebas y medía una implementación que sumaba todo en cada gasto; no son resultados de la versión optimizada. En este cierre se agregaron las pruebas de repetición del incremento y pérdida/corrupción de versión. Un fallo inicial del generador de volumen por eventos de triggers pendientes se corrigió con SET CONSTRAINTS ALL IMMEDIATE antes de rehabilitar la publicación; no se contó como prueba aprobada. No fue un fallo del escritor financiero.

Cobertura confirmada por los tests:

- Instalación NOWAIT bloqueada, rechazo de rol con función/vista preexistente y fallo DDL tardío: restauran trigger, función, grants, rol y columnas anteriores.
- Instalación sin activación y detección del único escritor, incluida la guarda contra UPDATE directo por operador/API.
- Corte parcial fallido y guion local con ROLLBACK: no quedan aperturas/proyecciones/estado/eventos parciales.
- Corte concurrente con gasto y confirmación previos al commit; una nueva recepción espera y se contabiliza después.
- Ocho reintentos del mismo evento y doce eventos distintos concurrentes en dos usuarios; edición de alias concurrente.
- Pendiente heredado y pendiente v2 posterior: confirmaciones concurrentes, mismo ID y un solo efecto.
- V1/v2, destino forzado de otra cuenta, vínculo incorrecto, revocación entre usuarios y revocación concurrente antes del envío en espera.
- Cuotas: capital una vez y rollback si falla el calendario después de contabilizar.
- Altas con importe conocido, cero, negativo, null, precisión de 18 dígitos y USD; ID de cuenta repetido sin otra apertura.
- Fallo al crear proyección durante el alta y fallo después del UPDATE final de saldo: rollback completo.
- Pérdida/corrupción de caché, bloqueo de reanudación inconsistente, reconstrucción y reanudación sin cambiar apuntes/IDs.
- RLS de caché/vista, API sin DML ni funciones privadas, MFA AAL1/AAL2 y administrador sin factor. La credencial automática sigue limitada a capturar gastos aunque su propietario requiera MFA.

Auth/JWT/TOTP en estas pruebas están **simulados en SQL**. La concurrencia y los locks son reales, con procesos psql independientes. No hubo nuevas pruebas HTTP/Edge ni JWT/TOTP reales alojados en esta fase. No se trasladan a 009 las mediciones de volumen de 008. No hubo emails ni cuentas de prueba nuevas en Supabase.

## Repetir localmente

Windows, Node 20+ (probado 24.18.1) y binarios PostgreSQL 18.4; sin npm install. Puerto libre y WorkRoot nuevo fuera del checkout:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-libro008-local.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin' -WorkRoot 'C:\ruta\nueva\ensayo009' -Port 55442 -Include009
```

Se ejecuta primero 008 y después 009. Para medir 009, añadir -Include009Performance (incluye las suites funcionales y guarda 009-performance.json fuera del checkout). -IncludeVolume corresponde solo al benchmark anterior de 008. El modelo de permisos tiene su ejecutor separado; consultar el informe de cierre. La simulación Auth y el guion de corte local nunca se ejecutan en Supabase alojado. El guion exige loopback, nombre de base aleatorio abaco_it_... y confirmación local; no basta cambiar una URL.

## Activación futura: procedimiento para revisión

**Esta sección no autoriza ejecutarlo en staging.** activar_libro recorre todas las cuentas, incluidas las del titular. La única activación realizada fue dentro de bases locales sintéticas que se eliminaron. Hace falta autorización nueva y una ventana acordada antes de tocar el staging operativo.

1. Revalidar esquema 001→008 y escritores desplegados, grants, roles y políticas. Revalidar la versión alojada (la referencia anterior era Supabase 17.11), CREATEROLE/ADMIN, SET/INHERIT, ownership y grant options reales del instalador. Pasó un modelo local sin SUPERUSER, pero no reproduce las restricciones del proveedor; consultar los requisitos detallados del informe de cierre. Mantener credenciales y datos personales fuera de fixtures/logs.
2. Revisar compatibilidad de presentación/gestión de cuentas. La web actual normaliza null a cero en Dashboard y algunas exportaciones; debe distinguir desconocido antes de mostrar saldos del motor nuevo. También requiere tratar el archivo de cuentas con historia. Esas pantallas no se modificaron sobre el trabajo local previo en esta entrega.
3. Preparar recuperación y frenar temporalmente nuevas peticiones financieras. Drenar llamadas en curso y transacciones lectoras largas antes de instalar 009. No activar cron. No se requieren cambios de payload ni de UUID en el iPhone.
4. Instalar 009 en una sola transacción, sin reescribir migraciones anteriores. Si NOWAIT/timeout falla, revisar y reintentar íntegra tras drenar; no aplicar fragmentos. Verificar modo legacy, auditoría 009 y un gasto sintético con reintento. El escritor ya es el nuevo, aunque todavía no hay corte.
5. Obtener y conservar un UUID de solicitud de corte. Tomar de nuevo la ventana acordada; ejecutar el corte y su comprobación en una transacción. Los siguientes comandos son una plantilla de revisión para psql local, no una orden remota:

```sql
\set ON_ERROR_STOP on
select gen_random_uuid() as solicitud_corte \gset
begin;
set local lock_timeout='2s';
set local statement_timeout='60s';
select abaco_privado.activar_libro(:'solicitud_corte'::uuid,
  'activar-libro-con-saldos-comprometidos');
select abaco_privado.verificar_proyecciones();
-- ROLLBACK para ensayo; COMMIT solo tras autorización del corte.
rollback;
```

6. En una ejecución aprobada, confirmar el commit únicamente si todas las invariantes pasan. Conservar UUID/corte y comparar exactamente los saldos previos, aperturas nuevas e históricos incluidos, sin exportar datos personales. Repetir ese UUID no reabre cuentas. Una cuenta nueva posterior tendrá apertura automática.
7. Antes de liberar tráfico, comprobar en el entorno alojado REST/RPC/las Edge existentes con JWT reales: propietario, AAL1/AAL2, máquina restringida, pending/confirmación, cuotas, revocación e IDs repetidos. Medir ventana/locks/coste del índice parcial y de la reconstrucción con volumen representativo de 009. El operador puede pausar si falla una invariante. No hay autorización de despliegue implícita en los tests locales.

## Recuperación

Si instalación o corte falla antes de commit, PostgreSQL revierte todo. Si la 009 se instaló pero aún está en legacy, mantener la ventana externa de mantenimiento y reparar mediante entrega revisada; no añadir el trigger viejo en paralelo. La función de pausa del libro requiere que exista un corte.

Después del corte, recuperación de caché bajo operador SQL (sin exponer estos comandos como RPC):

```sql
select abaco_privado.pausar_libro('pausar-escritores');
select modo from abaco_privado.libro_control where singleton;
select abaco_privado.verificar_estructura_operativa();
select abaco_privado.reconstruir_proyecciones('reconstruir-desde-apuntes');
select abaco_privado.verificar_proyecciones();
-- Ejecutar solo si sigue pausado y la comprobación devuelve true:
select abaco_privado.reanudar_libro('reanudar-libro-validado');
```

La reconstrucción toma la barrera exclusiva y valida primero los apuntes/recepciones/históricos. Usa temporalmente modo libro dentro de esa misma transacción para materializar, y restaura pausado al terminar. Los escritores externos esperan y solo ven el estado final; no hay intervalo público activo. Si falla algo, también se revierte la reconstrucción. No crea aperturas, no descuenta históricos y no elimina apuntes. Repetir la reconstrucción conserva versión e importes; registra una ejecución de mantenimiento adicional.

Después de reconstruir, ejecutar también auditoria_libro009.sql antes de reanudar para revalidar permisos y el escritor instalado.

Si la estructura del libro falla, la función se niega a reconstruir: conservar la pausa, investigar y preparar reparación versionada revisada. No cambiar saldo a mano, no reutilizar una apertura de ensayo, no degradar a legacy ni restaurar solo tarjetas o solo el libro. Revertir la web no cambia de escritor. Una restauración integral de desastre requeriría además preservar/reconciliar IDs y revocaciones posteriores al backup; no se implementa ni se promete aquí automatización de ese proceso.

## Pendientes y fronteras

Quedan pendientes la validación alojada de 009, ownership/privilegios reales del nuevo rol, HTTP/Edge/JWT reales, rendimiento/locks en el proveedor y las adaptaciones de presentación antes del corte. Hay mediciones locales hasta 100.000 gastos operativos por cuenta; no equivalen a capacidad alojada. No se implementan conciliación, importación, ingresos, transferencias, pagos de crédito ni compensaciones nuevas en esta fase.

La apertura conserva el saldo comprometido por Ábaco; no lo convierte en saldo conciliado con banco. Se representan los históricos **recibidos y confirmados** antes del corte. Una captura con UUID nuevo y fecha antigua mantiene el contrato actual y puede generar un gasto nuevo; no se infiere que esté incluida en el saldo por su fecha. Matching, cobertura bancaria y resolución de capturas tardías pertenecen a la etapa posterior. No se pidió otra compra real ni se cambiaron Atajos.
