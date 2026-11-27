import { once } from 'node:events';
import type { Writable } from 'node:stream';

type ZipEntry = { name: string; bytes: Buffer };
const table = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const value of bytes) crc = table[(crc ^ value) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function headers(entry: ZipEntry, offset: number) {
  if (!/^[a-zA-Z0-9_./-]+$/.test(entry.name) || entry.name.startsWith('/') || entry.name.split('/').some(s => s === '..') || entry.name.length > 512) throw new Error('INVALID_ARCHIVE_PATH');
  if (entry.bytes.length > 0xffffffff || offset > 0xffffffff) throw new Error('ARCHIVE_TOO_LARGE');
  const name = Buffer.from(entry.name), crc = crc32(entry.bytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
  local.writeUInt16LE(33, 12); // fixed DOS date 1980-01-01, not an invented capture time
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(entry.bytes.length, 18); local.writeUInt32LE(entry.bytes.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8);
  central.writeUInt16LE(33, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(entry.bytes.length, 20); central.writeUInt32LE(entry.bytes.length, 24);
  central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
  return { local: Buffer.concat([local, name]), central: Buffer.concat([central, name]) };
}
function endDirectory(count: number, size: number, offset: number) {
  if (count > 65535 || size + offset > 0xffffffff) throw new Error('ARCHIVE_TOO_LARGE');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return end;
}
export function createCollectionZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const header = headers(entry, offset);
    chunks.push(header.local, entry.bytes); central.push(header.central); offset += header.local.length + entry.bytes.length;
  }
  const directory = Buffer.concat(central);
  return Buffer.concat([...chunks, directory, endDirectory(entries.length, directory.length, offset)]);
}
export async function streamCollectionZip(entries: AsyncIterable<ZipEntry>, output: Writable): Promise<void> {
  const central: Buffer[] = [];
  let offset = 0;
  const write = async (bytes: Buffer) => {
    if (output.destroyed) throw new Error('ARCHIVE_DOWNLOAD_INTERRUPTED');
    if (!output.write(bytes)) await once(output, 'drain');
  };
  for await (const entry of entries) {
    const header = headers(entry, offset);
    await write(header.local); await write(entry.bytes);
    central.push(header.central); offset += header.local.length + entry.bytes.length;
  }
  const directory = Buffer.concat(central);
  await write(directory); await write(endDirectory(central.length, directory.length, offset));
  output.end();
}
