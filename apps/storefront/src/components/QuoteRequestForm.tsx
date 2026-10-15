'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  PROJECT_TYPES,
  QUOTE_LIMITS,
  characterCount,
  deadlineProblem,
  validateQuoteRequest,
} from '@kcpw/contracts/client';
import type { QuoteSubmitResponse } from '@/lib/quotes/api-types';
import { isPictureName, prepareImage } from '@/lib/quotes/image-prep';

interface FieldIssue {
  field: string;
  message: string;
}

const MAX_FILES = 4;
const MAX_FILE_BYTES = 2_621_440;
const MAX_TOTAL_BYTES = 5_242_880;
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

interface Values {
  name: string;
  email: string;
  projectType: string;
  game: string;
  description: string;
  dimensions: string;
  quantity: string;
  colors: string;
  deadline: string;
  shipTo: string;
}

/**
 * "Request a custom quote". It checks what it can in the browser (the same rules the shop applies, from @kcpw/contracts/client) and
 * makes phone photos small, then sends the request, with its pictures, to this site's own /api/quotes/, which checks everything again
 * and hands it to the shop. No payment and no price is involved: the shop owner reads the request and emails a quote.
 *
 * Accessibility: an error summary takes focus and links to each field; every error is tied to its field with aria-describedby; the send
 * button stays focusable (aria-disabled) while sending; the confirmation takes focus; the picture list can be changed with the keyboard.
 */
