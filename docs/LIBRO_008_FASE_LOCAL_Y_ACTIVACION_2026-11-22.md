# Libro de movimientos fase008 y plan de activación

## Actualización: validación en staging del 22 de noviembre de 2026

Por autorización posterior se instaló la 008 exacta de f319928 en **abaco-staging (bikubreyffppuxfxzxew)**. Sigue inactiva: el motor vigente es el único escritor de saldo. No hubo aperturas en las cuentas originales ni cambios de producción, cron, web o Edge. Se comprobaron preservación de datos, permisos, RLS/MFA real y concurrencia; volumen y bloqueos intensivos se probaron exclusivamente en PostgreSQL local.

Resultados y límites actuales: [VALIDACION_008_STAGING_VOLUMEN_2026-11-22.md](./VALIDACION_008_STAGING_VOLUMEN_2026-11-22.md). Las secciones siguientes conservan la entrega local histórica y su plan de activación pendiente; sus menciones a «no aplicado» corresponden al estado anterior a esta autorización. Esta validación no activa el libro.

## Estado para revisión del22 de noviembre de2026

**Solo local. No aplicado a Supabase staging ni producción; sin despliegue web/Edge ni push. Cierre mediante commit local dedicado.** Base: commit91d3f4631e18f09334e69e4543f488f810b63702 y trabajo local previo001→006 conservado.007 sigue siendo protección de edición de cuentas.008 es una expansión inactiva de ensayo: el motor actual permanece como único escritor de saldo. No se implementa conciliación ni importación.

## Archivos preparados

- `supabase/migrations/202611220008_libro_ensayo.sql`: esquema, lectura protegida y funciones privadas de ensayo. No ejecutarla contra el staging operativo hasta revisar esta entrega. No activar automáticamente con db push/reset.
- `supabase/tests/ensayo_transicion_libro_local.sql`: ensayo por cuentas con confirmación explícita y ROLLBACK al finalizar. Solo para base local sintética con008 instalada.
- `tests/integration/libro-ensayo-postgres.test.mjs`: reconstrucción de base completa,001→008 y pruebas con conexiones independientes; no lee .env.local ni admite host remoto. Comprueba el data_directory real antes de crear su propia base temporal y la elimina al finalizar.

## Modelo implementado

| Entidad | Función y garantías |
| --- | --- |
| `libro_aperturas` | Cuenta, usuario, moneda/tipo fijados, saldo inicial exacto o null, solicitud idempotente, instante y origen de legado no conciliado. Modo limitado por CHECK a ensayo; no existe un estado activo |
| `libro_historicos_incluidos` | Conjunto exacto de IDs confirmados representados en esa apertura y snapshot de monto_cuenta. No es un apunte ni vuelve a descontar nada |
| `libro_operaciones` | Operación de apertura o gasto reflejado explícitamente. Una apertura por ensayo; un gasto por transacción/ensayo. FK compuestas impiden cruzar propietario, cuenta o apertura |
| `libro_apuntes` | Importe firmado y finito en moneda de la apertura, una fila por operación en esta fase. Apertura conserva signo; gasto resta efectivo o incrementa deuda. Inmutable |
| `libro_saldos_ensayo` | Suma reconstruida de apuntes por apertura, sin caché activa. Null inicial sigue desconocido aunque existan movimientos; no inventa cero. No se deben sumar ensayos diferentes como cuentas reales |

Se añade un índice/constraint único redundante sobre `(usuario_id,id,tarjeta_id)` de transacciones para sus FK compuestas; no se modifica contenido financiero ni el motor. Ese DDL toma locks y debe evaluarse antes de cualquier futura instalación alojada. Las FK conservan referencias históricas y pueden bloquear borrado o cambios de moneda/tipo de cuentas usadas en un ensayo. No ejecutar ensayos persistentes sobre cuentas del titular sin revisión: no hay borrado/reutilización del historial mediante API.

Los importes usan numeric sin conversión por floats ni redondeo de apertura. La apertura también conserva un saldo legacy finito grande exactamente; los límites/precisión para nuevos movimientos del motor futuro se diseñarán por separado. No se impone retroactivamente un límite arbitrario al saldo de apertura. CLP/USD se mantienen separados por cuenta.

