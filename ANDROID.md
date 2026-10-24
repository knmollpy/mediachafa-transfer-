# MediaChafa para Android

La web puede instalarse desde Chrome en Android con **⋮ → Instalar aplicación** o **Agregar a pantalla principal**.

Para compilar el APK en una computadora con Node.js 22, Java 21 y Android SDK:

1. `npm install`
2. `npx cap add android`
3. `npm run mobile:sync`
4. `cd android && ./gradlew assembleDebug`

El APK de depuración queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

También se puede ejecutar el workflow **Build Android APK** desde GitHub Actions. El APK queda como artifact descargable durante 30 días. Para publicar en Google Play hace falta crear y proteger una clave de firma de producción.
