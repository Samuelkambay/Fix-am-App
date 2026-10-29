// Reference data for Sierra Leone. Prices are illustrative launch values in new Leones (SLE) and should be set
// from local market research; holiday dates that follow the lunar calendar must be confirmed each year.

export const ZONES = [
  { name: 'Freetown - Central', district: 'Western Area Urban', city: 'Freetown', lat: 8.484, lng: -13.234, r: 2.5 },
  { name: 'Freetown - East End', district: 'Western Area Urban', city: 'Freetown', lat: 8.462, lng: -13.185, r: 4.5 },
  { name: 'Freetown - West End', district: 'Western Area Urban', city: 'Freetown', lat: 8.468, lng: -13.27, r: 3.5 },
  { name: 'Freetown - Goderich & Lakka', district: 'Western Area Rural', city: 'Freetown', lat: 8.42, lng: -13.29, r: 4 },
  { name: 'Waterloo', district: 'Western Area Rural', city: 'Waterloo', lat: 8.339, lng: -13.072, r: 6 },
  { name: 'Bo', district: 'Bo', city: 'Bo', lat: 7.9647, lng: -11.7383, r: 8 },
  { name: 'Kenema', district: 'Kenema', city: 'Kenema', lat: 7.8767, lng: -11.1903, r: 8 },
  { name: 'Makeni', district: 'Bombali', city: 'Makeni', lat: 8.8833, lng: -12.05, r: 8 },
  { name: 'Koidu', district: 'Kono', city: 'Koidu', lat: 8.6439, lng: -10.9714, r: 7 },
  { name: 'Port Loko', district: 'Port Loko', city: 'Port Loko', lat: 8.7667, lng: -12.7833, r: 6 },
];

const le = (n: number) => Math.round(n * 100);

interface ServiceSeed { name: string; price: number; unit?: 'fixed' | 'hourly' | 'per_unit'; unitLabel?: string; minutes?: number; description?: string }
interface CategorySeed { slug: string; name: string; icon: string; services: ServiceSeed[] }

const RAW_CATALOG: CategorySeed[] = [
  {
    slug: 'electrical', name: 'Electrical', icon: 'bolt', services: [
      { name: 'Electrical fault finding & repair', price: 250, minutes: 90 },
      { name: 'Socket or switch installation', price: 75, unit: 'per_unit', unitLabel: 'point', minutes: 30 },
      { name: 'House wiring', price: 600, unit: 'per_unit', unitLabel: 'room', minutes: 240 },
      { name: 'Generator changeover switch installation', price: 800, minutes: 180, description: 'Safe switching between grid power and generator' },
    ],
  },
  {
    slug: 'plumbing', name: 'Plumbing', icon: 'droplet', services: [
      { name: 'Fix leaking pipe or tap', price: 200, minutes: 60 },
      { name: 'Toilet repair or installation', price: 400, minutes: 120 },
      { name: 'Water tank (polytank) installation & connection', price: 700, minutes: 240 },
      { name: 'Borehole / water pump repair', price: 900, minutes: 180 },
    ],
  },
  {
    slug: 'generator-solar', name: 'Generator & Solar', icon: 'sun', services: [
      { name: 'Generator servicing', price: 300, minutes: 90 },
      { name: 'Generator repair', price: 450, minutes: 150 },
      { name: 'Solar panel & inverter installation (labour)', price: 2500, minutes: 480 },
      { name: 'Inverter battery replacement', price: 300, minutes: 60 },
    ],
  },
  {
    slug: 'cooling', name: 'AC & Fridge', icon: 'snowflake', services: [
      { name: 'AC servicing & gas refill', price: 450, minutes: 120 },
      { name: 'Fridge or freezer repair', price: 400, minutes: 120 },
      { name: 'Ceiling fan installation', price: 150, unit: 'per_unit', unitLabel: 'fan', minutes: 45 },
    ],
  },
  {
    slug: 'carpentry-roofing', name: 'Carpentry & Roofing', icon: 'hammer', services: [
      { name: 'Door or lock repair', price: 200, minutes: 60 },
      { name: 'Furniture repair', price: 300, unit: 'hourly', unitLabel: 'hour', minutes: 60 },
      { name: 'Roof leak repair (zinc)', price: 600, minutes: 180 },
    ],
  },
  {
    slug: 'masonry-painting', name: 'Masonry, Tiling & Painting', icon: 'brick', services: [
      { name: 'Wall plastering', price: 120, unit: 'per_unit', unitLabel: 'm²', minutes: 30 },
      { name: 'Floor tiling', price: 90, unit: 'per_unit', unitLabel: 'm²', minutes: 30 },
      { name: 'Room painting', price: 700, unit: 'per_unit', unitLabel: 'room', minutes: 360 },
    ],
  },
  {
    slug: 'cleaning', name: 'Cleaning & Pest Control', icon: 'sparkles', services: [
      { name: 'House deep clean', price: 600, minutes: 240 },
      { name: 'Water tank cleaning', price: 450, minutes: 150 },
      { name: 'Fumigation / pest control', price: 800, minutes: 180 },
    ],
  },
  {
    slug: 'welding', name: 'Welding & Metal Work', icon: 'flame', services: [
      { name: 'Gate or burglar-proof repair', price: 500, minutes: 180 },
      { name: 'General welding work', price: 250, unit: 'hourly', unitLabel: 'hour', minutes: 60 },
    ],
  },
  {
    slug: 'electronics', name: 'TV & Electronics', icon: 'tv', services: [
      { name: 'TV wall mounting', price: 200, minutes: 60 },
      { name: 'Satellite dish & decoder installation', price: 350, minutes: 120 },
    ],
  },
];

