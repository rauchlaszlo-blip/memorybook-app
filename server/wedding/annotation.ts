import sharp from 'sharp';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { annotationSvg } from '../../shared/photo-annotation';
import type { Annotation } from '../../shared/photo-annotation';
import { PhotoError } from './media';
import type { MediaLimits } from './media';

export const annotationHash = (a: Annotation | null) => a?.strokes.length ? createHash('sha256').update(JSON.stringify(a)).digest('hex') : null;
export async function attachAnnotation(client: PoolClient, mediaId: string, bookId: string, base: Buffer, layer: Annotation, limits: MediaLimits) {
  // Called under global quota lock and book/media row locks in the final transaction.
  const meta = await sharp(base).metadata();
  if (!meta.width || !meta.height) throw new PhotoError('PHOTO_INVALID');
  const display = await sharp(base).composite([{input:Buffer.from(annotationSvg(layer, meta.width, meta.height))}]).jpeg({quality:85}).timeout({seconds:15}).toBuffer();
  const preview = await sharp(display).resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
  const json = JSON.stringify(layer);
  const size = (await client.query('SELECT octet_length($1::jsonb::text) AS size', [json])).rows[0].size + preview.length + display.length;
  const quota = (await client.query(`SELECT COALESCE(sum(size),0)::bigint AS total, COALESCE(sum(size) FILTER(WHERE book_id=$1),0)::bigint AS book FROM (
    SELECT book_id,stored_size AS size FROM event_media UNION ALL SELECT m.book_id,a.stored_size FROM event_media_annotations a JOIN event_media m ON m.id=a.media_id) q`, [bookId])).rows[0];
  const physical = (await client.query('SELECT pg_database_size(current_database()) AS size')).rows[0].size;
  if (Number(quota.total)+size>limits.totalBytes || Number(quota.book)+size>limits.bookBytes || Number(physical)>700*1024*1024) throw new PhotoError('PHOTO_QUOTA',413);
  await client.query(`INSERT INTO event_media_annotations(media_id,version,layer,layer_hash,preview_bytes,display_bytes,stored_size) VALUES($1,1,$2,$3,$4,$5,$6)`, [mediaId,json,annotationHash(layer),preview,display,size]);
}
