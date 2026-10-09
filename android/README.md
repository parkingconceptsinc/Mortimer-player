# Mortimer Player para Android nativo

Este módulo Android está en transición desde el antiguo lanzador WebView a una aplicación nativa con Kotlin, Jetpack Compose y Media3. La PWA permanece separada en la raíz del repositorio y no se modifica por esta aplicación.

## Compilar

Requisitos: Android Studio, JDK 17 y Android SDK 35. Desde la carpeta `android/`:

```sh
gradle assembleDebug
```

El APK de depuración se genera en `app/build/outputs/apk/debug/app-debug.apk`. El workflow de GitHub Actions también compila y publica el APK como artefacto descargable de la ejecución.

## Funciones de esta primera vista nativa

- Interfaz Android nativa con el estilo oscuro y acento coral de Mortimer Player.
- Selección de archivos de audio con el selector de documentos de Android; el selector permite navegar por almacenamiento interno, SD y unidades USB compatibles con el dispositivo.
- Reproducción local de audio mediante AndroidX Media3/ExoPlayer.
- Selección de vídeos, libros y cómics; por ahora, esos elementos se abren con una aplicación externa compatible cuando corresponda.
- Acceso directo a la aplicación oficial de Spotify, o a Spotify Web si la aplicación no está instalada.
- Se conserva el servicio de medios de Android Auto existente, que requiere pruebas en un dispositivo y vehículo compatibles.

## Estado y limitaciones

Esta es una versión preliminar de la conversión nativa, no una paridad funcional completa con la PWA. Las listas seleccionadas son temporales en esta primera implementación; todavía faltan persistencia de biblioteca, controles de reproducción completos, lectores nativos de EPUB/PDF/CBZ/CBR, reproducción de vídeo integrada, ecualizador, preferencias, y pruebas de Android Auto. Spotify se abre en su aplicación oficial: la reproducción completa de su catálogo dentro de Mortimer Player no está implementada.

La app no usa WebView ni carga la PWA. No se afirma que el APK esté listo para distribución final hasta que el workflow compile correctamente y las funciones se prueben en dispositivos reales.