Todas las tablas nuevas son inmutables por UPDATE/DELETE, tienen RLS de propietario y política restrictiva MFA004. Vista security_invoker: respeta permisos y RLS del lector. authenticated solo lee bajo esos controles; anon/service_role no reciben lectura ni DML del libro. Las funciones SECURITY DEFINER tienen search_path vacío, sin EXECUTE para PUBLIC, anon, authenticated o service_role. Son herramientas SQL de operador para ensayos, no nuevas RPC de cuenta ni un permiso humano para saltarse MFA. El rol SQL propietario sigue siendo confiable y puede administrar DDL; esto no pretende restringir a un superusuario.

## Procedimiento de transición implementado como ensayo

`abaco_privado.preparar_apertura_ensayo(usuario,cuenta,solicitud,'ensayo-sin-activacion')` toma primero el advisory por usuario compatible con005 y luego la cuenta FOR UPDATE. Lee saldo, moneda/tipo y el conjunto de confirmados dentro de esa transacción. Crea una operación y, si el saldo es conocido, un apunte de apertura por el valor NETO actual. Incluye los históricos como referencias sin apuntes de gasto adicionales. Los pendientes quedan fuera.

Repetir la misma solicitud devuelve la misma apertura; no refresca una foto obsoleta ni añade otro cargo. Reutilizar la solicitud para otra cuenta da conflicto. Puede prepararse otro ensayo con otra solicitud, conservando el anterior. No es una apertura financiera definitiva ni saldo confirmado por banco.

`reflejar_gasto_ensayo(apertura,transaccion)` solo copia explícitamente un gasto ya confirmado por el motor actual de la misma cuenta/usuario. Rechaza históricos incluidos, ajenos, pendientes y montos desconocidos. Repetir devuelve la misma operación. No escribe tarjetas ni modifica su saldo; no hay hook automático. Sirve para probar reconstrucción de movimientos posteriores, no como endpoint de registro ni motor activo.

`comprobar_ensayo(apertura)` toma el mismo orden de locks y verifica saldo reconstruido frente al actual, cobertura de confirmados por históricos u operaciones y conservación del snapshot histórico. Detecta gastos posteriores sin reflejar y pendientes que se confirmaron después. El resultado solo vale para ese instante; no es una autorización persistente de activación. Las fechas de Wallet no definen la frontera: importan los IDs observados bajo locks.

El guion `ensayo_transicion_libro_local.sql` exige `abaco.libro_ensayo_local='base-local-sintetica'`, prepara y comprueba las cuentas en orden y siempre revierte sus registros. El GUC es confirmación operativa, no una frontera de seguridad para un operador SQL ya privilegiado.

## Resultados de la preparación inicial (históricos)

**PostgreSQL18.4 local:9 pruebas/subpruebas aprobadas**, con esquema completo y Auth/sesiones simulados mediante roles/claims SQL:

1.008 instala vacía; las definiciones del registrador público/privado, confirmador y función del trigger actual permanecen iguales. Saldo inicial intacto.
2.Gasto histórico1000 sobre10000 deja9000; apertura y reconstrucción9000; histórico incluido una vez; repetir preparación o recepción no resta de nuevo. Intentar reflejar ese histórico se rechaza.
3.Gasto nuevo100: el motor actual deja8900 mientras el ensayo sigue9000 y detecta inconsistencia. Reflejarlo deja reconstrucción8900 sin tocar la cuenta. Repetir no duplica. Pendiente confirmado después genera su único efecto por el motor actual y puede reflejarse una vez.
4.Crédito300 en3 cuotas: deuda/apertura300, un plan y sin triple cargo. Cero, negativo, USD y saldo desconocido conservados. Valor legacy1000000000000000001 reconstruido exactamente como texto decimal, sin pasar por Number.
5.V1/v2: registro/repetición/revocación siguen funcionando. Dos gastos nuevos afectan al motor actual; el número de apuntes del ensayo no cambia automáticamente.
6.FK/propiedad, UPDATE/DELETE inmutables y denegación de DML/ejecución privada a roles API; otra cuenta no lee el ensayo. AAL1 con factor no lee y AAL2 sí. Son roles Auth simulados, no JWT alojados nuevos.
7.Guion de ensayo rechaza falta de confirmación y con confirmación revierte todos sus registros.
8.Error forzado tras preparar apertura revierte toda la transacción. Ocho conexiones solicitan la misma apertura junto a un gasto: una apertura, saldo/historia coherentes con el orden real de serialización y un cargo. Reflejo posterior solo si no estaba incluido.

