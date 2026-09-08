from pathlib import Path

server_path = Path('server/index.ts')
s = server_path.read_text(encoding='utf-8')

old = """async function savePageVersioned(
  pageId: string,
  canvasData: Record<string, any>,
  previewDataUrl: string | null | undefined,
  expectedVersion: number,
  inviteStatus?: string
) {"""
new = """async function savePageVersioned(
  pageId: string,
  canvasData: Record<string, any>,
  previewDataUrl: string | null | undefined,
  expectedVersion: number,
  inviteStatus?: string,
  requireEditable = false
) {"""
assert old in s, 'savePageVersioned signature not found'
s = s.replace(old, new, 1)

old = """       SELECT id, preview_image_url
       FROM pages
       WHERE id = $3 AND version = $4"""
new = """       SELECT id, preview_image_url
       FROM pages
       WHERE id = $3
         AND version = $4
         AND ($6::boolean = FALSE OR invite_status <> 'submitted')"""
assert old in s, 'old_state query not found'
s = s.replace(old, new, 1)

old = """       FROM old_state os
       WHERE p.id = os.id
       RETURNING"""
new = """       FROM old_state os
       WHERE p.id = os.id
         AND ($6::boolean = FALSE OR p.invite_status <> 'submitted')
       RETURNING"""
assert old in s, 'update guard not found'
s = s.replace(old, new, 1)

old = """    [canvasData, newPreviewUrl, pageId, expectedVersion, inviteStatus ?? null]
  );"""
new = """    [
      canvasData,
      newPreviewUrl,
      pageId,
      expectedVersion,
      inviteStatus ?? null,
      requireEditable,
    ]
  );"""
assert old in s, 'savePageVersioned args not found'
s = s.replace(old, new, 1)

old = """    const check = await pool.query(
      'SELECT version FROM pages WHERE id = $1',
      [pageId]
    );"""
new = """    const check = await pool.query(
      `SELECT version, invite_status AS "inviteStatus"
       FROM pages
       WHERE id = $1`,
      [pageId]
    );"""
assert old in s, 'conflict check not found'
s = s.replace(old, new, 1)

old = """    if (check.rowCount === 0) {
      const error: any = new Error('PAGE_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    const error: any = new Error('PAGE_CONFLICT');"""
new = """    if (check.rowCount === 0) {
      const error: any = new Error('PAGE_NOT_FOUND');
      error.status = 404;
      throw error;
    }

    if (requireEditable && check.rows[0].inviteStatus === 'submitted') {
      const error: any = new Error('PAGE_ALREADY_SUBMITTED');
      error.status = 410;
      throw error;
    }

    const error: any = new Error('PAGE_CONFLICT');"""
assert old in s, 'submitted conflict insertion point not found'
s = s.replace(old, new, 1)

old = """      expectedVersion,
      'draft'
    );"""
new = """      expectedVersion,
      'draft',
      true
    );"""
assert old in s, 'invite save call not found'
s = s.replace(old, new, 1)

old = """    if (err?.status === 409) {
      res.status(409).json({
        error: 'PAGE_CONFLICT',
        latestRemoteVersion: err.latestRemoteVersion,
      });
      return;
    }

    if (
      err?.message === 'INVALID_PREVIEW_FORMAT'"""
new = """    if (err?.status === 409) {
      res.status(409).json({
        error: 'PAGE_CONFLICT',
        latestRemoteVersion: err.latestRemoteVersion,
      });
      return;
    }

    if (err?.status === 410 || err?.message === 'PAGE_ALREADY_SUBMITTED') {
      res.status(410).json({ error: 'PAGE_ALREADY_SUBMITTED' });
      return;
    }

    if (
      err?.message === 'INVALID_PREVIEW_FORMAT'"""
invite_route_pos = s.index("app.put('/api/page-invites/:token'")
tail = s[invite_route_pos:]
assert old in tail, 'invite error handler insertion point not found'
tail = tail.replace(old, new, 1)
s = s[:invite_route_pos] + tail

marker = "app.get('/api/health', async (_req, res) => {"
submit_route = """app.post('/api/page-invites/:token/submit', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE pages
       SET invite_status = 'submitted',
           submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE invite_token = $1
         AND invite_status IN ('invited', 'draft')
       RETURNING
         id,
         page_number AS "pageNumber",
         submitted_at AS "submittedAt"`,
      [req.params.token]
    );

    if (result.rowCount === 0) {
      const check = await pool.query(
        `SELECT invite_status AS "inviteStatus"
         FROM pages
         WHERE invite_token = $1`,
        [req.params.token]
      );

      if (check.rowCount === 0) {
        res.status(404).json({ error: 'PAGE_INVITE_NOT_FOUND' });
        return;
      }

      if (check.rows[0].inviteStatus === 'submitted') {
        res.status(409).json({ error: 'PAGE_ALREADY_SUBMITTED' });
        return;
      }

      res.status(409).json({ error: 'PAGE_NOT_READY_FOR_SUBMIT' });
      return;
    }

    res.status(200).json({
      success: true,
      pageId: result.rows[0].id,
      pageNumber: result.rows[0].pageNumber,
      submittedAt: result.rows[0].submittedAt,
    });
  } catch (err) {
    console.error('Invite page submit error:', err);
    res.status(500).json({ error: 'PAGE_SUBMIT_FAILED' });
  }
});

"""
assert marker in s, 'health marker not found'
s = s.replace(marker, submit_route + marker, 1)

