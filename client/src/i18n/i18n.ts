import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';

const RTL_LANGUAGES = ['ar', 'fa', 'he', 'ku', 'ps'];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'discreet_locale',
      caches: ['localStorage'],
    },
    react: { useSuspense: false },
  });

i18n.on('languageChanged', (lng) => {
  const dir = RTL_LANGUAGES.includes(lng) ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
});

// Apply direction for the initial language detected by LanguageDetector.
// The languageChanged event does not fire during init(), so set it explicitly.
const initLng = i18n.language || 'en';
document.documentElement.dir = RTL_LANGUAGES.includes(initLng) ? 'rtl' : 'ltr';
document.documentElement.lang = initLng;

export { RTL_LANGUAGES };
export default i18n;

/**
 * Programmatically switch language.
 * 1. Applies language immediately via i18next (updates UI + localStorage via detector)
 * 2. Persists to server (best-effort, no-op if not authenticated)
 */
export async function setLanguage(lang: string): Promise<void> {
  await i18n.changeLanguage(lang);
  // Best-effort server-side persistence
  try {
    const { api } = await import('../api/CitadelAPI');
    if (api?.userId) {
      api.updateSettings({ locale: lang }).catch(() => {});
    }
  } catch { /* not authenticated */ }
}
