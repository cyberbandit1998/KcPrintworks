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