**Regresión:**29 pruebas/subpruebas Node/PGlite existentes aprobadas. ESLint aprobado. Estas cifras son separadas: PGlite no demuestra concurrencia; esta se ensayó con procesos psql independientes. No se realizaron pruebas remotas, compras, envíos SMTP ni ensayos nuevos de iPhone. La primera ejecución requirió arrancar el clúster local; se corrigió una aserción de FK que inicialmente chocaba antes con el índice de apertura única. No se contabilizan esas ejecuciones fallidas como aprobadas.

## Plan de activación pendiente de revisión

### A. Revisar e instalar solo expansión, si se autoriza

Revisar008 y su nueva constraint con esquema real, grants heredados/defaults, owners y coste de locks. Mantener001→007 intactas. Respaldar únicamente esquema/datos necesarios de staging dentro del entorno autorizado, sin copiar producción. Repetir ensayos en una base aislada de pruebas antes de considerar el staging operativo. Aprobar primero el alcance de instalación008; instalar el esquema no activa el motor ni debe ejecutar aperturas del titular automáticamente.

### B. Implementar todavía el escritor financiero único

Una migración posterior,009 o la siguiente libre, deberá implementar el posteo canónico que actualiza la proyección y el espejo de saldo en la misma transacción. Falta conectar registrador v1/v2 y confirmador, diseñar altas de cuentas posteriores al corte, tratamiento de desconocidos y tardíos, ID de recepción estable, protección de moneda/tipo/archivo y compensaciones. El protocolo actual no permite activar limitándose a cambiar modo o llamar a reflejar_gasto_ensayo. Tampoco sumar ensayos múltiples ni convertir una foto vieja en apertura vigente.

Antes de activar, completar pruebas de fallos/rollback de posteo, proyección reconstruible, cuotas, reversos, identidad global de operación, dos instrumentos sobre la misma cuenta, propietarios/MFA, service_role y todos los escritores. La 008 actual solo soporta apertura y gasto de ensayo; no anuncia ingresos/transferencias/pagos como funcionalidades operativas.

### C. Ventana de corte coordinada del futuro motor

1.Pausar TODOS los escritores financieros relevantes: Edge, REST/RPC de gastos y confirmación, creación de cuentas y cambios financieros de metadatos. Mantener disponibles lecturas y datos históricos. No cambiar las credenciales ni JSON del teléfono; los fallos de red conservarán sus archivos para reintento manual.
2.Bajo transacción y locks ordenados, preparar aperturas NUEVAS de corte para el estado comprometido en ese instante y capturar membresía de históricos exacta. No reciclar ensayos previos. Excluir pendientes y preservar null.
3.Sustituir el trigger de saldo antiguo identificado y adaptar registrador/confirmador junto al único escritor nuevo. Actualizar web/proyecciones coordinadamente. Nunca dejar dos mecanismos descontando el mismo gasto. Las marcas de históricos evitan volver a aplicar su capital; los pendientes reciben un efecto solo al resolverse.
4.Validar por cuenta que el saldo previo coincide con apertura/proyección/espejo y que los IDs antiguos responden igual. Si cambia el estado entre revisión y confirmación, abortar y repetir dentro de la misma ventana. El timestamp de captura no prueba liquidación bancaria ni inclusión de una compra tardía.
5.Reabrir con observación y eventos sintéticos autorizados; una captura antigua ya recibida mantiene ID y un evento nunca recibido pero posiblemente incluido debe revisarse antes de cargar. No restablecer saldos del titular a cifras antiguas de informes.

### D. Recuperación

Antes del corte, un fallo de008 revierte su DDL transaccional; un ensayo fallido no toca saldos y su transacción revierte. Si ya hay ensayos persistentes, conservarlos y corregir con migración nueva, no borrar historia para reiniciar. Después de activar un escritor financiero futuro, cerrar escritores y reparar por migración compensatoria; no volver al trigger legacy dejando apuntes activos. La recuperación posterior al corte todavía debe implementarse/ensayarse con ese escritor, no se declara resuelta en008.

**Conciliación e importación quedan para fases posteriores.** No hay conexión bancaria, saldo bancario confirmado ni una decisión de activar staging en esta entrega.

## Referencias técnicas