export const CATALOG: CategorySeed[] = RAW_CATALOG.map((c) => ({ ...c, services: c.services.map((s) => ({ ...s, price: le(s.price) })) }));

export interface RuleSeed {
  name: string; label: string; kind: string; category?: string; days?: number[]; start?: string; end?: string;
  from?: string; to?: string; yearly?: boolean; ratio?: number; multiplier: number; flat?: number; stackable?: boolean; priority: number;
}

export const PRICING_RULES: RuleSeed[] = [
  // Time windows (Freetown local time).
  { name: 'Weekday evening peak', label: 'Evening peak', kind: 'time_window', days: [1, 2, 3, 4, 5], start: '17:00', end: '21:00', multiplier: 1.25, priority: 10 },
  { name: 'Saturday morning rush', label: 'Saturday rush', kind: 'time_window', days: [6], start: '08:00', end: '14:00', multiplier: 1.15, priority: 5 },
  { name: 'Night call-out', label: 'Night call-out', kind: 'time_window', start: '21:00', end: '06:00', multiplier: 1.5, flat: le(50), priority: 20 },
  // Stacking modifiers.
  { name: 'Urgent / as soon as possible', label: 'Urgent job', kind: 'emergency', multiplier: 1.2, flat: le(100), stackable: true, priority: 30 },
  { name: 'High demand in zone', label: 'High demand', kind: 'demand', ratio: 2, multiplier: 1.2, stackable: true, priority: 25 },
  // Public holidays.
  { name: 'Independence Day', label: 'Holiday rate', kind: 'holiday', from: '2026-04-27', to: '2026-04-27', yearly: true, multiplier: 1.3, priority: 15 },
  { name: 'Christmas & New Year', label: 'Holiday rate', kind: 'holiday', from: '2026-12-24', to: '2026-01-01', yearly: true, multiplier: 1.3, priority: 15 },
  // Seasons: rainy season roof/plumbing work, hottest months for cooling.
  { name: 'Rainy season - roofing', label: 'Rainy season', kind: 'seasonal', category: 'carpentry-roofing', from: '2026-06-01', to: '2026-09-30', yearly: true, multiplier: 1.2, priority: 8 },
  { name: 'Rainy season - plumbing', label: 'Rainy season', kind: 'seasonal', category: 'plumbing', from: '2026-06-01', to: '2026-09-30', yearly: true, multiplier: 1.1, priority: 8 },
  { name: 'Hot season - AC & fridge', label: 'Hot season', kind: 'seasonal', category: 'cooling', from: '2026-03-01', to: '2026-05-31', yearly: true, multiplier: 1.15, priority: 8 },
];