old = """         invite_status AS "inviteStatus",
         invite_token AS "inviteToken",
         updated_at AS "updatedAt""""
new = """         invite_status AS "inviteStatus",
         invite_token AS "inviteToken",
         submitted_at AS "submittedAt",
         updated_at AS "updatedAt""""
assert old in s, 'owner page select not found'
s = s.replace(old, new, 1)

old = """      invite_status TEXT NOT NULL DEFAULT 'empty',
      invite_created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"""
new = """      invite_status TEXT NOT NULL DEFAULT 'empty',
      invite_created_at TIMESTAMPTZ,
      submitted_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP"""
assert old in s, 'pages table columns not found'
s = s.replace(old, new, 1)

old = "  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_created_at TIMESTAMPTZ`);"
new = """  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS invite_created_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ`);"""
assert old in s, 'submitted_at migration point not found'
s = s.replace(old, new, 1)

server_path.write_text(s, encoding='utf-8')

page_path = Path('src/PageInviteEditorPage.tsx')
page = page_path.read_text(encoding='utf-8')

old = "import { useCallback, useEffect, useState } from 'react';\nimport { MemoryBookEditor, type PageData } from './MemoryBookEditor';"
new = """import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MemoryBookEditor,
  type MemoryBookEditorRef,
  type PageData,
} from './MemoryBookEditor';"""
assert old in page, 'frontend imports not found'
page = page.replace(old, new, 1)

old = """export function PageInviteEditorPage({ token }: PageInviteEditorPageProps) {
  const [page, setPage] = useState<InvitePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);"""
new = """export function PageInviteEditorPage({ token }: PageInviteEditorPageProps) {
  const editorRef = useRef<MemoryBookEditorRef>(null);
  const [page, setPage] = useState<InvitePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);"""
assert old in page, 'frontend state block not found'
page = page.replace(old, new, 1)

marker = """  if (loading) {
    return <div style={styles.message}>Meghívó betöltése...</div>;
  }"""
handler = """  const submitPage = async () => {
    if (submitting) return;

    const confirmed = window.confirm(
      'Beküldés után ezt az oldalt már nem tudod módosítani. Biztosan beküldöd?'
    );

    if (!confirmed) return;

    try {
      setSubmitting(true);
      setError(null);

      await editorRef.current?.flush();

      const response = await fetch(
        `${API_BASE}/api/page-invites/${encodeURIComponent(token)}/submit`,
        { method: 'POST' }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (data?.error === 'PAGE_ALREADY_SUBMITTED') {
          setSubmitted(true);
          return;
        }
        throw new Error(data?.error || 'PAGE_SUBMIT_FAILED');
      }

      setSubmitted(true);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && err.message === 'PAGE_CONFLICT'
          ? 'Az oldal közben megváltozott. Frissítsd az oldalt, majd próbáld újra.'
          : 'A beküldés nem sikerült. A szerkesztés még nincs lezárva.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <main style={styles.page}>
        <section style={styles.header}>
          <div style={styles.brand}>MemoryBook</div>
          <h1 style={styles.title}>{page?.bookTitle || 'MemoryBook'}</h1>
          <div style={styles.successBox}>
            Az oldalad elküldve. Köszönjük!
          </div>
          <p style={styles.note}>
            A beküldött oldal már nem módosítható ezen a meghívón keresztül.
          </p>
        </section>
      </main>
    );
  }

"""
assert marker in page, 'frontend loading marker not found'
page = page.replace(marker, handler + marker, 1)

old = """        <p style={styles.note}>
          Ezzel a meghívóval csak ezt az egy oldalt tudod szerkeszteni. A módosítások automatikusan mentődnek.
        </p>
      </section>

      <MemoryBookEditor page={page} onSavePage={savePage} />"""
new = """        <p style={styles.note}>
          Ezzel a meghívóval csak ezt az egy oldalt tudod szerkeszteni. A módosítások automatikusan mentődnek.
        </p>
        <div style={styles.submitArea}>
          <button
            type="button"
            onClick={submitPage}
            disabled={submitting}
            style={styles.submitButton}
          >
            {submitting ? 'Beküldés...' : 'Oldal beküldése'}
          </button>
          <div style={styles.submitWarning}>
            Beküldés után az oldal végleg lezárul számodra.
          </div>
        </div>
        {error && <div style={styles.error}>{error}</div>}
      </section>

      <MemoryBookEditor ref={editorRef} page={page} onSavePage={savePage} />"""
assert old in page, 'frontend editor block not found'
page = page.replace(old, new, 1)

old = """  message: {
    padding: 40,
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
  },
};"""
new = """  submitArea: {
    marginTop: 16,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  submitButton: {
    padding: '11px 16px',
    border: 0,
    borderRadius: 9,
    background: '#0f172a',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
  },
  submitWarning: {
    color: '#92400e',
    fontSize: 13,
    fontWeight: 700,
  },
  error: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    background: '#fef2f2',
    color: '#991b1b',
  },
  successBox: {
    marginTop: 16,
    padding: 14,
    borderRadius: 10,
    background: '#ecfdf5',
    color: '#065f46',
    fontWeight: 800,
  },
  message: {
    padding: 40,
    textAlign: 'center',
    fontFamily: 'Arial, sans-serif',
  },
};"""
assert old in page, 'frontend styles block not found'
page = page.replace(old, new, 1)

page_path.write_text(page, encoding='utf-8')
