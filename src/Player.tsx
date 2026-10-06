import { useEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
import { loadLibrary, saveLibrary, clearLibrary as clearStoredLibrary, type StoredLibraryItem } from "./library";
import { loadLibrary, saveLibrary, clearLibrary as clearStoredLibrary, type StoredLibraryItem } from "./library";
import {
  FolderOpen,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  RotateCcw,
  Shuffle,
  Repeat,
  Music2,
  Film,
  Trash2,
} from "lucide-react";

type Item = {
  id: string;
  name: string;
  url: string;
  kind: "audio" | "video";
  size: number;
  path?: string;
  artist?: string;
  album?: string;
  genre?: string;
  cover?: string;
};

const audioExt = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|weba|aiff|aif|alac)$/i;
const videoExt = /\.(mp4|webm|ogv|mov|m4v|mkv|avi)$/i;

function supported(fileName: string) {
  return audioExt.test(fileName) || videoExt.test(fileName);
}

function kindOf(fileName: string): "audio" | "video" {
  return videoExt.test(fileName) ? "video" : "audio";
}

export function Player() {
  const media = useRef<HTMLMediaElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("Choose your music folder");
  const [libraryTab, setLibraryTab] = useState<"songs" | "artists" | "albums">("songs");
  const [search, setSearch] = useState("");
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [libraryMode, setLibraryMode] = useState<"songs" | "artists" | "albums">("songs");
  const [libraryPersistent, setLibraryPersistent] = useState(true);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  const current = items[index];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((x) => [x.name, x.artist, x.album, x.genre].some((v) => v?.toLowerCase().includes(q))) : items;
  }, [items, search]);
  const groups = useMemo(() => {
    const key = libraryTab === "artists" ? "artist" : "album";
    return Array.from(new Set(items.map((x) => x[key] || "Unknown"))).sort();
  }, [items, libraryTab]);

  useEffect(() => {
    const onBeforeInstall = (event: Event) => { event.preventDefault(); setInstallEvent(event as BeforeInstallPromptEvent); };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  useEffect(() => {
    const syncWakeLock = async () => {
      if (playing && "wakeLock" in navigator) {
        try { wakeLock.current = await navigator.wakeLock.request("screen"); } catch {}
      } else if (wakeLock.current) {
        try { await wakeLock.current.release(); } catch {}
        wakeLock.current = null;
      }
    };
    void syncWakeLock();
    return () => { if (wakeLock.current) void wakeLock.current.release(); };
  }, [playing]);

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  }

  useEffect(() => {
    const m = media.current;
    if (!m) return;

    const update = () => {
      setCurrentTime(m.currentTime || 0);
      setDuration(Number.isFinite(m.duration) ? m.duration : 0);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => {
      if (repeat) {
        m.currentTime = 0;
        void m.play().catch(() => setPlaying(false));
      } else {
        goNext();
      }
    };

    m.addEventListener("timeupdate", update);
    m.addEventListener("loadedmetadata", update);
    m.addEventListener("durationchange", update);
    m.addEventListener("play", onPlay);
    m.addEventListener("pause", onPause);
    m.addEventListener("ended", onEnded);
    return () => {
      m.removeEventListener("timeupdate", update);
      m.removeEventListener("loadedmetadata", update);
      m.removeEventListener("durationchange", update);
      m.removeEventListener("play", onPlay);
      m.removeEventListener("pause", onPause);
      m.removeEventListener("ended", onEnded);
    };
  }, [repeat, shuffle, items.length, index]);

  useEffect(() => {
    const m = media.current;
    if (!current || !m) return;
    setCurrentTime(0);
    setDuration(0);
    m.load();
    if (playing) void m.play().catch(() => setPlaying(false));
  }, [current]);

  useEffect(() => {
    if (media.current) {
      media.current.volume = muted ? 0 : volume;
    }
  }, [volume, muted]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !current) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: current.name,
      artist: "Mortimer Player",
    });

    const handlers: Array<[MediaSessionAction, () => void]> = [
      ["play", () => void media.current?.play()],
      ["pause", () => media.current?.pause()],
      ["previoustrack", goPrev],
      ["nexttrack", goNext],
    ];

    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some browsers do not expose every Media Session action.
      }
    }
  }, [current]);

  async function addFiles(list: FileList | File[]) {
    const files = Array.from(list).filter((file) => supported(file.name));
    if (!files.length) { setStatus("No supported audio/video files found"); return; }

    const added: Item[] = [];
    const stored: StoredLibraryItem[] = [];
    let parseBlob: ((file: Blob) => Promise<any>) | undefined;
    if (files.some((file) => kindOf(file.name) === "audio")) {
      try { ({ parseBlob } = await import("music-metadata-browser")); } catch { setStatus("Metadata reader unavailable; files can still be played"); }
    }
    for (const file of files) {
      let artist = "", album = "", genre = "", cover = "";
      let coverBlob: Blob | undefined;
      if (kindOf(file.name) === "audio") {
        try {
          const meta = parseBlob ? await parseBlob(file) : null;
          artist = meta?.common.artist || ""; album = meta?.common.album || ""; genre = meta?.common.genre?.[0] || "";
          const picture = meta?.common.picture?.[0];
          if (picture) { coverBlob = new Blob([picture.data], { type: picture.format }); cover = URL.createObjectURL(coverBlob); }
        } catch {}
      }
      const id = crypto.randomUUID();
      added.push({ id, name: file.name, url: URL.createObjectURL(file), kind: kindOf(file.name), size: file.size, path: file.name, artist, album, genre, cover });
      stored.push({ id, name: file.name, kind: kindOf(file.name), path: file.name, size: file.size, lastModified: file.lastModified, file, artist, album, genre, cover: coverBlob });
    }
    await saveLibrary(stored);
    setItems((old) => [...old, ...added]);
    setStatus(`${added.length} media file${added.length === 1 ? "" : "s"} added and saved locally`);
  }

