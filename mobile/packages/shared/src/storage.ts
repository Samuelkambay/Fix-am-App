/** AsyncStorage-compatible key/value store. The apps pass AsyncStorage; scripts use MemoryKV. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class MemoryKV implements KeyValueStore {
  private m = new Map<string, string>();
  async getItem(key: string) {
    return this.m.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.m.set(key, value);
  }
  async removeItem(key: string) {
    this.m.delete(key);
  }
}

export async function readJson<T>(store: KeyValueStore, key: string): Promise<T | null> {
  try {
    const raw = await store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function writeJson(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  try {
    if (value === null || value === undefined) await store.removeItem(key);
    else await store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable: caching is best effort.
  }
}
