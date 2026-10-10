# Mortimer Player Android parity audit

Reference: the PWA on `main`. Native target: `android/` on `fix/unified-media3-android-auto`.
This is a working checklist, not a claim that features are already implemented or tested.

## PWA feature inventory

The PWA entry point is `src/Player.tsx`; its main screens are:
- Music/library, search, sorting, artists/albums/folders, favorites and playlists
- Now Playing, queue, playback history/play counts, shuffle/repeat
- Equalizer with presets/custom presets, preamp, balance and boost
- Videos, video fit, subtitles, resume position, skip interval, remaining-time display
- Books/text, EPUB reader, comics/CBZ/CBR reader and reading progress/settings
- Persistent settings: theme/accent, volume, speed/pitch, queue, reader options and playback preferences
- Sleep timer, A–B loop, swipe/navigation, import progress, metadata and cover/thumbnail handling
- PWA install/offline behavior and library persistence

Primary reference files: `src/Player.tsx`, `src/styles.css`, `src/context.ts`, `src/prefs.ts`, `src/library.ts`, `src/screens/Library.tsx`, `NowPlaying.tsx`, `Queue.tsx`, `Equalizer.tsx`, `Settings.tsx`, `Videos.tsx`, `TextReader.tsx`, `EpubReader.tsx`, `Comics.tsx`, `ComicReader.tsx`.

## Native implementation observed

- `MainActivity.kt`: Compose interface, local media import/library, player controls, volume/speed, shuffle/repeat, sleep-timer choices, playlists and reader launch paths.
- `PlaybackService.kt`: Media3 player/session, local audio browsing/search and playback resumption support for Android Auto.
- `PdfReaderActivity.kt`, `EpubReaderActivity.kt`, `ComicReaderActivity.kt`: separate native readers.
- Android Auto UI and voice-search integration are separate from the full in-app experience.

## Parity checklist

| Area | Required acceptance criteria | Status |
|---|---|---|
| Navigation and transitions | Match PWA sections, back behavior, screen transitions, menus, gestures and loading/error states | NOT VERIFIED / GAP |
| Music library | Import folders recursively; deduplicate by stable URI; persist permission and library across restart; search/sort/group/filter | PARTIAL; test on device |
| Playback engine | Common queue for UI and service; supported codec coverage; error recovery; resume position; background playback | PARTIAL; test formats and device |
| Now Playing | Match artwork, metadata, progress, queue actions, swipe, repeat/shuffle and control states | PARTIAL |
| Audio processing | Equalizer presets/custom bands, preamp, balance, boost, pitch-preserving speed, volume/mute | GAP / NOT VERIFIED |
| Videos | Video browsing/playback, audio track, subtitle import/display/size, fit modes, skip interval, resume position | GAP / NOT VERIFIED |
| Books and text | TXT and other PWA text formats; search/navigation where applicable; reading progress and reader options | PARTIAL; verify format coverage |
| EPUB | Open EPUB, retain progress, typography/layout/background and reader preferences | PARTIAL; compare with PWA |
| Comics | CBZ and CBR coverage, page ordering, paged/continuous modes, direction, fit/background, tap zones, keep-awake, progress | PARTIAL; format and options need verification |
| Metadata/artwork | Embedded tags, folder art, generated thumbnails, correct refresh/fallback, no duplicate entries | NOT VERIFIED |
| Persistence | Settings, favorites, playlists, queue/index, history, play counts, progress and library survive process/app restart | PARTIAL; test each data class |
| Accessibility/UX | English strings, touch targets, empty/loading/error states, screen rotation and different phone sizes | NOT VERIFIED |
| Android Auto | Browse, search, voice search, queue sync, resumption and metadata on real hardware | BUILD ONLY; device test pending |
| Build quality | Unit tests, lint with zero actionable errors, APK build and regression tests | Must rerun after changes |

## Implementation order

1. Treat the PWA's navigation, state and settings as the behavioral specification. Create a screen-by-screen and control-by-control checklist before declaring parity.
2. Finish native navigation, animations/transitions, menu/back/gesture behavior and consistent visual components.
3. Port settings and equalizer semantics, then verify persistence and playback controls.
4. Complete video, subtitles, text/EPUB and comic format/options parity.
5. Audit import, metadata/artwork, duplicates, progress and restart recovery.
6. Run unit tests, lint and APK assembly; then test the APK on a physical Android device. Test Android Auto separately.
7. Keep the PWA on `main` untouched; deliver native work on this feature branch until reviewed.

## Release gate

Do not describe native Android as feature-complete merely because Gradle builds. Each row needs an implementation reference and a reproducible test result. Anything not verified on a physical device must remain explicitly marked unverified.
