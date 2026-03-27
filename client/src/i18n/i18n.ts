import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from './locales/en.json';

export const RTL_LANGUAGES = ['ar', 'fa', 'he', 'ku', 'ps'];

export const SUPPORTED_LANGUAGES: ReadonlyArray<{ code: string; label: string; beta: boolean }> = [
  { code: 'en', label: 'English', beta: false },
  { code: 'es', label: 'Espa\u00f1ol', beta: true },
  { code: 'fr', label: 'Fran\u00e7ais', beta: true },
  { code: 'de', label: 'Deutsch', beta: true },
  { code: 'pt', label: 'Portugu\u00eas', beta: true },
  { code: 'zh', label: '\u4e2d\u6587', beta: true },
  { code: 'ja', label: '\u65e5\u672c\u8a9e', beta: true },
  { code: 'ko', label: '\ud55c\uad6d\uc5b4', beta: true },
  { code: 'ru', label: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439', beta: true },
  { code: 'uk', label: '\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430', beta: true },
  { code: 'ar', label: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', beta: true },
  { code: 'fa', label: '\u0641\u0627\u0631\u0633\u06cc', beta: true },
  { code: 'he', label: '\u05e2\u05d1\u05e8\u05d9\u05ea', beta: true },
  { code: 'ku', label: '\u06a9\u0648\u0631\u062f\u06cc', beta: true },
  { code: 'my', label: '\u1019\u103c\u1014\u103a\u1019\u102c', beta: true },
  { code: 'ps', label: '\u067e\u069a\u062a\u0648', beta: true },
];

const SUPPORTED_CODES = SUPPORTED_LANGUAGES.map(l => l.code);

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_CODES,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'discreet_locale',
      caches: ['localStorage'],
    },
    react: { useSuspense: false },
  });

/** Lazy-load a non-English locale bundle on demand. */
const loadLocale = async (lang: string): Promise<void> => {
  if (lang === 'en') return;
  if (i18n.hasResourceBundle(lang, 'translation')) return;
  try {
    const mod = await import(`./locales/${lang}.json`);
    i18n.addResourceBundle(lang, 'translation', mod.default, true, true);
  } catch (err) {
    console.warn(`Failed to load locale: ${lang}`, err);
  }
};

i18n.on('languageChanged', async (lng) => {
  const dir = RTL_LANGUAGES.includes(lng) ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
  await loadLocale(lng);
});

// Set direction for the initial language (languageChanged does not fire during init).
const initLng = i18n.language || 'en';
document.documentElement.dir = RTL_LANGUAGES.includes(initLng) ? 'rtl' : 'ltr';
document.documentElement.lang = initLng;
if (initLng !== 'en') {
  loadLocale(initLng);
}

export default i18n;

/**
 * Switch language: loads the bundle, applies it, persists server-side.
 */
export async function setLanguage(lang: string): Promise<void> {
  await loadLocale(lang);
  await i18n.changeLanguage(lang);
  try {
    const { api } = await import('../api/CitadelAPI');
    if (api?.userId) {
      api.updateSettings({ locale: lang }).catch(() => {});
    }
  } catch { /* not authenticated */ }
}
