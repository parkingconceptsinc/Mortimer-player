import { useEffect, useMemo, useRef, useState, type CSSProperties, type InputHTMLAttributes } from "react";
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
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadLibrary();
        if (cancelled || !stored.length) return;
        const restored: Item[] = stored.map((x) => ({
          id: x.id, name: x.name, url: URL.createObjectURL(x.file), kind: x.kind,
          size: x.size, path: x.path, artist: x.artist, album: x.album, genre: x.genre,
          cover: x.cover ? URL.createObjectURL(x.cover) : "",
        }));
        if (!cancelled) {
          setItems(restored);
          setStatus(`${restored.length} tracks restored from your library`);
        }
      } catch {
        setLibraryPersistent(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

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
    if (!files.length) {
      setStatus("No supported audio/video files found");
      return;
    }

    const added: Item[] = [];
    const stored: StoredLibraryItem[] = [];
    let parseBlob: ((file: Blob) => Promise<any>) | undefined;
    if (files.some((file) => kindOf(file.name) === "audio")) {
      try {
        ({ parseBlob } = await import("music-metadata-browser"));
      } catch {
        setStatus("Metadata reader unavailable; files can still be played");
      }
    }
    for (const file of files) {
      let artist = "", album = "", genre = "", coverUrl = "";
      let coverBlob: Blob | undefined;
      if (kindOf(file.name) === "audio") {
        try {
          const meta = parseBlob ? await parseBlob(file) : null;
          artist = meta?.common.artist || "";
          album = meta?.common.album || "";
          genre = meta?.common.genre?.[0] || "";
          const picture = meta?.common.picture?.[0];
          if (picture) {
            coverBlob = new Blob([picture.data], { type: picture.format });
            coverUrl = URL.createObjectURL(coverBlob);
          }
        } catch {}
      }
      const id = crypto.randomUUID();
      const fileUrl = URL.createObjectURL(file);
      added.push({ id, name: file.name, url: fileUrl, kind: kindOf(file.name), size: file.size, path: file.name, artist, album, genre, cover: coverUrl });
      stored.push({ id, name: file.name, kind: kindOf(file.name), path: file.name, size: file.size, lastModified: file.lastModified, file, artist, album, genre, cover: coverBlob });
    }
    try {
      await saveLibrary(stored);
      setLibraryPersistent(true);
    } catch {
      setLibraryPersistent(false);
      setStatus("Files added, but local library storage is unavailable");
    }
    setItems((old) => [...old, ...added]);
    setStatus(`${added.length} media file${added.length === 1 ? "" : "s"} added and saved locally`);
  }

  async function openFolder() {
    type DirectoryEntry = {
      kind: "file" | "directory";
      name: string;
      getFile?: () => Promise<File>;
      values?: () => AsyncIterable<DirectoryEntry>;
    };
    type DirectoryHandleLike = {
      name: string;
      values: () => AsyncIterable<DirectoryEntry>;
    };
    const picker = (window as Window & {
      showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<DirectoryHandleLike>;
    }).showDirectoryPicker;

    if (!picker) {
      folderInput.current?.click();
      setStatus("Choose your music folder");
      return;
    }

    try {
      const directory = await picker({ mode: "read" });
      const found: File[] = [];

      async function walk(
        dir: DirectoryHandleLike,
        prefix = ""
      ): Promise<void> {
        for await (const entry of dir.values()) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.kind === "file") {
            const file = await entry.getFile!();
            if (supported(file.name)) {
              found.push(new File([file], file.name, { type: file.type, lastModified: file.lastModified }));
            }
          } else {
            await walk(entry as DirectoryHandleLike, path);
          }
        }
      }

      await walk(directory);
      await addFiles(found);
      setStatus(found.length ? `${found.length} media files found in “${directory.name}”` : "No supported media in that folder");
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") {
        setStatus("Could not open that folder");
      }
    }
  }

  function goNext() {
    if (!items.length) return;
    setIndex((i) => (shuffle ? Math.floor(Math.random() * items.length) : (i + 1) % items.length));
  }

  function goPrev() {
    if (!items.length) return;
    const m = media.current;
    if (m && m.currentTime > 3) {
      m.currentTime = 0;
      return;
    }
    setIndex((i) => (i - 1 + items.length) % items.length);
  }

  function togglePlayback() {
    if (!media.current || !current) return;
    if (playing) {
      media.current.pause();
    } else {
      void media.current.play().catch(() => {
        setStatus("The browser cannot play this format");
        setPlaying(false);
      });
    }
  }

  function removeCurrent() {
    if (!current) return;
    URL.revokeObjectURL(current.url);
    setItems((old) => old.filter((_, i) => i !== index));
    setIndex((old) => Math.min(old, Math.max(0, items.length - 2)));
  }

  function clearQueue() {
    items.forEach((item) => URL.revokeObjectURL(item.url));
    setItems([]);
    setIndex(0);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    void clearStoredLibrary().catch(() => setLibraryPersistent(false));
    setStatus("Queue and local library cleared");
  }

  return (
    <main className="app">
      <header>
        <div className="brand">
          <div className="logo"><Play size={18} fill="currentColor" /></div>
          <div><b>Mortimer</b><span>PLAYER</span></div>
        </div>
        <div className="headerActions">
          {installEvent && <button className="open install" onClick={installApp}>Install</button>}
          <button className="open" onClick={openFolder}><FolderOpen size={18} /> Music folder</button>
          <button className="open secondary" onClick={() => fileInput.current?.click()}>Open files</button>
          <input
            ref={fileInput}
            hidden
            type="file"
            multiple
            accept="audio/*,video/*,.flac,.mkv,.avi,.mov,.aac,.opus"
            onChange={(e) => {
              addFiles(e.target.files ?? []);
              e.currentTarget.value = "";
            }}
          />
          <input ref={folderInput} hidden type="file" multiple accept="audio/*,video/*,.flac,.mkv,.avi,.mov,.aac,.opus" onChange={(e) => { addFiles(e.target.files ?? []); e.currentTarget.value = ""; }} {...({ webkitdirectory: "" } as InputHTMLAttributes<HTMLInputElement>)} />
        </div>
      </header>

      <section className={"stage " + (current?.kind === "audio" && playing ? "audioPlaying" : "")}>
        {current?.kind === "video" ? (
          <video ref={(node) => { media.current = node; }} src={current.url} playsInline onError={() => { setPlaying(false); setStatus("This video format is not supported by your browser"); }} />
        ) : (
          <div className="art">
            {current?.cover ? <img className="cover" src={current.cover} alt="" /> : <div className="disc"><Music2 size={54} /></div>}
            <div className="wave" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</div>
            <strong>{current?.name || "Mortimer Player"}</strong>
            <small>{current ? [current.artist, current.album].filter(Boolean).join(" • ") || "Ready to play" : status}</small>
          </div>
        )}
        {current?.kind === "audio" && <audio ref={(node) => { media.current = node; }} src={current.url} preload="metadata" onError={() => { setPlaying(false); setStatus("This audio format is not supported by your browser"); }} />}
      </section>

      <section className="now">
        <div>
          <span>NOW PLAYING</span>
          <h1>{current?.name || "Nothing selected"}</h1>
          <p>{current ? [current.artist, current.album].filter(Boolean).join(" • ") || current.kind.toUpperCase() : status}</p>
        </div>
        <button onClick={removeCurrent} disabled={!current} aria-label="Remove current"><Trash2 size={18} /></button>
      </section>

      <div className="progress">
        <span>{format(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          step="0.1"
          value={Math.min(currentTime, duration || 0)}
          disabled={!current || !duration}
          onChange={(e) => {
            if (media.current) {
              media.current.currentTime = Number(e.target.value);
              setCurrentTime(Number(e.target.value));
            }
          }}
        />
        <span>{format(duration)}</span>
      </div>

      <nav className="controls">
        <button className={shuffle ? "active" : ""} onClick={() => setShuffle((x) => !x)} aria-label="Shuffle"><Shuffle /></button>
        <button onClick={goPrev} aria-label="Previous"><SkipBack /></button>
        <button className="play" onClick={togglePlayback} disabled={!current} aria-label="Play or pause">
          {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </button>
        <button onClick={goNext} aria-label="Next"><SkipForward /></button>
        <button className={repeat ? "active" : ""} onClick={() => setRepeat((x) => !x)} aria-label="Repeat"><Repeat /></button>
      </nav>

      <div className="bottom">
        <div className="volume">
          <button onClick={() => setMuted((x) => !x)} aria-label="Mute">
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={muted ? 0 : volume}
            onChange={(e) => { setMuted(false); setVolume(Number(e.target.value)); }}
          />
        </div>
        {current && (
          <button onClick={() => {
            const element = media.current as HTMLVideoElement | HTMLAudioElement | null;
            if (element?.requestFullscreen) void element.requestFullscreen();
            else if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen();
          }} aria-label="Fullscreen"><Maximize /></button>
        )}
        <button onClick={clearQueue} disabled={!items.length} aria-label="Clear queue"><RotateCcw /></button>
      </div>

      <div className="mobileStatus">{status}</div>
      <nav className="mobileNav">
        <button className={!showQueue ? "active" : ""} onClick={() => setShowQueue(false)}><Music2/><span>Player</span></button>
        <button className={showQueue ? "active" : ""} onClick={() => setShowQueue(true)}><FolderOpen/><span>Queue</span><b>{items.length}</b></button>
        <button className={showQueue ? "active" : ""} onClick={() => { setLibraryTab("artists"); setShowQueue(true); }}><Music2/><span>Library</span></button>
      </nav>
      <section className={"queue " + (showQueue ? "mobileOpen" : "")}>
        <div className="libraryHead"><div className="queueTitle"><b>LIBRARY</b><span>{items.length} tracks</span></div><input className="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search music" /><div className="tabs"><button className={libraryTab === "songs" ? "active" : ""} onClick={() => setLibraryTab("songs")}>Songs</button><button className={libraryTab === "artists" ? "active" : ""} onClick={() => setLibraryTab("artists")}>Artists</button><button className={libraryTab === "albums" ? "active" : ""} onClick={() => setLibraryTab("albums")}>Albums</button></div></div>
        {!items.length && <div className="empty">{status}</div>}
        {libraryTab !== "songs" && groups.map((group) => <button className="row" key={group} onClick={() => { setSearch(group === "Unknown" ? "" : group); setLibraryTab("songs"); }}><span><Music2/></span><div><b>{group}</b><small>{libraryTab === "artists" ? "Artist" : "Album"}</small></div></button>)}
        {libraryTab === "songs" && filtered.map((item) => { const i = items.indexOf(item); return (
          <button className={"row " + (i === index ? "selected" : "")} key={item.id} onClick={() => setIndex(i)}>
            <span>{item.kind === "video" ? <Film /> : <Music2 />}</span>
            <div><b>{item.name}</b><small>{[item.artist, item.album, item.kind].filter(Boolean).join(" • ")}</small></div>
          </button>
        ); })}
      </section>
    </main>
  );
}

function format(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  return Math.floor(seconds / 60) + ":" + String(Math.floor(seconds % 60)).padStart(2, "0");
}
