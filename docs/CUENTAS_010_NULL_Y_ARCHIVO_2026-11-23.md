# Cuentas 010: saldo desconocido y archivo para preparar 009

## Evidencia local histórica — 23 de noviembre de 2026

**Actualización Git del 24 de noviembre:** ver [cierre y dependencias de integración](./CIERRE_010_GIT_Y_PREFLIGHT_2026-11-24.md). Las secciones siguientes conservan la evidencia de la implementación local original.

**Entrega local original del 23 de noviembre**, sobre 8962e5c8686d00309483b36dc487b2ad0008a49a. Migración nueva: **202611230010_archivo_cuentas.sql**. No se aplicó 010 a staging, no se desplegó la web ni ninguna Edge y no se activó el corte del libro. Tampoco se modificaron producción, cron ni los Atajos del iPhone. El último estado alojado verificado en la entrega anterior era 009 instalada en legacy; este trabajo no consultó ni modificó ese entorno.

La interfaz conserva los saldos NULL como desconocidos, ofrece archivo de cuentas con historial y elimina su borrado físico desde Configuración. La protección efectiva de nuevas capturas y del historial está en SQL, no solo en los selectores. **Hace falta instalar y validar 010 en staging antes de publicar esta web allí.** No se autoriza instalación ni activación con este informe.

Resultados finales: **36 pruebas/subpruebas Node, 48 SQL (13 de 008 + 23 de 009 + 12 de 010) y 12 Edge aprobadas**, sin fallos ni omisiones en las ejecuciones finales. Los siete casos específicos de interfaz/exportaciones están incluidos en las 36 de Node. Build completo y comprobación HTTP local aprobados. [Evidencia, versiones y SHA256 finales](./CUENTAS_010_PRUEBAS_2026-11-23.json).

## Saldo desconocido: lectores, altas y exportaciones

Se revisaron los usos de saldo_actual en src y las rutas de lectura/exportación. El nuevo helper src/lib/saldos.mjs centraliza la distinción entre NULL/vacío/desconocido y un cero explícito. El formato visible es exactamente **«Sin saldo definido»**. No se escribe esa etiqueta en la base ni se sustituye NULL por 0 en el dominio.

- Resumen: tarjetas individuales y totales CLP usan el mismo criterio. Si cualquier cuenta del grupo tiene saldo desconocido, el total completo es desconocido; no se publica la suma parcial como saldo total. Corriente y deuda permanecen separados y no se suman monedas diferentes.
- Configuración e historial: muestran el saldo con su moneda y conservan el estado desconocido.
- Excel: los saldos conocidos siguen siendo celdas numéricas, incluido cero y negativos; un saldo desconocido lleva la etiqueta explícita. Se añaden estado y fecha de archivo. Las cuentas archivadas permanecen en la exportación.
- PDF: usa el formato por moneda de la cuenta y la etiqueta de desconocido, con estado archivado visible. Se verificó el árbol del documento y la generación de bytes PDF válidos; no se hizo revisión visual en Safari.
- Alta: saldo inicial opcional. Vacío envía NULL; escribir 0 crea saldo cero. El formulario lo explica. No se ha cambiado la aritmética del escritor legacy para confirmar gastos en cuentas desconocidas: esta entrega corrige entradas, lectores y exportaciones, y conserva el motor vigente.
- Edición: sigue enviando únicamente la lista explícita de campos descriptivos; no envía saldo_actual ni archivado_at, aunque existan en el snapshot. 007 y las guardas de 009 siguen protegiendo el servidor.

Los saldos de cuentas archivadas **siguen incluidos en los totales**. Archivar no liquida una deuda ni elimina un activo; la interfaz explica esa inclusión. Si un saldo archivado es desconocido, también vuelve desconocido el total correspondiente.

## Archivo de cuentas y preservación

La columna tarjetas.archivado_at es nullable: las cuentas existentes siguen activas sin backfill, cambios de saldo o eliminación de filas. El nuevo RPC archivar_cuenta(uuid) devuelve la cuenta actualizada y exige propietario, sesión y el MFA requerido por acceso_protegido/exigir_acceso. service_role y anon no tienen EXECUTE.

El archivo es idempotente e irreversible por las rutas de esta entrega: repetirlo conserva la primera fecha. No se implementó desarchivo. La fecha no se puede imponer en un INSERT de cuenta ni cambiar por UPDATE de los roles API. La guarda también rechaza reactivar/cambiar la fecha de una cuenta ya archivada desde SQL.

