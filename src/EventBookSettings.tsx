import { useEffect, useState, type FormEvent } from 'react';
import { ownerText, useOwnerUiLanguage } from './ownerUiI18n';

const API_BASE =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type Props = { bookId: string };
type SettingsResponse = {
  deviceLimit: number;
  identityMode: 'none' | 'google' | 'email' | 'external' | string;
};

export function EventBookSettings({ bookId }: Props) {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const [deviceLimit, setDeviceLimit] = useState(1);
  const [identityMode, setIdentityMode] = useState('none');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch(
          `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/event-settings`,
          { credentials: 'include' }
        );
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!response.ok) throw new Error('LOAD_FAILED');
        const data: SettingsResponse = await response.json();
        setDeviceLimit(data.deviceLimit || 1);
        setIdentityMode(data.identityMode || 'none');
      } catch (err) {
        console.error(err);
        setError(t('A rendezvény beállításait nem sikerült betölteni.'));
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [bookId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const nextLimit = Math.max(1, Math.min(100, Math.round(Number(deviceLimit) || 1)));
    try {
      setSaving(true);
      setError(null);
      setMessage(null);
      const response = await fetch(
        `${API_BASE}/api/my/books/${encodeURIComponent(bookId)}/event-settings`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceLimit: nextLimit }),
        }
      );
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error('SAVE_FAILED');
      setDeviceLimit(data.deviceLimit);
      setIdentityMode(data.identityMode || 'none');
      setMessage(t('Beállítás mentve.'));
    } catch (err) {
      console.error(err);
      setError(t('A beállítást nem sikerült menteni.'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <section style={styles.panel}>{t('Rendezvény beállítások betöltése...')}</section>;

  return (
    <section style={styles.panel}>
      <div style={styles.eyebrow}>{t('Beküldési szabályok')}</div>
      <h2 style={styles.title}>{t('Hány bejegyzés jöhet egy telefonról?')}</h2>
      <p style={styles.text}>
        {t('Ezt minden rendezvénykönyvnél külön állítod be. Nagy koncertnél vagy fesztiválnál tipikusan 1, családi rendezvénynél 5 vagy 10 lehet.')}
      </p>

      <form onSubmit={save} style={styles.form}>
        <label style={styles.label}>
          {t('Bejegyzések száma egy eszközről')}
          <input
            aria-label={t('Bejegyzések száma egy eszközről')}
            type="number"
            min={1}
            max={100}
            step={1}
            value={deviceLimit}
            onChange={(e) => setDeviceLimit(Number(e.target.value))}
            style={styles.input}
          />
        </label>
        <div style={styles.presets}>
          {[1, 2, 5, 10].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setDeviceLimit(value)}
              style={deviceLimit === value ? { ...styles.preset, ...styles.presetActive } : styles.preset}
            >
              {value}
            </button>
          ))}
        </div>
        <button type="submit" disabled={saving} style={styles.saveButton}>
          {saving ? t('Mentés...') : t('Beállítás mentése')}
        </button>
      </form>

      <div style={styles.identityBox}>
        <strong>{t('Azonosítás')}</strong>
        <div style={styles.identityValue}>{identityMode === 'none' ? t('Azonosítás nélkül') : identityMode}</div>
        <div style={styles.identityNote}>
          {t('Google-, e-mail- és rendezvényalkalmazás-azonosítás külön következő lépésben kapcsolható be. A mostani eszközlimit már működik.')}
        </div>
      </div>

      {message && <div style={styles.success}>{message}</div>}
      {error && <div style={styles.error}>{error}</div>}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { marginBottom: 16, padding: 16, borderRadius: 14, background: '#ffffff', boxShadow: '0 6px 20px rgba(15,23,42,.06)' },
  eyebrow: { color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.1 },
  title: { margin: '6px 0 8px', color: '#0f172a', fontSize: 20, lineHeight: 1.25 },
  text: { margin: '0 0 14px', color: '#475569', lineHeight: 1.5 },
  form: { display: 'grid', gap: 10 },
  label: { color: '#1e293b', fontWeight: 800 },
  input: { display: 'block', width: 120, maxWidth: '100%', minHeight: 48, marginTop: 7, padding: '10px 12px', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 17 },
  presets: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  preset: { minWidth: 48, minHeight: 44, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#334155', fontWeight: 800, cursor: 'pointer' },
  presetActive: { background: '#e2e8f0', borderColor: '#94a3b8', color: '#0f172a' },
  saveButton: { minHeight: 46, justifySelf: 'start', padding: '10px 16px', border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  identityBox: { marginTop: 16, paddingTop: 14, borderTop: '1px solid #e2e8f0', color: '#334155' },
  identityValue: { marginTop: 5, fontWeight: 800, color: '#0f172a' },
  identityNote: { marginTop: 5, color: '#64748b', fontSize: 13, lineHeight: 1.45 },
  success: { marginTop: 12, padding: 10, borderRadius: 8, background: '#ecfdf5', color: '#166534' },
  error: { marginTop: 12, padding: 10, borderRadius: 8, background: '#fef2f2', color: '#991b1b' },
};
