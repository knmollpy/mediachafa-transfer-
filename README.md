# MediaChafa PS4

**Sitio oficial:** [mediachafa-transfer.vercel.app](https://mediachafa-transfer.vercel.app/)

Una biblioteca móvil y web para organizar archivos, enlaces y una sección pública de juegos de PS4. La app Android conserva su interfaz galáctica y permite elegir dónde guardar descargas compatibles.

## Descargas

- [Descargar MediaChafa Android 2.5.1](https://mediachafa-transfer.vercel.app/downloads/MediaChafa.apk)
- [Abrir MediaChafa en la web](https://mediachafa-transfer.vercel.app/)

En Android, descargá el APK y abrilo para instalarlo. El sistema puede pedir autorización para instalar aplicaciones descargadas desde el navegador.

## Cómo funciona

- **Invitados:** entran directamente a Juegos PS4. Pueden consultar títulos públicos, ver sus detalles, compartir enlaces de descarga y reportar enlaces caídos.
- **Reportes privados:** los avisos aparecen en el apartado DM, visible solo para el dueño.
- **Colaboradores:** cuentas creadas por el dueño con acceso completo a la administración.
- **Usuarios normales:** el dueño puede elegir acceso a archivos y carpetas públicas, enlaces, Juegos PS4, creación de carpetas y subida de archivos. Las cuentas con subida tienen un cupo de almacenamiento configurable.
- **Privacidad:** las reglas de acceso se aplican en Supabase además de la interfaz. Los archivos privados siguen sujetos a permisos de cuenta.

## Servicio de almacenamiento

El dueño ofrece un plan de **20 GB de almacenamiento por US$ 5, con acceso permanente**, sujeto a disponibilidad y a las condiciones que se acuerden al contratarlo. Consultas y gestión desde el [sitio oficial](https://mediachafa-transfer.vercel.app/).

## Tecnología

Aplicación web y Android con Capacitor, Supabase para autenticación y datos, Cloudflare R2 para almacenamiento y Google Drive como destino opcional. El catálogo PS4 usa enlaces de descarga configurados por el dueño.
