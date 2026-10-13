'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  MAX_LINE_QUANTITY,
  addMoney,
  characterCount,
  findVariation,
  formatMoney,
  optionPriceAdders,
  validateOptions,
  type OptionField,
  type OptionValues,
  type PriceEffect,
  type Product,
} from '@kcpw/contracts';
import { cartActions } from '@/lib/cart/store';
import { optionAvailability } from '@/lib/variation';
import { Price } from './Price';

interface FormIssue {
  id: string;
  message: string;
}

function effectText(effect: PriceEffect | undefined, currency: string): string {
  if (!effect) return '';
  if (effect.kind === 'flat') {
    const sign = effect.amount >= 0 ? '+' : '-';
    return ` (${sign}${formatMoney({ amount: Math.abs(effect.amount), currency })})`;
  }
  return ` (${effect.basisPoints >= 0 ? '+' : ''}${effect.basisPoints / 100}%)`;
}

/** Option values that are safe to price while the shopper is still typing. */
function usableValues(fields: OptionField[], values: OptionValues): OptionValues {
  const out: OptionValues = {};
  for (const field of fields) {
    const value = values[field.id];
    if (value === undefined) continue;
    if (field.type === 'select' || field.type === 'radio') {
      if (typeof value === 'string' && field.choices.some((c) => c.value === value))
        out[field.id] = value;
    } else if (field.type === 'checkbox') {
      if (value === true) out[field.id] = true;
    } else if (typeof value === 'string' && value.trim() !== '') {
      out[field.id] = value;
    }
  }
  return out;
}

/** Move focus to a field (or the first input of a group) from the error summary. */
function focusField(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const target = el.matches('input, select, textarea, button')
    ? el
    : el.querySelector<HTMLElement>('input, select, textarea, button');
  (target ?? el).focus();
}

