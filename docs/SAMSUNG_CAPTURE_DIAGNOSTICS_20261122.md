# Samsung capture compatibility diagnostics — 2026-11-22

The two reported missing submissions have not been attributed to a specific server rejection: the original failed request bodies and their response codes were unavailable. Do not label a synthetic reproduction as the proven cause of a physical Samsung failure.

## Preservation baseline

`scripts/verify-review-preservation.ts --capture --samsung-release test-results/mcp-internet/config.local` captured 8 existing books and 123 HTTPS resources on 2026-11-22. `/healthz` returned 200. This mode uses existing owner/operator sessions with GET requests only; it does not refresh authentication or change a firewall. Its isolated files are under ignored `test-results/samsung-release/pre-release` and an existing manifest cannot be overwritten.

Captured resources include source book data, protected originals, annotations, stored draft and snapshot content, owner review/approval state, export metadata and complete PDF bytes. This is an HTTPS recovery copy, not a full database backup. Upload orphans, guest identities/quotas and internal upload-attempt rows are not exposed by these APIs.

Run the same command without `--capture` to compare these existing resources after release. A separately created test book is outside this baseline. No new submissions are allowed in the captured books by this mode.

`scripts/diagnose-samsung-baseline.ts test-results/mcp-internet/config.local` reads this local copy and emits only attached-media metadata. It does not print guest names, messages, EXIF tags, credentials or original bytes. The designated book contained 41 submissions, with 34 photo, 3 video and 4 audio attachments. These counts establish what reached the owner API; they cannot establish whether an unacknowledged client attempt ever reached the server.

## Reproduced compatibility defects

1. A valid JPEG-based Motion Photo v1 was rejected by the old requirement that the entire upload end in JPEG EOI. The synthetic JPEG and its short AVC/AAC MP4 clip each decoded successfully; the combined, XMP-declared Motion Photo failed with `PHOTO_INVALID`. The [Android Motion Photo specification](https://developer.android.com/media/platform/motion-photo-format) explicitly describes the appended video and its XMP directory.
2. Actual local Chromium MediaRecorder VP8/Opus and VP9/Opus WebM recordings omitted individual video frame duration fields. Full ffprobe decoding produced valid frames and presentation timestamps, but the old validator required a positive packet duration for every frame and returned `MEDIA_INVALID`. MP4/AVC/AAC passed. [RFC 9559 §5.1.3.5.3](https://www.rfc-editor.org/rfc/rfc9559.html#section-5.1.3.5.3) describes deriving a missing block duration from the next presentation timestamp.

## Bounded changes

`photo-envelope.ts` reads complete JPEG marker segments and scan escaping, then accepts either an exact standalone JPEG or a narrowly supported Motion Photo v1: one JPEG primary item, optional declared zero padding, and one MP4/MOV video item of the exact declared length. Namespace-aware XML parsing rejects DTDs and malformed/ambiguous directories. The appended clip passes the existing bounded full AV decoder. Only the JPEG prefix feeds photo preview/display generation; the complete original upload remains unchanged. A Motion Photo remains one photo submission under the photo quota; its embedded clip is not offered as a separate video/playback item.

This is not universal Motion Photo support. Legacy MicroVideo/SEF trailers, extra gain-map images, secondary video tracks, unsupported codecs and videos exceeding the existing byte/duration/resolution limits remain rejected. Arbitrary appended files and concatenated MP4 movies are rejected. No general MP4 box whitelist expansion was made.

For durationless WebM video frames, the decoder uses fully decoded, strictly increasing presentation timestamps. The last frame has no successor; its duration is conservatively estimated using the longest observed interval, at least the reported cadence and 1/60 second. The overall timeline also accounts for inter-stream offsets. The 20-second maximum, codec/resolution/fps limits, complete ffmpeg validation and resource bounds remain in force. An uncertain file near the duration boundary can still be rejected; the recorder intentionally stops before 20 seconds.

## Evidence and reproducible checks

`tests/photo-envelope.test.ts` covers baseline/progressive JPEG, marker parsing, valid Motion Photo rendering with unchanged original bytes, exact length and namespace checks, DTD/trailer/truncation/concatenation rejection, byte/pixel limits, and actual localhost Chromium MediaRecorder output. Four short MP4/WebM recorder cases passed; a real 20.2-second WebM recording was rejected with `MEDIA_DURATION`.

The harmless fixture creator is `tests/fixtures/motion-photo.ts`. Generated color-image/short-silent-clip artifacts and their SHA256 manifest are under ignored `test-results/samsung-release/fixtures`. Recorder reports are in `test-results/samsung-release/local-recorder-formats.json`. No paid service or model was called. Local desktop Chromium results do not certify a physical Samsung or iPhone.

After V9 integration, the existing `av-media.test.ts` and `av-workflow.test.ts` regression suite passed 8/8 against an isolated local PostgreSQL schema, including exact 20-second audio, supported codecs, rejection boundaries, concurrent quotas, scoped recovery and immutable AV snapshot/PDF behavior. Recovery assertions cover the new expiry/diagnostic/submission identifiers and retained expired originals. Server TypeScript and affected-file ESLint checks passed.
