import {Router} from 'express';
import type {Pool} from 'pg';
import type {WeddingOptions} from '../wedding/router';
import {deploymentMcpBookIds} from '../mcp/book-policy';
import {mediaLimits} from '../wedding/media';

/** Read-only incident evidence. No originals, names, text, cookies or invite/upload keys. */
export function createPilotMediaDiagnostics(pool:Pool,getSession:WeddingOptions['getSession'],env:NodeJS.ProcessEnv=process.env){
  const router=Router();
  router.get('/api/pilot/books/:id/media-diagnostics',async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');
    try{
      const session=await getSession(req);if(!session){res.status(401).json({error:'UNAUTHENTICATED'});return;}
      const id=String(req.params.id),allowed=deploymentMcpBookIds(env);
      // Diagnostics require an explicit deployment scope even in local development.
      if(!allowed?.includes(id)){res.status(404).json({error:'NOT_FOUND'});return;}
      const client=await pool.connect();
      try{
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const book=await client.query("SELECT id FROM event_books WHERE id=$1 AND owner_user_id=$2 AND product='celebration' AND event_type='wedding' AND title ILIKE '%fiktív%'",[id,session.user.id]);
        if(!book.rowCount){await client.query('ROLLBACK');res.status(404).json({error:'NOT_FOUND'});return;}
        const submissions=await client.query(`SELECT s.id,s.created_at,count(m.id)::int AS media_count FROM event_submissions s
          LEFT JOIN event_media m ON m.submission_id=s.id AND m.book_id=s.book_id WHERE s.book_id=$1
          GROUP BY s.id ORDER BY s.created_at DESC,s.id LIMIT 1000`,[id]);
        const media=await client.query(`SELECT m.id,m.submission_id,m.created_at,m.expires_at,m.state,m.kind,m.mime_type,
          m.original_size,m.stored_size,m.width,m.height,m.duration_seconds,m.sha256,
          octet_length(m.original_bytes)=m.original_size AS original_size_matches,
          encode(sha256(m.original_bytes),'hex')=m.sha256 AS original_hash_matches,
          (m.submission_id IS NOT NULL AND s.id IS NOT NULL) AS submission_link_valid,
          (m.state='attached' AND s.id IS NOT NULL) AS owner_visible,
          CASE WHEN substring(m.original_bytes FROM 1 FOR 3)=decode('ffd8ff','hex') THEN 'jpeg'
            WHEN substring(m.original_bytes FROM 1 FOR 8)=decode('89504e470d0a1a0a','hex') THEN 'png'
            WHEN substring(m.original_bytes FROM 5 FOR 4)=decode('66747970','hex') THEN 'isobmff'
            WHEN substring(m.original_bytes FROM 1 FOR 4)=decode('1a45dfa3','hex') THEN 'ebml'
            WHEN substring(m.original_bytes FROM 1 FOR 4)=decode('52494646','hex') THEN 'riff'
            WHEN substring(m.original_bytes FROM 1 FOR 4)=decode('4f676753','hex') THEN 'ogg' ELSE 'unknown' END AS signature
          FROM event_media m LEFT JOIN event_submissions s ON s.id=m.submission_id AND s.book_id=m.book_id
          WHERE m.book_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 1000`,[id]);
        const usage=await client.query(`SELECT COALESCE(sum(stored_size),0)::bigint AS bytes,count(*)::int AS files,
          count(*) FILTER(WHERE state='uploaded')::int AS unattached FROM event_media WHERE book_id=$1`,[id]);
        const annotations=await client.query('SELECT COALESCE(sum(a.stored_size),0)::bigint AS bytes FROM event_media_annotations a JOIN event_media m ON m.id=a.media_id WHERE m.book_id=$1',[id]);
        const attempts=await client.query(`SELECT id,media_id,kind,state,stage,error_code,error_status,diagnostic_id,created_at,updated_at,lease_until,
          byte_length,source_hint,mime_hint,pending_bytes IS NOT NULL AS original_pending,
          CASE WHEN pending_bytes IS NOT NULL THEN encode(sha256(pending_bytes),'hex')=sha256 ELSE NULL END AS pending_hash_matches
          FROM event_media_attempts WHERE book_id=$1 ORDER BY created_at DESC LIMIT 400`,[id]);
        const pending=await client.query('SELECT COALESCE(sum(octet_length(pending_bytes)),0)::bigint AS bytes FROM event_media_attempts WHERE book_id=$1',[id]);
        const counts=await client.query(`SELECT dense_rank() OVER(ORDER BY s.guest_device_id)::int AS guest_group,m.kind,count(*)::int AS used
          FROM event_submissions s JOIN event_media m ON m.submission_id=s.id AND m.book_id=s.book_id
          WHERE s.book_id=$1 GROUP BY s.guest_device_id,m.kind ORDER BY guest_group,m.kind`,[id]);
        await client.query('COMMIT');
        res.json({bookId:id,at:new Date().toISOString(),submissions:submissions.rows,media:media.rows,attempts:attempts.rows,
          usage:{...usage.rows[0],bytes:Number(usage.rows[0].bytes)+Number(annotations.rows[0].bytes)+Number(pending.rows[0].bytes),pendingBytes:Number(pending.rows[0].bytes),limitBytes:mediaLimits(env).bookBytes},guestUsage:counts.rows,
          limitations:['No historic client errors or device/source identity can be inferred from existing media rows.','Unattached rows are uploads, not confirmed guest submissions.']});
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }catch{res.status(503).json({error:'DIAGNOSTICS_UNAVAILABLE'});}
  });
  return router;
}
