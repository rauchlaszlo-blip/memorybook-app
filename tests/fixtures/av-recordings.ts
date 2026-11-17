import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeAv, mediaBinaryPaths } from '../../server/wedding/av-decoder';

const execute = promisify(execFile);
export function fictionalWav() {
  const samples = 8000, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(16000, 24); bytes.writeUInt32LE(32000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) bytes.writeInt16LE(Math.round(1000 * Math.sin(n * 2 * Math.PI * 440 / 16000)), 44 + n * 2);
  return bytes;
}
/** Half-second synthesized tone and blue rectangle; no human recordings. */
export async function fictionalRecordings() {
  const folder = await mkdtemp(join(tmpdir(), 'memorybook-fictional-av-')), path = join(folder, 'blue.webm');
  try {
    await execute(mediaBinaryPaths().ffmpeg, ['-v', 'error', '-nostdin', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=10:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.5', '-c:v', 'libvpx', '-threads', '1', '-c:a', 'libopus', '-shortest', path], { timeout: 30000, windowsHide: true });
    const audio = fictionalWav(), video = await readFile(path);
    return [{ kind: 'audio' as const, bytes: audio, ...await decodeAv(audio, 'audio') }, { kind: 'video' as const, bytes: video, ...await decodeAv(video, 'video') }];
  } finally { await unlink(path).catch(() => {}); await rmdir(folder); }
}
