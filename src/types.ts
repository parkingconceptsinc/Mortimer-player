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

export type Screen = "library" | "videos" | "player" | "queue" | "eq" | "settings";

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