Bajo la barrera de 009, el bloqueo por usuario y el lock de cuenta, la misma transacción:

1. Marca únicamente archivado_at, sin tocar saldo_actual, identidad, propietario o destino.
2. Revoca las credenciales v1/v2 y los vínculos de esa cuenta, preservando filas y fechas de revocación anteriores.
3. Conserva instrumentos y perfiles hacia otras cuentas, movimientos, cuotas y libros.

No se generan operaciones/apuntes por archivar. No hay otro escritor financiero: las definiciones del proyector y de los RPC financieros permanecen iguales antes/después de 010.

Se revoca DELETE de tarjetas a PUBLIC y roles API. Una guarda BEFORE DELETE protege también el acceso SQL directo a cuentas ya archivadas o con movimientos, libros, vínculos, credenciales, cuotas o planes fijos; no depende de que RLS bloquee la operación. El operador puede seguir gestionar una cuenta activa vacía sin historial según sus privilegios, pero no borrar una cuenta archivada para eludir su conservación.

Configuración separa activas e historial plegable, nombra la cuenta al pedir confirmación y explica la revocación, el cese de nuevos envíos/reintentos y la conservación de pendientes. Al completar el archivo se refresca el panel de Atajos y se oculta cualquier secreto mostrado. La confirmación de archivo no contiene saldo editable.

## Capturas, contratos v1/v2 y pendientes

Las firmas y payloads v1/v2, IDs, evento_id, binding_id, validación de credenciales e idempotencia no cambian. Los triggers nuevos comprueban la cuenta activa antes de insertar una transacción, vínculo, credencial, compra en cuotas o plan fijo con cuenta. También comprueban cambios de propietario/destino donde corresponde. Alcanzan a los wrappers SECURITY DEFINER, al operador y a las rutas que usan service_role.

La serialización usa el orden existente: barrera de control → usuario → cuenta. Si una captura se compromete antes del archivo, permanece en su historial y saldo. Si el archivo gana, una captura nueva se rechaza. Crear un vínculo o credencial nuevo hacia una cuenta archivada también se rechaza en servidor. No se retargetean cuentas ni se sustituyen UUID al fallar.

Un reintento web autenticado de una recepción ya comprometida conserva el ID sin nuevo efecto, incluso después de archivar. Las credenciales automáticas revocadas dejan de funcionar, incluidos sus reintentos, igual que la revocación existente. La cola offline mantiene sus datos y su UUID; un evento nuevo hacia una cuenta archivada no se aceptará ni se moverá automáticamente a otra cuenta.

Los pendientes capturados antes del archivo siguen visibles y pueden confirmarse con propietario/MFA correctos. La confirmación no es una captura nueva y conserva la recepción; sus reintentos aplican un único efecto. Esto se ensayó con el motor legacy y también con 009 activo **solo dentro de una base local sintética desechable**. No se ejecutó corte alojado.

Los selectores de gasto, coincidencia por últimos dígitos, planes fijos y perfiles de Atajos ofrecen solo cuentas activas. Un plan fijo antiguo conserva su referencia, pero «Registrar hoy» queda deshabilitado si apunta a una cuenta archivada o no disponible; debe elegirse una cuenta activa explícitamente para futuros usos.

## Historial accesible después de archivar

Se añadió /cuentas/[id], enlazada desde cuentas activas y archivadas. Usa la sesión y el cliente del usuario, MFA y RLS; nunca service_role. No limita los datos al año actual. Usa páginas de 30 movimientos con cursor fecha/UUID estable y una consulta de hasta 31 filas; conserva precisión de microsegundos en el cursor y permite ver movimientos más antiguos sin cargar todo el historial.

La ruta de retorno de Auth acepta únicamente /cuentas/UUID, junto a los destinos existentes, sin URLs arbitrarias o queries abiertas. Los cursores admiten solo fecha con zona horaria y UUID. Una cuenta ajena o inexistente no se expone; una ruta sin sesión redirige al login. Los pendientes pueden revisarse en esa página usando el panel existente.

## Validación final y límites

PostgreSQL **18.4** real local, Node **24.18.1**, Next **16.3.0** instalado. Las pruebas SQL usan procesos psql independientes y bases aleatorias, verificando loopback/data_directory; Auth y niveles MFA de esas pruebas son simulaciones SQL. Los tests Edge usan dependencias simuladas. **No hubo pruebas HTTP/JWT/TOTP reales contra Supabase para 010 en esta entrega.** Las pruebas alojadas de 009 anteriores no acreditan los cambios nuevos de 010.

