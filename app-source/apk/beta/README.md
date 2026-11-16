# Beta para Android

Aplicación Android independiente llamada **Beta**. Abre directamente el espacio Beta de MediaChafa en un WebView, sin mostrar Archivos, Juegos PS4 ni las demás secciones del sitio.

## Acceso y privacidad
- Usa la autenticación existente de Supabase y el formulario protegido por Cloudflare Turnstile.
- Solo permite iniciar sesión con el usuario propietario **nxmollpy** y la cuenta de propietario verificada del sitio.
- No crea cuentas nuevas ni concede permisos de dueño a otros usuarios.
- Mantiene la sesión en el dispositivo y permite cerrarla desde Beta.

## Integraciones
La interfaz Beta y su Worker permanecen en el servidor oficial. Se reutilizan los modelos, herramientas, historial, conectores y permisos existentes; no se duplican ni se guardan tokens de integraciones dentro del APK.

## Compilación
Desde la raíz del repositorio: `gradle -p app-source/apk/beta assembleDebug`.
El APK se genera en `app/build/outputs/apk/debug/`.
