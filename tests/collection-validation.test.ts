import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { PassThrough } from 'node:stream';
import sharp from 'sharp';
import { validateCollectionMedia, readExifCaptureTime } from '../server/collection/validation';
import { mediaBinaryPaths } from '../server/collection/av-decoder';
import { createCollectionZip, streamCollectionZip } from '../server/collection/archive';

const limits = { maxBytes: 25 * 1024 * 1024, maxDurationSeconds: 20 };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function clip(kind: 'video' | 'audio', seconds: number, format = 'mp4') {
  const folder = await mkdtemp(join(tmpdir(), 'memorybook-collection-test-'));
  try {
    const filename = join(folder, `synthetic.${format}`);
    const source = kind === 'video' ? ['-f','lavfi','-i','color=c=blue:s=160x120:r=10'] : ['-f','lavfi','-i','sine=frequency=440:sample_rate=48000'];
    const codecs = kind === 'video' ? (format === 'webm' ? ['-c:v','libvpx-vp9'] : ['-c:v','libx264','-pix_fmt','yuv420p']) : ['-c:a',format === 'wav' ? 'pcm_s16le' : 'aac'];
    await promisify(execFile)(mediaBinaryPaths().ffmpeg, ['-hide_banner','-loglevel','error',...source,'-t',String(seconds),...codecs,'-threads','1',filename], { windowsHide: true, timeout: 30_000 });
    return await readFile(filename);
  } finally {
    if (resolve(dirname(folder)) === resolve(tmpdir()) && basename(folder).startsWith('memorybook-collection-test-')) await rm(folder, { recursive: true, force: true });
  }
}

test('photo decoder preserves source bytes, extracts real EXIF, strips preview metadata', async () => {
  const original = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#55aaff' } })
    .withExif({ IFD2: { DateTimeOriginal: '2026:11:26 14:23:45', OffsetTimeOriginal: '+01:00' } }).jpeg().toBuffer();
  const before = sha(original), result = await validateCollectionMedia(original, 'photo', limits);
  assert.equal(sha(original), before);
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.capturedAt, '2026-11-26T14:23:45+01:00');
  assert.notEqual(sha(result.preview!), before);
  assert.equal((await sharp(result.preview!).metadata()).exif, undefined);
});

test('missing capture metadata stays missing; local EXIF time gets no invented offset', async () => {
  assert.deepEqual(readExifCaptureTime(), { capturedAt: null, captureTimeSource: null });
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
    .withExif({ IFD2: { DateTimeOriginal: '2026:11:26 14:23:45' } }).jpeg().toBuffer();
  const result = await validateCollectionMedia(bytes, 'photo', limits);
  assert.equal(result.capturedAt, '2026-11-26T14:23:45');
  assert.match(result.captureTimeSource!, /timezone-unknown/);
});

test('actual type, full image validity, byte and pixel ceilings are enforced', async () => {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ffff00' } }).png().toBuffer();
  assert.equal((await validateCollectionMedia(png, 'photo', limits)).mimeType, 'image/png');
  await assert.rejects(validateCollectionMedia(Buffer.from('<script>bad</script>'), 'photo', limits), /PHOTO_TYPE/);
  await assert.rejects(validateCollectionMedia(png.subarray(0, png.length - 5), 'photo', limits), /PHOTO_INVALID/);
  await assert.rejects(validateCollectionMedia(png, 'photo', { ...limits, maxBytes: 20 }), /MEDIA_TOO_LARGE/);
  await assert.rejects(validateCollectionMedia(png, 'photo', { ...limits, maxPixels: 100 }), /PHOTO_PIXELS/);
});

test('audio is decoded and normalized to separate playable MP4, source stays exact', async () => {
  const original = await clip('audio', 0.5, 'wav'), before = sha(original);
  const result = await validateCollectionMedia(original, 'audio', limits);
  assert.equal(result.mimeType, 'audio/wav');
  assert.equal(result.playbackMimeType, 'audio/mp4');
  assert.ok(result.durationSeconds! >= 0.49 && result.durationSeconds! <= 0.51);
  assert.equal(sha(original), before);
  assert.equal(result.playback!.toString('ascii', 4, 8), 'ftyp');
  await assert.rejects(validateCollectionMedia(original, 'video', limits), /MEDIA_TYPE/);
});

test('video playback derivative is MP4 for WebM originals and duration is server-enforced', async () => {
  const webm = await clip('video', 0.6, 'webm');
  const result = await validateCollectionMedia(webm, 'video', limits);
  assert.equal(result.mimeType, 'video/webm');
  assert.equal(result.playbackMimeType, 'video/mp4');
  assert.equal(result.playback!.toString('ascii', 4, 8), 'ftyp');
  await assert.rejects(validateCollectionMedia(webm, 'video', { ...limits, maxDurationSeconds: 0.4 }), /MEDIA_DURATION/);
  const over = await clip('video', 20.2);
  await assert.rejects(validateCollectionMedia(over, 'video', limits), /MEDIA_DURATION/);
  await assert.rejects(validateCollectionMedia(webm.subarray(0, webm.length - 15), 'video', limits), /MEDIA_INVALID/);
});

test('ZIP preserves original hash and generated paths; streaming equals bounded ZIP', async () => {
  const original = Buffer.from('fictional-original-bytes\0\xff', 'latin1');
  const entries = [{ name: 'submission-1/file-1.bin', bytes: original }, { name: 'manifest.json', bytes: Buffer.from(JSON.stringify({ sha256: sha(original) })) }];
  const archive = createCollectionZip(entries);
  assert.equal(archive.readUInt32LE(), 0x04034b50);
  const length = archive.readUInt32LE(18), nameLength = archive.readUInt16LE(26);
  const downloaded = archive.subarray(30 + nameLength, 30 + nameLength + length);
  assert.equal(sha(downloaded), sha(original));
  const output = new PassThrough(), chunks: Buffer[] = [];
  output.on('data', chunk => chunks.push(chunk));
  async function* source() { yield* entries; }
  await streamCollectionZip(source(), output);
  assert.deepEqual(Buffer.concat(chunks), archive);
  assert.throws(() => createCollectionZip([{ name: '../secret', bytes: original }]), /INVALID_ARCHIVE_PATH/);
});
