// The "Save as" file handles of the open processes, kept in IndexedDB (a FileSystemFileHandle can be stored
// there, localStorage cannot hold it) so that Ctrl+S after a reload writes to the same file again.
// Keyed by tab id (src/ui/docs.ts). Every call is best effort: without IndexedDB nothing is remembered.
import type { WritableFile } from './files'

const DB = 'strataflow-files'
const STORE = 'handles'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function run<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open()
    return await new Promise<T>((resolve, reject) => {
      const req = f(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return undefined
  }
}

export const putHandle = (tab: string, file: WritableFile) => run('readwrite', (s) => s.put(file, tab))
export const getHandle = (tab: string) => run<WritableFile>('readonly', (s) => s.get(tab))
export const deleteHandle = (tab: string) => run('readwrite', (s) => s.delete(tab))
export const handleTabs = async (): Promise<string[]> => ((await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) ?? []).map(String)
