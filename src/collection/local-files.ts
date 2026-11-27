/** Local recovery is best effort; server receipts, not this cache, prove delivery. */
function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('memorybook-collection-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('LOCAL_STORAGE_BLOCKED'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  let db: IDBDatabase | undefined;
  try {
    db = await openStore();
    return await new Promise<T>((resolve, reject) => {
      const tx = db!.transaction('files', mode), request = run(tx.objectStore('files'));
      tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } catch { return undefined; }
  finally { db?.close(); }
}
export async function keepLocalFile(groupId: string, id: string, file: File) { return (await transaction('readwrite', store => store.put(file, `${groupId}:${id}`))) !== undefined; }
export async function getLocalFile(groupId: string, id: string) { const result = await transaction('readonly', store => store.get(`${groupId}:${id}`)); return result instanceof File ? result : undefined; }
export async function forgetLocalFile(groupId: string, id: string) { await transaction('readwrite', store => store.delete(`${groupId}:${id}`)); }
