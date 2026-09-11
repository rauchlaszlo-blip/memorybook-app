import { useEffect, useMemo, useState } from 'react';
import { InviteSendDialog } from './InviteSendDialog.tsx';
import { EventBookSettings } from './EventBookSettings.tsx';
import { normalizeAppLanguage, SUPPORTED_APP_LANGUAGES, type AppLanguage } from './i18n';
import { ownerFormat, ownerLocale, ownerText, useOwnerUiLanguage } from './ownerUiI18n';

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
  inviteLanguage?: AppLanguage | null;
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
  const uiLanguage = useOwnerUiLanguage();
  const t = (key: string) => ownerText(uiLanguage, key);
  const f = (key: string, values: Record<string, string | number>) => ownerFormat(uiLanguage, key, values);
  const [bookTitle, setBookTitle] = useState('MemoryBook');
  const [eventInviteToken, setEventInviteToken] = useState<string | null>(null);
  const [bookType, setBookType] = useState<'standard' | 'event' | 'dedication'>('standard');
  const [bookLanguage, setBookLanguage] = useState<AppLanguage>('hu');
  const [languageSaving, setLanguageSaving] = useState(false);
  const [pages, setPages] = useState<OwnerPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workingPageId, setWorkingPageId] = useState<string | null>(null);
  const [copiedPageId, setCopiedPageId] = useState<string | null>(null);
  const [inviteComposerPage, setInviteComposerPage] = useState<OwnerPage | null>(null);
  const [ownMemoryOpening, setOwnMemoryOpening] = useState(false);

  const origin = useMemo(() => window.location.origin, []);
  const targetPageId = useMemo(
    () => new URLSearchParams(window.location.search).get('page'),
    []
  );
  const displayedPages = useMemo(() => {
    if (targetPageId) {
      return pages.filter((page) => page.id === targetPageId);
    }
    if (bookType === 'standard') {
      const nextEmptyPage = pages
        .filter((page) => page.inviteStatus === 'empty')
        .sort((a, b) => a.pageNumber - b.pageNumber)[0];
      return nextEmptyPage ? [nextEmptyPage] : [];
    }
    return pages;
  }, [bookType, pages, targetPageId]);
  const nextDedicationPage = useMemo(
    () => pages
      .filter((page) => page.inviteStatus === 'empty')
      .sort((a, b) => a.pageNumber - b.pageNumber)[0] ?? null,
    [pages]
  );

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
        setBookType(data.book?.bookType === 'event'
          ? 'event'
          : data.book?.bookType === 'dedication'
            ? 'dedication'
            : 'standard');
        setBookLanguage(normalizeAppLanguage(data.book?.language) ?? 'hu');
        setPages(Array.isArray(data.pages) ? data.pages : []);
      } catch (err) {
        console.error(err);
        setError(t('Nem sikerült betölteni a könyv oldalait.'));
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [bookId]);

  useEffect(() => {
    if (loading || bookType !== 'standard' || !targetPageId) return;

    const target = document.getElementById(`owner-page-${targetPageId}`);
    if (!target) return;

    const timer = window.setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);

    return () => window.clearTimeout(timer);
  }, [loading, bookType, pages, targetPageId]);

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
      setError(t('Nem sikerült létrehozni a meghívót.'));
    } finally {
      setWorkingPageId(null);
    }
  };

  const openOwnMemory = async () => {
    if (ownMemoryOpening) return;
    try {
      setOwnMemoryOpening(true);
      setError(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/own-memory`,
        { method: 'POST', credentials: 'include' }
      );
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.pageId) throw new Error(data.error || 'OWNER_MEMORY_OPEN_FAILED');
      window.location.href = `/my-books/${encodeURIComponent(bookId)}/memory/${encodeURIComponent(data.pageId)}`;
    } catch (err) {
      console.error(err);
      setError(t('A saját emléklapot nem sikerült megnyitni.'));
      setOwnMemoryOpening(false);
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
        inviteLanguage: null,
        submittedAt: null,
        ownerNote: null,
      };

      setPages((current) => current.map((item) => item.id === page.id ? reassignedPage : item));
      setInviteComposerPage(reassignedPage);
    } catch (err) {
      console.error(err);
      setError(t('Nem sikerült új címzettnek megnyitni az oldalt.'));
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
      inviteLanguage: AppLanguage | null;
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
      inviteLanguage: normalizeAppLanguage(data.inviteLanguage),
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
      setError(t('Nem sikerült módosítani az oldal állapotát.'));
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
          ? t('A szerző nem járult hozzá a nyilvános megosztáshoz.')
          : t('Nem sikerült módosítani a nyilvános megosztást.')
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
      window.prompt(t('Másold ki a nyilvános linket:'), url);
    }
  };

  const deleteSubmittedPage = async (page: OwnerPage) => {
    const confirmed = window.confirm(
      f('Biztosan végleg törlöd a(z) {page}. oldal beküldött tartalmát?\n\nA tartalom nem állítható vissza. Az oldal újra üres lesz, és később másnak is kiküldhető.', { page: page.pageNumber })
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
      setError(t('Nem sikerült törölni a beküldött oldalt.'));
    } finally {
      setWorkingPageId(null);
    }
  };

  const updateBookLanguage = async (language: AppLanguage) => {
    try {
      setLanguageSaving(true);
      setError(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/language`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language }),
        }
      );

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.book?.language) {
        throw new Error(data?.error || 'BOOK_LANGUAGE_UPDATE_FAILED');
      }

      setBookLanguage(normalizeAppLanguage(data.book.language) ?? 'hu');
    } catch (err) {
      console.error(err);
      setError(t('A könyv nyelvét nem sikerült módosítani.'));
    } finally {
      setLanguageSaving(false);
    }
  };

  return (
    <main style={styles.page}>
      <section style={styles.container}>
        <div style={styles.topRow}>
          <div>
            <a href="/my-books" style={styles.backLink}>{t('← Saját könyveim')}</a>
            <div style={styles.brand}>MemoryBook</div>
            <h1 style={styles.title}>{bookTitle}</h1>
            <label style={styles.bookLanguageLabel}>
              {t('Könyv nyelve')}
              <select
                value={bookLanguage}
                onChange={(event) => void updateBookLanguage(event.target.value as AppLanguage)}
                disabled={languageSaving}
                style={styles.bookLanguageSelect}
                aria-label={t('Könyv nyelve')}
              >
                {SUPPORTED_APP_LANGUAGES.map((item) => (
                  <option key={item.code} value={item.code}>{item.label}</option>
                ))}
              </select>
            </label>
            <p style={styles.subtitle}>
              {bookType === 'event'
                ? t('A vendégek QR-kóddal írhatnak a rendezvény vendégkönyvébe. A beérkezett anyagokról te döntesz.')
                : bookType === 'dedication'
                  ? t('Gyűjts fényképes aláírásokat gyorsan, egymás után.')
                  : t('A következő üres oldalhoz innen küldhetsz meghívót.')}
            </p>
          </div>
        </div>

        {bookType === 'event' && <EventBookSettings bookId={bookId} />}

        {!loading && (
          <section style={styles.eventPanel}>
            <div>
              <strong style={styles.eventPanelTitle}>{t('Saját emlék')}</strong>
              <div style={styles.eventPanelText}>{t('Készíts saját emlékoldalt szöveggel, rajzzal és képpel.')}</div>
            </div>
            <button type="button" style={styles.eventQrButton} onClick={openOwnMemory} disabled={ownMemoryOpening}>
              {ownMemoryOpening ? t('Megnyitás…') : t('Saját emlék létrehozása')}
            </button>
          </section>
        )}

      {bookType === 'event' && eventInviteToken && (
        <section style={styles.eventPanel}>
          <div>
            <strong style={styles.eventPanelTitle}>{t('QR-kódos vendégkönyv')}</strong>
            <div style={styles.eventPanelText}>{t('Családi vagy nagy közösségi eseményen egy közös QR-kódot tehetsz ki. Minden vendég ugyanabba a vendégkönyvbe írhat.')}</div>
          </div>
          <div style={styles.eventActions}>
            <a href={`/my-books/${encodeURIComponent(bookId)}/event-qr`} style={styles.eventQrButton}>{t('QR-kód megnyitása')}</a>
            <a href={`/book/${encodeURIComponent(bookId)}/view`} style={styles.eventSecondaryButton}>{t('Könyv megnyitása')}</a>
            <a href={`/my-books/${encodeURIComponent(bookId)}/cover`} style={styles.eventSecondaryButton}>{t('Fedőlap szerkesztése')}</a>
          </div>
        </section>
      )}

        {!loading && bookType === 'dedication' && (
          <section style={styles.eventPanel}>
            <div>
              <strong style={styles.eventPanelTitle}>{t('Dedikálás')}</strong>
              <div style={styles.eventPanelText}>{t('A következő üres oldal automatikusan nyílik majd meg.')}</div>
            </div>
            <div style={styles.eventActions}>
              <button
                type="button"
                style={styles.eventQrButton}
                disabled={!nextDedicationPage}
                onClick={() => {
                  if (!nextDedicationPage) return;
                  window.location.href = `/my-books/${encodeURIComponent(bookId)}/dedication/${encodeURIComponent(nextDedicationPage.id)}`;
                }}
              >
                {t('Következő dedikálás')}
              </button>
              <a href={`/book/${encodeURIComponent(bookId)}/view`} style={styles.eventSecondaryButton}>
                {t('Könyv megnyitása')}
              </a>
              <a href={`/my-books/${encodeURIComponent(bookId)}/cover`} style={styles.eventSecondaryButton}>
                {t('Fedőlap szerkesztése')}
              </a>
            </div>
          </section>
        )}

        {loading && <div style={styles.panel}>{t('Betöltés...')}</div>}
        {error && <div style={styles.error}>{error}</div>}

        {!loading && bookType === 'standard' && (
          <div style={styles.grid}>
            {displayedPages.map((page) => {
              const hasInvite = Boolean(page.inviteToken);
              const isSubmitted = page.inviteStatus === 'submitted';
              const isArchived = page.ownerVisibility === 'archived';
              const isWorking = workingPageId === page.id;

              return (
                <article
                  key={page.id}
                  id={`owner-page-${page.id}`}
                  style={{
                    ...styles.card,
                    ...(isArchived ? styles.archivedCard : {}),
                    ...(targetPageId === page.id ? styles.targetCard : {}),
                  }}
                >
                  <div style={styles.cardTop}>
                    <strong style={styles.pageNumber}>{f('Oldal {page}', { page: page.pageNumber })}</strong>
                    <span style={styles.status}>
                      {displayStatusLabel(page, uiLanguage)}
                    </span>
                  </div>

                  {isSubmitted ? (
                    <div>
                      <div style={styles.managementState}>
                        {isArchived
                          ? t('Elrejtve a könyvből, a tartalom megőrizve.')
                          : t('Könyvben marad.')}
                      </div>

                      {(page.inviteRecipientName || page.inviteRecipientEmail || page.submittedAt) && (
                        <div style={styles.memoryIdentitySummary}>
                          <strong>{t('Emlék:')}</strong>{' '}
                          {page.inviteRecipientName || page.inviteRecipientEmail || t('Nincs azonosítva')}
                          {page.submittedAt ? ` · ${formatInviteExpiry(page.submittedAt, uiLanguage)}` : ''}
                        </div>
                      )}

                      <div style={styles.shareState}>
                        {t('Szerző jóváhagyása:')} <strong>{page.authorShareApproved ? t('igen') : t('nem')}</strong>
                        <br />
                        {t('Tulajdonosi jóváhagyás:')} <strong>{page.ownerShareApproved ? t('igen') : t('nem')}</strong>
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
                              ? t('Nyilvános megosztás visszavonása')
                              : t('Nyilvános megosztás jóváhagyása')}
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
                                ? t('Nyilvános link kimásolva')
                                : t('Nyilvános link másolása')}
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
                            ? t('Folyamatban...')
                            : isArchived
                              ? t('Vissza a könyvbe')
                              : t('Elrejtés / archiválás')}
                        </button>

                        <button
                          type="button"
                          onClick={() => deleteSubmittedPage(page)}
                          disabled={isWorking}
                          style={styles.dangerButton}
                        >
                          {t('Végleges törlés')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {hasInvite && page.inviteExpiresAt && (isInviteExpired(page) || Boolean(page.inviteSentAt && (page.inviteRecipientName || page.inviteRecipientEmail))) && (
                        <div style={styles.inviteMeta}>
                          {isInviteExpired(page)
                            ? t('A meghívó lejárt. Az oldal új címzettnek kiadható.')
                            : null}
                          {!isInviteExpired(page) && page.inviteSentAt && (page.inviteRecipientName || page.inviteRecipientEmail) && (
                            <strong>{f('Aktív címzett: {name}', { name: page.inviteRecipientName || page.inviteRecipientEmail || '' })}</strong>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => openInviteComposer(page)}
                        disabled={isWorking}
                        style={styles.primaryButton}
                      >
                        {isWorking
                          ? t('Készül...')
                          : !hasInvite
                            ? t('Meghívás')
                            : isInviteExpired(page)
                              ? t('Új címzett meghívása')
                              : page.inviteSentAt
                                ? (page.inviteRecipientName || page.inviteRecipientEmail
                                    ? f('Újraküldés: {name}', { name: page.inviteRecipientName || page.inviteRecipientEmail || '' })
                                    : t('Meghívó újraküldése'))
                                : t('Meghívás folytatása')}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
            {displayedPages.length === 0 && !targetPageId && (
              <div style={styles.panel}>{t('Nincs több üres, meghívható oldal.')}</div>
            )}
          </div>
        )}
      </section>

      {inviteComposerPage?.inviteToken && (
        <InviteSendDialog
          key={inviteComposerPage.inviteToken}
          bookTitle={bookTitle}
          pageNumber={inviteComposerPage.pageNumber}
          pageUrl={`${origin}/p/${inviteComposerPage.inviteToken}`}
          bookLanguage={bookLanguage}
          savedInviteLanguage={inviteComposerPage.inviteLanguage || null}
          isResend={Boolean(inviteComposerPage.inviteSentAt)}
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

function statusLabel(status: string, language: AppLanguage) {
  switch (status) {
    case 'empty':
      return ownerText(language, 'Üres');
    case 'invited':
      return ownerText(language, 'Meghívva');
    case 'draft':
      return ownerText(language, 'Szerkesztés alatt');
    case 'submitted':
      return ownerText(language, 'Beküldve');
    default:
      return status;
  }
}

function displayStatusLabel(page: OwnerPage, language: AppLanguage) {
  if (page.inviteStatus === 'submitted' && page.ownerVisibility === 'archived') {
    return ownerText(language, 'Archiválva');
  }
  if (isInviteExpired(page)) {
    return ownerText(language, 'Meghívó lejárt');
  }
  if (page.inviteStatus === 'invited' && page.inviteSentAt) {
    return ownerText(language, 'Meghívó kiküldve');
  }

  return statusLabel(page.inviteStatus, language);
}

function isInviteExpired(page: OwnerPage) {
  if (page.inviteStatus === 'submitted' || !page.inviteExpiresAt) return false;
  const expires = new Date(page.inviteExpiresAt).getTime();
  return Number.isFinite(expires) && expires <= Date.now();
}

function formatInviteExpiry(value: string, language: AppLanguage) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(ownerLocale(language), { year: 'numeric', month: '2-digit', day: '2-digit' });
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
  bookLanguageLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 10,
    fontSize: 14,
    fontWeight: 700,
    color: '#475569',
  },
  bookLanguageSelect: {
    minHeight: 40,
    padding: '7px 9px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 700,
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
  targetCard: {
    outline: '3px solid #2563eb',
    outlineOffset: 2,
    boxShadow: '0 10px 28px rgba(37, 99, 235, 0.22)',
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
