export type StoredLibraryItem = {
  id: string;
  name: string;
  kind: "audio" | "video";
  path: string;
  size: number;
  lastModified: number;
  file: Blob;
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNo?: number;
  duration?: number;
  addedAt?: number;
  metaVersion?: number;
  cover?: Blob;
};

export type StoredComic = {
  id: string;
  name: string;
  path: string;
  size: number;
  lastModified: number;
  addedAt: number;
  format:
    | "cbz" | "cbr" | "pdf" | "epub"
    | "txt" | "md" | "markdown" | "log" | "nfo"
    | "csv" | "tsv" | "json" | "xml" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf"
    | "srt" | "vtt" | "ass" | "ssa" | "sub"
    | "html" | "htm" | "rtf" | "docx" | "odt";
  shelf?: "books" | "comics";
  title?: string;
  author?: string;
  pages?: number;
  file: Blob;
  cover?: Blob;
  // Serialized epub.js locations, so percentages don't need recomputing on every open.
  locations?: string;
};

const DB_NAME = "mortimer-player";
const STORE = "library";
const COMICS = "comics";
const VERSION = 2;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(COMICS)) db.createObjectStore(COMICS, { keyPath: "id" });
    };
    request.onsuccess = () => {
      // Lets a newer tab upgrade the schema instead of being blocked by this connection.
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void, storeName = STORE): Promise<T | undefined> {
  const db = await openDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = run(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLibrary(items: StoredLibraryItem[]) {
  if (!items.length) return;
  await withStore("readwrite", (store) => { for (const item of items) store.put(item); });
}

export async function loadLibrary(): Promise<StoredLibraryItem[]> {
  return (await withStore<StoredLibraryItem[]>("readonly", (store) => store.getAll())) ?? [];
}

export async function deleteTracks(ids: string[]) {
  if (!ids.length) return;
  await withStore("readwrite", (store) => { for (const id of ids) store.delete(id); });
}

export async function patchTrack(id: string, patch: Partial<Omit<StoredLibraryItem, "id" | "file">>) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const get = store.get(id);
      get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...patch }); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function clearLibrary() {
  await withStore("readwrite", (store) => store.clear());
}

export async function saveComics(items: StoredComic[]) {
  if (!items.length) return;
  await withStore("readwrite", (store) => { for (const item of items) store.put(item); }, COMICS);
}

export async function loadComics(): Promise<StoredComic[]> {
  return (await withStore<StoredComic[]>("readonly", (store) => store.getAll(), COMICS)) ?? [];
}

export async function deleteComics(ids: string[]) {
  if (!ids.length) return;
  await withStore("readwrite", (store) => { for (const id of ids) store.delete(id); }, COMICS);
}

export async function patchComic(id: string, patch: Partial<Omit<StoredComic, "id" | "file">>) {
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(COMICS, "readwrite");
      const store = tx.objectStore(COMICS);
      const get = store.get(id);
      get.onsuccess = () => { if (get.result) store.put({ ...get.result, ...patch }); };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadComicLocations(id: string): Promise<string | undefined> {
  const item = await withStore<StoredComic | undefined>("readonly", (store) => store.get(id), COMICS);
  return item?.locations;
}
