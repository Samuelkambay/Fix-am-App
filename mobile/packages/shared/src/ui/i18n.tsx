import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { makeTranslator, type Translator } from '../i18n';
import type { Language } from '../types';

interface I18nValue {
  lang: Language;
  setLang: (l: Language) => void;
  t: Translator;
}

const Ctx = createContext<I18nValue>({ lang: 'en', setLang: () => {}, t: makeTranslator('en') });

export function I18nProvider({ lang, setLang, children }: { lang: Language; setLang: (l: Language) => void; children: ReactNode }) {
  const value = useMemo(() => ({ lang, setLang, t: makeTranslator(lang) }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}

export function useT(): Translator {
  return useContext(Ctx).t;
}
