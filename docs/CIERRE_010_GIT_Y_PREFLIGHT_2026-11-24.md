# Cierre Git de 010 y preflight de staging — 24 de noviembre de 2026

**Actualización posterior:** el bloqueo de dependencias web descrito aquí quedó resuelto en [el cierre de dependencias y reproducibilidad](./WEB_010_DEPENDENCIAS_Y_REPRODUCIBILIDAD_2026-11-24.md). Lo que sigue conserva el estado histórico del preflight anterior; 010 continúa sin instalar ni desplegar.

## Estado y alcance

Se prepara un commit dedicado de 010 sobre **8962e5c8686d00309483b36dc487b2ad0008a49a**, sin publicar al remoto. El hash final y los resultados del preflight posterior se registran en el acta local de salida CIERRE_010_Y_PREFLIGHT_2026-11-24.md, fuera del repositorio, para no intentar insertar un commit dentro de su propio contenido.

**010 no se instala, la web no se publica y el corte no se activa.** El preflight utiliza únicamente lecturas de catálogo, auditoría 009 y huellas calculadas en servidor. El resultado alojado del ensayo de 010 seguirá pendiente: la suite preparada no se ejecuta con datos reales en esta entrega.

## Separación del trabajo previo

Se verificaron las bases previas a 010 mediante las huellas guardadas al iniciar su implementación y las copias aisladas de las releases anteriores. Se encontraron cuatro archivos tracked con modificaciones anteriores intercaladas (ConfiguracionView, DashboardView, RegistrarView y registrar/page.js) y tres archivos previos todavía sin versionar (AtajosPanel, VinculosAtajosPanel y auth/rutas.mjs).

El índice del commit usa HEAD más solo las modificaciones de 010 para los cuatro archivos tracked. No se sustituyen sus archivos en el working tree: tu trabajo anterior sigue allí. Los archivos puros y nuevos de 010 se incluyen normalmente. No se incorporan package.json/lock, Next config, Auth/MFA, Edge, estilos ni otros cambios anteriores ajenos a 010.

Los cambios de 010 sobre los tres archivos previos sin versionar se entregan como **patches/010_integracion_sobre_trabajo_previo.patch**, junto con la línea de refresco del panel de Atajos en Configuración que depende de su integración previa. El parche contiene exclusivamente esas diferencias, no implementaciones completas anteriores. Se comprobó con git apply --ignore-space-change --reverse --check que ya está integrado en tu carpeta actual. **No volver a aplicarlo aquí.**

El parche se reserva para integrar sobre las bases anteriores una vez que se versionen por separado. En ese contexto primero comprobar con git apply --ignore-space-change --check; no aplicar a ciegas si cambian sus bases. No se resetearon archivos ni se descartaron cambios; no se creó un commit intermedio con trabajo ajeno.

**Limitación de publicación:** este commit no es un paquete web autónomo sobre el HEAD anterior. La ruta de historial usa Auth y MovimientosPanel del trabajo previo, y la integración completa con Atajos también depende de esos componentes no versionados. Las dependencias de la web, incluidos los cambios anteriores de package.json, permanecen fuera del commit. Antes de cualquier despliegue desde Git hay que revisar/versionar ese trabajo en una entrega separada e integrar el parche. No se presenta el build anterior del working tree completo como un build limpio de este commit.

## Validación del commit preparado

Además de los resultados históricos locales del 23 de noviembre (36 Node, 48 SQL, 12 Edge y build aislado), se probaron las versiones parciales del índice:

- Ocho pruebas/subpruebas de saldo/exportaciones/historial/edición aprobadas en el candidato del commit. Para los tests de destinos Auth se añadió explícitamente un overlay de auth/rutas.mjs del working tree; esa dependencia no se incorporó al commit. No se afirma que la suite web esté cerrada sin ese overlay.
- La nueva suite alojada se cargó sin ACK: una prueba omitida, cero llamadas a staging y cero pruebas alojadas aprobadas. El skip es una guarda, no evidencia HTTP/MFA real de 010.
- La suite SQL 010 se ejecuta desde el candidato, usando únicamente las dependencias SQL versionadas, en PostgreSQL 18.4 local con datos sintéticos y conexiones independientes. Las simulaciones Auth de esta suite no sustituyen JWT reales.
- Sintaxis Node y ESLint comprobados para el preflight y la suite alojada. Las fuentes SQL/funcionales de 010 no se modificaron para cerrar Git.

