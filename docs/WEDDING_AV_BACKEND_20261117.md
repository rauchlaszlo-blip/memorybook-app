# Guest audio/video backend contract

The image upload endpoint remains backward compatible for clients sending JPEG/PNG with no `X-Media-Kind`. All new media uploads require the guest cookie created by `GET /api/wedding/guest/:token`. The identity is one browser cookie in one book, not a verified person; clearing cookies creates a different identity.

`POST /api/wedding/guest/:token/media/:key` accepts an `application/octet-stream` body with `X-Media-Kind: photo | audio | video`. The UUID upload key must equal the later submission `idempotencyKey`. The response is `{mediaId,replayed,kind,mimeType,durationSeconds}` (photo duration is null). Uploading does not consume a guest count. `POST .../submissions` attaches one `mediaId` atomically and charges its kind only when committed. Name is required; the message may be empty only with a media attachment. Audio/video cannot have a drawing annotation.

`GET /api/wedding/guest/:token/media/:key` recovers a lost upload response after reload using the same guest cookie and upload key. It returns `{mediaId,kind,mimeType,durationSeconds,state}` for an unexpired staged upload or an attached item, including after submissions close. It creates no cookie and changes no data/quota. Missing, expired, invalid, anonymous and other-guest/book requests uniformly return `404 MEDIA_NOT_FOUND`; anonymous requests do not query upload keys. The UI still requires an explicit submission retry after recovery.

Counts apply to all wedding books: 10 photos, 2 videos, 2 audio recordings per book and guest cookie. The book row lock serializes the count and commit. Exact committed retries return success without charging again, including after closure. Newly staged uploads are bound to their guest identity; a different cookie cannot attach or replay them. Existing historical media and original bytes are preserved. Unattached expired uploads are cleaned separately. The existing pilot storage safeguards (default 50 MiB per book, 200 MiB total and count/database safeguards) still apply independently.

Guest GET retains its old `photo` field and adds:

```text
media: {
  maxDurationSeconds: 20,
  limits: {photo:{maxCount:10,maxBytes:6291456},
           video:{maxCount:2,maxBytes:25165824},
           audio:{maxCount:2,maxBytes:8388608}},
  used: {photo,video,audio}, remaining: {photo,video,audio},
  supportedMimeTypes: {photo:string[],video:string[],audio:string[]}
}
```

Photo max bytes can be configured within the existing bounded environment settings. Audio/video limits are fixed. Supported video containers/codecs are MP4/QuickTime with H.264 or HEVC and optional AAC, or WebM with VP8/VP9 and optional Opus/Vorbis. Audio accepts AAC in MP4/M4A, Opus/Vorbis in WebM/Ogg, and supported PCM WAV. Video is limited to 1920 pixels on either side, at most 1920×1080 pixels and 60 fps; audio to two channels and 48 kHz. Browser playback depends on its installed codecs; original download remains available. Native iPhone HEVC/MOV is accepted within these limits, but 4K files are not.

FFmpeg and FFprobe come from the pinned package lock (`ffmpeg-static`, `@derhuerst/ffprobe-static`); optional operator paths are `PILOT_FFMPEG_PATH` / `PILOT_FFPROBE_PATH`. Startup calls `assertMediaToolsReady`. A strict container envelope, stream/codec checks and complete decode reject malformed, unsupported, truncated and tested appended-file inputs. File MIME and duration sent by the client are never authoritative. Decoded frame end timestamps and audio sample counts determine duration, including durationless MediaRecorder WebM. AAC padding and millisecond WebM timestamp precision are handled explicitly. The capture UI stops before 20 seconds to leave room for device/muxing jitter.

The decoder uses direct executable arguments, one active decode, one thread, 64 MiB maximum single FFmpeg allocation, a 30-second timeout per child process, 1 MiB captured output limit, only the local `file` protocol and forced allowed input formats. Temporary files have generated names and are removed only after their resolved directory is checked. These bounds do not constitute an operating-system memory sandbox. Existing JSON bodies and original media are never executed or used as shell commands.

Relevant error codes: `GUEST_SESSION_REQUIRED` (428), `MEDIA_GUEST_LIMIT` (413, includes kind/limit), `MEDIA_GUEST_MISMATCH` (409), `MEDIA_DURATION` (413), `MEDIA_TOO_LARGE` (413), `MEDIA_TYPE` (415), `MEDIA_INVALID` (400), `MEDIA_BUSY` (429), `MEDIA_DECODER_UNAVAILABLE` (503). Existing photo/storage/expiry and idempotency errors remain compatible. A busy decoder is retryable with the same key and bytes.

Owner book detail media items include kind, MIME, duration and an AV `playbackUrl`. Image preview/display URLs are null for AV. The protected playback endpoint supports a single HTTP byte range (206/416); it requires the owning session and exposes only attached media. Original downloads are protected and retain exact bytes. Image preview/display/annotation endpoints return 404 for AV. Downstream snapshots/MCP/PDF distinguish kinds; audio/video is not silently treated as an image or transcription.

Local verification: `tests/av-media.test.ts` covers actual WAV/AAC/WebM/Ogg/H.264/HEVC decoding, exact 20-second WAV and rejected 20.01-second WAV, fMP4 padding boundary, type spoofing, truncation, appended files, sizes, owner/range access, checksums, image-path denial, empty-message attachment, count boundaries, concurrency, replay, expiry and guest/book isolation. `tests/wedding-photo.test.ts` retains the original-photo/annotation regressions with explicit guest cookies. Physical iPhone/Android testing remains separate from these synthetic fixture and browser checks.

FFmpeg reference: [FFprobe stream/frame inspection](https://ffmpeg.org/ffprobe.html), [FFmpeg decoding options](https://ffmpeg.org/ffmpeg.html), [protocol allowlisting](https://ffmpeg.org/ffmpeg-protocols.html).
