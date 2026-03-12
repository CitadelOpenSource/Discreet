/**
 * i18n.ts — i18next initialisation for Discreet.
 *
 * English is bundled synchronously as the default. All other locales are
 * lazy-loaded on demand so the initial JS bundle stays lean.
 *
 * RTL support:
 *   Arabic (ar) and Farsi (fa) set document.dir = "rtl" when active.
 *   All other languages use the default LTR direction.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';

// Languages that read right-to-left.
const RTL_LANGS = new Set(['ar', 'fa']);

// Detect the user's preferred language from browser settings,
// falling back to English if unsupported.
const SUPPORTED = ['en', 'es', 'ar', 'zh', 'ru', 'ja', 'fa', 'uk', 'pt', 'fr', 'ko', 'tr'];
const detected =
  navigator.language?.split('-')[0] ??
  (navigator.languages?.[0]?.split('-')[0]) ??
  'en';
const lng = SUPPORTED.includes(detected) ? detected : 'en';

/** Lazy-load a locale JSON and add it to i18next. */
async function loadLocale(lang: string): Promise<void> {
  if (lang === 'en') return; // already bundled
  try {
    const mod = await import(`./${lang}.json`);
    i18n.addResourceBundle(lang, 'translation', mod.default ?? mod, true, true);
  } catch {
    console.warn(`[i18n] Failed to load locale: ${lang}`);
  }
}

/** Apply LTR/RTL direction to the document root. */
function applyDir(lang: string): void {
  document.documentElement.dir = RTL_LANGS.has(lang) ? 'rtl' : 'ltr';
  document.documentElement.lang = lang;
}

i18n
  .use(initReactI18next)
  .init({
    lng,
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
    },
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: false,
    },
  });

// Apply direction for the initial language.
applyDir(lng);

// Lazy-load non-English locale if needed.
if (lng !== 'en') {
  loadLocale(lng).then(() => {
    i18n.changeLanguage(lng);
  });
}

// Re-apply direction and lazy-load on language change.
i18n.on('languageChanged', (lang: string) => {
  applyDir(lang);
  loadLocale(lang).then(() => {
    // Trigger a re-render by explicitly setting the language after the
    // resource bundle has been added.
    if (!i18n.hasResourceBundle(lang, 'translation')) return;
    i18n.changeLanguage(lang);
  });
});

export default i18n;

/**
 * Programmatically switch language. Exported for use in Settings.
 */
export async function setLanguage(lang: string): Promise<void> {
  await loadLocale(lang);
  await i18n.changeLanguage(lang);
}

/** Returns the current text direction for the active language. */
export function currentDir(): 'ltr' | 'rtl' {
  return RTL_LANGS.has(i18n.language) ? 'rtl' : 'ltr';
}
