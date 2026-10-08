import type { StoredLibraryItem } from "./library";
import { kindOf, stripExt } from "./util";

type ParseBlob = typeof import("music-metadata").parseBlob;

// Bump when tag reading improves; older library items get re-read in the background.
export const META_VERSION = 3;

let parser: Promise<ParseBlob | null> | null = null;
const loadParser = () => (parser ??= import("music-metadata").then((m) => m.parseBlob).catch(() => null));

export type Incoming = { file: File; path: string };
export type Tags = Pick<StoredLibraryItem, "title" | "artist" | "album" | "albumArtist" | "genre" | "year" | "trackNo" | "duration" | "cover">;

export async function readTags(file: Blob, name: string): Promise<Tags> {
  const tags: Tags = { title: stripExt(name) };
  const parseBlob = await loadParser();
  if (!parseBlob) throw new Error("Metadata parser unavailable");
  const { common, format } = await parseBlob(file);
    tags.title = common.title || tags.title;
    tags.artist = common.artist || common.artists?.[0] || "";
    tags.album = common.album || "";
    tags.albumArtist = common.albumartist || "";
    tags.genre = common.genre?.[0] || "";
    tags.year = common.year || undefined;
    tags.trackNo = common.track?.no ?? undefined;
    tags.duration = format.duration && Number.isFinite(format.duration) ? format.duration : undefined;
  const picture = common.picture?.find((candidate) => {
    const type = (candidate as { type?: unknown }).type;
    return type === 3 || /front/i.test(String(type));
  }) ?? common.picture?.find((candidate) => /cover/i.test(String((candidate as { type?: unknown }).type ?? ""))) ?? common.picture?.[0];
  if (picture) tags.cover = new Blob([new Uint8Array(picture.data)], { type: picture.format });
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
    // File already implements Blob. Keep it directly instead of constructing
    // new Blob([file]), which can force an unnecessary full-file copy during import.
    file,
    title: stripExt(file.name),
    addedAt,
    // Audio metadata is enriched after the file is persisted. Keep it stale
    // until that pass completes so an interrupted import is retried next time.
    metaVersion: kind === "audio" ? 0 : META_VERSION,
  };
  if (kind !== "audio") return item;

  // Do not parse tags during import. music-metadata can be slow or stall on
  // unusual files; importing the file itself must never depend on tag parsing.
  // Metadata is enriched asynchronously by the player after the item is saved.
  return item;
}
