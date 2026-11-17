import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createRequire } from 'node:module';
import { PhotoError } from './media-error';
import { guestMediaLimits, maxMediaDurationSeconds } from '../../shared/media-limits';
import type { MediaKind } from '../../shared/media-limits';

const require = createRequire(import.meta.url);
type AvKind = Exclude<MediaKind, 'photo'>;
type Stream = {index?: number; codec_type?: string; codec_name?: string; width?: number; height?: number; sample_rate?: string; channels?: number; avg_frame_rate?: string; disposition?: {attached_pic?: number}};
type Frame = {stream_index: number; best_effort_timestamp_time?: string; duration_time?: string; pkt_duration_time?: string; nb_samples?: number; width?: number; height?: number};
let activeDecoders = 0;
export function mediaBinaryPaths(env: NodeJS.ProcessEnv = process.env) {
  function binary(setting: string, dependency: string) {
    if (env[setting]) return env[setting]!;
    try { const resolved = require(dependency) as string | {path: string}; return typeof resolved === 'string' ? resolved : resolved.path; } catch { throw new PhotoError('MEDIA_DECODER_UNAVAILABLE', 503); }
  }
  return {ffmpeg: binary('PILOT_FFMPEG_PATH', 'ffmpeg-static'), ffprobe: binary('PILOT_FFPROBE_PATH', '@derhuerst/ffprobe-static')};
}
export async function assertMediaToolsReady() {
  const paths = mediaBinaryPaths();
  for (const path of [paths.ffmpeg, paths.ffprobe]) await run(path, ['-version']);
}
function run(file: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(file, args, {timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, windowsHide: true}, (error, stdout, stderr) => {
      if (error) { reject(new PhotoError((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'MEDIA_DECODER_UNAVAILABLE' : 'MEDIA_INVALID', (error as NodeJS.ErrnoException).code === 'ENOENT' ? 503 : 400)); return; }
      // -v error: malformed/truncated input is rejected even when a demuxer exits successfully.
      if (stderr.trim()) { reject(new PhotoError('MEDIA_INVALID')); return; }
      resolve(stdout);
    });
  });
}

