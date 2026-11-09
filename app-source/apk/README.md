# Android APK projects for MediaChafa Beta

Beta can create standalone Android applications and compile them into debug APK artifacts using GitHub Actions.

## Required layout

```
app-source/apk/<project-name>/
  settings.gradle or settings.gradle.kts
  build.gradle or build.gradle.kts
  app/
    build.gradle or build.gradle.kts
    src/main/AndroidManifest.xml
    src/main/java/.../
```

Use Android Gradle Plugin 8.x with Gradle 8.9 and Java 17. The workflow installs Android SDK platform 35 and build tools 35.0.0. The app module must produce an APK at `app/build/outputs/apk/debug/`.

The owner explicitly starts the build through Beta. GitHub Actions checks out the isolated `beta-agent/*` branch, uses read-only repository permissions, and uploads the resulting APK as a 30-day artifact. It does not merge, publish to the website, or write to the repository. This produces a debug APK for testing; a release APK requires a user-provided signing key and is intentionally not configured.
