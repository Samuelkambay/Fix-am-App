import type { Language } from '../types';
import { en, type TKey } from './en';
import { kri, KRIO_REVIEW_STATUS } from './kri';

export type { TKey };
export { en, kri, KRIO_REVIEW_STATUS };

export const dictionaries: Record<Language, Record<TKey, string>> = { en, kri };

export type TParams = Record<string, string | number>;

export function interpolate(template: string, params?: TParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Translate a key. Falls back to English, then to the key itself. */
export function translate(lang: Language, key: TKey, params?: TParams): string {
  return interpolate(dictionaries[lang]?.[key] ?? en[key] ?? key, params);
}

/** For dynamic keys built at runtime (e.g. `status.${s}`); returns `fallback` when the key is unknown. */
export function translateDynamic(lang: Language, key: string, fallback: string, params?: TParams): string {
  const k = key as TKey;
  if (!(k in en)) return interpolate(fallback, params);
  return translate(lang, k, params);
}

export type Translator = ((key: TKey, params?: TParams) => string) & {
  lang: Language;
  dyn: (key: string, fallback: string, params?: TParams) => string;
};

export function makeTranslator(lang: Language): Translator {
  const t = ((key: TKey, params?: TParams) => translate(lang, key, params)) as Translator;
  t.lang = lang;
  t.dyn = (key, fallback, params) => translateDynamic(lang, key, fallback, params);
  return t;
}
