'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { validateQuoteApproval } from '@kcpw/contracts/client';
import type { QuoteApproveResponse } from '@/lib/quotes/api-types';

interface FieldIssue {
  field: string;
  message: string;
}

interface Props {
  reference: string;
  token: string;
  revision: number;
  /** The total as shown on the page, in words ("$53.50"), for the sentence the customer agrees to. */
  totalText: string;
  taxable: boolean;
  countries: { code: string; name: string }[];
}

/**
 * "Approve this quote." The customer gives a shipping address and ticks that they approve; nothing about a price is sent (the shop looks
 * up what they were offered, and the revision they saw is checked so an old page cannot approve a newer quote). On success the browser
 * goes to WooCommerce's payment page at the address this site already checked.
 *
 * Accessibility: an error summary takes focus and links to each field; every error is tied to its field with aria-describedby; the
 * button stays focusable (aria-disabled) while working; the status line announces what is happening.
 */
export function QuoteApprovalForm({
  reference,
  token,
  revision,
  totalText,
  taxable,
  countries,
}: Props) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [values, setValues] = useState({
    line1: '',
    line2: '',
    city: '',
    state: '',
    postcode: '',
    country: 'US',
    phone: '',
  });
  const [accepted, setAccepted] = useState(false);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'sending' | 'redirecting'>('idle');
  const [attempt, setAttempt] = useState(0);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);

  const set =
    (name: keyof typeof values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [name]: event.target.value }));
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const describedBy = (field: string, ...extra: string[]) =>
    [...extra, issueFor(field) ? fid(`${field}-error`) : ''].filter(Boolean).join(' ') || undefined;
  const focusField = (field: string) => document.getElementById(fid(field))?.focus();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status !== 'idle') return;
    setServerMessage(null);
    const approval = { revision, ...values, accepted };
    const check = validateQuoteApproval(approval);
    if (!check.ok) {
      setIssues(check.issues.map(({ field, message }) => ({ field, message })));
      setAttempt((n) => n + 1);
      return;
    }
    setIssues([]);
    setStatus('sending');
    try {
      const response = await fetch('/api/quotes/approve/', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ref: reference, token, approval: check.value }),
      });
      const answer = (await response.json()) as QuoteApproveResponse;
      if (answer.ok) {
        setStatus('redirecting');
        window.location.assign(answer.payUrl);
        return;
      }
      setStatus('idle');
      if (answer.code === 'invalid') setIssues(answer.errors);
      else setServerMessage(answer.message);
      setAttempt((n) => n + 1);
    } catch {
      setStatus('idle');
      setServerMessage(
        'We could not reach the shop. Nothing was charged. Please check your connection and try again.',
      );
      setAttempt((n) => n + 1);
    }
  }

  const summary = serverMessage ? [{ field: '', message: serverMessage }] : issues;
  const text = (
    name: keyof typeof values,
    label: string,
    required: boolean,
    extra?: { autoComplete?: string; help?: string; inputMode?: 'tel' },
  ) => (
    <div className="field">
      <label className="field__label" htmlFor={fid(name)}>
        {label} <span className="field__req">({required ? 'required' : 'optional'})</span>
      </label>
      {extra?.help ? (
        <p className="field__help" id={fid(`${name}-help`)}>
          {extra.help}
        </p>
      ) : null}
      <input
        id={fid(name)}
        className="input"
        type="text"
        autoComplete={extra?.autoComplete}
        inputMode={extra?.inputMode}
        value={values[name]}
        onChange={set(name)}
        aria-invalid={issueFor(name) ? true : undefined}
        aria-describedby={describedBy(name, extra?.help ? fid(`${name}-help`) : '')}
      />
      {issueFor(name) ? (
        <p className="field__error" id={fid(`${name}-error`)}>
          {issueFor(name)}
        </p>
      ) : null}
    </div>
  );

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="quote-form quote-approve"
      aria-busy={status !== 'idle' ? true : undefined}
    >
      {summary.length > 0 ? (
        <div ref={summaryRef} className="error-summary" role="alert" tabIndex={-1}>
          <h3>
            {serverMessage
              ? 'Your approval was not completed'
              : `Please fix ${summary.length === 1 ? 'this' : 'these'} before approving`}
          </h3>
          <ul>
            {summary.map((issue) => (
              <li key={issue.field + issue.message}>
                {issue.field && issue.field !== 'revision' ? (
                  <a
                    href={`#${fid(issue.field)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      focusField(issue.field);
                    }}
                  >
                    {issue.message}
                  </a>
                ) : (
                  issue.message
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset className="form-section">
        <legend>Where should we send it?</legend>
        {text('line1', 'Street address', true, { autoComplete: 'address-line1' })}
        {text('line2', 'Apartment, suite, etc.', false, { autoComplete: 'address-line2' })}
        <div className="quote-form__row">
          {text('city', 'City', true, { autoComplete: 'address-level2' })}
          {text('state', 'State or region', false, { autoComplete: 'address-level1' })}
        </div>
        <div className="quote-form__row">
          {text('postcode', 'ZIP or postal code', true, { autoComplete: 'postal-code' })}
          <div className="field">
            <label className="field__label" htmlFor={fid('country')}>
              Country <span className="field__req">(required)</span>
            </label>
            <select
              id={fid('country')}
              className="select"
              autoComplete="country"
              value={values.country}
              onChange={set('country')}
              aria-invalid={issueFor('country') ? true : undefined}
              aria-describedby={describedBy('country')}
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
            {issueFor('country') ? (
              <p className="field__error" id={fid('country-error')}>
                {issueFor('country')}
              </p>
            ) : null}
          </div>
        </div>
        {text('phone', 'Phone', false, {
          autoComplete: 'tel',
          inputMode: 'tel',
          help: 'Only used if there is a question about delivery.',
        })}
      </fieldset>

      <div className="field quote-approve__accept">
        <label className="check" htmlFor={fid('accepted')}>
          <input
            id={fid('accepted')}
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            aria-invalid={issueFor('accepted') ? true : undefined}
            aria-describedby={describedBy('accepted')}
          />
          <span>
            I approve this quote for <strong>{totalText}</strong>
            {taxable ? ' plus sales tax where it applies' : ''}. It is made to order for me, and I
            will pay securely on the next page.
          </span>
        </label>
        {issueFor('accepted') ? (
          <p className="field__error" id={fid('accepted-error')}>
            {issueFor('accepted')}
          </p>
        ) : null}
      </div>

      <button type="submit" className="button" aria-disabled={status !== 'idle' ? true : undefined}>
        {status === 'sending'
          ? 'Approving…'
          : status === 'redirecting'
            ? 'Taking you to payment…'
            : 'Approve and continue to payment'}
      </button>
      <p className="field__help" role="status" style={{ marginTop: 'var(--space-3)' }}>
        {status === 'redirecting'
          ? 'Your quote is approved. Taking you to the secure payment page…'
          : 'You will not be charged until you complete payment on the next page.'}
      </p>
    </form>
  );
}