export const COMMISSION_PLANS = [
  {
    code: 'standard', name: 'Pay per job', model: 'commission', defaultRateBps: 1500, subscriptionRateBps: 0, surchargeRateBps: 1000,
    minCommissionMinor: le(10), maxCommissionMinor: null, feeMinor: 0, periodDays: 30, isDefault: true,
    // Busy providers pay less: trailing-30-day completed GMV thresholds.
    tiers: [{ min_gmv_minor: 0, rate_bps: 1500 }, { min_gmv_minor: le(20000), rate_bps: 1250 }, { min_gmv_minor: le(50000), rate_bps: 1000 }],
    categoryRates: { cleaning: 1200, 'generator-solar': 1200 } as Record<string, number>,
  },
  {
    code: 'growth', name: 'Growth (monthly + 8%)', model: 'hybrid', defaultRateBps: 1500, subscriptionRateBps: 800, surchargeRateBps: null,
    minCommissionMinor: 0, maxCommissionMinor: null, feeMinor: le(250), periodDays: 30, isDefault: false, tiers: [], categoryRates: {},
  },
  {
    code: 'pro_monthly', name: 'Pro (monthly, 0% commission)', model: 'subscription', defaultRateBps: 1500, subscriptionRateBps: 0, surchargeRateBps: null,
    minCommissionMinor: 0, maxCommissionMinor: null, feeMinor: le(750), periodDays: 30, isDefault: false, tiers: [], categoryRates: {},
  },
];

export const BADGES = [
  { code: 'PHONE_VERIFIED', name: 'Phone verified', kind: 'verification', docs: [], validity: null, weight: 5, icon: 'phone-check', order: 1,
    description: 'Phone number confirmed with an SMS code.' },
  { code: 'NATIONAL_ID', name: 'ID verified', kind: 'verification', docs: ['id_document', 'selfie'], validity: 730, weight: 25, icon: 'id-card', order: 2,
    description: 'National ID card, passport or voter ID checked against a live selfie by FixAm staff.' },
  { code: 'POLICE_CLEARANCE', name: 'Background checked', kind: 'verification', docs: ['police_clearance'], validity: 365, weight: 25, icon: 'shield-check', order: 3,
    description: 'Police clearance certificate from the Sierra Leone Police, renewed every year.' },
  { code: 'TRADE_CERTIFIED', name: 'Trade certified', kind: 'verification', docs: ['trade_certificate'], validity: null, weight: 20, icon: 'certificate', order: 4,
    description: 'Certificate from a technical/vocational institute, or a letter from a recognised trade association or master craftsman.' },
  { code: 'BUSINESS_REGISTERED', name: 'Registered business', kind: 'verification', docs: ['business_registration', 'tax_certificate'], validity: 365, weight: 15, icon: 'building', order: 5,
    description: 'Business registration certificate and National Revenue Authority TIN.' },
  { code: 'TOP_RATED', name: 'Top rated', kind: 'performance', docs: [], validity: null, weight: 15, icon: 'star', order: 6,
    description: 'Average rating of 4.7 or more across at least 20 reviews.', criteria: { min_rating: 4.7, min_reviews: 20 } },
  { code: 'RELIABLE', name: 'Reliable', kind: 'performance', docs: [], validity: null, weight: 10, icon: 'clock-check', order: 7,
    description: 'At least 30 jobs completed with a 95% or better completion rate.', criteria: { min_completed: 30, min_completion_rate: 0.95 } },
  { code: 'VETERAN', name: '100 jobs', kind: 'performance', docs: [], validity: null, weight: 10, icon: 'trophy', order: 8,
    description: 'Completed 100 jobs on FixAm.', criteria: { min_completed: 100 } },
];
