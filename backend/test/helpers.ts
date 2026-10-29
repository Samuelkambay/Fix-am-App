import request from 'supertest';
import { createApp } from '../src/app.js';
import { one, pool, tx } from '../src/db.js';
import { migrate } from '../src/db/migrate.js';
import { resetDatabase, seedDemo, seedReference } from '../src/db/seed.js';

export const app = createApp();
export const api = () => request(app);
export const V = '/api/v1';

export async function freshDb() {
  await migrate();
  await resetDatabase();
  await tx(async (c) => {
    await seedReference(c);
    await seedDemo(c);
  });
}

export async function loginOtp(phone: string, name?: string): Promise<{ token: string; user: any }> {
  const r1 = await api().post(`${V}/auth/otp/request`).send({ phone });
  if (r1.status !== 200) throw new Error(`otp request ${r1.status} ${JSON.stringify(r1.body)}`);
  const r2 = await api().post(`${V}/auth/otp/verify`).send({ phone, code: r1.body.devCode, name });
  if (r2.status !== 200) throw new Error(`otp verify ${r2.status} ${JSON.stringify(r2.body)}`);
  return { token: r2.body.accessToken, user: r2.body.user };
}

export async function loginAdmin(): Promise<string> {
  const r = await api().post(`${V}/auth/login`).send({ phone: '076000001', password: 'Admin@123' });
  if (r.status !== 200) throw new Error(`admin login ${r.status}`);
  return r.body.accessToken;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function ids() {
  const zone = async (name: string) => (await one('SELECT id FROM zones WHERE name = $1', [name])).id as string;
  const service = async (name: string) => (await one('SELECT id FROM services WHERE name = $1', [name])).id as string;
  const provider = async (name: string) => (await one('SELECT id FROM providers WHERE business_name = $1', [name])).id as string;
  return { zone, service, provider };
}

/** A weekday at 10:00 Freetown time (off-peak) at least two days out. */
export function offPeakSlot(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  const isHoliday = (x: Date) => {
    const md = x.toISOString().slice(5, 10);
    return md === '04-27' || md >= '12-24' || md <= '01-01';
  };
  while ([0, 6].includes(d.getUTCDay()) || isHoliday(d)) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(10, 0, 0, 0);
  return d;
}

/** A weekday at 18:00 (evening peak). */
export function eveningSlot(): Date {
  const d = offPeakSlot();
  d.setUTCHours(18, 0, 0, 0);
  return d;
}

export async function closePool() {
  await pool.end();
}
