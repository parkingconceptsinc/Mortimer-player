import type { StoredLibraryItem } from "./library";
import { kindOf, stripExt } from "./util";

type ParseBlob = typeof import("music-metadata").parseBlob;

let parser: Promise<ParseBlob | null> | null = null;
const loadParser = () => (parser ??= import("music-metadata").then((m) => m.parseBlob).catch(() => null));

export type Incoming = { file: File; path: string };

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
  };
  if (kind !== "audio") return item;
  const parseBlob = await loadParser();
  if (!parseBlob) return item;
  try {
    const { common, format } = await parseBlob(file);
    item.title = common.title || item.title;
    item.artist = common.artist || common.artists?.[0] || "";
    item.album = common.album || "";
    item.albumArtist = common.albumartist || "";
    item.genre = common.genre?.[0] || "";
    item.year = common.year || undefined;
    item.trackNo = common.track?.no ?? undefined;
    item.duration = format.duration && Number.isFinite(format.duration) ? format.duration : undefined;
    const picture = common.picture?.[0];
    if (picture) item.cover = new Blob([new Uint8Array(picture.data)], { type: picture.format });
  } catch {}
  return item;
}
