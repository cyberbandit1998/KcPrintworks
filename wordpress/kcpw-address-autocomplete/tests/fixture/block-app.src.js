/*
 * A STAND-IN for WooCommerce's Checkout Block, written with real React 19 so the plugin meets React's actual behavior. It copies the
 * parts of the block that matter to an address plugin, from the block's public markup and behavior:
 *   - text fields and selects are CONTROLLED inputs (React keeps its own value; `input.value = x` is ignored by React),
 *   - the address form rebuilds the WHOLE address from the value it last rendered each time one field changes,
 *   - changing the country redraws the state field (a list for some countries, a text box for others),
 *   - the second address line is hidden behind a "+ Add apartment, suite, etc." link,
 *   - the fields appear a moment after the page loads,
 *   - shipping rates are recalculated (debounced) when the address changes,
 *   - billing fields appear when "Use same address for billing" is unticked,
 *   - a payment area (a Stripe-like frame stand-in) that nothing but the payment plugin should ever touch.
 * It is NOT WooCommerce: a real shop with the real block is checked by the install guide's preview step.
 */
import { createElement as h, memo, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const params = new URLSearchParams(location.search);
const LATE_MS = Number(params.get('late') || 500);
const COMBOBOX = params.get('combobox') === '1';

const COUNTRIES = [
  ['US', 'United States (US)'],
  ['CA', 'Canada'],
  ['GB', 'United Kingdom (UK)'],
  ['DE', 'Germany'],
  ['AU', 'Australia'],
];
const STATES = {
  US: [['MI', 'Michigan'], ['TX', 'Texas'], ['NY', 'New York'], ['CA', 'California']],
  CA: [['ON', 'Ontario'], ['BC', 'British Columbia']],
  AU: [['NSW', 'New South Wales'], ['VIC', 'Victoria']],
};

const empty = (country) => ({ country, first_name: '', last_name: '', address_1: '', address_2: '', city: '', state: '', postcode: '' });

function TextInput({ id, label, value, onChange, autoComplete }) {
  return h(
    'div',
    { className: 'wc-block-components-text-input wc-block-components-address-form__' + id.split('-').slice(1).join('-') + (value ? ' is-active' : '') },
    h('input', { type: 'text', id, value, autoComplete, 'aria-label': label, 'aria-invalid': 'false', onChange: (e) => onChange(e.target.value) }),
    h('label', { htmlFor: id }, label),
  );
}

function Select({ id, label, value, options, onChange }) {
  return h(
    'div',
    { className: 'wc-blocks-components-select' },
    h(
      'div',
      { className: 'wc-blocks-components-select__container' },
      h('label', { htmlFor: id, className: 'wc-blocks-components-select__label' }, label),
      h(
        'select',
        { id, className: 'wc-blocks-components-select__select', value, onChange: (e) => onChange(e.target.value) },
        h('option', { value: '' }, 'Select an option'),
        options.map(([v, t]) => h('option', { key: v, value: v }, t)),
      ),
    ),
  );
}

/** The older Checkout Block drew country and state as a text combobox: type, then pick a row. */
function Combobox({ id, label, value, options, onChange }) {
  const current = (options.find(([v]) => v === value) || ['', ''])[1];
  const [text, setText] = useState(current);
  const [open, setOpen] = useState(false);
  useEffect(() => setText(current), [current]);
  const shown = options.filter(([, t]) => t.toLowerCase().includes(text.toLowerCase()));
  return h(
    'div',
    { className: 'wc-block-components-combobox' },
    h('label', { htmlFor: id }, label),
    h('input', {
      id, type: 'text', role: 'combobox', 'aria-expanded': open, autoComplete: 'off', value: text,
      onFocus: () => setOpen(true),
      onChange: (e) => { setText(e.target.value); setOpen(true); },
    }),
    open && h('ul', { role: 'listbox' }, shown.map(([v, t]) => h('li', { key: v, role: 'option', onClick: () => { onChange(v); setText(t); setOpen(false); } }, t))),
  );
}

function AddressForm({ type, values, onChange, showAddress2, setShowAddress2 }) {
  // Like the block: every change rebuilds the whole address from the values this render was given.
  const set = (key) => (value) => onChange({ ...values, [key]: value });
  const states = STATES[values.country];
  const Pick = COMBOBOX ? Combobox : Select;
  return h(
    'div',
    { className: 'wc-block-components-address-form' },
    h(Pick, { id: `${type}-country`, label: 'Country/Region', value: values.country, options: COUNTRIES, onChange: (country) => onChange({ ...values, country, state: '' }) }),
    h(TextInput, { id: `${type}-first_name`, label: 'First name', value: values.first_name, onChange: set('first_name'), autoComplete: 'given-name' }),
    h(TextInput, { id: `${type}-last_name`, label: 'Last name', value: values.last_name, onChange: set('last_name'), autoComplete: 'family-name' }),
    h(TextInput, { id: `${type}-address_1`, label: 'Address', value: values.address_1, onChange: set('address_1'), autoComplete: 'address-line1' }),
    showAddress2
      ? h(TextInput, { id: `${type}-address_2`, label: 'Apartment, suite, etc. (optional)', value: values.address_2, onChange: set('address_2'), autoComplete: 'address-line2' })
      : h('a', { className: 'wc-block-components-address-form__address_2-toggle', role: 'button', tabIndex: 0, onClick: () => setShowAddress2(true) }, '+ Add apartment, suite, etc.'),
    h(TextInput, { id: `${type}-city`, label: 'City', value: values.city, onChange: set('city'), autoComplete: 'address-level2' }),
    // A different element (and key) for a country with a list than for one without: React draws the state field again.
    states
      ? h(Pick, { key: 'state-list', id: `${type}-state`, label: 'State/Province', value: values.state, options: states, onChange: set('state') })
      : h(TextInput, { key: 'state-text', id: `${type}-state`, label: 'State/County', value: values.state, onChange: set('state'), autoComplete: 'address-level1' }),
    h(TextInput, { id: `${type}-postcode`, label: values.country === 'US' ? 'ZIP Code' : 'Postal code', value: values.postcode, onChange: set('postcode'), autoComplete: 'postal-code' }),
  );
}

/** Nothing here may ever change because of the address plugin. */
const Payment = memo(function Payment() {
  return h(
    'div',
    null,
    h('div', { id: 'express-payment-stand-in', className: 'wc-block-components-express-payment' }, h('p', null, 'Express checkout (stand-in)')),
    h(
      'div',
      { id: 'payment-stand-in', className: 'wc-block-components-radio-control-accordion-option' },
      h('p', null, 'Card (stand-in for the Stripe payment element)'),
      h('iframe', { id: 'payment-frame', title: 'Stand-in for the secure payment frame', srcDoc: '<!doctype html><title>x</title><p>secure card fields</p>' }),
    ),
  );
});

function rateFor(a) {
  if (!a.country) return null;
  if (a.country === 'US') return a.state === 'MI' ? 500 : a.state ? 800 : null;
  if (a.country === 'CA') return 1500;
  return 2500;
}

function Checkout() {
  const [ready, setReady] = useState(false);
  const [shipping, setShipping] = useState(empty('US'));
  const [billing, setBilling] = useState(empty('US'));
  const [same, setSame] = useState(true);
  const [show2, setShow2] = useState({ shipping: false, billing: false });
  const [rates, setRates] = useState(null);
  const [changes, setChanges] = useState(0);

  useEffect(() => { const t = setTimeout(() => setReady(true), LATE_MS); return () => clearTimeout(t); }, []);
  // Debounced, like the block's own request for new shipping rates.
  useEffect(() => {
    const t = setTimeout(() => setRates({ for: `${shipping.city}|${shipping.state}|${shipping.postcode}|${shipping.country}`, cents: rateFor(shipping) }), 150);
    return () => clearTimeout(t);
  }, [shipping.country, shipping.state, shipping.postcode, shipping.city]);

  const store = { shipping, billing, same, rates, changes };
  window.__store = store;

  const setShip = (v) => { setChanges((n) => n + 1); setShipping(v); };
  const setBill = (v) => { setChanges((n) => n + 1); setBilling(v); };

  return h(
    'div',
    { className: 'wp-block-woocommerce-checkout' },
    h(Payment),
    !ready
      ? h('div', { className: 'wc-block-components-skeleton', 'aria-busy': 'true' }, 'Loading checkout...')
      : h(
          'form',
          { className: 'wc-block-components-form wc-block-checkout__form', onSubmit: (e) => { e.preventDefault(); window.__placed = (window.__placed || 0) + 1; } },
          h('h2', null, 'Shipping address'),
          h(AddressForm, { type: 'shipping', values: shipping, onChange: setShip, showAddress2: show2.shipping, setShowAddress2: () => setShow2((s) => ({ ...s, shipping: true })) }),
          h('label', { className: 'wc-block-components-checkbox' }, h('input', { type: 'checkbox', id: 'use-same-address', checked: same, onChange: (e) => setSame(e.target.checked) }), ' Use same address for billing'),
          !same && h('div', null, h('h2', null, 'Billing address'), h(AddressForm, { type: 'billing', values: billing, onChange: setBill, showAddress2: show2.billing, setShowAddress2: () => setShow2((s) => ({ ...s, billing: true })) })),
          h('div', { id: 'shipping-rates', 'data-cents': rates && rates.cents != null ? String(rates.cents) : '', 'data-for': rates ? rates.for : '' },
            rates && rates.cents != null ? `Shipping to ${shipping.city}, ${shipping.state} ${shipping.postcode}: $${(rates.cents / 100).toFixed(2)}` : 'Enter your address to see shipping options'),
          h('button', { type: 'submit', id: 'place-order', className: 'wc-block-components-checkout-place-order-button' }, 'Place Order'),
        ),
  );
}

createRoot(document.getElementById('root')).render(h(Checkout));
