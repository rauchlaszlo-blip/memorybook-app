import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MemoryBookEditor,
  type MemoryBookEditorRef,
  type PageData,
} from './MemoryBookEditor';
import { detectBrowserAppLanguage, type AppLanguage } from './i18n';
import { getInviteEditorMessages } from './inviteEditorI18n';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type InvitePageData = PageData & {
  bookId: string;
  bookTitle: string;
  inviteStatus: string;
  language: AppLanguage;
};

type PageInviteEditorPageProps = {
  token: string;
};

export function PageInviteEditorPage({ token }: PageInviteEditorPageProps) {
  const editorRef = useRef<MemoryBookEditorRef>(null);
  const [fallbackLanguage] = useState<AppLanguage>(() => detectBrowserAppLanguage());
  const [page, setPage] = useState<InvitePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [authorShareApproved, setAuthorShareApproved] = useState(false);

  const language: AppLanguage =
    page?.language === 'en' ? 'en' : page?.language === 'hu' ? 'hu' : fallbackLanguage;
  const copy = getInviteEditorMessages(language).page;

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE}/api/page-invites/${encodeURIComponent(token)}`
        );

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (data?.error === 'PAGE_ALREADY_SUBMITTED') {
            throw new Error('PAGE_ALREADY_SUBMITTED');
          }
          throw new Error('PAGE_INVITE_LOAD_FAILED');
        }

        setPage({
          ...data,
          language: data?.language === 'hu' ? 'hu' : 'en',
        });
      } catch (err) {
        console.error(err);
        const fallbackCopy = getInviteEditorMessages(fallbackLanguage).page;
        setError(
          err instanceof Error && err.message === 'PAGE_ALREADY_SUBMITTED'
            ? fallbackCopy.alreadySubmitted
            : fallbackCopy.unavailable
        );
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [token, fallbackLanguage]);

  const savePage = useCallback(
    async (
      _pageId: string,
      canvasJson: Record<string, any>,
      previewDataUrl: string,
      expectedVersion: number
    ) => {
      const response = await fetch(
        `${API_BASE}/api/page-invites/${encodeURIComponent(token)}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            canvasData: canvasJson,
            previewDataUrl,
            expectedVersion,
          }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error: any = new Error(data?.error || 'PAGE_SAVE_FAILED');
        error.status = response.status;
        throw error;
      }

      setPage((current) =>
        current
          ? {
              ...current,
              version: data.newVersion,
              previewImageUrl: data.previewImageUrl,
              inviteStatus: 'draft',
            }
          : current
      );

      return { newVersion: data.newVersion };
    },
    [token]
  );

  const submitPage = async () => {
    if (submitting) return;

    const confirmed = window.confirm(copy.confirmSubmit);
    if (!confirmed) return;

    try {
      setSubmitting(true);
      setError(null);

      await editorRef.current?.flush();

      const response = await fetch(
        `${API_BASE}/api/page-invites/${encodeURIComponent(token)}/submit`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ authorShareApproved }),
        }
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
          ? copy.conflict
          : copy.submitFailed
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <main style={styles.page} lang={language}>
        <section style={styles.header}>
          <div style={styles.brand}>MemoryBook</div>
          <h1 style={styles.title}>{page?.bookTitle || 'MemoryBook'}</h1>
          <div style={styles.successBox}>{copy.success}</div>
          <p style={styles.note}>{copy.submittedLocked}</p>
          <p style={styles.note}>
            {authorShareApproved ? copy.shareApproved : copy.shareDenied}
          </p>
        </section>
      </main>
    );
  }

  if (loading) {
    const loadingCopy = getInviteEditorMessages(fallbackLanguage).page;
    return <div style={styles.message} lang={fallbackLanguage}>{loadingCopy.loading}</div>;
  }

  if (error || !page) {
    const fallbackCopy = getInviteEditorMessages(fallbackLanguage).page;
    return (
      <div style={styles.message} lang={fallbackLanguage}>
        {error || fallbackCopy.notFound}
      </div>
    );
  }

  return (
    <main style={styles.page} lang={language}>
      <section style={styles.header}>
        <div style={styles.brand}>MemoryBook</div>
        <h1 style={styles.title}>{page.bookTitle}</h1>
        <div style={styles.subtitle}>{copy.pageLabel(page.pageNumber)}</div>
        <p style={styles.note}>{copy.instructions}</p>
        <label style={styles.shareConsent}>
          <input
            type="checkbox"
            aria-label={copy.shareConsentAria}
            checked={authorShareApproved}
            style={{ width: 20, height: 20, flex: '0 0 auto' }}
            onChange={(event) => setAuthorShareApproved(event.target.checked)}
          />
          <span>{copy.shareConsent}</span>
        </label>
        <div style={styles.submitArea}>
          <button
            type="button"
            onClick={submitPage}
            disabled={submitting}
            style={styles.submitButton}
          >
            {submitting ? copy.submitting : copy.submit}
          </button>
          <div style={styles.submitWarning}>{copy.submitWarning}</div>
        </div>
        {error && <div style={styles.error}>{error}</div>}
      </section>

      <MemoryBookEditor
        ref={editorRef}
        page={page}
        onSavePage={savePage}
        language={language}
      />
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#e2e8f0',
    padding: '20px 12px 40px',
    fontFamily: 'Arial, sans-serif',
  },
  header: {
    maxWidth: 750,
    margin: '0 auto 18px',
    padding: '18px 20px',
    borderRadius: 14,
    background: '#ffffff',
    boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
  },
  brand: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    margin: '6px 0 4px',
    color: '#0f172a',
    fontSize: 'clamp(22px, 7vw, 28px)',
  },
  subtitle: {
    color: '#334155',
    fontWeight: 800,
  },
  note: {
    margin: '10px 0 0',
    color: '#64748b',
    lineHeight: 1.5,
  },
  shareConsent: {
    marginTop: 16,
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    background: '#f8fafc',
    color: '#475569',
    fontSize: 13,
    lineHeight: 1.45,
    cursor: 'pointer',
  },
  submitArea: {
    marginTop: 16,
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    flexDirection: 'column',
    gap: 10,
  },
  submitButton: {
    minHeight: 48,
    width: '100%',
    padding: '12px 16px',
    border: 0,
    borderRadius: 9,
    background: '#0f172a',
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 800,
    cursor: 'pointer',
    touchAction: 'manipulation',
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
};
