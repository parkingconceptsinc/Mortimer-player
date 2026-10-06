export type StoredLibraryItem = {
  id: string;
  name: string;
  kind: "audio" | "video";
  path: string;
  size: number;
  lastModified: number;
  file: Blob;
  artist?: string;
  album?: string;
  genre?: string;
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

export async function saveLibrary(items: StoredLibraryItem[]) {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const item of items) store.put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadLibrary(): Promise<StoredLibraryItem[]> {
  const db = await openDB();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => { db.close(); resolve(request.result as StoredLibraryItem[]); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function clearLibrary() {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const request = tx.objectStore(STORE).clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  db.close();
}
