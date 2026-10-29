import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

// Krio strings are a first draft and need review by a native speaker before launch.
const STRINGS = {
  en: {
    heroTitle: 'Get it fixed today',
    heroSub: 'Verified electricians, plumbers, generator and AC technicians near you. Pay with mobile money or cash.',
    search: 'What needs fixing? e.g. leaking tap',
    trades: 'Trades',
    verifiedNear: 'Verified fixers near you',
    seeAll: 'See all',
    bookings: 'Bookings',
    wallet: 'Wallet',
    verify: 'Verify',
    home: 'Home',
    profile: 'Profile',
    login: 'Log in',
    chooseArea: 'Choose your area',
    useLocation: 'Use my location',
    howTrust: 'How FixAm keeps you safe',
    offPeak: 'Book off-peak and save',
    book: 'Book now',
    getPrice: 'See the price',
    when: 'When do you need it?',
    asap: 'Urgent – as soon as possible',
    anyProvider: 'Any available verified fixer',
    chooseProvider: 'Or choose a fixer',
    landmark: 'Landmark near you',
    area: 'Area / neighbourhood',
    payWith: 'Pay with',
    confirm: 'Confirm booking',
    startCode: 'Start code',
    completionCode: 'Completion code',
  },
  kri: {
    heroTitle: 'Mek wi fix am tide',
    heroSub: 'Fixman dem we wi dn chek: kurent, paip, jenereta, AC. Pe wit mobile money or kesh.',
    search: 'Wetin yu want fix? lek paip we de lik',
    trades: 'Wok dem',
    verifiedNear: 'Fixman dem we nia yu',
    seeAll: 'Si ol',
    bookings: 'Booking',
    wallet: 'Wallet',
    verify: 'Chek',
    home: 'Om',
    profile: 'Mi profile',
    login: 'Log in',
    chooseArea: 'Pik usai yu de',
    useLocation: 'Yuz mi location',
    howTrust: 'Aw FixAm de protek yu',
    offPeak: 'Book wen nor bizi, sev moni',
    book: 'Book naw',
    getPrice: 'Si di prais',
    when: 'Wetin tem yu want am?',
    asap: 'Kwik kwik – naw naw',
    anyProvider: 'Eni fixman we wi dn chek',
    chooseProvider: 'Or pik yu fixman',
    landmark: 'Ples we de nia yu',
    area: 'Eria',
    payWith: 'Pe wit',
    confirm: 'Konfam di booking',
    startCode: 'Start code',
    completionCode: 'Don code',
  },
} as const;

export type Lang = keyof typeof STRINGS;
export type StringKey = keyof (typeof STRINGS)['en'];

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: StringKey) => string }>({
  lang: 'en',
  setLang: () => {},
  t: (k) => STRINGS.en[k],
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      return (localStorage.getItem('fixam.lang') as Lang) || 'en';
    } catch {
      return 'en';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('fixam.lang', lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang === 'kri' ? 'kri' : 'en';
  }, [lang]);
  return <Ctx.Provider value={{ lang, setLang, t: (k) => STRINGS[lang][k] }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
