# Web de 010: dependencias versionadas y verificación limpia

## Estado actual — 24 de noviembre de 2026

**Se cerró el bloqueo de dependencias Git de la web de 010.** Auth/MFA, Atajos, MovimientosPanel, sus lectores, estilos y dependencias de pruebas están versionados en commits separados de la migración 010. Los ajustes del parche de integración ya estaban en el working tree y se versionaron directamente, sin reaplicarlos.

Instalación de dependencias, 36 pruebas Node, build completo y smoke HTTP local aprobados desde un worktree nuevo en el commit exacto, sin overlays ni archivos .env. La comprobación de Git terminó limpia, sin fuentes sin versionar. No se copió node_modules: npm ci instaló 469 paquetes desde el lockfile. [Evidencia y huellas](./WEB_010_REPRODUCIBILIDAD_PRUEBAS_2026-11-24.json).

**Bloqueo real que permanece:** el build por defecto con Turbopack no puede crear junctions en este Windows gestionado. Webpack sin el perfil también encontró EPERM en directorios de prerender. El build aprobado utiliza un perfil local **versionado**, desactivado por defecto, descrito más abajo. No se afirma aprobación del comando estándar de Turbopack ni validación de un despliegue externo.

No se hizo push, no se instaló 010, no se publicaron web/Edge ni se activó el corte. No se hicieron llamadas a Supabase. El último preflight alojado sigue siendo el diagnóstico anterior: 009 en legacy y 010 pendiente; esta entrega no cambió ese entorno.

## Commits de código

| Commit | Alcance |
| --- | --- |
| 5921f224d52e31e36d6fee5a16e25b80c048c60f | Dependencias web de Auth/MFA: páginas/formularios, callbacks, guards de sesión, destinos seguros con historial 010, cierre de sesión, protección de caché y estilos compartidos. Añade PGlite/lockfile y tests Auth necesarios. |
| 8f9f63163c4baeb72a25df7450342ed57b347786 | Atajos v1/v2, vínculos/credenciales, MovimientosPanel y lectores de pendientes; envío/cola con UUID persistente e integración de filtros/refresco de 010. Tests y fixtures sintéticos. |
| 65b1ee9405b21df40e70105a6b86e2ed2e863111 | Perfil y ejecutor versionados de verificación local, sin overlays ni secretos. Es el commit exacto del worktree de instalación, tests y build final. |

Base: 7897a7cb7ac9e42dd4cb1c8975046e019272341d, cierre de 010. El commit documental posterior no modifica fuentes ni configuración probadas. Su hash final se entrega también en el acta de salida, fuera del checkout, para no introducir autorreferencias de hashes en un commit.

## Revisión e integración

Auth usa getClaims y estado_seguridad para proteger datos y operaciones; la página de bootstrap MFA queda fuera del layout financiero. Los callbacks PKCE/OTP solo devuelven destinos internos permitidos; recuperación no omite MFA. El QR/secretos TOTP quedan en memoria de interfaz, no en logs o almacenamiento. La interfaz conserva acceso por enlace y correo/contraseña, enrolamiento/desafío y gestión del factor con verificación del factor retenido antes de retirar otro. No promete códigos de recuperación. Los controles de servidor existentes en 004/009 no se sustituyen por estos componentes.

El cierre de sesión descarta el documento/caché del router; el service worker no conserva HTML privado, respuestas RSC o APIs autenticadas. Se incluye offline.html estático como fallback. Los estilos versionados son las dependencias compartidas que consumen los paneles existentes; no se hizo un rediseño nuevo.

Atajos genera secretos en el navegador, envía solo su hash al RPC y mantiene identidad/destino inmutables. Los cambios de 010 ofrecen solo cuentas activas y refrescan el panel después del archivo. MovimientosPanel conserva pendientes separados de los gráficos y llama al RPC de confirmación existente. El UUID se conserva al reintentar, incluida la actualización de entradas antiguas de la cola antes de enviarlas.

Se comprobó en el working tree y en el checkout limpio:

```powershell
git apply --ignore-space-change --reverse --check patches/010_integracion_sobre_trabajo_previo.patch
```

La comprobación aprobada demuestra que el parche **ya está integrado**. Se conserva como evidencia histórica; no aplicarlo otra vez. No se modificaron las migraciones 001–010 ni sus auditorías.

## Qué se conservó fuera de los commits

Los cambios previos de Edge/cron, supabase/config.toml, scripts de staging, pruebas remotas/Edge pendientes, informes anteriores y otros archivos ajenos permanecen en el working tree sin commit. Se dejaron fuera los comandos de pruebas remotas/Edge añadidos anteriormente a package.json; el package versionado contiene los scripts necesarios de la web y npm test, sin referencias nuevas a fuentes no versionadas.

También se conserva sin commit el cambio previo distDir/ABACO_BUILD_DIR en next.config.mjs; el commit de verificación incluye únicamente el perfil local nuevo. La comparación con el snapshot inicial confirmó que los archivos de trabajo anteriores se conservaron. En fuentes/configuración y tests solo hubo dos ediciones intencionales sobre archivos ya presentes: añadir ese perfil manteniendo distDir y normalizar una línea vacía final del test multitarjeta. Se actualizó además el informe propio anterior para enlazar este cierre y evitar que su bloqueo histórico se interprete como vigente.

