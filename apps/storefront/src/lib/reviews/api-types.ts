/** What /api/reviews/ answers. Plain words only: nothing from the shop's own answer is passed on. */
export type ReviewApiFailure =
  | { ok: false; code: 'invalid'; errors: { field: string; message: string }[] }
  | {
      ok: false;
      code:
        | 'disabled'
        | 'form_expired'
        | 'try_again'
        | 'closed'
        | 'verification_required'
        | 'rate_limited'
        | 'unavailable';
      message: string;
    };

export type ReviewApiResponse = { ok: true } | ReviewApiFailure;
