import {
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  lineKey,
  readCartLineIntent,
  type CartLineIntent,
} from '@kcpw/contracts/client';

/**
 * Pure cart operations on LINE INTENTS. The cart never holds prices; the server re-quotes every time.
 * Lines with identical product, variation, and personalization merge; different personalization never does.
 */

export function addLine(
  lines: readonly CartLineIntent[],
  intent: CartLineIntent,
): CartLineIntent[] {
  const key = lineKey(intent);
  const existing = lines.find((l) => lineKey(l) === key);
  if (existing) {
    return lines.map((l) =>
      l === existing
        ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + intent.quantity) }
        : l,
    );
  }
  if (lines.length >= MAX_CART_LINES) return [...lines];
  return [...lines, { ...intent, quantity: Math.min(MAX_LINE_QUANTITY, intent.quantity) }];
}

export function setQuantity(
  lines: readonly CartLineIntent[],
  key: string,
  quantity: number,
): CartLineIntent[] {
  if (!Number.isFinite(quantity) || quantity < 1) return removeLine(lines, key);
  const q = Math.min(MAX_LINE_QUANTITY, Math.floor(quantity));
  return lines.map((l) => (lineKey(l) === key ? { ...l, quantity: q } : l));
}

export function removeLine(lines: readonly CartLineIntent[], key: string): CartLineIntent[] {
  return lines.filter((l) => lineKey(l) !== key);
}

export function cartCount(lines: readonly CartLineIntent[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** Parse what was stored in the browser. Anything invalid is dropped rather than trusted. */
export function parseStoredCart(raw: string | null): CartLineIntent[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const lines: CartLineIntent[] = [];
  for (const item of data.slice(0, MAX_CART_LINES)) {
    const line = readCartLineIntent(item);
    if (line) lines.push(line);
  }
  return lines;
}
