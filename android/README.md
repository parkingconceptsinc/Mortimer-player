# Mortimer Player for Android Auto

This Android companion module adds a native Android media-browser service so Android Auto can browse and play audio indexed by Android's MediaStore. The phone activity opens the existing Mortimer Player web app.

## Requirements

- Android Studio with JDK 17 and Android SDK 35
- Gradle 8.9 or compatible
- Android phone for playback and Android Auto testing

## Build

Open the `android/` directory in Android Studio and sync Gradle. Or, with Gradle installed:

```sh
cd android
gradle assembleDebug
```

The debug APK is generated at `app/build/outputs/apk/debug/app-debug.apk`.

## Android Auto behavior

- The car interface is provided by Android Auto, not by the web UI.
- The media service exposes the audio files Android indexes on the device under **All music**.
- Grant the audio permission on the phone before browsing media from the car.
- Video, books, comics, and files imported only into the web app's browser storage are not exposed to Android Auto by this module.
- This repository change does not publish an APK or grant Google Play approval. Test with Android Auto's Desktop Head Unit and a compatible phone/car before release.

The app uses the standard Android media-browser service architecture. See [Android's media apps guide](https://developer.android.com/training/cars/media).
