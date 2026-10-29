// Platform adapters: secure token storage, the list cache and the API URL, with web-safe fallbacks.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { ApiClient, createFixamApi, type KeyValueStore, type TokenStore, type Tokens } from '@fixam/shared';

const TOKEN_KEY = 'fixam.tokens';

/** expo-secure-store on Android/iOS (Keystore/Keychain). Web has no secure store, so it uses localStorage. */
export const tokenStore: TokenStore = {
  async get() {
    try {
      const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(TOKEN_KEY) ?? null : await SecureStore.getItemAsync(TOKEN_KEY);
      return raw ? (JSON.parse(raw) as Tokens) : null;
    } catch {
      return null;
    }
  },
  async set(tokens) {
    try {
      if (Platform.OS === 'web') {
        if (tokens) globalThis.localStorage?.setItem(TOKEN_KEY, JSON.stringify(tokens));
        else globalThis.localStorage?.removeItem(TOKEN_KEY);
        return;
      }
      if (tokens) await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
      else await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch {
      // Keystore unavailable: the session lasts until the app closes.
    }
  },
};

/** AsyncStorage (localStorage on web) for cached lists, the chosen zone and pending payment attempts. */
export const kv: KeyValueStore = AsyncStorage;

/**
 * EXPO_PUBLIC_API_URL wins. Otherwise: the Android emulator reaches the host at 10.0.2.2, everything else
 * (iOS simulator, web) uses localhost. A real phone needs your computer's LAN IP in EXPO_PUBLIC_API_URL.
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL || (Platform.OS === 'android' ? 'http://10.0.2.2:4000/api/v1' : 'http://localhost:4000/api/v1');

export const api = createFixamApi(new ApiClient({ baseUrl: API_URL, tokenStore, timeoutMs: 30_000 }));