export function ProductPurchase({ product }: { product: Product }) {
  const uid = useId();
  const currency = product.price.currency;
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [values, setValues] = useState<OptionValues>({});
  const [quantity, setQuantity] = useState('1');
  const [issues, setIssues] = useState<FormIssue[]>([]);
  const [added, setAdded] = useState<string | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  const variationAttributes = product.attributes.filter((a) => a.usedForVariations);
  const variation = useMemo(() => findVariation(product, selection), [product, selection]);
  const base = variation?.price ?? product.price;
  const adders = optionPriceAdders(
    product.optionSchema,
    usableValues(product.optionSchema.fields, values),
    base,
  );
  const itemPrice = addMoney(base, adders);

  const variationSoldOut = variation?.stockStatus === 'outofstock';
  const simpleSoldOut =
    product.type === 'simple' && product.availability.stockStatus === 'outofstock';
  const soldOut = variationSoldOut || simpleSoldOut;

  const issueFor = (id: string) => issues.find((i) => i.id === id)?.message;
  const fid = (name: string) => `${uid}-${name}`;

  useEffect(() => {
    if (issues.length > 0) summaryRef.current?.focus();
  }, [issues]);

  function setValue(id: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [id]: value }));
    setAdded(null);
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const problems: FormIssue[] = [];

    const chosen = variation;
    if (product.type === 'variable') {
      for (const attr of variationAttributes) {
        if (!selection[attr.slug]) {
          problems.push({
            id: fid(`attr-${attr.slug}`),
            message: `Choose a ${attr.name.toLowerCase()}.`,
          });
        }
      }
      if (problems.length === 0 && !chosen) {
        const first = variationAttributes[0];
        problems.push({
          id: fid(`attr-${first?.slug ?? 'x'}`),
          message: 'That combination is not available. Choose a different option.',
        });
      }
    }
    if (soldOut) {
      const first = variationAttributes[0];
      problems.push({
        id: product.type === 'variable' ? fid(`attr-${first?.slug ?? 'x'}`) : fid('buy'),
        message: 'This item is sold out.',
      });
    }

    const validation = validateOptions(product.optionSchema, values);
    for (const issue of validation.issues) {
      problems.push({ id: fid(`opt-${issue.fieldId}`), message: issue.message });
    }

    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QUANTITY) {
      problems.push({
        id: fid('qty'),
        message: `Enter a quantity from 1 to ${MAX_LINE_QUANTITY}.`,
      });
    }

    if (problems.length > 0) {
      setIssues(problems);
      setAdded(null);
      return;
    }

    setIssues([]);
    cartActions.add({
      productId: product.id,
      variationId: chosen?.id,
      attributes: product.type === 'variable' ? selection : undefined,
      quantity: qty,
      options: validation.values,
    });
    setAdded(`${qty} × ${product.name} added to your cart.`);
  }

  const leadTime = product.availability.madeToOrder
    ? product.availability.leadTimeDays
      ? `Made to order. Allow about ${product.availability.leadTimeDays} days before it ships.`
      : 'Made to order.'
    : null;

  return (
    <form onSubmit={onSubmit} noValidate aria-label={`Buy ${product.name}`}>
      <p className="pdp__price">
        <Price
          price={variation ? variation.price : product.price}
          regularPrice={variation ? variation.regularPrice : product.regularPrice}
          from={product.type === 'variable' && !variation}
        />
      </p>
      {leadTime ? <p className="pdp__note">{leadTime}</p> : null}

      {issues.length > 0 ? (
        <div ref={summaryRef} className="error-summary" role="alert" tabIndex={-1}>
          <h2>Please fix {issues.length === 1 ? 'this' : 'these'} before adding to your cart</h2>
          <ul>
            {issues.map((issue) => (
              <li key={issue.id + issue.message}>
                <a
                  href={`#${issue.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    focusField(issue.id);
                  }}
                >
                  {issue.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {variationAttributes.map((attr) => (
        <fieldset
          key={attr.slug}
          className="form-section"
          aria-describedby={
            issueFor(fid(`attr-${attr.slug}`)) ? fid(`attr-${attr.slug}-error`) : undefined
          }
        >
          <legend>
            {attr.name} <span className="field__req">(required)</span>
          </legend>
          <div className="choice-group" id={fid(`attr-${attr.slug}`)} tabIndex={-1}>
            {attr.options.map((option) => {
              const availability = optionAvailability(product, attr.slug, option.slug, selection);
              return (
                <label key={option.slug} className="choice">
                  <input
                    type="radio"
                    name={fid(`attr-${attr.slug}`)}
                    value={option.slug}
                    checked={selection[attr.slug] === option.slug}
                    disabled={availability === 'unavailable'}
                    onChange={() => {
                      setSelection((prev) => ({ ...prev, [attr.slug]: option.slug }));
                      setAdded(null);
                    }}
                  />
                  <span>
                    {option.name}
                    {availability === 'soldout' ? (
                      <span className="visually-hidden"> (sold out)</span>
                    ) : null}
                    {availability === 'unavailable' ? (
                      <span className="visually-hidden"> (not available)</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
          {issueFor(fid(`attr-${attr.slug}`)) ? (
            <p className="field__error" id={fid(`attr-${attr.slug}-error`)}>
              {issueFor(fid(`attr-${attr.slug}`))}
            </p>
          ) : null}
        </fieldset>
      ))}

      {product.optionSchema.fields.length > 0 ? (
        <fieldset className="form-section">
          <legend>Personalize it</legend>
          {product.optionSchema.fields.map((field) => {
            const id = fid(`opt-${field.id}`);
            const error = issueFor(id);
            const helpId = `${id}-help`;
            const errorId = `${id}-error`;
            const counterId = `${id}-count`;
            const describedBy =
              [
                field.helpText ? helpId : null,
                field.type === 'text' || field.type === 'textarea' ? counterId : null,
                error ? errorId : null,
              ]
                .filter(Boolean)
                .join(' ') || undefined;
            const required = field.required;
            const label = (
              <>
                {field.label}
                {required ? (
                  <span className="field__req"> (required)</span>
                ) : (
                  <span className="field__req"> (optional)</span>
                )}
              </>
            );

            if (field.type === 'checkbox') {
              return (
                <div className="field" key={field.id}>
                  <div className="checkbox-row">
                    <input
                      id={id}
                      type="checkbox"
                      checked={values[field.id] === true}
                      aria-describedby={describedBy}
                      onChange={(e) => setValue(field.id, e.target.checked)}
                    />
                    <label htmlFor={id}>
                      {field.label}
                      {effectText(field.priceEffect, currency)}
                    </label>
                  </div>
                  {field.helpText ? (
                    <p className="field__help" id={helpId}>
                      {field.helpText}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="field__error" id={errorId}>
                      {error}
                    </p>
                  ) : null}
                </div>
              );
            }

            if (field.type === 'radio') {
              return (
                <fieldset
                  className="field form-section"
                  key={field.id}
                  aria-describedby={describedBy}
                >
                  <legend>{label}</legend>
                  <div className="choice-group" id={id} tabIndex={-1}>
                    {field.choices.map((choice) => (
                      <label key={choice.value} className="choice">
                        <input
                          type="radio"
                          name={id}
                          value={choice.value}
                          checked={values[field.id] === choice.value}
                          onChange={() => setValue(field.id, choice.value)}
                        />
                        <span>
                          {choice.label}
                          {effectText(choice.priceEffect, currency)}
                        </span>
                      </label>
                    ))}
                  </div>
                  {field.helpText ? (
                    <p className="field__help" id={helpId}>
                      {field.helpText}
                    </p>
                  ) : null}
                  {error ? (
                    <p className="field__error" id={errorId}>
                      {error}
                    </p>
                  ) : null}
                </fieldset>
              );
            }

            if (field.type === 'select') {
              return (
                <div className="field" key={field.id}>
                  <label className="field__label" htmlFor={id}>
                    {label}
                  </label>
                  {field.helpText ? (
                    <p className="field__help" id={helpId}>
                      {field.helpText}
                    </p>
                  ) : null}
                  <select
                    id={id}
                    className="select"
                    value={typeof values[field.id] === 'string' ? (values[field.id] as string) : ''}
                    aria-required={required}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    onChange={(e) => setValue(field.id, e.target.value)}
                  >
                    <option value="">Choose an option</option>
                    {field.choices.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                        {effectText(choice.priceEffect, currency)}
                      </option>
                    ))}
                  </select>
                  {error ? (
                    <p className="field__error" id={errorId}>
                      {error}
                    </p>
                  ) : null}
                </div>
              );
            }

            const current =
              typeof values[field.id] === 'string' ? (values[field.id] as string) : '';
            const common = {
              id,
              value: current,
              placeholder: field.placeholder,
              'aria-required': required,
              'aria-invalid': error ? true : undefined,
              'aria-describedby': describedBy,
            } as const;
            return (
              <div className="field" key={field.id}>
                <label className="field__label" htmlFor={id}>
                  {label}
                </label>
                {field.helpText ? (
                  <p className="field__help" id={helpId}>
                    {field.helpText}
                  </p>
                ) : null}
                {field.type === 'textarea' ? (
                  <textarea
                    {...common}
                    className="textarea"
                    onChange={(e) => setValue(field.id, e.target.value)}
                  />
                ) : (
                  <input
                    {...common}
                    className="input"
                    type="text"
                    autoComplete="off"
                    onChange={(e) => setValue(field.id, e.target.value)}
                  />
                )}
                <p className="field__counter" id={counterId}>
                  {characterCount(current)} of {field.maxLength} characters
                </p>
                {error ? (
                  <p className="field__error" id={errorId}>
                    {error}
                  </p>
                ) : null}
              </div>
            );
          })}
        </fieldset>
      ) : null}

      <div className="buy-row">
        <div className="field" style={{ marginBottom: 0 }}>
          <label className="field__label" htmlFor={fid('qty')}>
            Quantity
          </label>
          <input
            id={fid('qty')}
            className="input qty"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_LINE_QUANTITY}
            value={quantity}
            aria-invalid={issueFor(fid('qty')) ? true : undefined}
            onChange={(e) => {
              setQuantity(e.target.value);
              setAdded(null);
            }}
          />
        </div>
        <div id={fid('buy')} tabIndex={-1}>
          <button
            type="submit"
            className="button"
            aria-disabled={soldOut ? true : undefined}
            aria-describedby={soldOut ? fid('soldout') : undefined}
          >
            {soldOut ? 'Sold out' : 'Add to cart'}
          </button>
        </div>
      </div>
      <p className="pdp__note" style={{ marginTop: 'var(--space-3)' }}>
        This item: <strong>{formatMoney(itemPrice)}</strong>
        {adders.amount !== 0 ? ` (includes ${formatMoney(adders)} for your choices)` : ''}. Shipping
        and tax are calculated at checkout.
      </p>
      {soldOut ? (
        <p className="field__error" id={fid('soldout')}>
          This {product.type === 'variable' ? 'combination' : 'item'} is currently sold out.
        </p>
      ) : null}

      <div role="status" aria-live="polite">
        {added ? (
          <div className="notice notice--success">
            <p>
              {added} <Link href="/cart/">View cart</Link>
            </p>
          </div>
        ) : null}
      </div>
    </form>
  );
}