No se añadieron claves, manifests privados, .env, muestras de datos personales ni contenidos del workspace privado. Los imports de los componentes que antes faltaban se resuelven ahora desde Git; no se utilizaron overlays para completar auth/rutas.mjs.

## Pruebas reales del checkout limpio

Worktree nuevo en detached HEAD 65b1ee9405b21df40e70105a6b86e2ed2e863111. Árbol probado: **47cb3905b53893a45d0f10d6ba79d4c303f521c9**. No hubo copia de fuentes desde el working tree. Node 24.18.1, npm 11.16.0, Next 16.3.0, React 19.2.8, Supabase JS 2.112.2 y PGlite 0.5.16.

- npm ci: 469 paquetes instalados, lockfile sin cambios. La caché offline estaba incompleta; se descargaron paquetes públicos desde registry.npmjs.org con configuración npm sin credenciales.
- npm test: **36 aprobadas, 0 fallidas, 0 omitidas**, 4267,7871 ms. Incluye callbacks, MFA/RLS simulados, v1/v2, pendientes, saldo NULL, edición, exportaciones Excel/PDF y navegación del historial.
- SQL 010: **12/12 aprobadas**, 20160,7734 ms, desde el primer checkout limpio en 8f9f631. PostgreSQL 18.4 local real con conexiones independientes; mismas fuentes SQL que el checkout final. Auth/MFA de esta suite está simulado en SQL. No es validación alojada.
- Build final: compilación, prerender 12/12, trazas y tabla de rutas completos, incluido /cuentas/[id], con el perfil versionado de Webpack local.
- HTTP local del build: login 200; historial sin sesión 307 hacia login. Configuración ficticia .invalid y clave ficticia, sin cuentas ni tokens reales.
- ESLint de Auth, Atajos, movimientos, lectores, proxy, configuración y tests: aprobado en el checkout limpio. El resolver nativo está disponible.
- git status --porcelain y git ls-files --others --exclude-standard vacíos al terminar. Los únicos artefactos son los generados/ignorados de dependencias y build; no hay fuentes externas u overlays.

npm 11 informó que el postinstall de unrs-resolver no estaba aprobado por su política. No se aprobaron scripts indiscriminadamente. El módulo nativo se cargó correctamente y ESLint pasó; no fue un bloqueo funcional de la verificación.

No se ejecutaron suites alojadas, envío de correo, enrolamiento real, compras ni automatizaciones del iPhone. Las pruebas reales JWT/TOTP de staging descritas en entregas anteriores no se cuentan como pruebas nuevas de este cierre.

## Repetir sin overlays

Requisitos: Windows, Node/npm, Git y acceso al registro público de npm. Para la suite SQL adicional, binarios PostgreSQL locales. Crear un worktree nuevo, fuera de la carpeta de trabajo con cambios:

```powershell
git worktree add --detach C:\ruta\nueva\web010 HEAD
cd C:\ruta\nueva\web010
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/verificar-web010-local.ps1 -Acknowledgement isolated-checkout
```

El ejecutor rechaza fuentes modificadas, archivos .env o node_modules enlazado. Instala con npm ci, corre npm test y construye con npm run build -- --webpack. Usa exclusivamente URL .invalid y clave ficticia para compilar; los ficheros temporales de configuración npm quedan fuera del checkout y se eliminan. Restaura las variables de entorno del proceso al terminar.

El perfil ABACO_LOCAL_BUILD_CHECK=synthetic-only usa un worker, desactiva webpackBuildWorker y conserva las carpetas de salida preparadas por el ejecutor. Solo se crean directorios de artefactos dentro de .next; no se escriben ni sustituyen fuentes, ni se modifica next.config.mjs en el checkout. El perfil permanece desactivado en el build normal y no cambia la configuración de despliegue.

Se verificó desde una .next inicialmente ausente, no sobre restos de los builds fallidos. Los artefactos de verificación contienen configuración ficticia y **no son un paquete para desplegar**. Un despliegue futuro requiere su propia configuración aislada de staging y revisión.

## Incidencias del entorno y pendientes reales

Git clone local falló al iniciar MSYS por NtCreateDirectoryObject/Access denied. Se resolvió creando un worktree nativo, con el commit exacto y estado limpio; no se exportó/copió una carpeta con overlays.

Turbopack sigue bloqueado aquí por la creación de junctions (OS error 5). Webpack con el paralelismo normal, e incluso reduciendo solo CIRCLE_NODE_TOTAL, encontró EPERM en directorios de prerender. El perfil versionado resuelve la verificación local con Webpack sin elevar permisos ni cambiar la seguridad de Windows. No se afirma compatibilidad del build por defecto fuera de este entorno: deberá comprobarse en el destino antes de publicar.

El bloqueo de fuentes faltantes de Auth/Atajos/MovimientosPanel está resuelto. Permanecen fuera de este cierre la instalación de 010 y su validación alojada con JWT/MFA reales, el despliegue web y Safari/iPhone. El último preflight remoto no autoriza por sí mismo esos pasos. No se hizo push ni se alteró producción o cron.
