// src/web/hooks/useI18n.ts — React hook for translations.
import { useState } from 'react';
import { t, setLocale, getLocale } from '../lib/i18n';

export function useI18n() {
  const [, force] = useState(0);
  return {
    t,
    setLocale,
    locale: getLocale(),
    rerender: () => force((n) => n + 1),
  };
}
