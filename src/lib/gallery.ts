export type Work = {
  id: string;
  createdAt: number;
  title: string;
  prompt: string;
  mime: string;
  blob: Blob;
};

const DB_NAME = "huiye";
const STORE = "works";
const MAX_WORKS = 36;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function listWorks(): Promise<Work[]> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readonly");
  const request = tx.objectStore(STORE).getAll();
  const rows = await new Promise<Work[]>((resolve, reject) => {
    request.onsuccess = () => resolve((request.result as Work[]) ?? []);
    request.onerror = () => reject(request.error);
  });
  await txDone(tx);
  db.close();
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveWork(work: Work): Promise<void> {
  const db = await openDb();
  const existing = await listWorks();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  store.put(work);
  for (const old of existing.slice(MAX_WORKS - 1)) {
    if (old.id !== work.id) store.delete(old.id);
  }
  await txDone(tx);
  db.close();
}

export async function deleteWork(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await txDone(tx);
  db.close();
}
