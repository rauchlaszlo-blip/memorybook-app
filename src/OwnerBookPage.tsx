import { useEffect, useMemo, useState } from 'react';
import { InviteSendDialog } from './InviteSendDialog.tsx';
import { EventBookSettings } from './EventBookSettings.tsx';

const API_BASE =
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type OwnerPage = {
  id: string;
  pageNumber: number;
  version: number;
  inviteStatus: 'empty' | 'invited' | 'draft' | 'submitted' | string;
  inviteToken?: string | null;
  inviteCreatedAt?: string | null;
  inviteSentAt?: string | null;
  inviteExpiresAt?: string | null;
  inviteRecipientName?: string | null;
  inviteRecipientEmail?: string | null;
  inviteDeliveryMethod?: 'share' | 'email' | string | null;
  ownerNote?: string | null;
  ownerVisibility?: 'active' | 'archived' | string;
  submittedAt?: string | null;
  authorShareApproved?: boolean;
  ownerShareApproved?: boolean;
  publicShareToken?: string | null;
  updatedAt?: string;
};

type OwnerBookPageProps = {
  bookId: string;
};

export function OwnerBookPage({ bookId }: OwnerBookPageProps) {
  const [bookTitle, setBookTitle] = useState('MemoryBook');
  const [eventInviteToken, setEventInviteToken] = useState<string | null>(null);
  const [bookType, setBookType] = useState<'standard' | 'event'>('standard');
  const [pages, setPages] = useState<OwnerPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingPageId, setWorkingPageId] = useState<string | null>(null);
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null);
  const [inviteComposerPage, setInviteComposerPage] = useState<OwnerPage | null>(null);

  const origin = useMemo(() => window.location.origin, []);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(
          `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages`,
          { credentials: 'include' }
        );

        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }

        if (!response.ok) {
          throw new Error('OWNER_PAGE_LIST_LOAD_FAILED');
        }

        const data = await response.json();
        setBookTitle(data.book?.title || 'MemoryBook');
        setEventInviteToken(data.book?.eventInviteToken || null);
        setBookType(data.book?.bookType === 'event' ? 'event' : 'standard');
        setPages(Array.isArray(data.pages) ? data.pages : []);
      } catch (err) {
        console.error(err);
        setError('Nem sikerült betölteni a könyv oldalait.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bookId]);

  const createInvite = async (page: OwnerPage) => {
    try {
      setWorkingPageId(page.id);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/invite`,
        {
          method: 'POST',
          credentials: 'include',
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || 'PAGE_INVITE_CREATE_FAILED');
      }

      const invitedPage: OwnerPage = {
        ...page,
        inviteToken: data.inviteToken,
        inviteCreatedAt: data.inviteCreatedAt || page.inviteCreatedAt || null,
        inviteSentAt: data.inviteSentAt || page.inviteSentAt || null,
        inviteExpiresAt: data.inviteExpiresAt || page.inviteExpiresAt || null,
        inviteStatus: page.inviteStatus === 'empty' ? 'invited' : page.inviteStatus,
      };

      setPages((current) =>
        current.map((item) => (item.id === page.id ? invitedPage : item))
      );
      setInviteComposerPage(invitedPage);
    } catch (err) {
      console.error(err);
      setError('Nem sikerült létrehozni a meghívót.');
    } finally {
      setWorkingPageId(null);
    }
  };

  const openInviteComposer = (page: OwnerPage) => {
    if (!page.inviteToken) {
      void createInvite(page);
      return;
    }

    if (isInviteExpired(page)) {
      void reassignExpiredInvite(page);
      return;
    }

    setInviteComposerPage(page);
  };

  const reassignExpiredInvite = async (page: OwnerPage) => {
    try {
      setWorkingPageId(page.id);
      setError(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/invite/reassign`,
        { method: 'POST', credentials: 'include' }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'PAGE_INVITE_REASSIGN_FAILED');
      }

      const reassignedPage: OwnerPage = {
        ...page,
        version: page.version + 1,
        inviteStatus: 'invited',
        inviteToken: data.inviteToken,
        inviteCreatedAt: data.inviteCreatedAt || null,
        inviteSentAt: null,
        inviteExpiresAt: data.inviteExpiresAt || null,
        inviteRecipientName: null,
        inviteRecipientEmail: null,
        inviteDeliveryMethod: null,
        submittedAt: null,
        ownerNote: null,
      };

      setPages((current) => current.map((item) => item.id === page.id ? reassignedPage : item));
      setInviteComposerPage(reassignedPage);
    } catch (err) {
      console.error(err);
      setError('Nem sikerült új címzettnek megnyitni az oldalt.');
    } finally {
      setWorkingPageId(null);
    }
  };

  const markInviteSent = async (
    page: OwnerPage,
    metadata: {
      recipientName: string;
      recipientEmail: string;
      deliveryMethod: 'share' | 'email';
    }
  ) => {
    const response = await fetch(
      `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/invite/sent`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata),
      }
    );

    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('UNAUTHENTICATED');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.inviteSentAt) {
      throw new Error(data?.error || 'PAGE_INVITE_SENT_STATE_FAILED');
    }

    const updatedPage: OwnerPage = {
      ...page,
      inviteSentAt: data.inviteSentAt,
      inviteCreatedAt: data.inviteCreatedAt || page.inviteCreatedAt || null,
      inviteExpiresAt: data.inviteExpiresAt || page.inviteExpiresAt || null,
      inviteRecipientName: data.inviteRecipientName || page.inviteRecipientName || null,
      inviteRecipientEmail: data.inviteRecipientEmail || page.inviteRecipientEmail || null,
      inviteDeliveryMethod: data.inviteDeliveryMethod || page.inviteDeliveryMethod || null,
    };

    setPages((current) =>
      current.map((item) => (item.id === page.id ? updatedPage : item))
    );
    setInviteComposerPage((current) =>
      current?.id === page.id ? updatedPage : current
    );
  };

  const updateVisibility = async (
    page: OwnerPage,
    visibility: 'active' | 'archived'
  ) => {
    try {
      setWorkingPageId(page.id);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/visibility`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ visibility }),
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.page) {
        throw new Error(data?.error || 'OWNER_PAGE_VISIBILITY_UPDATE_FAILED');
      }

      setPages((current) =>
        current.map((item) => (item.id === page.id ? data.page : item))
      );
    } catch (err) {
      console.error(err);
      setError('Nem sikerült módosítani az oldal állapotát.');
    } finally {
      setWorkingPageId(null);
    }
  };

  const updateSharing = async (page: OwnerPage, approved: boolean) => {
    try {
      setWorkingPageId(page.id);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}/sharing`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ approved }),
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.page) {
        if (data?.error === 'AUTHOR_SHARE_APPROVAL_REQUIRED') {
          throw new Error('AUTHOR_SHARE_APPROVAL_REQUIRED');
        }
        throw new Error(data?.error || 'OWNER_PAGE_SHARING_UPDATE_FAILED');
      }

      setPages((current) =>
        current.map((item) => (item.id === page.id ? data.page : item))
      );
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error && err.message === 'AUTHOR_SHARE_APPROVAL_REQUIRED'
          ? 'A szerző nem járult hozzá a nyilvános megosztáshoz.'
          : 'Nem sikerült módosítani a nyilvános megosztást.'
      );
    } finally {
      setWorkingPageId(null);
    }
  };

  const copyPublicLink = async (page: OwnerPage) => {
    if (!page.publicShareToken) return;
    const url = `${origin}/share/${page.publicShareToken}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopiedPageId(page.id);
      window.setTimeout(() => setCopiedPageId(null), 1800);
    } catch (err) {
      console.error(err);
      window.prompt('Másold ki a nyilvános linket:', url);
    }
  };

  const deleteSubmittedPage = async (page: OwnerPage) => {
    const confirmed = window.confirm(
      `Biztosan végleg törlöd a(z) ${page.pageNumber}. oldal beküldött tartalmát?\n\nA tartalom nem állítható vissza. Az oldal újra üres lesz, és később másnak is kiküldhető.`
    );

    if (!confirmed) return;

    try {
      setWorkingPageId(page.id);
      setError(null);

      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(page.id)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.page) {
        throw new Error(data?.error || 'OWNER_PAGE_DELETE_FAILED');
      }

      setPages((current) =>
        current.map((item) => (item.id === page.id ? data.page : item))
      );
    } catch (err) {
      console.error(err);
      setError('Nem sikerült törölni a beküldött oldalt.');
    } finally {
      setWorkingPageId(null);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <div style={styles.topRow}>
          <div>
            <a href="/my-books" style={styles.backLink}>← Saját könyveim</a>
            <div style={styles.brand}>MemoryBook</div>
            <h1 style={styles.title}>{bookTitle}</h1>
            <p style={styles.subtitle}>
              {bookType === 'event'
                ? 'A vendégek QR-kóddal írhatnak a rendezvény vendégkönyvébe. A beérkezett anyagokról te döntesz.'
                : 'Minden meghívó egyetlen konkrét oldalhoz tartozik. A beküldött oldalakat megtarthatod, archiválhatod vagy végleg törölheted.'}
            </p>
          </div>
        </div>

      {bookType === 'event' && eventInviteToken && (
        <section style={styles.eventPanel}>
          <div>
            <strong style={styles.eventPanelTitle}>Rendezvény vendégkönyv</strong>
            <div style={styles.eventPanelText}>Egy közös QR-kódot tehetsz ki a helyszínen. Minden vendég ugyanabba a vendégkönyvbe írhat.</div>
          </div>
          <div style={styles.eventActions}>
            <a href={`/my-books/${encodeURIComponent(bookId)}/event-qr`} style={styles.eventQrButton}>QR-kód megnyitása</a>
            <a href={`/organizer/${encodeURIComponent(bookId)}/contributions`} style={styles.eventSecondaryButton}>Beérkezett bejegyzések</a>
          </div>
        </section>
      )}

        {bookType === 'event' && <EventBookSettings bookId={bookId} />}

        {loading && <div style={styles.panel}>Betöltés...</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && bookType === 'standard' && (
          <div style={styles.grid}>
            {pages.map((page) => {
              const hasInvite = Boolean(page.inviteToken);
              const isSubmitted = page.inviteStatus === 'submitted';
              const isArchived = page.ownerVisibility === 'archived';
              const isWorking = workingPageId === page.id;

              return (
                <article
                  key={page.id}
                  style={
                    isArchived
                      ? { ...styles.card, ...styles.archivedCard }
                      : styles.card
                  }
                >
                  <div style={styles.cardTop}>
                    <strong style={styles.pageNumber}>Oldal {page.pageNumber}</strong>
                    <span style={styles.status}>
                      {displayStatusLabel(page)}
                    </span>
                  </div>

                  {isSubmitted ? (
                    <div>
                      <div style={styles.managementState}>
                        {isArchived
                          ? 'Elrejtve a könyvből, a tartalom megőrizve.'
                          : 'Könyvben marad.'}
                      </div>

                      {(page.inviteRecipientName || page.inviteRecipientEmail || page.submittedAt) && (
                        <div style={styles.memoryIdentitySummary}>
                          <strong>Emlék:</strong>{' '}
                          {page.inviteRecipientName || page.inviteRecipientEmail || 'Nincs azonosítva'}
                          {page.submittedAt ? ` · ${formatInviteExpiry(page.submittedAt)}` : ''}
                        </div>
                      )}

                      <div style={styles.shareState}>
                        Szerző jóváhagyása: <strong>{page.authorShareApproved ? 'igen' : 'nem'}</strong>
                        <br />
                        Tulajdonosi jóváhagyás: <strong>{page.ownerShareApproved ? 'igen' : 'nem'}</strong>
                      </div>

                      <div style={styles.managementActions}>
                        {page.authorShareApproved && (
                          <button
                            type="button"
                            onClick={() => updateSharing(page, !page.ownerShareApproved)}
                            disabled={isWorking}
                            style={styles.secondaryButton}
                          >
                            {page.ownerShareApproved
                              ? 'Nyilvános megosztás visszavonása'
                              : 'Nyilvános megosztás jóváhagyása'}
                          </button>
                        )}

                        {page.authorShareApproved &&
                          page.ownerShareApproved &&
                          page.publicShareToken && (
                            <button
                              type="button"
                              onClick={() => copyPublicLink(page)}
                              disabled={isWorking}
                              style={styles.primaryButton}
                            >
                              {copiedPageId === page.id
                                ? 'Nyilvános link kimásolva'
                                : 'Nyilvános link másolása'}
                            </button>
                          )}

                        <button
                          type="button"
                          onClick={() =>
                            updateVisibility(
                              page,
                              isArchived ? 'active' : 'archived'
                            )
                          }
                          disabled={isWorking}
                          style={styles.secondaryButton}
                        >
                          {isWorking
                            ? 'Folyamatban...'
                            : isArchived
                              ? 'Vissza a könyvbe'
                              : 'Elrejtés / archiválás'}
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteSubmittedPage(page)}
                          disabled={isWorking}
                          style={styles.dangerButton}
                        >
                          Végleges törlés
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {hasInvite && page.inviteExpiresAt && (
                        <div style={styles.inviteMeta}>
                          {isInviteExpired(page)
                            ? 'A meghívó lejárt. Az oldal új címzettnek kiadható.'
                            : <>A meghívó 14 napig használható. Lejár: {formatInviteExpiry(page.inviteExpiresAt)}</>}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => openInviteComposer(page)}
                        disabled={isWorking}
                        style={styles.primaryButton}
                      >
                        {isWorking
                          ? 'Készül...'
                          : !hasInvite
                            ? 'Meghívás'
                            : isInviteExpired(page)
                              ? 'Új címzett meghívása'
                              : page.inviteSentAt
                                ? 'Meghívó újraküldése'
                                : 'Meghívás folytatása'}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {inviteComposerPage?.inviteToken && (
        <InviteSendDialog
          key={inviteComposerPage.inviteToken}
          bookTitle={bookTitle}
          pageNumber={inviteComposerPage.pageNumber}
          pageUrl={`${origin}/p/${inviteComposerPage.inviteToken}`}
          ctaUrl={`${origin}/nekem-is-kell`}
          isResend={Boolean(inviteComposerPage.inviteSentAt)}
          expiresAt={inviteComposerPage.inviteExpiresAt || null}
          savedRecipientName={inviteComposerPage.inviteRecipientName || null}
          savedRecipientEmail={inviteComposerPage.inviteRecipientEmail || null}
          savedDeliveryMethod={
            inviteComposerPage.inviteDeliveryMethod === 'email'
              ? 'email'
              : inviteComposerPage.inviteDeliveryMethod === 'share'
                ? 'share'
                : null
          }
          onSent={(metadata) => markInviteSent(inviteComposerPage, metadata)}
          onClose={() => setInviteComposerPage(null)}
        />
      )}
    </main>
  );
}

function statusLabel(status: string) {
  switch (status) {
    case 'empty':
      return 'Üres';
    case 'invited':
      return 'Meghívva';
    case 'draft':
      return 'Szerkesztés alatt';
    case 'submitted':
      return 'Beküldve';
    default:
      return status;
  }
}

function displayStatusLabel(page: OwnerPage) {
  if (page.inviteStatus === 'submitted' && page.ownerVisibility === 'archived') {
    return 'Archiválva';
  }
  if (isInviteExpired(page)) {
    return 'Meghívó lejárt';
  }
  if (page.inviteStatus === 'invited' && page.inviteSentAt) {
    return 'Meghívó kiküldve';
  }

  return statusLabel(page.inviteStatus);
}

function isInviteExpired(page: OwnerPage) {
  if (page.inviteStatus === 'submitted' || !page.inviteExpiresAt) return false;
  const expires = new Date(page.inviteExpiresAt).getTime();
  return Number.isFinite(expires) && expires <= Date.now();
}

function formatInviteExpiry(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    padding: '16px 12px 36px',
    fontFamily: 'Arial, sans-serif',
    boxSizing: 'border-box',
  },
  container: {
    maxWidth: 1050,
    margin: '0 auto',
  },
  topRow: {
    marginBottom: 18,
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    marginBottom: 10,
    color: '#475569',
    textDecoration: 'none',
    fontWeight: 700,
  },
  brand: {
    color: '#64748b',
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    margin: '6px 0',
    color: '#0f172a',
    fontSize: 'clamp(24px, 8vw, 32px)',
    lineHeight: 1.15,
    overflowWrap: 'anywhere',
  },
  subtitle: {
    maxWidth: 760,
    margin: 0,
    color: '#64748b',
    lineHeight: 1.5,
    fontSize: 14,
  },
  eventPanel: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 16, padding: 16, borderRadius: 14, background: '#e2e8f0',
  },
  eventPanelTitle: { display: 'block', marginBottom: 4, color: '#0f172a', fontSize: 17 },
  eventPanelText: { maxWidth: 680, color: '#475569', fontSize: 14, lineHeight: 1.5 },
  eventActions: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  eventQrButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, padding: '10px 14px', borderRadius: 9, background: '#0f172a', color: '#ffffff', textDecoration: 'none', fontWeight: 800, whiteSpace: 'nowrap' },
  eventSecondaryButton: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 46, padding: '10px 14px', borderRadius: 9, border: '1px solid #cbd5e1', background: '#ffffff', color: '#334155', textDecoration: 'none', fontWeight: 800, whiteSpace: 'nowrap' },
  inviteMeta: { marginBottom: 10, color: '#64748b', fontSize: 12, lineHeight: 1.45 },
  memoryIdentitySummary: { margin: '8px 0 10px', padding: 10, borderRadius: 8, background: '#f8fafc', color: '#334155', fontSize: 13, lineHeight: 1.45 },
  panel: {
    padding: 24,
    borderRadius: 14,
    background: '#ffffff',
  },
  error: {
    marginBottom: 16,
    padding: 14,
    borderRadius: 10,
    background: '#fef2f2',
    color: '#991b1b',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
    gap: 14,
  },
  card: {
    padding: 16,
    borderRadius: 14,
    background: '#ffffff',
    boxShadow: '0 6px 20px rgba(15, 23, 42, 0.07)',
  },
  archivedCard: {
    background: '#f8fafc',
    border: '1px dashed #94a3b8',
  },
  cardTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  pageNumber: {
    color: '#0f172a',
    fontSize: 18,
    minWidth: 0,
  },
  status: {
    padding: '5px 8px',
    borderRadius: 999,
    background: '#e2e8f0',
    color: '#475569',
    fontSize: 12,
    fontWeight: 700,
    flexShrink: 0,
  },
  inviteBox: {
    overflow: 'hidden',
    marginBottom: 10,
    padding: 9,
    borderRadius: 8,
    background: '#f8fafc',
    color: '#475569',
    fontSize: 12,
    overflowWrap: 'anywhere',
    wordBreak: 'break-word',
    whiteSpace: 'normal',
    lineHeight: 1.4,
  },
  managementState: {
    marginBottom: 12,
    color: '#64748b',
    fontSize: 13,
    lineHeight: 1.45,
  },
  shareState: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    background: '#f8fafc',
    color: '#475569',
    fontSize: 13,
    lineHeight: 1.5,
  },
  managementActions: {
    display: 'grid',
    gap: 8,
  },
  primaryButton: {
    width: '100%',
    minHeight: 46,
    padding: '10px 12px',
    border: 0,
    borderRadius: 8,
    background: '#0f172a',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  secondaryButton: {
    width: '100%',
    minHeight: 46,
    padding: '10px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
  dangerButton: {
    width: '100%',
    minHeight: 46,
    padding: '10px 12px',
    border: '1px solid #fecaca',
    borderRadius: 8,
    background: '#fff7f7',
    color: '#b91c1c',
    fontSize: 14,
    fontWeight: 800,
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
};