La suite SQL específica cubre instalación NOWAIT sin restos, conservación de NULL/saldos/funciones, edición concurrente con gasto, v1/v2 con reintentos, propietario y MFA, archivo idempotente, revocación restringida por destino, intentos de captura directa/credencial/vínculo/plan fijo, pendientes, borrado y reactivación bloqueados, carreras en ambos órdenes y rollback tardío. El ensayo local con 009 activo verifica aperturas conservadas y confirmación concurrente de un pendiente sobre una cuenta archivada, sin cambiar el escritor. Tras el último refuerzo de DELETE se repitió la suite específica completa: **12/12**, 14607,3413 ms.

Se ejecutaron además regresiones 008 (13/13), 009 (23/23), todos los tests Node (36/36) y Edge (12/12). Excel se generó y se volvió a leer; PDF se generó con el renderer real. El resumen y el historial se renderizaron o ejecutaron con fixtures sintéticos y dependencias de red sustituidas. ESLint, sintaxis PowerShell y diff --check aprobados.

El build se hizo en una copia aislada de la web y dependencias existentes, sin .env ni claves reales. Se usaron URL .invalid y clave ficticia. Compiló, prerenderizó y terminó correctamente con webpack; el código src coincide byte por byte con el entregado. Por errores EPERM al crear directorios en workers de Windows, solo en la copia de comprobación se usaron un worker, webpackBuildWorker=false y cleanDistDir=false, preparando directorios de salida. No se cambiaron esas opciones en el repositorio. El intento con el paralelismo habitual no completó el prerender por ese bloqueo del entorno; no se atribuye su aprobación al build estándar sin ajustes. El smoke local del build devolvió /login=200 y la ruta protegida sin sesión=307 al login.

El primer intento de Edge sin DENO_DIR no encontró las dependencias en caché. Se repitió con la caché local existente y --cached-only, sin descargar librerías. Los intentos de entorno fallidos no se contaron como aprobaciones. Los clústeres y servidores propios de pruebas terminaron detenidos.

No se hicieron nuevas mediciones de volumen del libro. No se alteran las métricas locales de 009 ni se presentan como capacidad alojada. Quedan pendientes instalación/auditoría y pruebas reales de 010 en staging, revisión visual y prueba en Safari/iPhone.

## Repetir y preparar staging

```powershell
# Tests generales y exportaciones (requieren las dependencias web instaladas):
node --test tests/*.test.mjs

# Clúster local NUEVO, fuera del checkout; incluye regresiones 008/009 y archivo 010:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-libro008-local.ps1 -PostgresBin 'C:\Program Files\PostgreSQL\18\bin' -WorkRoot 'C:\ruta\nueva\cuentas010' -Port 55442 -Include010
```

La suite crea y elimina bases sintéticas; el ensayo de libro activo es solo local. Los helpers Auth ficticios nunca deben ejecutarse alojados. El comportamiento predeterminado del ejecutor sigue siendo 008; el benchmark no se activa con -Include010.

Antes de instalar en staging, revisar 010 y acordar ventana sin escrituras. Revalidar owners y permisos del postgres administrado para ALTER/TRIGGER/funciones/grants; no hace falta un rol nuevo. Instalar 010 íntegra en una transacción y ejecutar auditoria_libro009.sql y auditoria_archivo_cuentas.sql. Un error NOWAIT/timeout debe abortar la transacción completa; no aplicar fragmentos.

Después, validar con fixtures identificados y JWT/MFA reales archivo, conservación de saldo/historial, v1/v2, reintentos, revocación y pendientes; solo entonces desplegar la web a un proyecto de staging aislado. La nueva consulta de registrar usa archivado_at: **no publicar esa web antes de instalar 010**. Registrar la versión en el historial de migraciones con el mecanismo habitual. Estas instrucciones son un plan de revisión, no una autorización de ejecución remota.

Ante un error de red al archivar, recargar el estado antes de repetir; el mismo UUID de cuenta hace el RPC idempotente. Si falla la transacción, no quedan archivo/revocaciones parciales. No se recupera una cuenta borrando su archivo o reactivando credenciales. Cualquier necesidad de desarchivo requiere una entrega posterior revisada.

No se implementaron conciliación, importaciones ni otro motor de saldos. El trabajo local anterior se preservó; 001–009 mantienen sus huellas, y los archivos ajenos a esta entrega coinciden con el snapshot inicial. No se crearon commits ni se publicó al remoto.
