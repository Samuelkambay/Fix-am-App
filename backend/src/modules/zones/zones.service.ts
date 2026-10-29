import { query } from '../../db.js';

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Finds the zone covering a GPS point; when circles overlap, the closest centre wins. */
export async function resolveZone(lat: number, lng: number) {
  const zones = await query('SELECT * FROM zones WHERE active');
  const hits = zones
    .map((z) => ({ ...z, distance_km: haversineKm(lat, lng, z.center_lat, z.center_lng) }))
    .filter((z) => z.distance_km <= z.radius_km)
    .sort((a, b) => a.distance_km - b.distance_km);
  return hits[0];
}
