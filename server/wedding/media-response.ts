import type { Request, Response } from 'express';

// Shared by live owner media and immutable snapshot playback. Authorization precedes this helper.
export function sendMediaBytes(req: Request, res: Response, input: {bytes: Buffer; mimeType: string; filename?: string; attachment?: boolean; range?: boolean}) {
  const { bytes, mimeType } = input;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.type(mimeType);
  if (input.filename) res.setHeader('Content-Disposition', `${input.attachment ? 'attachment' : 'inline'}; filename="${input.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}"`);
  if (input.range) {
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      const length = bytes.length;
      let start: number, end = length - 1;
      if (match && (match[1] || match[2])) {
        if (!match[1]) start = Math.max(0, length - Number(match[2]));
        else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      } else start = -1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= length || end < start) {
        res.setHeader('Content-Range', `bytes */${length}`); res.status(416).end(); return;
      }
      res.setHeader('Content-Range', `bytes ${start}-${end}/${length}`);
      res.status(206).send(bytes.subarray(start, end + 1)); return;
    }
  }
  res.send(bytes);
}