// A strict outer envelope rejects appended second files and truncated container records.
// Codec bytes inside records are subsequently validated by a complete decoder pass.
function container(bytes: Buffer): 'mov' | 'matroska' | 'ogg' | 'wav' {
  if (bytes.length >= 12 && bytes.toString('ascii', 4, 8) === 'ftyp') {
    let offset = 0;
    const allowed = new Set(['ftyp','moov','mdat','free','wide','skip','moof','sidx','styp','mfra','prft','pdin']);
    while (offset < bytes.length) {
      if (offset + 8 > bytes.length) throw new PhotoError('MEDIA_INVALID');
      let size = bytes.readUInt32BE(offset), header = 8;
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (!allowed.has(type)) throw new PhotoError('MEDIA_TYPE', 415);
      if (size === 1) { if (offset + 16 > bytes.length) throw new PhotoError('MEDIA_INVALID'); const large = bytes.readBigUInt64BE(offset + 8); if (large > BigInt(bytes.length)) throw new PhotoError('MEDIA_INVALID'); size = Number(large); header = 16; }
      if(size===0 && type==='mdat')size=bytes.length-offset;
      if (size < header || offset + size > bytes.length) throw new PhotoError('MEDIA_INVALID');
      offset += size;
    }
    return 'mov';
  }
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    function vint(offset: number, id = false) {
      const first = bytes[offset]; if (!first) throw new PhotoError('MEDIA_INVALID');
      let width = 1; while (width <= 8 && !(first & (1 << (8 - width)))) width++;
      if (width > (id ? 4 : 8) || offset + width > bytes.length) throw new PhotoError('MEDIA_INVALID');
      let value = BigInt(id ? first : first & ((1 << (8 - width)) - 1));
      for (let i = 1; i < width; i++) value = value * 256n + BigInt(bytes[offset + i]);
      return {width, value, unknown: !id && value === (1n << BigInt(7 * width)) - 1n};
    }
    function record(offset: number) {
      const id = vint(offset, true), size = vint(offset + id.width), start = offset + id.width + size.width;
      if (!size.unknown && size.value > BigInt(bytes.length - start)) throw new PhotoError('MEDIA_INVALID');
      return {id: Number(id.value), start, end: size.unknown ? bytes.length : start + Number(size.value), unknown: size.unknown};
    }
    const header = record(0), segment = record(header.end);
    if (header.unknown || segment.id !== 0x18538067 || segment.end !== bytes.length) throw new PhotoError('MEDIA_INVALID');
    let offset = segment.start;
    const allowed = new Set([0x114d9b74,0x1549a966,0x1654ae6b,0x1f43b675,0x1c53bb6b,0x1254c367,0xec,0xbf]);
    while (offset < segment.end) {
      const part = record(offset);
      if (!allowed.has(part.id)) throw new PhotoError('MEDIA_TYPE', 415);
      // MediaRecorder may write an unbounded final Cluster; full demux/decode validates it.
      if (part.unknown && part.id !== 0x1f43b675) throw new PhotoError('MEDIA_INVALID');
      offset = part.end;
    }
    return 'matroska';
  }
  if (bytes.toString('ascii',0,4) === 'OggS') {
    let offset = 0;
    while (offset < bytes.length) {
      if (offset + 27 > bytes.length || bytes.toString('ascii',offset,offset+4) !== 'OggS' || bytes[offset+4] !== 0) throw new PhotoError('MEDIA_INVALID');
      const count = bytes[offset+26]; if (offset+27+count > bytes.length) throw new PhotoError('MEDIA_INVALID');
      let size = 27 + count; for (let i=0;i<count;i++) size += bytes[offset+27+i];
      if (offset+size > bytes.length) throw new PhotoError('MEDIA_INVALID'); offset += size;
    }
    return 'ogg';
  }
  if (bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WAVE') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw new PhotoError('MEDIA_INVALID');
    let offset = 12;
    while (offset < bytes.length) {
      if (offset+8 > bytes.length) throw new PhotoError('MEDIA_INVALID');
      const size = bytes.readUInt32LE(offset+4); offset += 8 + size + size % 2;
      if (offset > bytes.length) throw new PhotoError('MEDIA_INVALID');
    }
    return 'wav';
  }
  throw new PhotoError('MEDIA_TYPE', 415);
}

