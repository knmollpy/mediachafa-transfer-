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

## Beta: agente autónomo

El modo **Normal** conserva el chat de un turno y las propuestas de acciones revisables. El modo **Autónomo** usa un ciclo backend: el modelo pide una herramienta, el Worker ejecuta esa herramienta, guarda el resultado y vuelve a consultar al modelo. No depende de una respuesta del modelo que simplemente afirme haber ejecutado algo.

### Herramientas disponibles en el ciclo autónomo

- **GitHub:** listar rutas, leer y buscar archivos, y escribir archivos completos bajo `app-source/`. Las escrituras crean commits solo en una rama aislada `beta-agent/<execution-id>`; el agente no tiene herramienta para borrar ni escribir en `main`.
- **Web:** leer páginas HTTPS públicas y devolver texto limitado al modelo. No controla el navegador visual ni ejecuta JavaScript de las páginas.
- **Pruebas:** iniciar el workflow `beta-agent-tests.yml` y consultar el resultado para el commit de la rama. El token de GitHub necesita permisos de lectura/escritura de Contents y Actions: write para iniciar manualmente el workflow. Las pruebas deben estar presentes en la rama predeterminada del repositorio para que GitHub permita `workflow_dispatch`.
- **Vercel:** si se conecta un token, crear un deployment con `target: preview`, consultar el estado del build y hacer un GET a la URL de Preview. El agente no tiene una herramienta de promoción o despliegue a producción.

El workflow ejecuta comprobaciones de sintaxis de JavaScript y `npm run test:beta-agent` en `app-source`. El agente puede usar errores de esas pruebas para proponer correcciones adicionales, con un máximo de 8 rondas, 20 llamadas a herramientas, 30.000 tokens estimados y 15 minutos por ejecución. El modo autónomo acepta únicamente modelos `:free` de OpenRouter cuya cuenta y cuota gratuita se verifican en cada consulta; no usa fallback a otro modelo. El coste configurado para esas llamadas es USD 0.

### Pausa, estado y límites

Las ejecuciones, resultados de herramientas, rama y contador de límites se guardan en el KV `BETA_LIMITS` durante 24 horas. **Pausar** guarda las instrucciones nuevas y espera que termine la operación en curso; después se puede continuar desde el estado guardado, sin repetir herramientas ya completadas. Al recargar la página, Beta consulta y recupera las ejecuciones recientes del dueño.

La pausa actúa entre operaciones; no revierte una petición externa que ya empezó. El backend usa el lease de KV para evitar que el cliente inicie a la vez dos pasos en la misma ejecución, pero KV no ofrece transacciones ni exclusión distribuida estricta. Antes de habilitar varias sesiones simultáneas o tareas críticas, conviene mover el coordinador a Durable Objects.

El agente no ejecuta shell en el Worker. Las pruebas remotas requieren que el workflow esté instalado y permitido por GitHub Actions. Un deployment de Preview requiere que el proyecto Vercel esté vinculado a `knmollpy/mediachafa-transfer-` y que el token tenga acceso a ese proyecto. El agente no ejecuta SQL, cambios de Supabase, operaciones de Cloudflare, borrados, merges ni operaciones de producción. Los commits permanecen en la rama `beta-agent/*`; revisalos y hacé el merge manualmente.

Para correr localmente las pruebas nuevas: `cd app-source && npm run test:beta-agent`. El cambio del Worker necesita desplegarse manualmente en el servicio Cloudflare Beta y sus integraciones GitHub/Vercel deben configurarse en **Integraciones** antes de usarlo. Esta implementación no despliega producción.


## Compilación autónoma de APK y PKG

Beta dispone de herramientas de compilación reales en GitHub Actions. Puede crear proyectos Android independientes en `app-source/apk/<nombre>/` y compilarlos a APK debug con Gradle, además de compilar proyectos PS4 homebrew a PKG. Devuelve los artefactos descargables sin modificar `main` ni publicar en producción. Para PS4, puede crear un proyecto homebrew en `app-source/ps4/<nombre>/`, ejecutar su `build.sh` con OpenOrbis PS4 Toolchain v0.5.4 y devolver el PKG generado en `dist/`. Los artefactos se conservan durante 30 días en GitHub Actions. Ambos flujos usan permisos de solo lectura del repositorio, no reciben secretos de firma y no publican binarios automáticamente en el sitio.

La compilación PKG es para homebrew original y consolas con entorno jailbreak compatible; no genera firmas retail ni permite instalar juegos comerciales protegidos. Ver `app-source/ps4/README.md` para el formato del proyecto.


Los proyectos Android independientes deben seguir `app-source/apk/README.md`; los APK resultantes son builds debug de prueba y no se firman como versiones retail.
