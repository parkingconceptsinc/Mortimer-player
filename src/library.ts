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
  cover?: Blob;
};

const DB_NAME = "mortimer-player";
const STORE = "library";
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDB();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
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