export async function decodeAv(bytes: Buffer, kind: AvKind) {
  if (!bytes.length || bytes.length > guestMediaLimits[kind].maxBytes) throw new PhotoError('MEDIA_TOO_LARGE', 413);
  const format = container(bytes);
  if (kind === 'video' && !['mov','matroska'].includes(format)) throw new PhotoError('MEDIA_TYPE', 415);
  const paths = mediaBinaryPaths();
  if (activeDecoders >= 1) throw new PhotoError('MEDIA_BUSY', 429);
  activeDecoders++;
  let folder: string | undefined;
  try {
    folder = await mkdtemp(join(tmpdir(), 'memorybook-media-'));
    const input = join(folder, 'input.bin'); await writeFile(input, bytes, {flag:'wx', mode:0o600});
    const inputArgs = ['-max_alloc','67108864','-protocol_whitelist','file','-format_whitelist','mov,matroska,webm,ogg,wav','-threads','1','-f',format,'-i',input];
    const probe = JSON.parse(await run(paths.ffprobe, ['-v','error',...inputArgs,'-show_entries','stream=index,codec_type,codec_name,width,height,sample_rate,channels,avg_frame_rate:stream_disposition=attached_pic','-of','json'])) as {streams?: Stream[]};
    const streams = probe.streams || [], videos = streams.filter(s => s.codec_type === 'video'), audios = streams.filter(s => s.codec_type === 'audio');
    if (!streams.length || streams.length > 2 || streams.some(s => !['video','audio'].includes(s.codec_type || '') || s.disposition?.attached_pic) || audios.length > 1 || (kind === 'audio' ? videos.length !== 0 || audios.length !== 1 : videos.length !== 1)) throw new PhotoError('MEDIA_TYPE', 415);
    const video = videos[0];
    if (video) {
      const [n,d] = (video.avg_frame_rate || '0/1').split('/').map(Number), fps = n/d;
      if (!['h264','hevc','vp8','vp9'].includes(video.codec_name || '') || !video.width || !video.height || video.width > 1920 || video.height > 1920 || video.width * video.height > 1920*1080 || (Number.isFinite(fps) && fps > 60)) throw new PhotoError('MEDIA_TYPE', 415);
      if ((format === 'mov') !== ['h264','hevc'].includes(video.codec_name || '')) throw new PhotoError('MEDIA_TYPE', 415);
    }
    for (const a of audios) {
      const codecs = format === 'mov' ? ['aac'] : format === 'wav' ? ['pcm_s16le','pcm_s24le','pcm_f32le','pcm_u8'] : ['opus','vorbis'];
      if (!codecs.includes(a.codec_name || '') || !a.channels || a.channels > 2 || !Number(a.sample_rate) || Number(a.sample_rate) > 48000) throw new PhotoError('MEDIA_TYPE', 415);
    }
    // Decode actual frames: ffmpeg progress alone reports the last frame's START,
    // which would let a slightly over-limit recording through. No header duration is trusted.
    const decoded=JSON.parse(await run(paths.ffprobe,['-v','error','-err_detect','explode',...inputArgs,'-show_frames','-show_entries','frame=stream_index,best_effort_timestamp_time,duration_time,pkt_duration_time,nb_samples,width,height','-of','json'])) as {frames?:Frame[]};
    const durations=streams.map(stream=>{
      const frames=(decoded.frames||[]).filter(f=>f.stream_index===stream.index);
      if(!frames.length)throw new PhotoError('MEDIA_INVALID');
      let first=Infinity,last=-Infinity,samplesDuration=0;
      for(const [frameIndex,frame] of frames.entries()){
        if(stream.codec_type==='video'&&(!frame.width||!frame.height||frame.width>1920||frame.height>1920||frame.width*frame.height>1920*1080))throw new PhotoError('MEDIA_TYPE',415);
        const start=Number(frame.best_effort_timestamp_time),packetDuration=Number(frame.duration_time??frame.pkt_duration_time);
        const sampleDuration=Number(frame.nb_samples)/Number(stream.sample_rate);
        let length=packetDuration;
        if(stream.codec_type==='audio'){
          if(!Number.isFinite(sampleDuration)||sampleDuration<=0)throw new PhotoError('MEDIA_INVALID');
          // AAC edit lists trim encoder padding in the final packet. Opus frame
          // sample counts already account for skip/discard padding; WebM times round to ms.
          length=stream.codec_name==='aac'&&frameIndex===frames.length-1&&packetDuration>0?Math.min(sampleDuration,packetDuration):sampleDuration;
          samplesDuration+=length;
        }
        if(!Number.isFinite(start)||!Number.isFinite(length)||length<=0)throw new PhotoError('MEDIA_INVALID');
        first=Math.min(first,start);last=Math.max(last,start+length);
      }
      const timeline=last-first-(format==='matroska'&&stream.codec_type==='audio'?0.001:0);
      if(stream.codec_type==='video'&&frames.length>Math.ceil(timeline*60))throw new PhotoError('MEDIA_TYPE',415);
      return Math.max(timeline,samplesDuration);
    });
    const duration=Math.round(Math.max(0,...durations)*1_000_000)/1_000_000;
    if (!Number.isFinite(duration) || duration <= 0) throw new PhotoError('MEDIA_INVALID');
    if (duration > maxMediaDurationSeconds) throw new PhotoError('MEDIA_DURATION', 413);
    await run(paths.ffmpeg, ['-hide_banner','-v','error','-nostdin','-xerror','-err_detect','explode',...inputArgs,'-map','0','-threads','1','-filter_threads','1','-f','null','-','-nostats']);
    const quicktime=format==='mov' && kind==='video' && bytes.toString('ascii',8,12)==='qt  ';
    const mime = quicktime?'video/quicktime':kind + '/' + ({mov:'mp4',matroska:'webm',ogg:'ogg',wav:'wav'}[format]);
    return {mime, width: video?.width || 0, height: video?.height || 0, durationSeconds: duration, preview: Buffer.alloc(0), display: Buffer.alloc(0)};
  } finally {
    activeDecoders--;
    if (folder && resolve(dirname(folder))===resolve(tmpdir()) && basename(folder).startsWith('memorybook-media-')) await rm(resolve(folder), {recursive:true, force:true});
  }
}
