import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import QRCode from 'qrcode';
import { getAppLanguage, subscribeAppLanguage } from '../i18n';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { weddingTemplate } from '../../shared/event-templates';
import './wedding.css';

type Book = { id: string; title: string; starts_on: string; closed_at: string | null; invite_token: string; guest_url?: string };
type Submission = { id: string; guest_name: string; message: string; created_at: string };
type GuestEvent = { title: string; starts_on: string; closed: boolean; template_id: string; template_version: number };
type Capability = { authenticated: boolean; canCreate: boolean; internetPilot?: boolean };
const apiBase = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port === '5173'
  ? `${window.location.protocol}//${window.location.hostname}:3001` : '';

class ApiError extends Error { status: number; constructor(status: number, code: string) { super(code); this.status = status; } }
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${apiBase}/api/wedding${path}`, {
    credentials: 'include', method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new ApiError(response.status, data.error);
  return data;
}
function attemptKey() {
  // getRandomValues also works on a local phone's HTTP LAN test origin.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function WeddingPage() {
  const [language, setLanguage] = useState(getAppLanguage);
  useEffect(() => subscribeAppLanguage(setLanguage), []);
  const t = weddingTemplate.copy[language];
  const guestToken = window.location.pathname.match(/^\/wedding\/join\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  const bookId = window.location.pathname.match(/^\/wedding\/books\/([a-f0-9-]+)\/?$/)?.[1];
  const [capability, setCapability] = useState<Capability | null>(null);
  const [guest, setGuest] = useState<GuestEvent | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [names, setNames] = useState('');
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const attempt = useRef<{ name: string; message: string; idempotencyKey: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [success, setSuccess] = useState(false);
  const [qr, setQr] = useState('');
  const [qrError, setQrError] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (guestToken) {
          const result = await api<{ event: GuestEvent }>(`/guest/${guestToken}`);
          if (result.event.template_id !== weddingTemplate.id || result.event.template_version !== weddingTemplate.version) throw new Error('unavailable');
          if (!cancelled) setGuest(result.event);
        } else {
          const initialCaps = await api<Capability>('/capabilities');
          if (!initialCaps.internetPilot && new URLSearchParams(window.location.search).get('pilot') === '1') {
            await api('/pilot-login', {});
            window.history.replaceState(null, '', window.location.pathname);
          }
          const caps = await api<Capability>('/capabilities');
          if (cancelled) return;
          setCapability(caps);
          if (caps.authenticated && bookId) {
            const data = await api<{ book: Book; submissions: Submission[] }>(`/books/${bookId}`);
            if (!cancelled) { setBook(data.book); setSubmissions(data.submissions); }
          } else if (caps.authenticated) {
            const data = await api<{ books: Book[] }>('/books');
            if (!cancelled) setBooks(data.books);
          }
        }
      } catch { if (!cancelled) setError('unavailable'); }
      finally { if (!cancelled) setLoading(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [guestToken, bookId]);

  const link = book ? book.guest_url || `${window.location.origin}/wedding/join/${book.invite_token}` : '';
  useEffect(() => {
    let cancelled = false;
    if (link) void QRCode.toDataURL(link, { width: 320, margin: 4, errorCorrectionLevel: 'M' })
      .then(data => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setQrError(true); });
    return () => { cancelled = true; };
  }, [link]);

  function report(error: unknown) {
    if (error instanceof ApiError && error.status < 500) {
      if (error.status === 410) { setError('closed'); setGuest(g => g ? { ...g, closed: true } : g); }
      else setError(error.status === 429 ? 'limited' : error.status === 409 ? 'conflict' : error.status === 400 ? 'invalid' : 'unavailable');
    } else setError('network');
  }
  async function send() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    attempt.current ??= { name, message, idempotencyKey: attemptKey() };
    try {
      await api(`/guest/${guestToken}/submissions`, attempt.current);
      setSuccess(true); setUncertain(false);
    } catch (error) {
      report(error);
      const ambiguous = !(error instanceof ApiError) || error.status >= 500;
      setUncertain(ambiguous || error instanceof ApiError && (error.status === 429 || error.status === 409));
      if (!ambiguous && error instanceof ApiError && error.status === 400) attempt.current = null;
    } finally { setBusy(false); busyRef.current = false; }
  }
  const errorText = error ? t[error as keyof typeof t] || t.unavailable : '';
  const appearance = weddingTemplate.appearance;
  return <main className="wedding" style={{ background: appearance.background, color: appearance.ink, '--wedding-accent': appearance.accent } as CSSProperties}>
    <div className="wedding-shell">
      <header><a href="/wedding">{t.heading}</a><LanguageSwitcher /></header>
      {loading ? <p role="status">{t.loading}</p> : <>
        {errorText && <p className="wedding-error" role="alert">{errorText}</p>}
        {guestToken ? guest && <section className="wedding-card">
          <p>{t.step}</p><h1>{guest.title}</h1><p>{guest.starts_on}</p>
          {success ? <h2 role="status">{t.success}</h2> : guest.closed && !uncertain ? <p role="status">{t.closed}</p> : <>
            <p>{t.guestIntro}</p>
            <form onSubmit={e => { e.preventDefault(); void send(); }}>
              <div><label htmlFor="wedding-guest-name">{t.name}</label><input id="wedding-guest-name" name="guestName" autoComplete="name" required maxLength={100} value={name} disabled={busy || uncertain} onChange={e => setName(e.target.value)} /></div>
              <div><label htmlFor="wedding-guest-message">{t.message}</label><textarea id="wedding-guest-message" name="message" required maxLength={4000} rows={6} placeholder={t.prompt} value={message} disabled={busy || uncertain} onChange={e => setMessage(e.target.value)} /></div>
              <small>{message.length} / 4000</small>
              <button disabled={busy} type="submit">{busy ? t.sending : uncertain ? t.retry : t.send}</button>
            </form>
          </>}
        </section> : capability && <>
          {!capability.authenticated ? <section className="wedding-card"><p>{capability.internetPilot ? 'A tulajdonosi hozzáféréshez nyisd meg a neked adott egyszer használható meghívót. Jelszó nem szükséges.' : t.loginHint}</p>{!capability.internetPilot && <a className="wedding-button" href={`/login?returnTo=${encodeURIComponent(window.location.pathname)}`}>{t.login}</a>}</section> : book ? <>
            <a href="/wedding">{t.back}</a><h1>{book.title}</h1><p>{book.starts_on} · {t.owner}</p>
            <section className="wedding-card"><h2>{t.qr}</h2>
              {book.closed_at ? <p role="status">{t.closed}</p> : <>
                {qr && <><img className="wedding-qr" src={qr} alt={t.qr} /><a className="wedding-button" href={qr} download="vendegkonyv-qr.png">QR letöltése</a></>}{qrError && <p>{t.qrFailed}</p>}
                <label>{t.link}<input readOnly value={link} onFocus={e => e.target.select()} /></label>
                <button onClick={() => { void navigator.clipboard?.writeText(link).then(() => setCopyStatus('copied')).catch(() => setCopyStatus('copyFailed')); if (!navigator.clipboard) setCopyStatus('copyFailed'); }}>{t.copy}</button>
                {copyStatus && <p role="status">{copyStatus === 'copied' ? t.copied : t.copyFailed}</p>}
              </>}
            </section>
            <section className="wedding-card"><h2>{t.messages} ({submissions.length})</h2>
              <button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { const data = await api<{ book: Book; submissions: Submission[] }>(`/books/${book.id}`); setBook(data.book); setSubmissions(data.submissions); } catch (e) { report(e); } finally { setBusy(false); } }}>{t.refresh}</button>
              {!submissions.length && <p>{t.empty}</p>}
              {submissions.map(item => <article key={item.id}><h3>{item.guest_name}</h3><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString(language)}</time><p className="wedding-message">{item.message}</p></article>)}
            </section>
            {!book.closed_at && <section className="wedding-card">
              <label className="wedding-confirm"><input type="checkbox" checked={confirmClose} onChange={e => setConfirmClose(e.target.checked)} />{t.closeQuestion}</label>
              <button disabled={busy || !confirmClose} onClick={async () => { setBusy(true); setError(''); try { const data = await api<{ book: Book }>(`/books/${book.id}/close`, {}); setBook(data.book); } catch (e) { report(e); } finally { setBusy(false); } }}>{t.close}</button>
            </section>}
          </> : !bookId && <>
            <h1>{t.heading}</h1><p>{t.intro}</p>
            {capability.canCreate ? <section className="wedding-card"><form onSubmit={async e => {
              e.preventDefault(); if (busyRef.current) return; busyRef.current = true; setBusy(true); setError('');
              try { const data = await api<{ book: Book }>('/books', { names, date }); window.location.assign(`/wedding/books/${data.book.id}`); }
              catch (error) { report(error); setBusy(false); busyRef.current = false; }
            }}>
              <label>{t.names}<input required maxLength={160} value={names} onChange={e => setNames(e.target.value)} /></label>
              <label>{t.date}<input type="date" required value={date} onChange={e => setDate(e.target.value)} /></label>
              <button disabled={busy}>{busy ? t.sending : t.create}</button>
            </form></section> : <p>{t.pilot}</p>}
            <section className="wedding-card"><h2>{t.yourBooks}</h2>{books.map(item => <p key={item.id}><a href={`/wedding/books/${item.id}`}>{item.title} · {item.starts_on}</a></p>)}</section>
          </>}
        </>}
      </>}
    </div>
  </main>;
}
