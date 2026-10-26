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
