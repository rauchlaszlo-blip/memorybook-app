import sharp from 'sharp';
import { decodeAv } from './av-decoder';
import { photoEnvelope } from './photo-envelope';
import { PhotoError } from './media-error';

export type CollectionValidationLimits = { maxBytes: number; maxDurationSeconds: number; maxPixels?: number };
export type ValidatedCollectionMedia = {
  mimeType: string; durationSeconds: number | null; width: number | null; height: number | null;
  capturedAt: string | null; captureTimeSource: string | null;
  preview: Buffer | null; playback: Buffer | null; playbackMimeType: string | null;
};
sharp.concurrency(1);
sharp.cache(false);
let activePhotos = 0;

// Read only EXIF DateTimeOriginal and its actual offset. A date without an offset
// remains a local wall-clock string: never assume the server/guest timezone.
export function readExifCaptureTime(exif?: Buffer): Pick<ValidatedCollectionMedia, 'capturedAt' | 'captureTimeSource'> {
  const absent = { capturedAt: null, captureTimeSource: null };
  if (!exif) return absent;
  try {
    const tiff = exif.subarray(exif.subarray(0, 6).equals(Buffer.from('Exif\0\0')) ? 6 : 0);
    const little = tiff.toString('ascii', 0, 2) === 'II';
    if (!little && tiff.toString('ascii', 0, 2) !== 'MM') return absent;
    const u16 = (p: number) => little ? tiff.readUInt16LE(p) : tiff.readUInt16BE(p);
    const u32 = (p: number) => little ? tiff.readUInt32LE(p) : tiff.readUInt32BE(p);
    if (u16(2) !== 42) return absent;
    const readDirectory = (offset: number) => {
      const values = new Map<number, string | number>();
      const count = u16(offset);
      if (count > 256 || offset + 2 + count * 12 > tiff.length) throw new Error('invalid EXIF');
      for (let i = 0; i < count; i++) {
        const p = offset + 2 + i * 12, tag = u16(p), type = u16(p + 2), length = u32(p + 4);
        if (type === 4 && length === 1) values.set(tag, u32(p + 8));
        if (type === 2 && length > 0 && length <= 64) {
          const start = length <= 4 ? p + 8 : u32(p + 8);
          if (start + length > tiff.length) throw new Error('invalid EXIF');
          values.set(tag, tiff.toString('ascii', start, start + length).replace(/\0+$/, ''));
        }
      }
      return values;
    };
    const root = readDirectory(u32(4)), pointer = root.get(0x8769);
    if (typeof pointer !== 'number') return absent;
    const values = readDirectory(pointer), date = values.get(0x9003), offset = values.get(0x9011);
    if (typeof date !== 'string' || !/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) return absent;
    const local = date.slice(0, 10).replaceAll(':', '-') + 'T' + date.slice(11);
    if (!Number.isFinite(Date.parse(local + 'Z')) || new Date(local + 'Z').toISOString().slice(0, 19) !== local) return absent;
    if (typeof offset === 'string' && /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset)) {
      return { capturedAt: local + offset, captureTimeSource: 'exif.DateTimeOriginal+OffsetTimeOriginal' };
    }
    return { capturedAt: local, captureTimeSource: 'exif.DateTimeOriginal.local-timezone-unknown' };
  } catch { return absent; }
}

export async function validateCollectionMedia(bytes: Buffer, kind: 'photo' | 'audio' | 'video', limits: CollectionValidationLimits): Promise<ValidatedCollectionMedia> {
  if (!bytes.length || bytes.length > limits.maxBytes) throw new PhotoError('MEDIA_TOO_LARGE', 413);
  if (kind !== 'photo') {
    const decoded = await decodeAv(bytes, kind, limits);
    return { mimeType: decoded.mime, width: decoded.width || null, height: decoded.height || null,
      durationSeconds: decoded.durationSeconds, capturedAt: decoded.capturedAt, captureTimeSource: decoded.captureTimeSource,
      preview: null, playback: decoded.playback, playbackMimeType: `${kind}/mp4` };
  }
  if (activePhotos >= 2) throw new PhotoError('MEDIA_BUSY', 429);
  activePhotos++;
  try {
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!jpeg && !png && !webp) throw new PhotoError('PHOTO_TYPE', 415);
    if (webp && bytes.readUInt32LE(4) + 8 !== bytes.length) throw new PhotoError('PHOTO_INVALID');
    if (png) {
      let position = 8, ended = false;
      while (position < bytes.length) {
        if (position + 12 > bytes.length) throw new PhotoError('PHOTO_INVALID');
        const size = bytes.readUInt32BE(position), type = bytes.toString('ascii', position + 4, position + 8);
        position += size + 12;
        if (position > bytes.length) throw new PhotoError('PHOTO_INVALID');
        if (type === 'IEND') { if (size !== 0 || position !== bytes.length) throw new PhotoError('PHOTO_INVALID'); ended = true; break; }
      }
      if (!ended) throw new PhotoError('PHOTO_INVALID');
    }
    const imageBytes = jpeg ? await photoEnvelope(bytes) : bytes;
    const maxPixels = limits.maxPixels ?? 40_000_000;
    const image = sharp(imageBytes, { limitInputPixels: maxPixels, failOn: 'warning' });
    const meta = await image.metadata();
    if (!meta.width || !meta.height || (meta.pages || 1) !== 1 || !['jpeg', 'png', 'webp'].includes(meta.format || '')) throw new PhotoError('PHOTO_INVALID');
    const preview = await image.autoOrient().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#fff' }).jpeg({ quality: 84 }).timeout({ seconds: 15 }).toBuffer();
    return { mimeType: jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/webp', width: meta.width, height: meta.height,
      durationSeconds: null, ...readExifCaptureTime(meta.exif), preview, playback: null, playbackMimeType: null };
  } catch (error) {
    if (error instanceof PhotoError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw new PhotoError('PHOTO_PIXELS', 413);
    throw new PhotoError('PHOTO_INVALID');
  } finally { activePhotos--; }
}
