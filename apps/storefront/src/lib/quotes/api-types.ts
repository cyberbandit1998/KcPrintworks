/** What /api/quotes/ answers. Nothing here comes from WordPress except the reference number. */
export type QuoteSubmitResponse =
  | { ok: true; ref: string }
  | { ok: false; code: 'invalid'; errors: { field: string; message: string }[] }
  | {
      ok: false;
      code:
        | 'disabled'
        | 'form_expired'
        | 'try_again'
        | 'rate_limited'
        | 'too_large'
        | 'bad_file'
        | 'unavailable';
      message: string;
    };

/** A reference number as the plugin writes it: KCQ- then four digits (year and month) then six letters and digits. */
export const QUOTE_REF = /^KCQ-\d{4}-[A-HJ-NP-Z2-9]{6}$/;

/** A quote link's secret: 32 random bytes in 43 URL-safe characters (the plugin makes it; only its hash is stored there). */
export const QUOTE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** What /api/quotes/approve/ answers. Nothing here comes from WordPress except the payment address, which is checked first. */
export type QuoteApproveResponse =
  | { ok: true; payUrl: string }
  | { ok: false; code: 'invalid'; errors: { field: string; message: string }[] }
  | {
      ok: false;
      code:
        | 'disabled'
        | 'form_expired'
        | 'rate_limited'
        | 'invalid_link'
        | 'terms_changed'
        | 'expired'
        | 'not_open'
        | 'busy'
        | 'unavailable';
      message: string;
    };

export type QuoteViewState = 'open' | 'approved' | 'paid' | 'expired' | 'closed';

/** What a private quote link may show: the offer and nothing about the customer beyond their first name. */
export interface QuoteView {
  state: QuoteViewState;
  ref: string;
  firstName: string;
  project: string;
  quantity: number;
  title: string;
  details: string;
  itemCents: number;
  shipCents: number;
  totalCents: number;
  currency: string;
  taxable: boolean;
  revision: number;
  /** Unix seconds. */
  expiresAt: number;
  payBy: number;
  /** Where to pay an approved quote: already checked to be an order-pay address on the shop. */
  payUrl?: string;
}
