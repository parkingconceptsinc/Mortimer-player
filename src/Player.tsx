import { useEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { BookOpen, Clapperboard, Disc3, Download, FilePlus, FolderOpen, Library as LibraryIcon, ListMusic, Settings as SettingsIcon, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { applyAudio, attachElement, EQ_PRESETS, initEngine, resumeEngine } from "./audioEngine";
import { decodeAudioTrack, type DecodedAudio } from "./codecAudioDecoder";
import { PlayerContext, ProgressContext, type Actions, type MenuTarget, type PlayerState, type SleepState } from "./context";
import { clearLibrary as clearStoredLibrary, deleteComics, deleteTracks, loadComics, loadLibrary, patchComic, patchTrack, saveComics, saveLibrary, type StoredComic, type StoredLibraryItem } from "./library";
import { comicFormatOf, defaultShelf, isComicFile, isTextFormat, makeThumbnail, openComic, toComic } from "./comics";
import { META_VERSION, readItem, readTags, type Incoming } from "./metadata";
import { readPref, usePref, writePref } from "./prefs";
import type { Comic, ComicProgress, EqSettings, Playlist, ReaderSettings, RepeatMode, Route, Screen, SongSort, Track, VideoFit } from "./types";
import { ACCENTS, compareText, formatTime, shuffled, srtToVtt, supported, toTrack, trackKey } from "./util";
import { captureVideoFrame } from "./thumbnails";
import { MiniPlayer, TrackMenu } from "./components";
import { Library } from "./screens/Library";
import { NowPlaying } from "./screens/NowPlaying";
import { Queue } from "./screens/Queue";
import { Equalizer } from "./screens/Equalizer";
import { Settings } from "./screens/Settings";
import { Videos } from "./screens/Videos";
import { Comics } from "./screens/Comics";
import { ComicReader } from "./screens/ComicReader";
import { EpubReader } from "./screens/EpubReader";
import { TextReader } from "./screens/TextReader";
import { readEpubInfo } from "./epub";

const NAV: Array<[Screen, string, string, LucideIcon, boolean]> = [
  ["library", "Music", "Music", LibraryIcon, true],
  ["videos", "Videos", "Videos", Clapperboard, true],
  ["books", "Books", "Books", BookOpen, true],
  ["comics", "Comics", "Comics", BookOpen, true],
  ["player", "Now Playing", "Playing", Disc3, true],
  ["queue", "Queue", "Queue", ListMusic, false],
  ["eq", "Equalizer", "EQ", SlidersHorizontal, false],
  ["settings", "Settings", "Settings", SettingsIcon, true],
];

const DEFAULT_READER: ReaderSettings = { mode: "paged", direction: "ltr", fit: "screen", background: "black", tapZones: true, keepAwake: true };
const comicCoverAttempted = new Set<string>();

const thumbAttempted = new Set<string>();

type DirectoryEntry = { kind: "file" | "directory"; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<DirectoryEntry> };
type DirectoryHandleLike = { name: string; values: () => AsyncIterable<DirectoryEntry> };

const MEDIA_EVENTS = ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "ended", "error"] as const;
type CodecAudioState = DecodedAudio & { id: string; source: AudioBufferSourceNode | null; gain: GainNode; startedAt: number; offset: number };

const metadataQueue: Array<() => Promise<void>> = [];
let mediaImportQueue: Promise<void> = Promise.resolve();
let metadataPump: Promise<void> | null = null;

function startMetadataPump() {
  if (metadataPump) return;
  metadataPump = (async () => {
    while (metadataQueue.length) {
      const batch = metadataQueue.splice(0, 4);
      await Promise.allSettled(batch.map((job) => job()));
    }
  })().finally(() => {
    metadataPump = null;
    if (metadataQueue.length) startMetadataPump();
  });
}

function enqueueMetadata(task: () => Promise<void>) {
  metadataQueue.push(task);
  startMetadataPump();
}

export function Player() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const wantPlay = useRef(false);
  const pendingSeek = useRef<number | null>(null);
  const counted = useRef(false);
  const lastResumeSave = useRef(0);
  const errorStreak = useRef(0);
  const pushedHistory = useRef(0);
  const engineStarted = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const thumbBusy = useRef(false);
  const comicBusy = useRef(false);
  const rescanStarted = useRef(false);
  const returnScreen = useRef<Screen>("library");
  const codecAudioRef = useRef<CodecAudioState | null>(null);
  const codecFallbackBusy = useRef<string | null>(null);
  const codecFallbackAttempted = useRef(new Set<string>());
  const videoAudioProbeTimer = useRef<number | undefined>(undefined);
  const codecTickTimer = useRef<number | undefined>(undefined);

  const [loaded, setLoaded] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [queue, setQueue] = usePref<string[]>("queue", []);
  const [qIndex, setQIndex] = usePref("qIndex", 0);
  const [originalQueue, setOriginalQueue] = usePref<string[] | null>("originalQueue", null);
  const [queueSource, setQueueSource] = usePref("queueSource", "");
  const [shuffle, setShuffle] = usePref("shuffle", false);
  const [repeat, setRepeat] = usePref<RepeatMode>("repeat", "off");
  const [volume, setVolume] = usePref("volume", 1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = usePref("speed", 1);
  const [preservePitch, setPreservePitch] = usePref("preservePitch", true);
  const [eq, setEq] = usePref<EqSettings>("eq", { enabled: false, preset: "Flat", bands: EQ_PRESETS.Flat, preamp: 0 });
  const [customPresets, setCustomPresets] = usePref<Record<string, number[]>>("customPresets", {});
  const [balance, setBalance] = usePref("balance", 0);
  const [boost, setBoost] = usePref("boost", 1);
  const [skipSeconds, setSkipSeconds] = usePref("skipSeconds", 10);
  const [resumePosition, setResumePosition] = usePref("resumePosition", true);
  const [videoFit, setVideoFit] = usePref<VideoFit>("videoFit", "contain");
  const [subtitleSize, setSubtitleSize] = usePref("subtitleSize", 100);
  const [showRemaining, setShowRemaining] = usePref("showRemaining", false);
  const [accent, setAccent] = usePref("accent", "Neon Red");
  const [songSort, setSongSort] = usePref<SongSort>("songSort", "title");
  const [favoritesList, setFavoritesList] = usePref<string[]>("favorites", []);
  const [videoProgress, setVideoProgress] = usePref<Record<string, number>>("videoProgress", {});
  const [comics, setComics] = useState<Comic[]>([]);
  const [comicProgress, setComicProgress] = usePref<Record<string, ComicProgress>>("comicProgress", {});
  const [readerSettings, setReaderSettings] = usePref<ReaderSettings>("readerSettings", DEFAULT_READER);
  const [reader, setReader] = useState<{ id: string; start: number | null } | null>(null);
  const [plays, setPlays] = usePref<Record<string, number>>("plays", {});
  const [lastPlayed, setLastPlayed] = usePref<Record<string, number>>("lastPlayed", {});
  const [playlists, setPlaylists] = usePref<Playlist[]>("playlists", []);
  const [screen, setScreen] = useState<Screen>("library");
  const [routes, setRoutes] = useState<Route[]>([{ view: "home" }]);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [sleep, setSleepState] = useState<SleepState>({ endsAt: null, endOfTrack: false });
  const [now, setNow] = useState(() => Date.now());
  const [ab, setAb] = useState<{ a: number | null; b: number | null }>({ a: null, b: null });
  const [subtitles, setSubtitles] = useState<{ url: string; name: string } | null>(null);
  const [importing, setImporting] = useState<{ done: number; total: number; label?: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [thumbTick, setThumbTick] = useState(0);

  useEffect(() => {
    if (readPref("brandSix", false)) return;
    writePref("brandSix", true);
    setAccent("Neon Red");
  }, []);

  const trackMap = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const favorites = useMemo(() => new Set(favoritesList), [favoritesList]);
  const current = trackMap.get(queue[qIndex] ?? "");
  const playbackLiveRef = useRef<{ current: Track | undefined; speed: number; ab: { a: number | null; b: number | null }; muted: boolean; volume: number; sleepFade: number }>({ current, speed, ab, muted, volume, sleepFade });
  playbackLiveRef.current = { current, speed, ab, muted, volume, sleepFade };
  const sleepRemaining = sleep.endsAt ? Math.max(0, sleep.endsAt - now) / 1000 : null;
  const sleepFade = sleepRemaining != null && sleepRemaining < 15 ? sleepRemaining / 15 : 1;

  function toast(message: string) {
    setToastMessage(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMessage(null), 2800);
  }

  function pushHistory() {
    try {
      history.pushState({ mortimer: Date.now() }, "");
      pushedHistory.current++;
    } catch {}
  }

  function handleBack() {
    if (menu) setMenu(null);
    else if (reader) setReader(null);
    else if (screen === "player" && returnScreen.current !== "player") setScreen(returnScreen.current);
    else if (screen !== "library") setScreen("library");
    else if (routes.length > 1) setRoutes((r) => r.slice(0, -1));
  }

  function stopCodecAudio() {
    window.clearInterval(codecTickTimer.current);
    codecTickTimer.current = undefined;
    const state = codecAudioRef.current;
    codecAudioRef.current = null;
    if (!state) return;
    try { state.source?.stop(); } catch {}
    state.source?.disconnect();
    state.gain.disconnect();
    void state.context.close().catch(() => {});
  }

  function finishCodecAudio(id: string) {
    const state = codecAudioRef.current;
    if (!state || state.id !== id) return;
    stopCodecAudio();
    handlers.current.onEnded();
  }

  function pauseCodecAudio() {
    const state = codecAudioRef.current;
    if (!state) return;
    const time = codecAudioTime();
    if (time != null) state.offset = time;
    state.startedAt = state.context.currentTime;
    const source = state.source;
    state.source = null;
    source?.disconnect();
    try { source?.stop(); } catch {}
    window.clearInterval(codecTickTimer.current);
    codecTickTimer.current = undefined;
    void state.context.suspend().catch(() => {});
  }

  function codecAudioTime() {
    const state = codecAudioRef.current;
    if (!state) return null;
    return Math.max(0, Math.min(state.buffer.duration, state.offset + (state.context.currentTime - state.startedAt) * playbackLiveRef.current.speed));
  }

  function startCodecAudio(offset: number) {
    const state = codecAudioRef.current;
    const el = mediaRef.current;
    if (!state || !el || state.id !== playbackLiveRef.current.current?.id) return;
    const safeOffset = Math.max(0, Math.min(offset, Math.max(0, state.buffer.duration - 0.01)));
    try { state.source?.stop(); } catch {}
    state.source?.disconnect();
    const source = state.context.createBufferSource();
    source.buffer = state.buffer;
    source.playbackRate.value = playbackLiveRef.current.speed;
    source.connect(state.gain);
    state.source = source;
    state.offset = safeOffset;
    state.startedAt = state.context.currentTime;
    void state.context.resume().catch(() => {});
    source.onended = () => {
      const live = codecAudioRef.current;
      if (live?.id === playbackLiveRef.current.current?.id && live.source === source && live.buffer.duration > 0) {
        finishCodecAudio(live.id);
      }
    };
    try { source.start(0, safeOffset); } catch {}
    window.clearInterval(codecTickTimer.current);
    codecTickTimer.current = window.setInterval(() => {
      const live = codecAudioRef.current;
      if (!live || live.id !== playbackLiveRef.current.current?.id || live.source !== source) return;
      const t = codecAudioTime();
      if (t == null) return;
      setCurrentTime(t);
      setDuration(live.buffer.duration);
      const loop = playbackLiveRef.current.ab;
      if (loop.a != null && loop.b != null && t >= loop.b) {
        startCodecAudio(loop.a);
        return;
      }
      if (t >= live.buffer.duration - 0.05) finishCodecAudio(live.id);
    }, 200);
  }

  async function activateCodecAudio(item: Track, el: HTMLMediaElement) {
    if (el !== mediaRef.current || (item.kind === "video" ? el !== videoRef.current : el !== audioRef.current)) return false;
    if (codecFallbackBusy.current === item.id) return false;
    if (codecFallbackAttempted.current.has(item.id)) return !!codecAudioRef.current;
    codecFallbackBusy.current = item.id;
    codecFallbackAttempted.current.add(item.id);
    setImporting({ done: 0, total: 100, label: item.kind === "video" ? "Decoding video audio" : "Decoding audio" });
    const originalMuted = el.muted;
    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error("Could not read the original media");
      const decoded = await decodeAudioTrack(await response.blob());
      if (playbackLiveRef.current.current?.id !== item.id || (item.kind === "video" ? videoRef.current !== el : audioRef.current !== el)) {
        void decoded.context.close().catch(() => {});
        return false;
      }
      const gain = decoded.context.createGain();
      gain.gain.value = playbackLiveRef.current.muted ? 0 : Math.max(0, Math.min(1, playbackLiveRef.current.volume * playbackLiveRef.current.sleepFade));
      gain.connect(decoded.context.destination);
      const initialOffset = Number.isFinite(el.currentTime) ? el.currentTime : 0;
      codecAudioRef.current = { ...decoded, id: item.id, source: null, gain, startedAt: decoded.context.currentTime, offset: initialOffset };
      el.muted = true;
      // Keep the original file. FFmpeg decodes the audio in memory only;
      // no replacement/transcoded media file is created.
      if (item.kind === "video") {
        if (el.error && el.getAttribute("src")) el.load();
        if (wantPlay.current) {
          try {
            await el.play();
          } catch {
            // A video codec failure cannot be fixed by an audio-only decoder.
            stopCodecAudio();
            el.muted = originalMuted;
            return false;
          }
          startCodecAudio(el.currentTime);
        } else if (!el.paused) {
          startCodecAudio(el.currentTime);
        }
      } else if (wantPlay.current) {
        startCodecAudio(initialOffset);
      }
      if (!item.duration) {
        const d = decoded.buffer.duration;
        setDuration(d);
        setTracks((old) => old.map((t) => t.id === item.id ? { ...t, duration: d } : t));
        void patchTrack(item.id, { duration: d }).catch(() => {});
      }
      toast(item.kind === "video" ? "Using the original video audio codec" : "Using the original FLAC/audio decoder");
      return true;
    } catch {
      if (codecAudioRef.current?.id === item.id) stopCodecAudio();
      el.muted = originalMuted;
      codecFallbackAttempted.current.delete(item.id);
      return false;
    } finally {
      codecFallbackBusy.current = null;
      if (playbackLiveRef.current.current?.id === item.id) setImporting(null);
    }
  }

  function startPlayback(el: HTMLMediaElement) {
    resumeEngine();
    wantPlay.current = true;
    if (codecAudioRef.current?.id === current?.id) {
      startCodecAudio(codecAudioTime() ?? el.currentTime);
      return;
    }
    void el.play().catch((error: DOMException) => {
      if (error?.name === "NotSupportedError" && current) {
        void activateCodecAudio(current, el).then((ok) => {
          if (!ok) {
            wantPlay.current = false;
            setPlaying(false);
            toast("This audio/video codec could not be decoded");
          }
        });
        return;
      }
      // Load failures surface through the element's "error" event.
      if (error?.name === "AbortError") return;
      wantPlay.current = false;
      setPlaying(false);
      if (error?.name !== "NotAllowedError") toast("This file can't be played in this browser");
    });
  }

  function saveResume() {
    const el = mediaRef.current;
    if (!current || !el) return;
    const t = codecAudioRef.current?.id === current.id ? (codecAudioTime() ?? 0) : el.currentTime;
    writePref("resume", { id: current.id, time: t });
    if (current.kind === "video" && t > 0) {
      const id = current.id;
      setVideoProgress((p) => ({ ...p, [id]: t }));
    }
  }

  function advance(step: 1 | -1, auto: boolean) {
    if (!queue.length) return;
    let i = qIndex + step;
    if (i >= queue.length) {
      if (auto && repeat === "off") {
        wantPlay.current = false;
        setPlaying(false);
        return;
      }
      i = 0;
    }
    if (i < 0) i = queue.length - 1;
    if (!auto) wantPlay.current = wantPlay.current || playing;
    const el = mediaRef.current;
    if (queue[i] === queue[qIndex] && el) {
      el.currentTime = 0;
      if (wantPlay.current) startPlayback(el);
    }
    setQIndex(i);
  }

  function playTracks(ids: string[], startId?: string, options?: { shuffle?: boolean; source?: string }) {
    if (!ids.length) return;
    stopCodecAudio();
    const useShuffle = options?.shuffle ?? shuffle;
    if (options?.shuffle !== undefined) setShuffle(options.shuffle);
    let startIdx = startId ? Math.max(0, ids.indexOf(startId)) : 0;
    let nextQueue = ids;
    if (useShuffle) {
      if (!startId) startIdx = Math.floor(Math.random() * ids.length);
      nextQueue = [ids[startIdx], ...shuffled(ids.filter((_, i) => i !== startIdx))];
      startIdx = 0;
      setOriginalQueue(ids);
    } else {
      setOriginalQueue(null);
    }
    wantPlay.current = true;
    const el = mediaRef.current;
    if (nextQueue[startIdx] === current?.id && el) {
      el.currentTime = 0;
      startPlayback(el);
    }
    setQueue(nextQueue);
    setQIndex(startIdx);
    setQueueSource(options?.source ?? "Library");
    if (trackMap.get(nextQueue[startIdx])?.kind === "video" && screen !== "player") {
      returnScreen.current = screen;
      setScreen("player");
      pushHistory();
    }
  }

  function clearQueue() {
    stopCodecAudio();
    wantPlay.current = false;
    mediaRef.current?.pause();
    setQueue([]);
    setQIndex(0);
    setOriginalQueue(null);
  }

  async function performImportEntries(entries: Incoming[], label?: string) {
    const seen = new Set([...tracks, ...comics].map((t) => trackKey(t.path, t.size, t.lastModified)));
    const isNew = ({ file, path }: Incoming) => {
      const key = trackKey(path, file.size, file.lastModified);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    const fresh = entries.filter((e) => supported(e.file.name) && isNew(e));
    const freshComics = entries.filter((e) => isComicFile(e.file.name) && isNew(e));
    const totalToAdd = fresh.length + freshComics.length;
    if (!totalToAdd) {
      toast(entries.some((e) => supported(e.file.name) || isComicFile(e.file.name)) ? "Those files are already in your library" : "No supported music, video or comic files found");
      return;
    }
    void navigator.storage?.persist?.().catch(() => false);
    const addedAt = Date.now();
    let libraryStorageOk = true;
    let comicStorageOk = true;

    let processed = 0;
    setImporting({ done: 0, total: totalToAdd, label: "Adding" });

    if (freshComics.length) {
      const comicBatchSize = 50;
      for (let start = 0; start < freshComics.length; start += comicBatchSize) {
        const end = Math.min(start + comicBatchSize, freshComics.length);
        const items: StoredComic[] = freshComics.slice(start, end).map(({ file, path }, offset) => ({
          id: crypto.randomUUID(), name: file.name, path, size: file.size, lastModified: file.lastModified,
          addedAt: addedAt + start + offset, format: comicFormatOf(file.name), shelf: defaultShelf(comicFormatOf(file.name)), file,
        }));
        let savedItems = items;
        if (comicStorageOk) {
          try { savedItems = await saveComics(items); } catch { comicStorageOk = false; }
        }
        if (savedItems.length) setComics((old) => [...old, ...savedItems.map(toComic)]);
        processed += items.length;
        setImporting({ done: processed, total: totalToAdd, label: "Adding" });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    let batch: StoredLibraryItem[] = [];
    const flush = async () => {
      const items = batch;
      batch = [];
      if (!items.length) return;
      let savedItems = items;
      if (libraryStorageOk) {
        try { savedItems = await saveLibrary(items); } catch { libraryStorageOk = false; }
      }
      if (savedItems.length) setTracks((old) => [...old, ...savedItems.map(toTrack)]);

      // Enrich audio metadata in the background. This must not delay adding
      // the actual file to the library.
      for (const item of savedItems) {
        if (item.kind !== "audio") continue;
        enqueueMetadata(async () => {
          const tags = await readTags(item.file, item.name);
          if (libraryStorageOk) await patchTrack(item.id, { ...tags, metaVersion: META_VERSION }).catch(() => {});
          setTracks((old) => {
            const live = old.find((track) => track.id === item.id);
            if (!live) return old;
            const cover = tags.cover ? URL.createObjectURL(tags.cover) : live.cover;
            if (tags.cover && live.cover) URL.revokeObjectURL(live.cover);
            return old.map((track) => (track.id === item.id ? { ...track, ...tags, cover, metaVersion: META_VERSION } : track));
          });
        });
      }
    };
    // Process files in parallel batches. Awaiting each file one by one makes
    // large libraries feel unnecessarily slow, especially when importing folders.
    let importedMedia = 0;
    let importFailures = 0;
    const importBatchSize = 50;
    for (let start = 0; start < fresh.length; start += importBatchSize) {
      const end = Math.min(start + importBatchSize, fresh.length);
      const results = await Promise.allSettled(
        fresh.slice(start, end).map((entry, offset) => readItem(entry, addedAt + start + offset)),
      );
      const items: StoredLibraryItem[] = [];
      for (const result of results) {
        if (result.status === "fulfilled") items.push(result.value);
        else importFailures++;
      }
      batch.push(...items);
      importedMedia += items.length;
      processed += results.length;
      setImporting({ done: processed, total: totalToAdd, label: "Adding" });
      await flush();
    }
    await flush();
    setImporting(null);
    const parts = [
      importedMedia ? `${importedMedia} song${importedMedia === 1 ? "" : "s"}/video${importedMedia === 1 ? "" : "s"}` : "",
      ...(["books", "comics"] as const).map((shelf) => {
        const n = freshComics.filter((e) => defaultShelf(comicFormatOf(e.file.name)) === shelf).length;
        return n ? `${n} ${shelf === "books" ? "book" : "comic"}${n === 1 ? "" : "s"}` : "";
      }),
    ].filter(Boolean);
    const what = parts.length
      ? `${parts.join(" and ")} added${label ? ` from “${label}”` : ""}`
      : "Nothing was added";
    const failureNote = importFailures
      ? ` · ${importFailures} media file${importFailures === 1 ? "" : "s"} couldn't be imported`
      : "";
    const storageNote = libraryStorageOk && comicStorageOk ? "" : ", but some items couldn't be saved for next time";
    toast(`${what}${failureNote}${storageNote}`);
  }
  function importEntries(entries: Incoming[], label?: string): Promise<void> {
    mediaImportQueue = mediaImportQueue
      .catch(() => {})
      .then(() => performImportEntries(entries, label));
    return mediaImportQueue;
  }

  async function importFolder() {
    const pickerHost = window as Window & { showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<DirectoryHandleLike> };
    if (!pickerHost.showDirectoryPicker) {
      folderInput.current?.click();
      return;
    }
    try {
      // Keep the native method bound to window. Calling the detached method can
      // fail with "Illegal invocation" in browsers that require its receiver.
      const directory = await pickerHost.showDirectoryPicker({ mode: "read" });
      const found: Incoming[] = [];
      const pending: Array<{ file: () => Promise<File>; path: string }> = [];

      const walk = async (dir: DirectoryHandleLike, prefix: string): Promise<void> => {
        for await (const entry of dir.values()) {
          const path = `${prefix}/${entry.name}`;
          if (entry.kind === "file") {
            if ((supported(entry.name) || isComicFile(entry.name)) && entry.getFile) {
              pending.push({ file: () => entry.getFile!(), path });
            }
          } else if (!entry.name.startsWith(".")) {
            await walk(entry as DirectoryHandleLike, path);
          }
        }
      };

      setImporting({ done: 0, total: 0, label: "Scanning" });
      await walk(directory, directory.name);

      // Read file handles concurrently in small batches instead of awaiting
      // getFile() one by one. This makes large folder scans much faster.
      const scanBatchSize = 50;
      for (let start = 0; start < pending.length; start += scanBatchSize) {
        const batch = pending.slice(start, start + scanBatchSize);
        const results = await Promise.allSettled(batch.map(async ({ file, path }) => ({ file: await file(), path })));
        for (const result of results) if (result.status === "fulfilled") found.push(result.value);
        setImporting({ done: Math.min(start + batch.length, pending.length), total: pending.length, label: "Scanning" });
      }

      setImporting({ done: 0, total: found.length, label: "Adding" });
      await importEntries(found, directory.name);
    } catch (error) {
      setImporting(null);
      if ((error as DOMException)?.name !== "AbortError") toast("Could not open that folder");
    }
  }

  function onPickFiles(list: FileList | null) {
    if (!list?.length) return;
    void importEntries(Array.from(list, (file) => ({ file, path: file.webkitRelativePath || file.name })));
  }

  function removeFromLibrary(ids: string[]) {
    const gone = new Set(ids);
    const currentId = queue[qIndex];
    const nextQueue = queue.filter((id) => !gone.has(id));
    if (currentId && gone.has(currentId)) {
      wantPlay.current = false;
      mediaRef.current?.pause();
      const before = queue.slice(0, qIndex).filter((id) => !gone.has(id)).length;
      setQIndex(Math.min(before, Math.max(0, nextQueue.length - 1)));
    } else {
      setQIndex(Math.max(0, nextQueue.indexOf(currentId)));
    }
    setQueue(nextQueue);
    setOriginalQueue((q) => q && q.filter((id) => !gone.has(id)));
    setTracks((old) => {
      for (const t of old) {
        if (!gone.has(t.id)) continue;
        URL.revokeObjectURL(t.url);
        if (t.cover) URL.revokeObjectURL(t.cover);
      }
      return old.filter((t) => !gone.has(t.id));
    });
    setPlaylists((p) => p.map((pl) => ({ ...pl, trackIds: pl.trackIds.filter((id) => !gone.has(id)) })));
    setFavoritesList((f) => f.filter((id) => !gone.has(id)));
    void deleteTracks(ids).catch(() => toast("Couldn't update local storage"));
    toast(`${ids.length} item${ids.length === 1 ? "" : "s"} removed from library`);
  }

  const impl: Actions = {
    playTracks,
    togglePlay() {
      const el = mediaRef.current;
      if (!current || !el) {
        if (tracks.length) playTracks([...tracks].sort((a, b) => compareText(a.title, b.title)).map((t) => t.id), undefined, { source: "All songs" });
        return;
      }
      if (codecAudioRef.current?.id === current.id) {
        if (wantPlay.current) {
          wantPlay.current = false;
          stopCodecAudio();
          setPlaying(false);
        } else {
          startPlayback(el);
        }
      } else if (el.paused) startPlayback(el);
      else {
        wantPlay.current = false;
        el.pause();
      }
    },
    next: () => advance(1, false),
    prev() {
      const el = mediaRef.current;
      const codecTime = codecAudioRef.current?.id === current?.id ? codecAudioTime() : null;
      if (codecTime != null) {
        if (codecTime > 3) startCodecAudio(0);
        else advance(-1, false);
      } else if (el && el.currentTime > 3) el.currentTime = 0;
      else advance(-1, false);
    },
    seek(time) {
      const el = mediaRef.current;
      if (!el || !Number.isFinite(time)) return;
      const codec = codecAudioRef.current?.id === current?.id ? codecAudioRef.current : null;
      if (codec) {
        startCodecAudio(Math.max(0, Math.min(time, codec.buffer.duration)));
        setCurrentTime(Math.max(0, Math.min(time, codec.buffer.duration)));
        return;
      }
      el.currentTime = Math.max(0, Math.min(time, el.duration || time));
      setCurrentTime(el.currentTime);
    },
    seekBy(delta) {
      const el = mediaRef.current;
      if (el) impl.seek((codecAudioTime() ?? el.currentTime) + delta);
    },
    jump(index) {
      if (index < 0 || index >= queue.length) return;
      wantPlay.current = true;
      const el = mediaRef.current;
      if (index === qIndex && el) {
        el.currentTime = 0;
        startPlayback(el);
      }
      setQIndex(index);
    },
    playNext(ids) {
      if (!queue.length) return playTracks(ids);
      setQueue((q) => [...q.slice(0, qIndex + 1), ...ids, ...q.slice(qIndex + 1)]);
      setOriginalQueue((q) => q && [...q, ...ids]);
      toast(ids.length === 1 ? "Will play next" : `${ids.length} tracks will play next`);
    },
    addToQueue(ids) {
      if (!queue.length) return playTracks(ids);
      setQueue((q) => [...q, ...ids]);
      setOriginalQueue((q) => q && [...q, ...ids]);
      toast(ids.length === 1 ? "Added to queue" : `${ids.length} tracks added to queue`);
    },
    removeFromQueue(index) {
      const nextQueue = queue.filter((_, i) => i !== index);
      if (!nextQueue.length) return clearQueue();
      if (index === qIndex) {
        wantPlay.current = wantPlay.current && playing;
        setQIndex(Math.min(index, nextQueue.length - 1));
      } else if (index < qIndex) {
        setQIndex(qIndex - 1);
      }
      setQueue(nextQueue);
    },
    moveInQueue(from, to) {
      if (to < 0 || to >= queue.length || from === to) return;
      const nextQueue = [...queue];
      const [item] = nextQueue.splice(from, 1);
      nextQueue.splice(to, 0, item);
      setQueue(nextQueue);
      if (from === qIndex) setQIndex(to);
      else if (from < qIndex && to >= qIndex) setQIndex(qIndex - 1);
      else if (from > qIndex && to <= qIndex) setQIndex(qIndex + 1);
    },
    clearQueue,
    toggleShuffle() {
      const currentId = queue[qIndex];
      if (!shuffle) {
        if (queue.length > 1) {
          setOriginalQueue(queue);
          setQueue([currentId, ...shuffled(queue.filter((_, i) => i !== qIndex))]);
          setQIndex(0);
        }
        setShuffle(true);
        toast("Shuffle on");
        return;
      }
      if (originalQueue) {
        const remaining = new Set(queue);
        const base = originalQueue.filter((id) => remaining.has(id));
        const baseSet = new Set(base);
        const restored = [...base, ...queue.filter((id) => !baseSet.has(id))];
        setQueue(restored);
        setQIndex(Math.max(0, restored.indexOf(currentId)));
      }
      setOriginalQueue(null);
      setShuffle(false);
      toast("Shuffle off");
    },
    cycleRepeat() {
      const nextMode: RepeatMode = repeat === "off" ? "all" : repeat === "all" ? "one" : "off";
      setRepeat(nextMode);
      toast(nextMode === "off" ? "Repeat off" : nextMode === "all" ? "Repeat queue" : "Repeat current track");
    },
    setVolume(v) {
      setMuted(false);
      setVolume(Math.max(0, Math.min(1, v)));
    },
    toggleMute: () => setMuted((m) => !m),
    setSpeed: (s) => setSpeed(Math.max(0.25, Math.min(4, s))),
    setPreservePitch,
    setEq,
    setBalance,
    setBoost,
    setSkipSeconds,
    setResumePosition,
    setVideoFit,
    setSubtitleSize,
    setShowRemaining,
    setAccent,
    setSongSort,
    setCustomPresets,
    toggleFavorite(ids, force) {
      const add = force ?? !ids.every((id) => favorites.has(id));
      setFavoritesList((list) => (add ? Array.from(new Set([...list, ...ids])) : list.filter((id) => !ids.includes(id))));
      if (ids.length > 1) toast(add ? `${ids.length} tracks added to favorites` : `${ids.length} tracks removed from favorites`);
    },
    createPlaylist(name, ids = []) {
      const id = crypto.randomUUID();
      setPlaylists((p) => [...p, { id, name, trackIds: ids, createdAt: Date.now() }]);
      toast(`Playlist “${name}” created`);
      return id;
    },
    addToPlaylist(playlistId, ids) {
      const playlist = playlists.find((p) => p.id === playlistId);
      setPlaylists((p) => p.map((pl) => (pl.id === playlistId ? { ...pl, trackIds: [...pl.trackIds, ...ids] } : pl)));
      if (playlist) toast(`Added to “${playlist.name}”`);
    },
    removeFromPlaylist(playlistId, index) {
      setPlaylists((p) => p.map((pl) => (pl.id === playlistId ? { ...pl, trackIds: pl.trackIds.filter((_, i) => i !== index) } : pl)));
    },
    movePlaylistItem(playlistId, from, to) {
      setPlaylists((p) => p.map((pl) => {
        if (pl.id !== playlistId || to < 0 || to >= pl.trackIds.length) return pl;
        const ids = [...pl.trackIds];
        const [item] = ids.splice(from, 1);
        ids.splice(to, 0, item);
        return { ...pl, trackIds: ids };
      }));
    },
    renamePlaylist(playlistId, name) {
      setPlaylists((p) => p.map((pl) => (pl.id === playlistId ? { ...pl, name } : pl)));
    },
    deletePlaylist(playlistId) {
      setPlaylists((p) => p.filter((pl) => pl.id !== playlistId));
      setRoutes((r) => r.filter((route) => !(route.view === "playlist" && route.id === playlistId)));
      toast("Playlist deleted");
    },
    removeFromLibrary,
    clearLibrary() {
      void (async () => {
        try {
          await clearStoredLibrary();
        } catch {
          toast("Couldn't clear local storage");
          return;
        }
        clearQueue();
        setTracks((old) => {
          for (const t of old) {
            URL.revokeObjectURL(t.url);
            if (t.cover) URL.revokeObjectURL(t.cover);
          }
          return [];
        });
        setComics((old) => {
          for (const c of old) if (c.cover) URL.revokeObjectURL(c.cover);
          return [];
        });
        setPlaylists((p) => p.map((pl) => ({ ...pl, trackIds: [] })));
        setFavoritesList([]);
        setPlays({});
        setLastPlayed({});
        setVideoProgress({});
        setComicProgress({});
        writePref("resume", null);
        setSleepState({ endsAt: null, endOfTrack: false });
        setAb({ a: null, b: null });
        setRoutes([{ view: "home" }]);
        toast("Library cleared");
      })();
    },
    importFolder: () => void importFolder(),
    importFiles: () => fileInput.current?.click(),
    setSleep(minutes) {
      if (minutes === null) {
        setSleepState({ endsAt: null, endOfTrack: false });
        toast("Sleep timer off");
      } else if (minutes === "track") {
        setSleepState({ endsAt: null, endOfTrack: true });
        toast("Playback will stop after this track");
      } else {
        setNow(Date.now());
        setSleepState({ endsAt: Date.now() + minutes * 60_000, endOfTrack: false });
        toast(`Sleep timer: ${minutes} min`);
      }
    },
    cycleAB() {
      const t = codecAudioRef.current?.id === current?.id
        ? (codecAudioTime() ?? 0)
        : (mediaRef.current?.currentTime ?? 0);
      if (ab.a == null) {
        setAb({ a: t, b: null });
        toast("Loop start (A) set");
      } else if (ab.b == null) {
        if (t <= ab.a + 0.5) return toast("Point B must be after point A");
        setAb({ a: ab.a, b: t });
        toast("A-B loop on");
      } else {
        setAb({ a: null, b: null });
        toast("A-B loop off");
      }
    },
    loadSubtitles(file) {
      void file.text().then((text) => {
        const url = URL.createObjectURL(new Blob([srtToVtt(text)], { type: "text/vtt" }));
        setSubtitles((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { url, name: file.name };
        });
        toast(`Subtitles: ${file.name}`);
      }).catch(() => toast("Couldn't read that subtitle file"));
    },
    install() {
      if (!installEvent) return;
      void installEvent.prompt().finally(() => setInstallEvent(null));
    },
    toast,
    openComic(id, options) {
      setReader({ id, start: options?.fromStart ? 0 : null });
      pushHistory();
    },
    closeComic() {
      if (pushedHistory.current > 0) history.back();
      else setReader(null);
    },
    setComicProgress(id, progress) {
      setComicProgress((p) => {
        const copy = { ...p };
        if (progress) copy[id] = progress;
        else delete copy[id];
        return copy;
      });
    },
    setReaderSettings,
    setComicShelf(id, shelf) {
      setComics((old) => old.map((c) => (c.id === id ? { ...c, shelf } : c)));
      void patchComic(id, { shelf }).catch(() => {});
      toast(shelf === "books" ? "Moved to Books" : "Moved to Comics");
    },
    removeComics(ids) {
      const gone = new Set(ids);
      setComics((old) => {
        for (const c of old) if (gone.has(c.id) && c.cover) URL.revokeObjectURL(c.cover);
        return old.filter((c) => !gone.has(c.id));
      });
      setComicProgress((p) => Object.fromEntries(Object.entries(p).filter(([id]) => !gone.has(id))));
      if (reader && gone.has(reader.id)) setReader(null);
      void deleteComics(ids).catch(() => toast("Couldn't update local storage"));
      toast(`${ids.length} comic${ids.length === 1 ? "" : "s"} removed`);
    },
    openMenu(target) {
      setMenu(target);
      pushHistory();
    },
    goTo(target) {
      if (target === screen) {
        if (target === "library") setRoutes([{ view: "home" }]);
        return;
      }
      if (target === "player") returnScreen.current = screen;
      setScreen(target);
      if (target !== "library") pushHistory();
    },
    navigate(route) {
      setScreen("library");
      setMenu(null);
      setRoutes((r) => [...r, route]);
      pushHistory();
    },
    back() {
      if (pushedHistory.current > 0) history.back();
      else handleBack();
    },
  };

  const implRef = useRef(impl);
  implRef.current = impl;
  const [actions] = useState(() => {
    const stable = {} as Record<string, (...args: unknown[]) => unknown>;
    for (const key of Object.keys(impl)) stable[key] = (...args) => (implRef.current as unknown as Record<string, (...a: unknown[]) => unknown>)[key](...args);
    return stable as unknown as Actions;
  });

  const handlers = useRef({ onTime: (_el: HTMLMediaElement) => {}, onMeta: (_el: HTMLMediaElement) => {}, onEnded: () => {}, onError: () => {}, onPause: () => {}, onBack: () => {} });
  handlers.current = {
    onTime(el) {
      const t = codecAudioRef.current?.id === current?.id ? (codecAudioTime() ?? 0) : el.currentTime;
      setCurrentTime(t);
      if (codecAudioRef.current?.id === current?.id && ab.a != null && ab.b != null && t >= ab.b) {
        startCodecAudio(ab.a);
        return;
      }
      if (ab.a != null && ab.b != null && t >= ab.b) el.currentTime = ab.a;
      const codec = codecAudioRef.current;
      const d = codec && codec.id === current?.id
        ? codec.buffer.duration
        : el.duration;
      if (current && !counted.current && t >= Math.min(30, Number.isFinite(d) && d > 0 ? d * 0.5 : 30)) {
        counted.current = true;
        const id = current.id;
        setPlays((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
        setLastPlayed((p) => ({ ...p, [id]: Date.now() }));
      }
      if (Date.now() - lastResumeSave.current > 4000) {
        lastResumeSave.current = Date.now();
        saveResume();
      }
      if ("mediaSession" in navigator && Number.isFinite(d) && d > 0) {
        try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: codecAudioRef.current?.id === current?.id ? speed : el.playbackRate, position: Math.min(t, d) }); } catch {}
      }
    },
    onMeta(el) {
      const d = el.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      setDuration(d);
      if (pendingSeek.current != null) {
        el.currentTime = Math.min(pendingSeek.current, Math.max(0, d - 1));
        pendingSeek.current = null;
      }
      if (current && !current.duration) {
        const id = current.id;
        setTracks((old) => old.map((t) => (t.id === id ? { ...t, duration: d } : t)));
        void patchTrack(id, { duration: d }).catch(() => {});
      }
      errorStreak.current = 0;
    },
    onEnded() {
      const el = mediaRef.current;
      if (current?.kind === "video" && el) {
        const id = current.id;
        const d = el.duration;
        setVideoProgress((p) => ({ ...p, [id]: Number.isFinite(d) ? d : p[id] ?? 0 }));
      }
      if (sleep.endOfTrack) {
        setSleepState({ endsAt: null, endOfTrack: false });
        wantPlay.current = false;
        toast("Sleep timer: playback stopped");
        return;
      }
      if (repeat === "one" && el) {
        el.currentTime = 0;
        startPlayback(el);
        return;
      }
      wantPlay.current = true;
      advance(1, true);
    },
    onError() {
      const el = mediaRef.current;
      if (!current || !el) return;
      const code = el.error?.code;
      if ((code === MediaError.MEDIA_ERR_DECODE || code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) && !codecFallbackAttempted.current.has(current.id)) {
        void activateCodecAudio(current, el).then((ok) => {
          if (!ok) {
            wantPlay.current = false;
            setPlaying(false);
            toast("This audio/video codec could not be decoded");
          }
        });
        return;
      }
      const reason = code === MediaError.MEDIA_ERR_ABORTED
        ? "playback was aborted"
        : code === MediaError.MEDIA_ERR_NETWORK
          ? "a network/read error occurred"
          : code === MediaError.MEDIA_ERR_DECODE
            ? "the video or its audio track could not be decoded"
            : code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
              ? "the video or its audio format is not supported"
              : "the media could not be played";
      setPlaying(false);
      toast(`Can't play “${current.title}” — ${reason}`);
      if (wantPlay.current && queue.length > 1 && errorStreak.current < Math.min(5, queue.length - 1)) {
        errorStreak.current++;
        window.setTimeout(() => actions.next(), 900);
      } else {
        wantPlay.current = false;
      }
    },
    onPause: saveResume,
    onBack: handleBack,
  };

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;
    const onEvent = (event: Event) => {
      const el = event.currentTarget as HTMLMediaElement;
      if (el !== mediaRef.current) return;
      switch (event.type) {
        case "play": {
          setPlaying(true);
          resumeEngine();
          const liveTrack = playbackLiveRef.current.current;
          if (codecAudioRef.current?.id === liveTrack?.id) startCodecAudio(codecAudioTime() ?? el.currentTime);
          if (el === video && liveTrack?.kind === "video" && !codecAudioRef.current && !codecFallbackAttempted.current.has(liveTrack.id)) {
            window.clearTimeout(videoAudioProbeTimer.current);
            const item = liveTrack;
            videoAudioProbeTimer.current = window.setTimeout(() => {
              const live = playbackLiveRef.current.current;
              if (live?.id !== item.id || mediaRef.current !== video || video.paused) return;
              const decodedBytes = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount;
              const suspiciousName = /\\.(mkv|mka|avi|ts|m2ts|mts|vob|wmv|asf|flv|f4v|rmvb|rm)$/i.test(item.name)
                || /\\b(?:ac3|e[ ._-]?ac3|ddp|dd\\+|dts|truehd|dolby)\\b/i.test(item.name);
              if (decodedBytes === 0 || (decodedBytes == null && suspiciousName)) void activateCodecAudio(item, video);
            }, 1400);
          }
          break;
        }
        case "pause":
          if (codecAudioRef.current?.id === playbackLiveRef.current.current?.id) pauseCodecAudio();
          setPlaying(false);
          handlers.current.onPause();
          break;
        case "timeupdate":
          if (el === video && codecAudioRef.current?.id === playbackLiveRef.current.current?.id) {
            const state = codecAudioRef.current;
            if (state) {
              const expected = state.offset + (state.context.currentTime - state.startedAt) * playbackLiveRef.current.speed;
              if (Math.abs(expected - video.currentTime) > 0.18) startCodecAudio(video.currentTime);
            }
          }
          handlers.current.onTime(el);
          break;
        case "loadedmetadata":
        case "durationchange": handlers.current.onMeta(el); break;
        case "ended":
          if (codecAudioRef.current?.id === playbackLiveRef.current.current?.id) stopCodecAudio();
          handlers.current.onEnded();
          break;
        case "error": handlers.current.onError(); break;
      }
    };
    for (const el of [audio, video]) for (const type of MEDIA_EVENTS) el.addEventListener(type, onEvent);
    return () => { for (const el of [audio, video]) for (const type of MEDIA_EVENTS) el.removeEventListener(type, onEvent); };
  }, []);

  useEffect(() => () => {
    window.clearTimeout(videoAudioProbeTimer.current);
    stopCodecAudio();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreMusic = loadLibrary().then((stored) => {
      if (cancelled) return;
      const uniqueStored = new Map<string, StoredLibraryItem>();
      const duplicateIds: string[] = [];
      const repaired: StoredLibraryItem[] = [];
      for (const item of stored) {
        const key = trackKey(item.path, item.size, item.lastModified);
        const previous = uniqueStored.get(key);
        if (!previous) {
          uniqueStored.set(key, item);
          continue;
        }
        const keep = (item.addedAt ?? 0) < (previous.addedAt ?? 0) ? item : previous;
        const drop = keep.id === item.id ? previous : item;
        const merged: StoredLibraryItem = {
          ...keep,
          title: keep.title || drop.title,
          artist: keep.artist || drop.artist,
          album: keep.album || drop.album,
          albumArtist: keep.albumArtist || drop.albumArtist,
          genre: keep.genre || drop.genre,
          year: keep.year ?? drop.year,
          trackNo: keep.trackNo ?? drop.trackNo,
          duration: keep.duration ?? drop.duration,
          metaVersion: Math.max(keep.metaVersion ?? 0, drop.metaVersion ?? 0),
          cover: keep.cover ?? drop.cover,
        };
        uniqueStored.set(key, merged);
        duplicateIds.push(drop.id);
        if (merged.cover !== keep.cover || merged.metaVersion !== keep.metaVersion || merged.title !== keep.title ||
            merged.artist !== keep.artist || merged.album !== keep.album || merged.albumArtist !== keep.albumArtist ||
            merged.genre !== keep.genre || merged.year !== keep.year || merged.trackNo !== keep.trackNo || merged.duration !== keep.duration) repaired.push(merged);
      }
      if (duplicateIds.length) void deleteTracks(duplicateIds).catch(() => {});
      if (repaired.length) void Promise.all(repaired.map((item) => {
        const { id, file: _file, ...patch } = item;
        return patchTrack(id, patch).catch(() => {});
      }));
      const restored = [...uniqueStored.values()].map(toTrack).sort((a, b) => a.addedAt - b.addedAt);
      const ids = new Set(restored.map((t) => t.id));
      const savedQueue = readPref<string[]>("queue", []);
      const savedIndex = readPref("qIndex", 0);
      const currentId = savedQueue[savedIndex];
      const kept = savedQueue.filter((id) => ids.has(id));
      const index = Math.max(0, kept.indexOf(currentId));
      const resume = readPref<{ id: string; time: number } | null>("resume", null);
      if (readPref("resumePosition", true) && resume && resume.id === kept[index]) pendingSeek.current = resume.time;
      setTracks(restored);
      setQueue(kept);
      setQIndex(index);
    }).catch(() => {
      if (!cancelled) toast("Local music storage is unavailable in this browser");
    });
    const restoreBooks = loadComics().then((stored) => {
      const uniqueStored = new Map<string, StoredComic>();
      const duplicateIds: string[] = [];
      const repaired: StoredComic[] = [];
      for (const item of stored) {
        const key = trackKey(item.path, item.size, item.lastModified);
        const previous = uniqueStored.get(key);
        if (!previous) {
          uniqueStored.set(key, item);
          continue;
        }
        const keep = item.addedAt < previous.addedAt ? item : previous;
        const drop = keep.id === item.id ? previous : item;
        const merged: StoredComic = {
          ...keep,
          title: keep.title || drop.title,
          author: keep.author || drop.author,
          pages: keep.pages ?? drop.pages,
          shelf: keep.shelf ?? drop.shelf,
          locations: keep.locations ?? drop.locations,
          cover: keep.cover ?? drop.cover,
        };
        uniqueStored.set(key, merged);
        duplicateIds.push(drop.id);
        if (merged.cover !== keep.cover || merged.title !== keep.title || merged.author !== keep.author ||
            merged.pages !== keep.pages || merged.shelf !== keep.shelf || merged.locations !== keep.locations) repaired.push(merged);
      }
      if (duplicateIds.length) void deleteComics(duplicateIds).catch(() => {});
      if (repaired.length) void Promise.all(repaired.map((item) => {
        const { id, file: _file, ...patch } = item;
        return patchComic(id, patch).catch(() => {});
      }));
      if (!cancelled) setComics([...uniqueStored.values()].map(toComic).sort((a, b) => a.addedAt - b.addedAt));
    }).catch(() => {
      if (!cancelled) toast("Local books and comics storage is unavailable in this browser");
    });
    Promise.allSettled([restoreMusic, restoreBooks]).finally(() => {
      if (!cancelled) setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;
    if (!audio || !video) return;
    const el = current?.kind === "video" ? video : audio;
    const other = el === audio ? video : audio;
    mediaRef.current = el;
    if (!other.paused) other.pause();
    if (other.getAttribute("src")) {
      other.removeAttribute("src");
      other.load();
    }
    counted.current = false;
    setAb({ a: null, b: null });
    setSubtitles((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
    if (!current) {
      if (el.getAttribute("src")) {
        el.removeAttribute("src");
        el.load();
      }
      setPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    stopCodecAudio();
    window.clearTimeout(videoAudioProbeTimer.current);
    video.muted = false;
    const watched = videoProgress[current.id];
    if (current.kind === "video" && resumePosition && pendingSeek.current == null && watched > 5 && (!current.duration || watched < current.duration - 5)) {
      pendingSeek.current = watched;
      toast(`Resuming at ${formatTime(watched)}`);
    }
    setCurrentTime(pendingSeek.current ?? 0);
    setDuration(current.duration ?? 0);
    // Always load the original media URL. Mortimer never transcodes user files.
    el.src = current.url;
    el.defaultPlaybackRate = speed;
    el.playbackRate = speed;
    el.preservesPitch = preservePitch;
    el.load();
    if (wantPlay.current) startPlayback(el);
  }, [current?.id]);

  useEffect(() => {
    for (const el of [audioRef.current, videoRef.current]) {
      if (!el) continue;
      el.defaultPlaybackRate = speed;
      el.playbackRate = speed;
      el.preservesPitch = preservePitch;
    }
    const state = codecAudioRef.current;
    if (state?.source) state.source.playbackRate.value = speed;
  }, [speed, preservePitch]);

  useEffect(() => {
    for (const el of [audioRef.current, videoRef.current]) if (el) el.volume = muted ? 0 : Math.max(0, Math.min(1, volume * sleepFade));
    const state = codecAudioRef.current;
    if (state) state.gain.gain.value = muted ? 0 : Math.max(0, Math.min(1, volume * sleepFade));
  }, [volume, muted, sleepFade]);

  useEffect(() => {
    const needed = eq.enabled || balance !== 0 || boost !== 1;
    if (!needed && !engineStarted.current) return;
    if (!engineStarted.current) {
      if (!initEngine()) return;
      engineStarted.current = true;
      attachElement(audioRef.current);
      attachElement(videoRef.current);
    }
    applyAudio({ enabled: eq.enabled, bands: eq.bands, preamp: eq.preamp, balance, boost });
  }, [eq, balance, boost]);

  useEffect(() => {
    if (screen === "player" || thumbBusy.current) return;
    const next = tracks.find((t) => t.kind === "video" && !t.cover && !thumbAttempted.has(t.id));
    if (!next) return;
    thumbAttempted.add(next.id);
    thumbBusy.current = true;
    void captureVideoFrame(next.url).then(({ image, duration: d }) => {
      thumbBusy.current = false;
      const newDuration = !next.duration && d ? d : undefined;
      setTracks((old) => {
        const live = old.find((t) => t.id === next.id);
        if (!live) return old;
        const cover = image ? URL.createObjectURL(image) : undefined;
        if (cover && live.cover) URL.revokeObjectURL(live.cover);
        if (cover || newDuration) {
          void patchTrack(next.id, { ...(image ? { cover: image } : {}), ...(newDuration ? { duration: newDuration } : {}) }).catch(() => {});
        }
        return cover || newDuration ? old.map((t) => (t.id === next.id ? { ...t, cover: cover ?? t.cover, duration: t.duration ?? newDuration } : t)) : old;
      });
      setThumbTick((n) => n + 1);
    }).catch(() => {
      thumbBusy.current = false;
      setThumbTick((n) => n + 1);
    });
  }, [tracks, screen, thumbTick]);

  useEffect(() => {
    if ((screen !== "comics" && screen !== "books") || reader || comicBusy.current) return;
    const next = comics.find((c) => (!c.cover || (!c.pages && c.format !== "epub")) && !comicCoverAttempted.has(c.id));
    if (!next) return;
    comicCoverAttempted.add(next.id);
    comicBusy.current = true;
    void (async () => {
      let pages: number | undefined;
      let image: Blob | null = null;
      let info: { title?: string; author?: string } = {};
      try {
        if (next.format === "epub") {
          const epub = await readEpubInfo(next.file);
          info = { title: epub.title, author: epub.author };
          if (epub.cover) image = await makeThumbnail(epub.cover, 360);
        } else if (next.format === "cbz" || next.format === "cbr" || next.format === "pdf") {
          const source = await openComic(next.file, undefined, { firstPageOnly: true });
          try {
            pages = source.pages;
            if (!next.cover) image = await makeThumbnail(await source.getPage(0), 360);
          } finally {
            source.close();
          }
        }
      } catch {}
      comicBusy.current = false;
      if (pages || image || info.title || info.author) {
        setComics((old) => {
          const live = old.find((c) => c.id === next.id);
          if (!live) return old;
          const cover = image ? URL.createObjectURL(image) : undefined;
          if (cover && live.cover) URL.revokeObjectURL(live.cover);
          void patchComic(next.id, Object.fromEntries(Object.entries({ cover: image ?? undefined, pages, title: info.title, author: info.author }).filter(([, v]) => v !== undefined))).catch(() => {});
          return old.map((c) => (c.id === next.id ? { ...c, cover: cover ?? c.cover, pages: pages ?? c.pages, title: info.title ?? c.title, author: info.author ?? c.author } : c));
        });
      }
      setThumbTick((n) => n + 1);
    })();
  }, [comics, screen, reader, thumbTick]);


  useEffect(() => {
    if (!loaded || rescanStarted.current) return;
    const stale = tracks.filter((t) => t.kind === "audio" && t.metaVersion < META_VERSION);
    if (!stale.length) return;
    rescanStarted.current = true;
    void (async () => {
      let improved = 0;
      for (let i = 0; i < stale.length; i++) {
        const track = stale[i];
        setImporting({ done: i, total: stale.length, label: "Reading tags and covers" });
        try {
          const tags = await readTags(await (await fetch(track.url)).blob(), track.name);
          const patch = Object.fromEntries(Object.entries({ ...tags, metaVersion: META_VERSION }).filter(([, v]) => v !== undefined));
          await patchTrack(track.id, patch).catch(() => {});
          const cover = tags.cover ? URL.createObjectURL(tags.cover) : undefined;
          setTracks((old) => old.map((t) => {
            if (t.id !== track.id) return t;
            if (cover && t.cover) URL.revokeObjectURL(t.cover);
            return {
              ...t,
              title: tags.title || t.title,
              artist: tags.artist ?? t.artist,
              album: tags.album ?? t.album,
              albumArtist: tags.albumArtist ?? t.albumArtist,
              genre: tags.genre ?? t.genre,
              year: tags.year ?? t.year,
              trackNo: tags.trackNo ?? t.trackNo,
              duration: tags.duration ?? t.duration,
              cover: cover ?? t.cover,
              metaVersion: META_VERSION,
            };
          }));
          if (tags.artist || tags.album || tags.cover) improved++;
        } catch {}
      }
      setImporting(null);
      if (improved) toast(`Updated tags and covers for ${improved} song${improved === 1 ? "" : "s"}`);
    })();
  }, [loaded, tracks]);

  useEffect(() => {
    if (!sleep.endsAt) return;
    const endsAt = sleep.endsAt;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      if (t < endsAt) return;
      wantPlay.current = false;
      mediaRef.current?.pause();
      setSleepState({ endsAt: null, endOfTrack: false });
      toast("Sleep timer: playback stopped");
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [sleep.endsAt]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = current
      ? new MediaMetadata({
          title: current.title,
          artist: current.artist || current.album,
          album: current.album,
          artwork: current.cover ? [{ src: current.cover, sizes: "512x512" }] : [{ src: "/Mortimer-player/icon-512.png", sizes: "512x512", type: "image/png" }],
        })
      : null;
  }, [current?.id, current?.cover]);

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : current ? "paused" : "none";
  }, [playing, current?.id]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
    };
    set("play", () => { if (mediaRef.current?.paused) actions.togglePlay(); });
    set("pause", () => { if (!mediaRef.current?.paused) actions.togglePlay(); });
    set("stop", () => { if (!mediaRef.current?.paused) actions.togglePlay(); });
    set("previoustrack", () => actions.prev());
    set("nexttrack", () => actions.next());
    set("seekbackward", (d) => actions.seekBy(-(d.seekOffset ?? readPref("skipSeconds", 10))));
    set("seekforward", (d) => actions.seekBy(d.seekOffset ?? readPref("skipSeconds", 10)));
    set("seekto", (d) => { if (d.seekTime != null) actions.seek(d.seekTime); });
  }, [actions]);

  useEffect(() => {
    if (!(playing && current?.kind === "video") || !navigator.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    navigator.wakeLock.request("screen").then((s) => {
      if (cancelled) void s.release();
      else sentinel = s;
    }).catch(() => {});
    return () => {
      cancelled = true;
      void sentinel?.release().catch(() => {});
    };
  }, [playing, current?.kind]);

  useEffect(() => {
    const onBeforeInstall = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      setInstallEvent(event);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      toast("App installed");
    };
    const onPop = () => {
      if (pushedHistory.current > 0) pushedHistory.current--;
      handlers.current.onBack();
    };
    const onHide = () => handlers.current.onPause();
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("popstate", onPop);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      // Space/Enter on a focused control must activate that control, not toggle playback.
      if ((event.key === " " || event.key === "Enter") && target?.closest("button, a, summary, [role=button], [role=switch]")) return;
      const skip = readPref("skipSeconds", 10);
      const handled: Record<string, () => void> = {
        " ": () => actions.togglePlay(),
        k: () => actions.togglePlay(),
        ArrowRight: () => actions.seekBy(skip),
        ArrowLeft: () => actions.seekBy(-skip),
        l: () => actions.seekBy(skip),
        j: () => actions.seekBy(-skip),
        ArrowUp: () => actions.setVolume(readPref("volume", 1) + 0.05),
        ArrowDown: () => actions.setVolume(readPref("volume", 1) - 0.05),
        n: () => actions.next(),
        p: () => actions.prev(),
        m: () => actions.toggleMute(),
        s: () => actions.toggleShuffle(),
        r: () => actions.cycleRepeat(),
        "[": () => actions.setSpeed(Math.round((readPref("speed", 1) - 0.1) * 100) / 100),
        "]": () => actions.setSpeed(Math.round((readPref("speed", 1) + 0.1) * 100) / 100),
        "=": () => actions.setSpeed(1),
        f: () => {
          const video = videoRef.current;
          if (document.fullscreenElement) void document.exitFullscreen();
          else if (video?.getAttribute("src")) void video.requestFullscreen?.().catch(() => {});
        },
      };
      const run = handled[event.key];
      if (!run) return;
      event.preventDefault();
      run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [actions]);

  const state: PlayerState = useMemo(() => ({
    loaded, tracks, trackMap, queue, qIndex, queueSource, current, playing, shuffle, repeat, volume, muted, speed, preservePitch,
    eq, customPresets, balance, boost, skipSeconds, resumePosition, videoFit, subtitleSize, showRemaining, accent, songSort,
    favorites, videoProgress, comics, comicProgress, readerSettings, readerId: reader?.id ?? null, readerStart: reader?.start ?? null,
    plays, lastPlayed, playlists, screen, routes, sleep, sleepRemaining: sleepRemaining == null ? null : Math.ceil(sleepRemaining),
    ab, subtitles, importing, canInstall: !!installEvent, videoRef, actions,
  }), [loaded, tracks, trackMap, queue, qIndex, queueSource, current, playing, shuffle, repeat, volume, muted, speed, preservePitch,
    eq, customPresets, balance, boost, skipSeconds, resumePosition, videoFit, subtitleSize, showRemaining, accent, songSort,
    favorites, videoProgress, comics, comicProgress, readerSettings, reader, plays, lastPlayed, playlists, screen, routes, sleep, sleepRemaining == null ? null : Math.ceil(sleepRemaining),
    ab, subtitles, importing, installEvent, actions]);

  const progress = useMemo(() => ({ currentTime, duration }), [currentTime, duration]);
  const accentColor = ACCENTS[accent] ?? ACCENTS.Coral;

  return (
    <PlayerContext.Provider value={state}>
      <ProgressContext.Provider value={progress}>
        <div className={`shell screen-${screen}${current ? " hasCurrent" : ""}${screen === "player" && current?.kind === "video" ? " immersive" : ""}`} style={{ "--accent": accentColor } as CSSProperties}>
          <aside className="sidebar">
            <div className="brand">
              <img className="logo" src={`${import.meta.env.BASE_URL}logo.png`} alt="Home" />
            </div>
            <nav>
              {NAV.map(([id, label, , Icon]) => (
                <button key={id} className={screen === id ? "active" : ""} onClick={() => actions.goTo(id)}>
                  <Icon size={19} /><span>{label}</span>
                  {id === "queue" && queue.length > 0 && <em>{queue.length}</em>}
                </button>
              ))}
            </nav>
            <div className="sidebarActions">
              <button onClick={actions.importFolder}><FolderOpen size={17} /> Add folder</button>
              <button onClick={actions.importFiles}><FilePlus size={17} /> Add files</button>
              {installEvent && <button className="accent" onClick={actions.install}><Download size={17} /> Install app</button>}
            </div>
          </aside>

          <main className="main">
            <Library active={screen === "library"} />
            <NowPlaying active={screen === "player"} />
            {screen === "videos" && <Videos />}
            {screen === "books" && <Comics shelfOverride="books" />}
            {screen === "comics" && <Comics shelfOverride="comics" />}
            {screen === "queue" && <Queue />}
            {screen === "eq" && <Equalizer />}
            {screen === "settings" && <Settings />}
          </main>

          <MiniPlayer />

          <nav className="tabbar">
            {NAV.filter((n) => n[4]).map(([id, , short, Icon]) => (
              <button key={id} className={screen === id ? "active" : ""} onClick={() => actions.goTo(id)}>
                <Icon size={21} /><span>{short}</span>
                {id === "queue" && queue.length > 0 && <em>{queue.length > 99 ? "99+" : queue.length}</em>}
              </button>
            ))}
          </nav>

          {reader && (() => { const item = comics.find((c) => c.id === reader.id); return item?.format === "epub" ? <EpubReader key={reader.id} /> : item && isTextFormat(item.format) ? <TextReader key={reader.id} /> : <ComicReader key={reader.id} />; })()}
          {menu && <TrackMenu target={menu} onClose={() => actions.back()} />}
          {importing && (
            <div className="importBar" role="status">
              <span>{importing.total ? `${importing.label ?? "Importing"} ${importing.done} of ${importing.total}…` : `Scanning folder… ${importing.done} files found`}</span>
              <i style={{ width: importing.total ? `${(importing.done / importing.total) * 100}%` : "15%" }} />
            </div>
          )}
          {toastMessage && <div className="toast" role="status">{toastMessage}</div>}

          <audio ref={audioRef} preload="auto" />
          <input ref={fileInput} hidden type="file" multiple
            accept="audio/*,video/*,text/*,.flac,.aac,.ogg,.oga,.opus,.weba,.aiff,.aif,.alac,.wma,.mka,.mp2,.mpa,.ac3,.eac3,.dts,.amr,.ape,.tak,.tta,.mpc,.wv,.shn,.caf,.au,.snd,.ra,.rm,.rma,.mp4,.webm,.ogv,.mov,.m4v,.mkv,.avi,.3gp,.3g2,.ts,.m2ts,.mts,.m2v,.mpg,.mpeg,.mpeg2,.vob,.wmv,.asf,.flv,.f4v,.rmvb,.rm,.dv,.tod,.mod,.vro,.nut,.ogm,.mxf,.divx,.cbz,.cbr,.pdf,.epub,.txt,.md,.markdown,.log,.nfo,.csv,.tsv,.json,.xml,.yaml,.yml,.toml,.ini,.cfg,.conf,.srt,.vtt,.ass,.ssa,.sub,.html,.htm,.rtf,.docx,.odt,application/pdf,application/epub+zip,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text"
            onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
          <input ref={folderInput} hidden type="file" multiple onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)} />
        </div>
      </ProgressContext.Provider>
    </PlayerContext.Provider>
  );
}