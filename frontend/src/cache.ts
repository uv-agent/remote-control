import { CACHE_DB_NAME } from "./constants";
import type { Json, TimelineEvent } from "./types";

export function openCache(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (!("indexedDB" in window)) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(CACHE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      const events = database.createObjectStore("events", { keyPath: "key" });
      events.createIndex("thread", "thread_id", { unique: false });
      events.createIndex("stored", "stored_at", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

export async function cachePutEvents(db: IDBDatabase, threadId: string, events: TimelineEvent[]) {
  if (!events.length) return;
  const tx = db.transaction("events", "readwrite");
  const store = tx.objectStore("events");
  const now = Date.now();
  for (const event of events) {
    if (!event._event_id) continue;
    const payload = JSON.stringify(event);
    store.put({ key: `${threadId}:${event._event_id}`, thread_id: threadId, event_id: event._event_id, stored_at: now, bytes: payload.length, event });
  }
  await txDone(tx);
  pruneCache(db).catch(() => undefined);
}

export async function cacheGetEvents(db: IDBDatabase, threadId: string) {
  const tx = db.transaction("events", "readonly");
  const index = tx.objectStore("events").index("thread");
  const rows = await getAll(index, IDBKeyRange.only(threadId));
  return rows.map((row) => row.event as TimelineEvent).sort((a, b) => Number(a._event_id || 0) - Number(b._event_id || 0));
}

export async function pruneCache(db: IDBDatabase) {
  const tx = db.transaction("events", "readwrite");
  const store = tx.objectStore("events");
  const rows = await getAll(store);
  rows.sort((a, b) => Number(a.stored_at || 0) - Number(b.stored_at || 0));
  let bytes = rows.reduce((sum, row) => sum + Number(row.bytes || 0), 0);
  while ((rows.length > 2500 || bytes > 8 * 1024 * 1024) && rows.length) {
    const row = rows.shift();
    if (!row) break;
    bytes -= Number(row.bytes || 0);
    store.delete(row.key as IDBValidKey);
  }
  await txDone(tx);
}

export function getAll(source: IDBObjectStore | IDBIndex, query?: IDBValidKey | IDBKeyRange): Promise<Json[]> {
  return new Promise((resolve, reject) => {
    const request = source.getAll(query);
    request.onsuccess = () => resolve(request.result as Json[]);
    request.onerror = () => reject(request.error);
  });
}

export function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
