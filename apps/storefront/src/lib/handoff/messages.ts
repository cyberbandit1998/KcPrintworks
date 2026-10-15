/**
 * What a shopper reads when the shop refuses a cart line. The shop's own wording is kept except where it is a developer's message:
 * `Unknown option "name".` means the product has no personalization setup stored in WooCommerce, which is the owner's to fix and
 * nothing the shopper did wrong, so the shopper is told plainly and offered the way to ask for help.
 */
const NOT_SET_UP_ONLINE =
  'The personalization options for this item are not available to order online right now. Please contact us and we will help.';

export interface ShopIssue {
  code: string;
  message: string;
  field?: string;
}

export function shopperMessage(issue: ShopIssue): string {
  if (issue.code === 'invalid_option' && /^Unknown option\b/i.test(issue.message)) {
    return NOT_SET_UP_ONLINE;
  }
  return issue.message;
}

/** One entry per distinct message: a product with three unknown fields says it once, not three times. */
export function shopperIssues<T extends ShopIssue>(issues: T[]): (T & { message: string })[] {
  const seen = new Set<string>();
  const out: (T & { message: string })[] = [];
  for (const issue of issues) {
    const message = shopperMessage(issue);
    if (seen.has(message)) continue;
    seen.add(message);
    out.push({ ...issue, message });
  }
  return out;
}
