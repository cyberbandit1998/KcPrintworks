'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { REVIEW_LIMITS, characterCount, validateReviewInput } from '@kcpw/contracts/client';
import type { ReviewApiResponse } from '@/lib/reviews/api-types';

interface FieldIssue {
  field: string;
  message: string;
}

const RATING_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

/**
 * "Write a review". It checks what it can in the browser (the same rules the shop applies, from @kcpw/contracts/client) for quick
 * feedback, then sends the review to this site's own /api/reviews/, which checks everything again and passes it to the shop. The review
 * is NOT shown afterwards: it waits for approval, and the page says so. Nothing here can mark a review approved or verified.
 *
 * Accessibility: an error summary takes focus and links to each field; every error is tied to its field with aria-describedby; the
 * rating is a real radio group; the send button stays focusable (aria-disabled) while sending; the confirmation takes focus.
 */
export function ReviewForm({ productId, token }: { productId: number; token: string }) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [rating, setRating] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [review, setReview] = useState('');
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [attempt, setAttempt] = useState(0); // bumped on each failed send so focus moves even if the message is the same
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);
  useEffect(() => {
    if (status === 'sent') doneRef.current?.focus();
  }, [status]);

  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const describedBy = (field: string, ...extra: string[]) =>
    [...extra, issueFor(field) ? fid(`${field}-error`) : ''].filter(Boolean).join(' ') || undefined;

  function focusField(field: string) {
    const target =
      field === 'rating'
        ? document.querySelector<HTMLElement>(`input[name="${CSS.escape(fid('rating'))}"]`)
        : document.getElementById(fid(field));
    target?.focus();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'sending') return;
    setServerMessage(null);
    const check = validateReviewInput({
      productId,
      rating: rating || undefined,
      name,
      email,
      review,
    });
    if (!check.ok) {
      setIssues(check.issues.map(({ field, message }) => ({ field, message })));
      setAttempt((n) => n + 1);
      return;
    }
    setIssues([]);
    setStatus('sending');
    try {
      const response = await fetch('/api/reviews/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          ...check.value,
          formToken: token,
          website: honeypotRef.current?.value ?? '',
        }),
      });
      const answer = (await response.json()) as ReviewApiResponse;
      if (answer.ok) {
        setStatus('sent');
        return;
      }
      setStatus('idle');
      if (answer.code === 'invalid') {
        setIssues(answer.errors);
        setAttempt((n) => n + 1);
      } else {
        setServerMessage(answer.message);
        setAttempt((n) => n + 1);
      }
    } catch {
      setStatus('idle');
      setServerMessage('We could not reach the shop. Please check your connection and try again.');
      setAttempt((n) => n + 1);
    }
  }

  if (status === 'sent') {
    return (
      <div ref={doneRef} className="notice notice--success" role="status" tabIndex={-1}>
        <p>
          <strong>Thank you!</strong> We&rsquo;ve received your review. It will appear on this page
          once we&rsquo;ve approved it. (We keep one review per customer for each product.)
        </p>
      </div>
    );
  }

  const summary = serverMessage ? [{ field: '', message: serverMessage }] : issues;
  return (
    <form onSubmit={onSubmit} noValidate className="review-form">
      {summary.length > 0 ? (
        <div ref={summaryRef} className="error-summary" role="alert" tabIndex={-1}>
          <h4>
            {serverMessage
              ? 'Your review was not sent'
              : `Please fix ${summary.length === 1 ? 'this' : 'these'} before sending your review`}
          </h4>
          <ul>
            {summary.map((issue) => (
              <li key={issue.field + issue.message}>
                {issue.field ? (
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

      <fieldset
        className="form-section"
        id={fid('rating')}
        aria-describedby={describedBy('rating')}
      >
        <legend>
          Your rating <span className="field__req">(required)</span>
        </legend>
        <div className="choice-group" role="radiogroup">
          {RATING_WORDS.map((word, index) => {
            const value = index + 1;
            return (
              <label key={value} className="choice">
                <input
                  type="radio"
                  name={fid('rating')}
                  value={value}
                  checked={rating === value}
                  onChange={() => setRating(value)}
                />
                <span>
                  {value} {value === 1 ? 'star' : 'stars'}
                  <span className="visually-hidden">, {word}</span>
                </span>
              </label>
            );
          })}
        </div>
        {issueFor('rating') ? (
          <p className="field__error" id={fid('rating-error')}>
            {issueFor('rating')}
          </p>
        ) : null}
      </fieldset>

      <div className="field">
        <label className="field__label" htmlFor={fid('name')}>
          Your name <span className="field__req">(required)</span>
        </label>
        <p className="field__help" id={fid('name-help')}>
          Shown with your review as your first name and the first letter of your last name.
        </p>
        <input
          id={fid('name')}
          className="input"
          type="text"
          autoComplete="name"
          value={name}
          maxLength={REVIEW_LIMITS.nameMax * 2}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={issueFor('name') ? true : undefined}
          aria-describedby={describedBy('name', fid('name-help'))}
        />
        {issueFor('name') ? (
          <p className="field__error" id={fid('name-error')}>
            {issueFor('name')}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={fid('email')}>
          Your email <span className="field__req">(required)</span>
        </label>
        <p className="field__help" id={fid('email-help')}>
          Never shown. Used to check your order and to keep one review per customer.
        </p>
        <input
          id={fid('email')}
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={issueFor('email') ? true : undefined}
          aria-describedby={describedBy('email', fid('email-help'))}
        />
        {issueFor('email') ? (
          <p className="field__error" id={fid('email-error')}>
            {issueFor('email')}
          </p>
        ) : null}
      </div>

      <div className="field">
        <label className="field__label" htmlFor={fid('review')}>
          Your review <span className="field__req">(required)</span>
        </label>
        <p className="field__help" id={fid('review-help')}>
          At least {REVIEW_LIMITS.textMin} characters. Please leave out web addresses.
        </p>
        <textarea
          id={fid('review')}
          className="textarea"
          value={review}
          onChange={(e) => setReview(e.target.value)}
          aria-invalid={issueFor('review') ? true : undefined}
          aria-describedby={describedBy('review', fid('review-help'), fid('review-counter'))}
        />
        <p className="field__counter" id={fid('review-counter')}>
          {characterCount(review)} of {REVIEW_LIMITS.textMax} characters
        </p>
        {issueFor('review') ? (
          <p className="field__error" id={fid('review-error')}>
            {issueFor('review')}
          </p>
        ) : null}
      </div>

      {/* A field for robots: no person sees it, reaches it with the keyboard, or hears it read. */}
      <div className="visually-hidden" aria-hidden="true">
        <label>
          Leave this field empty
          <input ref={honeypotRef} type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <button
        type="submit"
        className="button"
        aria-disabled={status === 'sending' ? true : undefined}
      >
        {status === 'sending' ? 'Sending…' : 'Send my review'}
      </button>
      <p className="field__help" style={{ marginTop: 'var(--space-3)' }}>
        Reviews are read before they are published. We keep your email address private.
      </p>
    </form>
  );
}
