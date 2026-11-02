import { readPreferences, subscribePreferences } from '@achoo254/app-shell/preferences';
import { type ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { brand } from '../brand';
import { type MessageKey, type Messages, en, vi } from './messages';

export const LOCALES = ['vi', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

const DICTIONARIES: Record<Locale, Messages> = { vi, en };

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** Fills `{name}` placeholders; `{app}` is always the brand name. */
export function format(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    if (name === 'app') return brand.appName;
    const value = vars[name];
    return value === undefined ? whole : String(value);
  });
}

export function translator(locale: Locale): Translate {
  const dictionary = DICTIONARIES[locale];
  return (key, vars) => format(dictionary[key], vars);
}

export const isLocale = (value: unknown): value is Locale => value === 'vi' || value === 'en';

/** `?lang=` wins (a shared link), then the saved choice, then Vietnamese. */
export function initialLocale(search: string, stored: Locale | undefined): Locale {
  const fromQuery = new URLSearchParams(search).get('lang');
  if (isLocale(fromQuery)) return fromQuery;
  return stored ?? 'vi';
}

/** The language picked in any hoandat.com app (cookie `hd_lang`), if any. */
function storedLocale(): Locale | undefined {
  return readPreferences({ domain: brand.primaryTenant.domain }).lang;
}

interface I18n {
  locale: Locale;
  t: Translate;
  /** Shows the page in `locale`; the footer's language switch has already stored the choice. */
  setLocale(locale: Locale): void;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }): ReactNode {
  // Without a window (never in the browser) the page is Vietnamese.
  const [locale, setLocale] = useState<Locale>(() => (typeof window === 'undefined' ? 'vi' : initialLocale(window.location.search, storedLocale())));
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  // A language picked in another app's tab shows here when this tab is viewed again. Only a change counts, so a
  // shared `?lang=` link keeps its language until someone picks one.
  useEffect(() => {
    let last = storedLocale();
    return subscribePreferences(() => {
      const next = storedLocale();
      if (next === undefined || next === last) return;
      last = next;
      setLocale(next);
    });
  }, []);
  const value = useMemo(() => ({ locale, t: translator(locale), setLocale }), [locale]);
  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n outside I18nProvider');
  return value;
}
