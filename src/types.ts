export type Kind = "audio" | "video";

export type Track = {
  id: string;
  name: string;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year?: number;
  trackNo?: number;
  duration?: number;
  kind: Kind;
  size: number;
  lastModified: number;
  path: string;
  folder: string;
  addedAt: number;
  url: string;
  cover?: string;
};

export type RepeatMode = "off" | "all" | "one";

export type Playlist = { id: string; name: string; trackIds: string[]; createdAt: number };

export type Screen = "library" | "videos" | "comics" | "player" | "queue" | "eq" | "settings";

export type ComicFormat = "cbz" | "cbr" | "pdf";

export type Comic = {
  id: string;
  name: string;
  title: string;
  path: string;
  folder: string;
  size: number;
  lastModified: number;
  addedAt: number;
  format: ComicFormat;
  pages?: number;
  file: Blob;
  cover?: string;
};

export type ComicProgress = { page: number; pages: number; at: number };

export type ReaderSettings = {
  mode: "paged" | "double" | "vertical";
  direction: "ltr" | "rtl";
  fit: "screen" | "width" | "height";
  background: "black" | "gray" | "white";
  tapZones: boolean;
  keepAwake: boolean;
};

export type Route =
  | { view: "home" }
  | { view: "songs" }
  | { view: "artists" }
  | { view: "artist"; name: string }
  | { view: "albums" }
  | { view: "album"; key: string }
  | { view: "genres" }
  | { view: "genre"; name: string }
  | { view: "folders" }
  | { view: "folder"; path: string }
  | { view: "playlists" }
  | { view: "playlist"; id: string }
  | { view: "favorites" }
  | { view: "recent" }
  | { view: "top" }
  | { view: "history" };

export type EqSettings = { enabled: boolean; preset: string; bands: number[]; preamp: number };

export type VideoFit = "contain" | "cover" | "fill";

export type SongSort = "title" | "artist" | "album" | "added" | "duration" | "plays";

export type VideoSort = "added" | "title" | "duration" | "size";

export type ComicSort = "recent" | "added" | "title";
