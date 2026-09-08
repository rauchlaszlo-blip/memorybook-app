export type AppLanguage = 'hu' | 'en' | 'de';

export const APP_LANGUAGE_STORAGE_KEY = 'memorybook.appLanguage';
export const APP_LANGUAGE_CHANGE_EVENT = 'memorybook:app-language-change';

export const SUPPORTED_APP_LANGUAGES: ReadonlyArray<{
  code: AppLanguage;
  label: string;
}> = [
  { code: 'hu', label: 'Magyar' },
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
];

export function normalizeAppLanguage(value: string | null | undefined): AppLanguage | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace('_', '-').split('-')[0];
  return normalized === 'hu' || normalized === 'en' || normalized === 'de'
    ? normalized
    : null;
}

export function detectBrowserAppLanguage(): AppLanguage {
  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ];

  for (const candidate of candidates) {
    const supported = normalizeAppLanguage(candidate);
    if (supported) return supported;
  }

  return 'en';
}

export function getAppLanguage(): AppLanguage {
  const stored = normalizeAppLanguage(window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY));
  return stored ?? detectBrowserAppLanguage();
}

export function applyAppLanguage(language: AppLanguage) {
  document.documentElement.lang = language;
}

export function initializeAppLanguage(): AppLanguage {
  const language = getAppLanguage();
  applyAppLanguage(language);
  return language;
}

export function setAppLanguage(language: AppLanguage) {
  window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language);
  applyAppLanguage(language);
  window.dispatchEvent(
    new CustomEvent<AppLanguage>(APP_LANGUAGE_CHANGE_EVENT, { detail: language })
  );
}

export function subscribeAppLanguage(listener: (language: AppLanguage) => void) {
  const onLanguageChange = (event: Event) => {
    const customEvent = event as CustomEvent<AppLanguage>;
    const language = normalizeAppLanguage(customEvent.detail);
    if (language) listener(language);
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== APP_LANGUAGE_STORAGE_KEY) return;
    const language = normalizeAppLanguage(event.newValue) ?? detectBrowserAppLanguage();
    applyAppLanguage(language);
    listener(language);
  };

  window.addEventListener(APP_LANGUAGE_CHANGE_EVENT, onLanguageChange);
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener(APP_LANGUAGE_CHANGE_EVENT, onLanguageChange);
    window.removeEventListener('storage', onStorage);
  };
}
