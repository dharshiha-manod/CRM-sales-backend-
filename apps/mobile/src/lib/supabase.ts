import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
const storage = { getItem: (key: string) => SecureStore.getItemAsync(key), setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value), removeItem: (key: string) => SecureStore.deleteItemAsync(key) };
export const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL ?? '', process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '', { auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
