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
    let settled = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(COMICS)) db.createObjectStore(COMICS, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      // A blocked open may eventually succeed after another tab closes. Don't
      // leak that late connection after reporting the blocked request to callers.
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      // Lets a newer tab upgrade the schema instead of being blocked by this connection.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error ?? new Error("Couldn't open local library storage"));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error("Local library storage is blocked by another open tab. Close other Mortimer tabs and retry."));
    };
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

async function saveUniqueItems<T extends { id: string; path: string; size: number; lastModified: number }>(
  storeName: string,
  items: T[],
  keyOf: (item: T) => string,
): Promise<T[]> {
  const db = await openDB();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const tx = db.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      const get = store.getAll();
      get.onerror = () => reject(get.error);
      get.onsuccess = () => {
        const existing = new Set((get.result as T[]).map(keyOf));
        const unique: T[] = [];
        const seen = new Set(existing);
        for (const item of items) {
          const key = keyOf(item);
          if (seen.has(key)) continue;
          seen.add(key);
          unique.push(item);
          store.put(item);
        }
        tx.oncomplete = () => resolve(unique);
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Library transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function saveLibrary(items: StoredLibraryItem[]): Promise<StoredLibraryItem[]> {
  if (!items.length) return [];
  return await saveUniqueItems(STORE, items, (item) => `${item.path}|${item.size}|${item.lastModified}`);
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
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([STORE, COMICS], "readwrite");
      tx.objectStore(STORE).clear();
      tx.objectStore(COMICS).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  } finally {
    db.close();
  }
}

export async function saveComics(items: StoredComic[]): Promise<StoredComic[]> {
  if (!items.length) return [];
  return await saveUniqueItems(COMICS, items, (item) => `${item.path}|${item.size}|${item.lastModified}`);
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
