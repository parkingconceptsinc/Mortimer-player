import type { SongSort, Track } from "./types";
import type { StoredLibraryItem } from "./library";

export const audioExt = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|weba|aiff|aif|alac|wma|mka|mp2|mpa|ac3|eac3|dts|amr|ape|tak|tta|mpc|wv|shn|caf|au|snd|ra|rm|rma)$/i;
export const videoExt = /\.(mp4|webm|ogv|mov|m4v|mkv|avi|3gp|3g2|ts|m2ts|mts|m2v|mpg|mpeg|mpeg2|vob|wmv|asf|flv|f4v|rmvb|rm|dv|tod|mod|vro|nut|ogm|mxf|divx)$/i;

export const supported = (name: string) => audioExt.test(name) || videoExt.test(name);
export const kindOf = (name: string): "audio" | "video" => (videoExt.test(name) ? "video" : "audio");

// Some browsers are stricter with Blob URLs when the stored Blob has an empty
// or generic MIME type. Give the media element an explicit browser MIME type.
export function mediaMime(name: string, kind: "audio" | "video") {
  const ext = name.split(".").pop()?.toLowerCase();
  const types: Record<string, string> = {
    mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac",
    flac: "audio/flac", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg",
    weba: "audio/webm", aiff: "audio/aiff", aif: "audio/aiff", alac: "audio/mp4",
    mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", ogv: "video/ogg", mov: "video/quicktime",
  };
  return types[ext ?? ""] ?? (kind === "video" ? "video/*" : "audio/*");
}
export const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
export const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export function formatTime(seconds?: number) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function formatTotal(seconds: number) {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}

export function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function shuffled<T>(list: T[]) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export const ACCENTS: Record<string, string> = {
  "Neon Red": "#ff2d3a",
  "Neon Blue": "#3ea6ff",
  Coral: "#ff7849",
  Amber: "#ffb020",
  Lime: "#a3e635",
  Teal: "#2dd4bf",
  Blue: "#4f9dff",
  Violet: "#8b7bff",
  Rose: "#ff5c8a",
  Mono: "#f4f4f6",
};

export const UNKNOWN_ARTIST = "Unknown Artist";
export const UNKNOWN_ALBUM = "Unknown Album";
export const UNKNOWN_GENRE = "Unknown Genre";

export const artistOf = (t: Track) => t.artist || UNKNOWN_ARTIST;
export const albumOf = (t: Track) => t.album || UNKNOWN_ALBUM;
export const genreOf = (t: Track) => t.genre || UNKNOWN_GENRE;
// Album artist if tagged, otherwise the folder: keeps compilations together without merging same-named albums.
export const albumKey = (t: Track) => `${albumOf(t)}\u0000${t.albumArtist || t.folder}`;

export const trackKey = (path: string, size: number, lastModified: number) => `${path}|${size}|${lastModified}`;

export function toTrack(x: StoredLibraryItem): Track {
  return {
    id: x.id,
    name: x.name,
    title: x.title || stripExt(x.name),
    artist: x.artist || "",
    album: x.album || "",
    albumArtist: x.albumArtist || "",
    genre: x.genre || "",
    year: x.year,
    trackNo: x.trackNo,
    duration: x.duration,
    kind: x.kind,
    size: x.size,
    lastModified: x.lastModified,
    path: x.path,
    folder: folderOf(x.path),
    addedAt: x.addedAt ?? x.lastModified,
    metaVersion: x.metaVersion ?? 0,
    url: URL.createObjectURL(x.file.type ? x.file : new Blob([x.file], { type: mediaMime(x.name, x.kind) })),
    cover: x.cover ? URL.createObjectURL(x.cover) : undefined,
  };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const compareText = (a: string, b: string) => collator.compare(a, b);

export function sortTracks(list: Track[], sort: SongSort, plays: Record<string, number>) {
  const copy = [...list];
  switch (sort) {
    case "artist":
      return copy.sort((a, b) => compareText(artistOf(a), artistOf(b)) || compareText(albumOf(a), albumOf(b)) || (a.trackNo ?? 0) - (b.trackNo ?? 0));
    case "album":
      return copy.sort((a, b) => compareText(albumOf(a), albumOf(b)) || (a.trackNo ?? 0) - (b.trackNo ?? 0) || compareText(a.title, b.title));
    case "added":
      return copy.sort((a, b) => b.addedAt - a.addedAt);
    case "duration":
      return copy.sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0));
    case "plays":
      return copy.sort((a, b) => (plays[b.id] ?? 0) - (plays[a.id] ?? 0) || compareText(a.title, b.title));
    default:
      return copy.sort((a, b) => compareText(a.title, b.title));
  }
}

export const albumOrder = (a: Track, b: Track) => (a.trackNo ?? 9999) - (b.trackNo ?? 9999) || compareText(a.name, b.name);

export function matches(t: Track, q: string) {
  return [t.title, t.artist, t.album, t.albumArtist, t.genre, t.name].some((v) => v.toLowerCase().includes(q));
}

export function srtToVtt(text: string) {
  if (text.trimStart().startsWith("WEBVTT")) return text;
  return "WEBVTT\n\n" + text.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}
