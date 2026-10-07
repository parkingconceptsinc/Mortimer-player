import type { StoredLibraryItem } from "./library";
import { kindOf, stripExt } from "./util";

type ParseBlob = typeof import("music-metadata").parseBlob;

// Bump when tag reading improves; older library items get re-read in the background.
export const META_VERSION = 2;

let parser: Promise<ParseBlob | null> | null = null;
const loadParser = () => (parser ??= import("music-metadata").then((m) => m.parseBlob).catch(() => null));

export type Incoming = { file: File; path: string };
export type Tags = Pick<StoredLibraryItem, "title" | "artist" | "album" | "albumArtist" | "genre" | "year" | "trackNo" | "duration" | "cover">;

export async function readTags(file: Blob, name: string): Promise<Tags> {
  const tags: Tags = { title: stripExt(name) };
  const parseBlob = await loadParser();
  if (!parseBlob) return tags;
  try {
    const { common, format } = await parseBlob(file);
    tags.title = common.title || tags.title;
    tags.artist = common.artist || common.artists?.[0] || "";
    tags.album = common.album || "";
    tags.albumArtist = common.albumartist || "";
    tags.genre = common.genre?.[0] || "";
    tags.year = common.year || undefined;
    tags.trackNo = common.track?.no ?? undefined;
    tags.duration = format.duration && Number.isFinite(format.duration) ? format.duration : undefined;
    const picture = common.picture?.[0];
    if (picture) tags.cover = new Blob([new Uint8Array(picture.data)], { type: picture.format });
  } catch {}
  return tags;
}

export async function readItem({ file, path }: Incoming, addedAt: number): Promise<StoredLibraryItem> {
  const kind = kindOf(file.name);
  const item: StoredLibraryItem = {
    id: crypto.randomUUID(),
    name: file.name,
    kind,
    path,
    size: file.size,
    lastModified: file.lastModified,
    file,
    title: stripExt(file.name),
    addedAt,
    metaVersion: META_VERSION,
  };
  return kind === "audio" ? { ...item, ...(await readTags(file, file.name)) } : item;
}
