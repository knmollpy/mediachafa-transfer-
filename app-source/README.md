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
- **Teléfono:** desde Brave, Opera GX, Chrome, Edge u otro navegador Chromium compatible en una computadora, conecta un Android por USB, muestra su pantalla en MediaChafa y permite manejarla con clic/toque, Atrás, Inicio y pantalla completa. La conexión se realiza localmente en el navegador con WebUSB y ADB; la imagen y los controles no pasan por Supabase.
- **Privacidad:** los permisos se aplican también en Supabase; la interfaz no es el único control de acceso.

### Conectar un teléfono Android

1. En Ajustes → Acerca del teléfono, toca “Número de compilación” siete veces para activar Opciones de desarrollador. En algunas marcas está bajo “Información de software”.
2. En Ajustes → Sistema → Opciones de desarrollador, activa “Depuración USB”.
3. Conecta el teléfono a la computadora con un cable USB de datos; si hace falta, selecciona “Transferencia de archivos”.
4. Abre MediaChafa en Brave, Opera GX, Chrome, Edge u otro navegador Chromium que tenga WebUSB y WebCodecs, entra en **Teléfono**, pulsa **Conectar teléfono por USB**, selecciona el dispositivo y acepta la autorización ADB que aparece en Android.

El permiso USB se concede por separado al navegador y el permiso ADB se confirma en el propio teléfono. Para proteger el dispositivo, no autorices equipos ni páginas que no reconozcas. La función requiere HTTPS, WebUSB y WebCodecs; la disponibilidad depende de la versión y configuración del navegador.

Para regenerar el módulo estático del visor después de cambiar `phone-mirror.js`, ejecuta `pnpm build:phone` dentro de `app-source`. El servidor Scrcpy v3.3.3 se distribuye en `scrcpy-server.bin`; su licencia Apache 2.0 está incluida en `SCRCPY-LICENSE`.

## Servicio de almacenamiento

El dueño ofrece **20 GB de almacenamiento por US$ 5 con acceso permanente**, sujeto a disponibilidad y a las condiciones acordadas al contratarlo. Para consultar, usá el [sitio oficial](https://mediachafa-transfer.vercel.app/).

## Tecnología

La aplicación web y Android usa Capacitor; Supabase gestiona autenticación y datos, y Cloudflare R2 y Google Drive se pueden usar como destinos de almacenamiento. El catálogo de PS4 muestra los enlaces que configura el dueño.
