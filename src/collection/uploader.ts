export type MediaKind = 'photo' | 'audio' | 'video';
export type CollectionFile = {
  id: string; kind: MediaKind; fileName: string; byteLength: number; sha256: string;
  state: 'uploading' | 'processing' | 'ready' | 'failed' | 'removed';
  receivedChunks: number[]; chunkCount: number; chunkBytes: number; errorCode: string | null; retryAvailable: boolean;
  mimeType?: string; actualMimeType?: string; durationSeconds?: number; uploadedAt?: string; previewUrl?: string; playbackUrl?: string; originalUrl?: string;
};
export type CollectionReceipt = { accepted: true; state: 'committed'; groupId: string; submissionId: string; committedAt: string; replayed: boolean };
export type CollectionData = {
  enabled: true; groupId: string; bookId: string; pageVersion: number; state: 'draft' | 'submitted';
  limits: { chunkBytes: number; photo: { maxBytes: number; maxCount: number }; audio: { maxBytes: number; maxCount: number; maxDurationSeconds: number }; video: { maxBytes: number; maxCount: number; maxDurationSeconds: number } };
  events: { id: string; label: string; order: number }[]; locations: { id: string; label: string; order: number }[];
  files: CollectionFile[]; eventIds?: string[]; locationIds?: string[]; receipt?: CollectionReceipt;
};
export type FileIdentity = { id: string; kind: MediaKind; fileName: string; mimeType: string; byteLength: number; sha256: string };
export type CommitInput = { key: string; expectedVersion: number; eventIds: string[]; locationIds: string[]; authorShareApproved: boolean; previewDataUrl?: string };
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;

export async function collectionRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(url, { ...init, credentials: 'same-origin', signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'COLLECTION_UNAVAILABLE');
    if (!body || response.status === 202) throw new Error('COLLECTION_UNCONFIRMED');
    return body as T;
  } finally { clearTimeout(timeout); }
}
export const jsonRequest = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
export async function fileIdentity(file: File, kind: MediaKind, id: string = crypto.randomUUID()): Promise<FileIdentity> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return { id, kind, fileName: file.name, mimeType: file.type.split(';')[0].toLowerCase() || 'application/octet-stream', byteLength: file.size, sha256: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') };
}
function validateFile(value: { file?: CollectionFile }, expected: FileIdentity): CollectionFile {
  const file = value?.file;
  if (!file || file.id !== expected.id || file.sha256 !== expected.sha256 || file.byteLength !== expected.byteLength || file.kind !== expected.kind || !Array.isArray(file.receivedChunks) || !Number.isInteger(file.chunkBytes) || file.chunkBytes < 1 || file.chunkBytes > 4 * 1024 * 1024 || file.chunkCount !== Math.ceil(expected.byteLength / file.chunkBytes)) throw new Error('COLLECTION_UNCONFIRMED');
  return file;
}
/** Stable IDs and byte hashes make both chunk retry and lost acknowledgements safe. */
export async function uploadOriginal(base: string, original: File, identity: FileIdentity, progress: (file: CollectionFile) => void, retry = false): Promise<CollectionFile> {
  const path = `${base}/files/${identity.id}`;
  let file: CollectionFile;
  try { file = validateFile(await collectionRequest<{ file: CollectionFile }>(`${base}/files`, jsonRequest(identity)), identity); }
  catch (error) {
    try { file = validateFile(await collectionRequest<{ file: CollectionFile }>(path), identity); }
    catch { throw error; }
  }
  progress(file);
  if (file.state === 'ready') return file;
  if (file.state === 'removed') throw new Error('COLLECTION_REMOVED');
  if (file.state === 'failed' && retry && file.retryAvailable) {
    file = validateFile(await collectionRequest<{ file: CollectionFile }>(`${path}/retry`, jsonRequest({})), identity);
    progress(file); if (file.state === 'ready') return file;
  }
  if (file.state === 'processing') throw new Error('COLLECTION_PROCESSING');
  for (let index = 0; index < file.chunkCount; index++) {
    if (file.receivedChunks.includes(index)) continue;
    const chunk = original.slice(index * file.chunkBytes, Math.min(original.size, (index + 1) * file.chunkBytes));
    try { file = validateFile(await collectionRequest<{ file: CollectionFile }>(`${path}/chunks/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk }), identity); }
    catch (error) {
      try { file = validateFile(await collectionRequest<{ file: CollectionFile }>(path), identity); }
      catch { throw error; }
      if (!file.receivedChunks.includes(index)) throw error;
    }
    progress(file);
  }
  try { file = validateFile(await collectionRequest<{ file: CollectionFile }>(`${path}/complete`, jsonRequest({})), identity); }
  catch (error) {
    try { file = validateFile(await collectionRequest<{ file: CollectionFile }>(path), identity); }
    catch { throw error; }
    if (file.state !== 'ready') throw error;
  }
  progress(file);
  if (file.state !== 'ready') throw new Error(file.errorCode || 'COLLECTION_PROCESSING');
  return file;
}
export function committedReceipt(value: unknown, groupId: string): CollectionReceipt {
  const receipt = value as Partial<CollectionReceipt> | null;
  if (!receipt || receipt.accepted !== true || receipt.state !== 'committed' || receipt.groupId !== groupId || typeof receipt.submissionId !== 'string' || !uuid.test(receipt.submissionId) || typeof receipt.replayed !== 'boolean' || typeof receipt.committedAt !== 'string') throw new Error('COLLECTION_UNCONFIRMED');
  return receipt as CollectionReceipt;
}