Las huellas originales de CUENTAS_010_PRUEBAS_2026-11-23.json describen el working tree completo probado el día 23; los cuatro archivos del índice excluyen intencionadamente cambios anteriores. No deben confundirse esas dos versiones al revisar evidencias.

## Preflight de instalación preparado

scripts/staging/preflight-010.mjs exige:

- ABACO_010_PREFLIGHT_ACK=bikubreyffppuxfxzxew:read-only.
- ABACO_STAGING_HOME y ABACO_STAGING_WORKDIR del workspace aislado ya autorizado.
- ABACO_010_PREFLIGHT_RESULT_FILE fuera del checkout; incluye huellas agregadas privadas, no filas ni secretos.

Verifica el nombre/ref del proyecto mediante GET antes de cualquier SQL. Cada bloque se ejecuta en BEGIN READ ONLY / ROLLBACK con timeouts. Comprueba versión, 009 en legacy y sin corte, historial de migraciones, cron, owners y privilegios efectivos de schemas/tablas, funciones auxiliares, colisiones de columna/RPC/triggers de 010 y locks externos puntuales. Ejecuta auditoria_libro009.sql. Calcula y compara huellas de 11 tablas antes y después; si el tráfico operativo cambia los datos, exige renovar el baseline en una ventana acordada, sin atribuir cambios a esta herramienta.

No ejecuta DDL, GRANT, llamadas a funciones financieras, altas Auth, cambios de configuración ni instalación. La ausencia de locks en un instante no garantiza una futura ventana libre. No crea ni utiliza recursos de pago.

## Validación alojada preparada, NO ejecutada

Archivo: tests/integration/cuentas-archivo-hosted.test.mjs. Para una futura ejecución autorizada requiere los parámetros habituales de contextoAlojado y, además:

- ABACO_010_HOSTED_TEST_ACK=bikubreyffppuxfxzxew:archive-identified-synthetic-only.
- ABACO_010_FIXTURE_MANIFEST con los dos actores TEST008 existentes y sus cuatro cuentas.
- ABACO_010_ORIGINAL_BASELINE_FILE para excluir las identidades originales/personales.
- ABACO_010_RESULT_FILE privado, fuera del repositorio.

Antes de modificar Auth exige que 010 ya esté registrada, 009 siga en legacy y cron esté inactivo. También verifica email .invalid, prefijo, etiqueta de perfil, propietario de cada cuenta e IDs excluidos. Si la cuenta elegida ya está archivada, se detiene: no la reactiva ni crea cuentas adicionales para repetir el ensayo.

El guion prepara login y TOTP reales, JWT AAL2, rechazo de AAL1/administrador sin MFA y otro propietario, captura v1/v2 con reintentos por Edge, pendientes sin efecto, archivo idempotente, revocación, rechazo de nuevas capturas/credenciales y confirmación de pendientes anteriores una sola vez. Las huellas de los otros propietarios deben permanecer iguales. Retira los actores sintéticos, sus sesiones y credenciales sin borrar historial. Los resets administrativos están restringidos a esos fixtures; no son recuperación de MFA para personas.

La futura prueba archiva de forma irreversible una cuenta sintética existente y conserva sus recepciones. Debe coordinarse con la ventana de staging después de autorizar e instalar 010. No modifica los Atajos del iPhone ni llama al corte.

## Pendientes

Revisar el acta del preflight y la separación del commit. Autorizar por separado la instalación transaccional de 010 y su registro, ejecutar auditorías 009/010 y después la validación alojada preparada. Para publicar la web de staging, cerrar primero las dependencias previas de Auth/Atajos y aplicar su integración; luego comprobar Safari. Producción, cron y el corte continúan fuera del alcance.
