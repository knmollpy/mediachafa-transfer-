# MediaChafa PS4

**Sitio oficial:** https://mediachafa-transfer.vercel.app/

MediaChafa es una biblioteca web y Android para organizar archivos, enlaces y un catálogo de juegos de PS4. La app móvil usa una interfaz galáctica adaptada a teléfonos.

## Descargar la aplicación

- **Android 2.5.4 (APK actualizado):** [Descargar APK directamente](https://mediachafa-transfer.vercel.app/downloads/MediaChafa.apk?v=2.5.4-20261026) · [Descargar ZIP](https://mediachafa-transfer.vercel.app/downloads/MediaChafa.zip)
- **Versión web:** https://mediachafa-transfer.vercel.app/

Descargá el APK y abrilo en Android para instalarlo. La app permite mantener la sesión iniciada en el dispositivo y cerrar sesión cuando quieras.

## Opciones principales

- **Archivos y carpetas:** navegar la biblioteca, crear carpetas y subir o descargar archivos según los permisos de la cuenta.
- **Enlaces:** guardar, organizar, compartir y borrar enlaces según el rol asignado.
- **Espacio:** consultar el espacio usado en Google Drive y Cloudflare R2.
- **Juegos PS4:** catálogo con portadas, carpetas, descripciones y características. Al abrir un juego se consultan sus detalles; sus enlaces se pueden descargar o compartir.
- **Invitados:** entrar directamente al catálogo de PS4. Pueden ver el contenido público, compartir enlaces y reportar un enlace caído; no pueden administrar juegos ni entrar a la biblioteca de archivos.
- **Reportes y DM:** los reportes de enlaces caídos se reciben en el apartado DM, disponible solo para el dueño.
- **Usuarios:** el dueño crea colaboradores con acceso de administración y usuarios normales con permisos elegidos para archivos públicos, enlaces, juegos, creación de carpetas, subida de archivos y cuota.
- **Privacidad:** los permisos se aplican también en Supabase; la interfaz no es el único control de acceso.

## Servicio de almacenamiento

El dueño ofrece **20 GB de almacenamiento por US$ 5 con acceso permanente**, sujeto a disponibilidad y a las condiciones acordadas al contratarlo. Para consultar, usá el [sitio oficial](https://mediachafa-transfer.vercel.app/).

## Tecnología

La aplicación web y Android usa Capacitor; Supabase gestiona autenticación y datos, y Cloudflare R2 y Google Drive se pueden usar como destinos de almacenamiento. El catálogo de PS4 muestra los enlaces que configura el dueño.


## Pruebas de navegador y monitoreo de errores

- **Playwright:** las pruebas de navegador se ejecutan en GitHub Actions para los cambios que afectan al sitio. Comprueban la pantalla de acceso, errores JavaScript no controlados y el ajuste básico en móvil. Los fallos conservan capturas, video y trace como artefactos de CI.
- **Sentry:** el SDK del navegador está preparado en `app-source/sentry-init.js`. Para activarlo, creá un proyecto **JavaScript** en Sentry y copiá su DSN público en `window.MEDIA_CHAFA_SENTRY.dsn`, dentro de `app-source/sentry-config.js`. El DSN no es un token privado; no pegues un Auth Token de Sentry en el frontend. Hasta configurar el DSN, Sentry permanece desactivado y no afecta el funcionamiento.
- La configuración de Sentry evita enviar por defecto datos personales, elimina cabeceras y cuerpos de solicitudes, y quita parámetros de consulta de las URLs registradas. No se habilita Session Replay.
- Para ejecutar Playwright localmente: `cd app-source`, `npm install --no-save --package-lock=false @playwright/test@1.65.0`, `npx playwright install chromium` y `npm run test:e2e`.
