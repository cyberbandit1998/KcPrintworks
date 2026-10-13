import { useSyncExternalStore } from 'react';
import type { CartLineIntent } from '@kcpw/contracts/client';
import { addLine, parseStoredCart, removeLine, setQuantity } from './cart-state';

/**
 * Browser cart store backed by localStorage. Storage can be unavailable (private windows, blocked site data),
 * so every access is wrapped; the cart then lives in memory for the session instead of breaking the page.
 */

const STORAGE_KEY = 'kcpw.cart.v1';
const EMPTY: readonly CartLineIntent[] = Object.freeze([]);

let memoryRaw: string | null = null;
let cachedRaw: string | null | undefined;
let cachedLines: readonly CartLineIntent[] = EMPTY;
const listeners = new Set<() => void>();

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryRaw;
  }
}

function writeRaw(raw: string): void {
  memoryRaw = raw;
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // Storage unavailable: keep the in-memory copy.
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function getSnapshot(): readonly CartLineIntent[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLines = raw === null ? EMPTY : parseStoredCart(raw);
  }
  return cachedLines;
}

function getServerSnapshot(): readonly CartLineIntent[] {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

function update(fn: (lines: readonly CartLineIntent[]) => CartLineIntent[]): void {
  writeRaw(JSON.stringify(fn(getSnapshot())));
  emit();
}

export function useCartLines(): readonly CartLineIntent[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export const cartActions = {
  add: (intent: CartLineIntent) => update((lines) => addLine(lines, intent)),
  setQuantity: (key: string, quantity: number) =>
    update((lines) => setQuantity(lines, key, quantity)),
  remove: (key: string) => update((lines) => removeLine(lines, key)),
  clear: () => update(() => []),
};
