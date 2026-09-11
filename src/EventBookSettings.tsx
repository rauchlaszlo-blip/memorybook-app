import { useEffect, useState, type FormEvent } from 'react';
import { ownerText, useOwnerUiLanguage } from './ownerUiI18n';

const API_BASE =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://' + window.location.hostname + ':3001'
    : '';

type Props = { bookId: string };
type SettingsResponse = {
  deviceLimit: number;
  requiredFields?: RequiredField[];
  eventIsOpen: boolean;
  eventClosesAt?: string | null;
};

type RequiredField = 'name' | 'email' | 'phone' | 'festivalId' | 'ticketId';

const REQUIRED_FIELD_OPTIONS: Array<{ value: RequiredField; label: string }> = [
  { value: 'name', label: 'Név' },
  { value: 'email', label: 'E-mail-cím' },
  { value: 'phone', label: 'Telefonszám' },
  { value: 'festivalId', label: 'Fesztiválazonosító' },
  { value: 'ticketId', label: 'Belépőjegy-azonosító' },
];

function toLocalDateTimeValue(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function EventBookSettings({ bookId }: Props) {
  const language = useOwnerUiLanguage();
  const t = (key: string) => ownerText(language, key);
  const [deviceLimit, setDeviceLimit] = useState(1);
  const [requiredFields, setRequiredFields] = useState<RequiredField[]>([]);
  const [eventIsOpen, setEventIsOpen] = useState(true);
  const [eventClosesAt, setEventClosesAt] = useState('');
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
        setRequiredFields(Array.isArray(data.requiredFields) ? data.requiredFields : []);
        setEventIsOpen(data.eventIsOpen !== false);
        setEventClosesAt(data.eventClosesAt ? toLocalDateTimeValue(data.eventClosesAt) : '');
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
          body: JSON.stringify({
            deviceLimit: nextLimit,
            requiredFields,
            eventIsOpen,
            eventClosesAt: eventClosesAt ? new Date(eventClosesAt).toISOString() : null,
          }),
        }
      );
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await response.json().catch(() => null);
      if (!response.ok || !data) throw new Error('SAVE_FAILED');
      setDeviceLimit(data.deviceLimit);
      setRequiredFields(Array.isArray(data.requiredFields) ? data.requiredFields : []);
      setEventIsOpen(data.eventIsOpen !== false);
      setEventClosesAt(data.eventClosesAt ? toLocalDateTimeValue(data.eventClosesAt) : '');
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
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>{t('Vendégkönyv elérhetősége')}</legend>
          <label style={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={eventIsOpen}
              onChange={(event) => setEventIsOpen(event.target.checked)}
            />
            <span>{t('A vendégkönyv nyitva van')}</span>
          </label>
          <label style={{ ...styles.label, display: 'block', marginTop: 10 }}>
            {t('Automatikus lezárás (opcionális)')}
            <input
              type="datetime-local"
              value={eventClosesAt}
              onChange={(event) => setEventClosesAt(event.target.value)}
              style={{ ...styles.input, width: '100%' }}
            />
          </label>
          <div style={styles.fieldHint}>{t('Ha nem adsz meg időpontot, a vendégkönyv addig marad nyitva, amíg kézzel le nem zárod.')}</div>
        </fieldset>
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
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>{t('Beküldés előtt kért adatok')}</legend>
          <div style={styles.fieldOptions}>
            {REQUIRED_FIELD_OPTIONS.map((option) => (
              <label key={option.value} style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={requiredFields.includes(option.value)}
                  onChange={(event) => {
                    setRequiredFields((current) =>
                      event.target.checked
                        ? [...current, option.value]
                        : current.filter((field) => field !== option.value)
                    );
                  }}
                />
                <span>{t(option.label)}</span>
              </label>
            ))}
          </div>
          <div style={styles.fieldHint}>{t('Csak a kijelölt adatokat kell majd a vendégnek megadnia.')}</div>
        </fieldset>
        <button type="submit" disabled={saving} style={styles.saveButton}>
          {saving ? t('Mentés...') : t('Beállítás mentése')}
        </button>
      </form>

      {message && <div style={styles.success}>{message}</div>}
      {error && <div style={styles.error}>{error}</div>}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: { width: 'min(100%, 560px)', margin: '12px auto 16px', padding: 16, boxSizing: 'border-box', borderRadius: 14, background: '#ffffff', boxShadow: '0 6px 20px rgba(15,23,42,.06)' },
  eyebrow: { color: '#64748b', fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.1 },
  title: { margin: '6px 0 8px', color: '#0f172a', fontSize: 20, lineHeight: 1.25 },
  text: { margin: '0 0 14px', color: '#475569', lineHeight: 1.5 },
  form: { display: 'grid', gap: 10 },
  label: { color: '#1e293b', fontWeight: 800 },
  input: { display: 'block', width: 120, maxWidth: '100%', minHeight: 48, marginTop: 7, padding: '10px 12px', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 17 },
  presets: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  fieldset: { margin: '8px 0 0', padding: 12, border: '1px solid #cbd5e1', borderRadius: 10 },
  legend: { padding: '0 6px', color: '#1e293b', fontWeight: 800 },
  fieldOptions: { display: 'grid', gap: 10 },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 9, minHeight: 34, color: '#334155', fontWeight: 700 },
  fieldHint: { marginTop: 10, color: '#64748b', fontSize: 13, lineHeight: 1.4 },
  preset: { minWidth: 48, minHeight: 44, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', color: '#334155', fontWeight: 800, cursor: 'pointer' },
  presetActive: { background: '#e2e8f0', borderColor: '#94a3b8', color: '#0f172a' },
  saveButton: { minHeight: 46, justifySelf: 'start', padding: '10px 16px', border: 0, borderRadius: 8, background: '#0f172a', color: '#fff', fontWeight: 800, cursor: 'pointer' },
  success: { marginTop: 12, padding: 10, borderRadius: 8, background: '#ecfdf5', color: '#166534' },
  error: { marginTop: 12, padding: 10, borderRadius: 8, background: '#fef2f2', color: '#991b1b' },
};
