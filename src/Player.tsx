import { useEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { Disc3, Download, FilePlus, FolderOpen, Library as LibraryIcon, ListMusic, Settings as SettingsIcon, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { applyAudio, attachElement, EQ_PRESETS, initEngine, resumeEngine } from "./audioEngine";
import { PlayerContext, ProgressContext, type Actions, type MenuTarget, type PlayerState, type SleepState } from "./context";
import { clearLibrary as clearStoredLibrary, deleteTracks, loadLibrary, patchTrack, saveLibrary, type StoredLibraryItem } from "./library";
import { readItem, type Incoming } from "./metadata";
import { readPref, usePref, writePref } from "./prefs";
import type { EqSettings, Playlist, RepeatMode, Route, Screen, SongSort, Track, VideoFit } from "./types";
import { ACCENTS, compareText, shuffled, srtToVtt, supported, toTrack, trackKey } from "./util";
import { MiniPlayer, TrackMenu } from "./components";
import { Library } from "./screens/Library";
import { NowPlaying } from "./screens/NowPlaying";
import { Queue } from "./screens/Queue";
import { Equalizer } from "./screens/Equalizer";
import { Settings } from "./screens/Settings";

const NAV: Array<[Screen, string, LucideIcon]> = [
  ["library", "Library", LibraryIcon],
  ["player", "Playing", Disc3],
  ["queue", "Queue", ListMusic],
  ["eq", "Equalizer", SlidersHorizontal],
  ["settings", "Settings", SettingsIcon],
];

type DirectoryEntry = { kind: "file" | "directory"; name: string; getFile?: () => Promise<File>; values?: () => AsyncIterable<DirectoryEntry> };
type DirectoryHandleLike = { name: string; values: () => AsyncIterable<DirectoryEntry> };

const MEDIA_EVENTS = ["play", "pause", "timeupdate", "loadedmetadata", "durationchange", "ended", "error"] as const;

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
  const [accent, setAccent] = usePref("accent", "Coral");
  const [songSort, setSongSort] = usePref<SongSort>("songSort", "title");
  const [favoritesList, setFavoritesList] = usePref<string[]>("favorites", []);
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
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  const trackMap = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const favorites = useMemo(() => new Set(favoritesList), [favoritesList]);
  const current = trackMap.get(queue[qIndex] ?? "");
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
    else if (screen !== "library") setScreen("library");
    else if (routes.length > 1) setRoutes((r) => r.slice(0, -1));
  }

  function startPlayback(el: HTMLMediaElement) {
    resumeEngine();
    wantPlay.current = true;
    void el.play().catch((error: DOMException) => {
      // Load failures surface through the element's "error" event, which handles skipping.
      if (error?.name === "AbortError" || error?.name === "NotSupportedError") return;
      wantPlay.current = false;
      setPlaying(false);
      if (error?.name !== "NotAllowedError") toast("This file can't be played in this browser");
    });
  }

  function saveResume() {
    const el = mediaRef.current;
    if (current && el) writePref("resume", { id: current.id, time: el.currentTime });
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
      setScreen("player");
      pushHistory();
    }
  }

  function clearQueue() {
    wantPlay.current = false;
    mediaRef.current?.pause();
    setQueue([]);
    setQIndex(0);
    setOriginalQueue(null);
  }

  async function importEntries(entries: Incoming[], label?: string) {
    const seen = new Set(tracks.map((t) => trackKey(t.path, t.size, t.lastModified)));
    const fresh = entries.filter(({ file, path }) => {
      if (!supported(file.name)) return false;
      const key = trackKey(path, file.size, file.lastModified);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!fresh.length) {
      toast(entries.some((e) => supported(e.file.name)) ? "Those files are already in your library" : "No supported audio or video files found");
      return;
    }
    void navigator.storage?.persist?.().catch(() => false);
    setImporting({ done: 0, total: fresh.length });
    const addedAt = Date.now();
    let batch: StoredLibraryItem[] = [];
    let storageOk = true;
    const flush = async () => {
      const items = batch;
      batch = [];
      if (!items.length) return;
      if (storageOk) {
        try { await saveLibrary(items); } catch { storageOk = false; }
      }
      setTracks((old) => [...old, ...items.map(toTrack)]);
    };
    for (let i = 0; i < fresh.length; i++) {
      batch.push(await readItem(fresh[i], addedAt + i));
      setImporting({ done: i + 1, total: fresh.length });
      if (batch.length >= 20) await flush();
    }
    await flush();
    setImporting(null);
    const what = `${fresh.length} file${fresh.length === 1 ? "" : "s"} added${label ? ` from “${label}”` : ""}`;
    toast(storageOk ? what : `${what}, but they couldn't be saved for next time`);
  }

  async function importFolder() {
    const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: "read" }) => Promise<DirectoryHandleLike> }).showDirectoryPicker;
    if (!picker) {
      folderInput.current?.click();
      return;
    }
    try {
      const directory = await picker({ mode: "read" });
      const found: Incoming[] = [];
      const walk = async (dir: DirectoryHandleLike, prefix: string): Promise<void> => {
        for await (const entry of dir.values()) {
          const path = `${prefix}/${entry.name}`;
          if (entry.kind === "file") {
            if (supported(entry.name) && entry.getFile) found.push({ file: await entry.getFile(), path });
          } else if (!entry.name.startsWith(".")) {
            await walk(entry as DirectoryHandleLike, path);
          }
        }
      };
      setImporting({ done: 0, total: 0 });
      await walk(directory, directory.name);
      setImporting(null);
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
      if (el.paused) startPlayback(el);
      else {
        wantPlay.current = false;
        el.pause();
      }
    },
    next: () => advance(1, false),
    prev() {
      const el = mediaRef.current;
      if (el && el.currentTime > 3) el.currentTime = 0;
      else advance(-1, false);
    },
    seek(time) {
      const el = mediaRef.current;
      if (!el || !Number.isFinite(time)) return;
      el.currentTime = Math.max(0, Math.min(time, el.duration || time));
      setCurrentTime(el.currentTime);
    },
    seekBy(delta) {
      const el = mediaRef.current;
      if (el) impl.seek(el.currentTime + delta);
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
      clearQueue();
      setTracks((old) => {
        for (const t of old) {
          URL.revokeObjectURL(t.url);
          if (t.cover) URL.revokeObjectURL(t.cover);
        }
        return [];
      });
      setPlaylists((p) => p.map((pl) => ({ ...pl, trackIds: [] })));
      setFavoritesList([]);
      setPlays({});
      setLastPlayed({});
      setRoutes([{ view: "home" }]);
      void clearStoredLibrary().catch(() => toast("Couldn't clear local storage"));
      toast("Library cleared");
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
      const t = mediaRef.current?.currentTime ?? 0;
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
    openMenu(target) {
      setMenu(target);
      pushHistory();
    },
    goTo(target) {
      if (target === screen) {
        if (target === "library") setRoutes([{ view: "home" }]);
        return;
      }
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
      const t = el.currentTime;
      setCurrentTime(t);
      if (ab.a != null && ab.b != null && t >= ab.b) el.currentTime = ab.a;
      const d = el.duration;
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
        try { navigator.mediaSession.setPositionState({ duration: d, playbackRate: el.playbackRate, position: Math.min(t, d) }); } catch {}
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
      if (!current) return;
      setPlaying(false);
      toast(`Can't play “${current.title}” — format not supported by this browser`);
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
        case "play": setPlaying(true); resumeEngine(); break;
        case "pause": setPlaying(false); handlers.current.onPause(); break;
        case "timeupdate": handlers.current.onTime(el); break;
        case "loadedmetadata":
        case "durationchange": handlers.current.onMeta(el); break;
        case "ended": handlers.current.onEnded(); break;
        case "error": handlers.current.onError(); break;
      }
    };
    for (const el of [audio, video]) for (const type of MEDIA_EVENTS) el.addEventListener(type, onEvent);
    return () => { for (const el of [audio, video]) for (const type of MEDIA_EVENTS) el.removeEventListener(type, onEvent); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadLibrary().then((stored) => {
      if (cancelled) return;
      const restored = stored.map(toTrack).sort((a, b) => a.addedAt - b.addedAt);
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
      setLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      setLoaded(true);
      toast("Local library storage is unavailable in this browser");
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
    setCurrentTime(pendingSeek.current ?? 0);
    setDuration(current.duration ?? 0);
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
  }, [speed, preservePitch]);

  useEffect(() => {
    for (const el of [audioRef.current, videoRef.current]) if (el) el.volume = muted ? 0 : Math.max(0, Math.min(1, volume * sleepFade));
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
          artist: current.artist || "Mortimer Player",
          album: current.album,
          artwork: current.cover ? [{ src: current.cover, sizes: "512x512" }] : [{ src: "/Mortimer-player/icon-512.svg", sizes: "512x512", type: "image/svg+xml" }],
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
      toast("Mortimer Player installed");
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
    favorites, plays, lastPlayed, playlists, screen, routes, sleep, sleepRemaining: sleepRemaining == null ? null : Math.ceil(sleepRemaining),
    ab, subtitles, importing, canInstall: !!installEvent, videoRef, actions,
  }), [loaded, tracks, trackMap, queue, qIndex, queueSource, current, playing, shuffle, repeat, volume, muted, speed, preservePitch,
    eq, customPresets, balance, boost, skipSeconds, resumePosition, videoFit, subtitleSize, showRemaining, accent, songSort,
    favorites, plays, lastPlayed, playlists, screen, routes, sleep, sleepRemaining == null ? null : Math.ceil(sleepRemaining),
    ab, subtitles, importing, installEvent, actions]);

  const progress = useMemo(() => ({ currentTime, duration }), [currentTime, duration]);
  const accentColor = ACCENTS[accent] ?? ACCENTS.Coral;

  return (
    <PlayerContext.Provider value={state}>
      <ProgressContext.Provider value={progress}>
        <div className={`shell screen-${screen}${current ? " hasCurrent" : ""}`} style={{ "--accent": accentColor } as CSSProperties}>
          <aside className="sidebar">
            <div className="brand">
              <div className="logo"><Disc3 size={20} /></div>
              <div><b>Mortimer</b><span>PLAYER</span></div>
            </div>
            <nav>
              {NAV.map(([id, label, Icon]) => (
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
            {screen === "queue" && <Queue />}
            {screen === "eq" && <Equalizer />}
            {screen === "settings" && <Settings />}
          </main>

          <MiniPlayer />

          <nav className="tabbar">
            {NAV.map(([id, label, Icon]) => (
              <button key={id} className={screen === id ? "active" : ""} onClick={() => actions.goTo(id)}>
                <Icon size={21} /><span>{label}</span>
                {id === "queue" && queue.length > 0 && <em>{queue.length > 99 ? "99+" : queue.length}</em>}
              </button>
            ))}
          </nav>

          {menu && <TrackMenu target={menu} onClose={() => actions.back()} />}
          {importing && (
            <div className="importBar" role="status">
              <span>{importing.total ? `Importing ${importing.done} of ${importing.total}…` : "Scanning folder…"}</span>
              <i style={{ width: importing.total ? `${(importing.done / importing.total) * 100}%` : "15%" }} />
            </div>
          )}
          {toastMessage && <div className="toast" role="status">{toastMessage}</div>}

          <audio ref={audioRef} preload="auto" />
          <input ref={fileInput} hidden type="file" multiple accept="audio/*,video/*,.flac,.mkv,.avi,.mov,.aac,.opus,.m4a,.wma" onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} />
          <input ref={folderInput} hidden type="file" multiple onChange={(e) => { onPickFiles(e.target.files); e.currentTarget.value = ""; }} {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)} />
        </div>
      </ProgressContext.Provider>
    </PlayerContext.Provider>
  );
}