[PostgreSQL18 CREATE VIEW](https://www.postgresql.org/docs/18/sql-createview.html) documenta security_invoker; [bloqueos PostgreSQL18](https://www.postgresql.org/docs/18/explicit-locking.html) describe advisory y locks de fila. La elección de serializar por usuario sigue el mecanismo005 ya existente. Compatibilidad con Supabase alojado y sus defaults queda pendiente de preflight y prueba aislada, no se infiere de PostgreSQL local.

## Revisión y cierre local de008

Hallazgos resueltos:

- DDL y guion de ensayo ahora usan lock_timeout2s y statement_timeout30s locales a su transacción. El primero limita cada espera de lock; el segundo limita cada sentencia, no la duración total de la transacción. Un conflicto aborta atómicamente; no se deja una cola indefinida ni esquema a medias.
- Índices de apoyo en cuenta de apertura y referencias de transacción de operaciones/históricos evitan barridos completos en comprobaciones de las FK. Índice por apertura en apuntes evita barrer todos los ensayos al reconstruir cada saldo. No se afirma un tiempo de ejecución para el volumen alojado: falta medirlo en una copia aislada representativa.
- comprobar_ensayo verifica que exista exactamente una operación de apertura, su apunte esperado (ninguno si desconocido), la presencia y el importe firmado de cada gasto reflejado y la ausencia de doble representación histórico/operación. Detecta dos importes cambiados en sentidos opuestos, aunque el saldo total siga coincidiendo.

Impacto comprobado en PostgreSQL local: instalar la constraint única de transacciones toma ACCESS EXCLUSIVE hasta commit; la creación de FK retiene SHARE ROW EXCLUSIVE sobre tarjetas y usuarios. Además aparecen locks de lectura/índice en transacciones. Con un escritor reteniendo la tabla,008 falla por timeout y no quedan apertura ni constraint parcial. Estos límites no hacen que el DDL sea sin bloqueo. Si la tabla real no admite la ventana o el coste de construir el índice, habrá que preparar otra estrategia de instalación revisada (por ejemplo, índice concurrente y asociación posterior), sin aplicar a ciegas008.

Durante un ensayo, el advisory por usuario y FOR UPDATE de cuenta hacen esperar al registrador del mismo usuario; un gasto de otro usuario continúa. Se observó el bloqueo mediante pg_blocking_pids y se canceló el holder local de prueba para liberar al escritor. Las FK preservan historia: una cuenta con ensayo persistente no se puede borrar o cambiar de moneda; editar su alias sigue funcionando. Esto también puede impedir borrar perfiles/usuarios por cascada, por lo que los ensayos persistentes no son una herramienta de limpieza ni deben ejecutarse sobre el staging del titular sin autorización.

Permisos revisados: las cuatro tablas deniegan INSERT/UPDATE/DELETE/TRUNCATE a anon, authenticated y service_role. Las cuatro funciones privadas no conceden EXECUTE a esos roles, incluso aunque llegasen a tener USAGE del esquema. La vista y tablas conservan lectura de propietario con MFA; anon/service_role no pueden leer la vista. FK compuestas verificadas contra usuario diferente y transacción de otra cuenta del mismo usuario. El propietario SQL sigue siendo de confianza; no se promete resistencia frente a un operador que cambie DDL o privilegios.

Cierre:13 pruebas/subpruebas PostgreSQL local ampliadas aprobadas,29 regresiones Node/PGlite aprobadas y ESLint aprobado. Claims/roles Auth simulados; no JWT de Supabase alojado en este cierre.001→007 y funciones del motor actual conservadas. Sin acceso ni cambios al staging operativo, producción, cron o teléfono. No hay activación, conciliación ni importación.

El commit dedicado incluye únicamente la migración008, el guion SQL local con rollback, su test PostgreSQL y este informe. La documentación general, las migraciones001→006, los fixtures y helpers previos aún sin seguimiento se conservan fuera del commit: el ensayo requiere esa base local anterior y no es un bootstrap autónomo desde el HEAD limpio. Queda pendiente ordenar/versionar ese trabajo en su propio alcance, no mezclarlo con008. No se publica el commit al remoto.

Pendientes antes de cualquier instalación alojada: revisión de esta fase, preflight de esquema/roles/default privileges y versión real, medir volumen y locks en instancia aislada, plan de conservación de ensayos y validación con JWT reales. Activar el escritor/corte exige una migración y entrega posteriores; este commit solo cierra el esquema inactivo.
