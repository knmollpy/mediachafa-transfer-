# Auxiliar inalámbrico de MediaChafa (Linux y Windows)

Permite que el navegador use ADB por Wi‑Fi mediante un puente local. El auxiliar escucha solo en `127.0.0.1`, crea un token temporal y acepta conexiones únicamente desde MediaChafa. El código de emparejamiento se pasa a ADB en esta computadora. No se envía a MediaChafa.

## Requisitos

- Android 11 o posterior con **Depuración inalámbrica**.
- Computadora y teléfono en la misma Wi‑Fi; no se necesita Bluetooth.
- Node.js 20+ y Android SDK Platform Tools (`adb`) instalados y disponibles en `PATH`.
- En Windows: ejecutá `start-windows.bat`. En Linux: abrí una terminal en la carpeta y ejecutá `bash start-linux.sh`. En la primera ejecución se instala la dependencia `ws` desde npm.

## Uso

1. Abrí MediaChafa desde HTTPS, entrá a **Teléfono → Wi‑Fi**, iniciá el auxiliar y copiá el token temporal de su ventana.
2. En Android, abrí **Opciones de desarrollador → Depuración inalámbrica → Vincular dispositivo con código**.
3. Copiá la IP y el puerto de emparejamiento que muestra Android, además del código de seis dígitos. Pegalos en MediaChafa y tocá **Emparejar**.
4. Volvé a la pantalla principal de Depuración inalámbrica. Copiá el puerto de conexión (puede ser diferente), completalo y tocá **Conectar por Wi‑Fi**.
5. Aceptá en el teléfono la autorización si Android la solicita. Mantené abierta la ventana del auxiliar durante la transmisión.

Los puertos cambian y pueden ser distintos entre emparejamiento y conexión; usá los que muestra Android. Si una red de invitados o el aislamiento Wi‑Fi bloquea dispositivos entre sí, probá una red privada compartida.

## Seguridad y desconexión

El token cambia cada vez que se inicia el auxiliar. El servicio solo escucha en loopback, requiere token y valida el origen web. No compartas el token ni emparejes dispositivos ajenos. Cerrá la ventana para detener el puente; también podés revocar la autorización desde las opciones de desarrollador de Android.
