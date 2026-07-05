// src/web/lib/i18n.ts — tiny key-based translation system.
export type Locale = 'en' | string;
export type Translations = Record<string, string>;

let currentLocale: Locale = 'en';
const translations: Record<Locale, Translations> = { en: {} };

export function setLocale(locale: Locale, dict?: Translations) {
  currentLocale = locale;
  if (dict) translations[locale] = dict;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let s = translations[currentLocale]?.[key] || translations['en']?.[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

export function getLocale(): Locale {
  return currentLocale;
}
