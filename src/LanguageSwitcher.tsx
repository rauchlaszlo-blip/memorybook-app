import { useEffect, useState } from 'react';
import {
  getAppLanguage,
  setAppLanguage,
  subscribeAppLanguage,
  SUPPORTED_APP_LANGUAGES,
  type AppLanguage,
} from './i18n';

export function LanguageSwitcher() {
  const [language, setLanguage] = useState<AppLanguage>(() => getAppLanguage());

  useEffect(() => subscribeAppLanguage(setLanguage), []);

  return (
    <select
      value={language}
      onChange={(event) => {
        const nextLanguage = event.target.value as AppLanguage;
        setAppLanguage(nextLanguage);
        setLanguage(nextLanguage);
      }}
      aria-label={language === 'hu' ? 'Alkalmazás nyelve' : 'Application language'}
      style={styles.select}
    >
      {SUPPORTED_APP_LANGUAGES.map((item) => (
        <option key={item.code} value={item.code}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

const styles: Record<string, React.CSSProperties> = {
  select: {
    minHeight: 44,
    padding: '9px 10px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    background: '#ffffff',
    color: '#334155',
    fontWeight: 700,
    cursor: 'pointer',
  },
};