export function QuoteRequestForm({ token, initialItem }: { token: string; initialItem: string }) {
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;
  const [values, setValues] = useState<Values>({
    name: '',
    email: '',
    projectType: '',
    game: initialItem,
    description: '',
    dimensions: '',
    quantity: '1',
    colors: '',
    deadline: '',
    shipTo: '',
  });
  const [files, setFiles] = useState<File[]>([]);
  const [preparing, setPreparing] = useState(0);
  const [fileMessage, setFileMessage] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [reference, setReference] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [today, setToday] = useState('');
  const summaryRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The browser's own "today" (the shop checks again with its own).
    const t = window.setTimeout(() => setToday(new Date().toLocaleDateString('en-CA')), 0);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus();
  }, [attempt]);
  useEffect(() => {
    if (status === 'sent') doneRef.current?.focus();
  }, [status]);

  const set =
    (name: keyof Values) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [name]: event.target.value }));
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const describedBy = (field: string, ...extra: string[]) =>
    [...extra, issueFor(field) ? fid(`${field}-error`) : ''].filter(Boolean).join(' ') || undefined;
  const focusField = (field: string) =>
    (field === 'files' ? fileRef.current : document.getElementById(fid(field)))?.focus();

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFileMessage(null);
    const chosen = Array.from(list);
    const bad = chosen.find((f) => !isPictureName(f.name, f.type));
    if (bad) {
      setFileMessage(`"${bad.name}" is not a JPEG, PNG, WebP or GIF picture.`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    if (files.length + chosen.length > MAX_FILES) {
      setFileMessage(`Please attach at most ${MAX_FILES} pictures.`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    setPreparing((n) => n + chosen.length);
    const prepared = await Promise.all(chosen.map((f) => prepareImage(f)));
    setPreparing((n) => n - chosen.length);
    const tooBig = prepared.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setFileMessage(
        `"${tooBig.name}" is still larger than ${mb(MAX_FILE_BYTES)}. Please choose a smaller picture.`,
      );
    } else {
      const next = [...files, ...prepared];
      if (next.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_BYTES) {
        setFileMessage(
          `The pictures together are larger than ${mb(MAX_TOTAL_BYTES)}. Please send fewer or smaller ones.`,
        );
      } else {
        setFiles(next);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  const removeFile = (index: number) => {
    setFiles((list) => list.filter((_, i) => i !== index));
    setFileMessage(null);
    fileRef.current?.focus();
  };

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === 'sending') return;
    setServerMessage(null);
    if (preparing > 0) {
      setServerMessage('Your pictures are still being prepared. Please try again in a moment.');
      setAttempt((n) => n + 1);
      return;
    }
    const quantity = /^\d{1,5}$/.test(values.quantity.trim())
      ? Number(values.quantity)
      : values.quantity;
    const check = validateQuoteRequest({ ...values, quantity });
    const found: FieldIssue[] = check.ok
      ? []
      : check.issues.map(({ field, message }) => ({ field, message }));
    if (check.ok && today) {
      const late = deadlineProblem(check.value.deadline, today);
      if (late) {
        found.push({
          field: 'deadline',
          message:
            late === 'past'
              ? 'The date has already passed. Choose a later one.'
              : 'Choose a date within the next two years.',
        });
      }
    }
    if (found.length > 0) {
      setIssues(found);
      setAttempt((n) => n + 1);
      return;
    }
    setIssues([]);
    setStatus('sending');
    try {
      const body = new FormData();
      for (const [key, value] of Object.entries(values)) body.append(key, value);
      body.set('quantity', String(quantity));
      body.append('formToken', token);
      body.append('website', honeypotRef.current?.value ?? '');
      for (const file of files) body.append('files', file, file.name);
      const response = await fetch('/api/quotes/', {
        method: 'POST',
        credentials: 'same-origin',
        body,
      });
      const answer = (await response.json()) as QuoteSubmitResponse;
      if (answer.ok) {
        setReference(answer.ref);
        setSentTo(values.email.trim());
        setStatus('sent');
        return;
      }
      setStatus('idle');
      if (answer.code === 'invalid') setIssues(answer.errors);
      else setServerMessage(answer.message);
      setAttempt((n) => n + 1);
    } catch {
      setStatus('idle');
      setServerMessage('We could not reach the shop. Please check your connection and try again.');
      setAttempt((n) => n + 1);
    }
  }

  if (status === 'sent') {
    return (
      <div ref={doneRef} className="notice notice--success quote-done" role="status" tabIndex={-1}>
        <h2>Thank you. We have your request.</h2>
        <p>
          Your reference number is <strong className="quote-ref">{reference}</strong>. Please keep
          it: quote it if you write to us.
        </p>
        <p>
          We are sending a confirmation to <strong>{sentTo}</strong>. We will read your request and
          email you a quote with the price, shipping and how long it is valid. You do not pay
          anything until you approve it.
        </p>
      </div>
    );
  }

  const summary = serverMessage ? [{ field: '', message: serverMessage }] : issues;
  const describedFiles = [
    fid('files-help'),
    fileMessage || issueFor('files') ? fid('files-error') : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="quote-form"
      aria-busy={status === 'sending' ? true : undefined}
    >
      {summary.length > 0 ? (
        <div ref={summaryRef} className="error-summary" role="alert" tabIndex={-1}>
          <h3>
            {serverMessage
              ? 'Your request was not sent'
              : `Please fix ${summary.length === 1 ? 'this' : 'these'} before sending your request`}
          </h3>
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

      <fieldset className="form-section">
        <legend>About you</legend>
        <div className="field">
          <label className="field__label" htmlFor={fid('name')}>
            Your name <span className="field__req">(required)</span>
          </label>
          <input
            id={fid('name')}
            className="input"
            type="text"
            autoComplete="name"
            value={values.name}
            onChange={set('name')}
            maxLength={QUOTE_LIMITS.nameMax * 2}
            aria-invalid={issueFor('name') ? true : undefined}
            aria-describedby={describedBy('name')}
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
            We email your quote here. We never share it.
          </p>
          <input
            id={fid('email')}
            className="input"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={set('email')}
            aria-invalid={issueFor('email') ? true : undefined}
            aria-describedby={describedBy('email', fid('email-help'))}
          />
          {issueFor('email') ? (
            <p className="field__error" id={fid('email-error')}>
              {issueFor('email')}
            </p>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>What would you like made?</legend>
        <div className="field">
          <label className="field__label" htmlFor={fid('projectType')}>
            Kind of project <span className="field__req">(required)</span>
          </label>
          <select
            id={fid('projectType')}
            className="select"
            value={values.projectType}
            onChange={set('projectType')}
            aria-invalid={issueFor('projectType') ? true : undefined}
            aria-describedby={describedBy('projectType')}
          >
            <option value="">Choose one…</option>
            {PROJECT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {issueFor('projectType') ? (
            <p className="field__error" id={fid('projectType-error')}>
              {issueFor('projectType')}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={fid('game')}>
            Game or theme <span className="field__req">(optional)</span>
          </label>
          <p className="field__help" id={fid('game-help')}>
            For example the name of the game a case is for.
          </p>
          <input
            id={fid('game')}
            className="input"
            type="text"
            value={values.game}
            onChange={set('game')}
            maxLength={QUOTE_LIMITS.gameMax * 2}
            aria-invalid={issueFor('game') ? true : undefined}
            aria-describedby={describedBy('game', fid('game-help'))}
          />
          {issueFor('game') ? (
            <p className="field__error" id={fid('game-error')}>
              {issueFor('game')}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={fid('description')}>
            Describe your project <span className="field__req">(required)</span>
          </label>
          <p className="field__help" id={fid('description-help')}>
            What it is for, what it should hold or do, and anything that matters. At least{' '}
            {QUOTE_LIMITS.descriptionMin} characters.
          </p>
          <textarea
            id={fid('description')}
            className="textarea"
            rows={6}
            value={values.description}
            onChange={set('description')}
            aria-invalid={issueFor('description') ? true : undefined}
            aria-describedby={describedBy(
              'description',
              fid('description-help'),
              fid('description-counter'),
            )}
          />
          <p className="field__counter" id={fid('description-counter')}>
            {characterCount(values.description)} of {QUOTE_LIMITS.descriptionMax} characters
          </p>
          {issueFor('description') ? (
            <p className="field__error" id={fid('description-error')}>
              {issueFor('description')}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={fid('dimensions')}>
            Dimensions <span className="field__req">(optional)</span>
          </label>
          <p className="field__help" id={fid('dimensions-help')}>
            For example 12 x 12 x 4 inches, or the size of what it must fit.
          </p>
          <input
            id={fid('dimensions')}
            className="input"
            type="text"
            value={values.dimensions}
            onChange={set('dimensions')}
            maxLength={QUOTE_LIMITS.dimensionsMax * 2}
            aria-invalid={issueFor('dimensions') ? true : undefined}
            aria-describedby={describedBy('dimensions', fid('dimensions-help'))}
          />
          {issueFor('dimensions') ? (
            <p className="field__error" id={fid('dimensions-error')}>
              {issueFor('dimensions')}
            </p>
          ) : null}
        </div>
        <div className="quote-form__row">
          <div className="field">
            <label className="field__label" htmlFor={fid('quantity')}>
              Quantity <span className="field__req">(required)</span>
            </label>
            <input
              id={fid('quantity')}
              className="input"
              type="number"
              inputMode="numeric"
              min={QUOTE_LIMITS.quantityMin}
              max={QUOTE_LIMITS.quantityMax}
              step={1}
              value={values.quantity}
              onChange={set('quantity')}
              aria-invalid={issueFor('quantity') ? true : undefined}
              aria-describedby={describedBy('quantity')}
            />
            {issueFor('quantity') ? (
              <p className="field__error" id={fid('quantity-error')}>
                {issueFor('quantity')}
              </p>
            ) : null}
          </div>
          <div className="field">
            <label className="field__label" htmlFor={fid('deadline')}>
              Needed by <span className="field__req">(optional)</span>
            </label>
            <input
              id={fid('deadline')}
              className="input"
              type="date"
              min={today || undefined}
              value={values.deadline}
              onChange={set('deadline')}
              aria-invalid={issueFor('deadline') ? true : undefined}
              aria-describedby={describedBy('deadline')}
            />
            {issueFor('deadline') ? (
              <p className="field__error" id={fid('deadline-error')}>
                {issueFor('deadline')}
              </p>
            ) : null}
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={fid('colors')}>
            Colors <span className="field__req">(optional)</span>
          </label>
          <input
            id={fid('colors')}
            className="input"
            type="text"
            value={values.colors}
            onChange={set('colors')}
            maxLength={QUOTE_LIMITS.colorsMax * 2}
            aria-invalid={issueFor('colors') ? true : undefined}
            aria-describedby={describedBy('colors')}
          />
          {issueFor('colors') ? (
            <p className="field__error" id={fid('colors-error')}>
              {issueFor('colors')}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label className="field__label" htmlFor={fid('shipTo')}>
            Where would it ship? <span className="field__req">(optional)</span>
          </label>
          <p className="field__help" id={fid('shipTo-help')}>
            A country and ZIP or postal code is enough. It helps us price shipping.
          </p>
          <input
            id={fid('shipTo')}
            className="input"
            type="text"
            autoComplete="postal-code"
            value={values.shipTo}
            onChange={set('shipTo')}
            maxLength={QUOTE_LIMITS.shipToMax * 2}
            aria-invalid={issueFor('shipTo') ? true : undefined}
            aria-describedby={describedBy('shipTo', fid('shipTo-help'))}
          />
          {issueFor('shipTo') ? (
            <p className="field__error" id={fid('shipTo-error')}>
              {issueFor('shipTo')}
            </p>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Reference pictures</legend>
        <div className="field">
          <label className="field__label" htmlFor={fid('files')}>
            Add pictures <span className="field__req">(optional)</span>
          </label>
          <p className="field__help" id={fid('files-help')}>
            Up to {MAX_FILES} JPEG, PNG, WebP or GIF pictures. Large photos are made smaller before
            they are sent.
          </p>
          <input
            id={fid('files')}
            ref={fileRef}
            className="input quote-form__file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            onChange={(e) => void addFiles(e.target.files)}
            aria-describedby={describedFiles}
            aria-invalid={fileMessage || issueFor('files') ? true : undefined}
          />
          {fileMessage || issueFor('files') ? (
            <p className="field__error" id={fid('files-error')}>
              {fileMessage ?? issueFor('files')}
            </p>
          ) : null}
          {preparing > 0 ? (
            <p className="field__help" role="status">
              Preparing your pictures…
            </p>
          ) : null}
          {files.length > 0 ? (
            <ul className="quote-files" aria-label="Pictures to send">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <span className="quote-files__name">{file.name}</span>
                  <span className="quote-files__size">{mb(file.size)}</span>
                  <button
                    type="button"
                    className="button button--small button--secondary"
                    onClick={() => removeFile(index)}
                  >
                    Remove<span className="visually-hidden"> {file.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </fieldset>

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
        aria-disabled={status === 'sending' || preparing > 0 ? true : undefined}
      >
        {status === 'sending' ? 'Sending…' : 'Send my request'}
      </button>
      <p className="field__help" style={{ marginTop: 'var(--space-3)' }}>
        Asking for a quote is free and you do not pay anything. We keep your details private and use
        them only to answer you.
      </p>
    </form>
  );
}
