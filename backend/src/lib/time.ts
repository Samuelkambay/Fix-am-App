import { config } from '../config.js';

export interface LocalParts {
  date: string; // YYYY-MM-DD
  monthDay: string; // MM-DD
  dayOfWeek: number; // 0 = Sunday
  minutes: number; // minutes since local midnight
}

const fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: config.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Breaks an instant into Freetown wall-clock parts. Sierra Leone is UTC+0 year round, but we never assume it. */
export function localParts(at: Date): LocalParts {
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    monthDay: `${p.month}-${p.day}`,
    dayOfWeek: WEEKDAYS.indexOf(p.weekday),
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

/** "HH:MM[:SS]" to minutes since midnight. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
