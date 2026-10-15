/*!
 * KCPrintWorks Address Autocomplete: address check (original code, GPL-2.0-or-later).
 *
 * Loaded only when the feature is on, a server key is saved and a form uses it. After an address is filled in or edited, it asks THIS
 * SITE's server (never Google directly: the key for that stays on the server) whether the address looks deliverable, and shows one
 * short message. It is advice: it never blocks typing, the Place Order button or a payment, and when the answer is unknown it says nothing.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root.KCPWAA && root.KCPWAA.registerModule) {
    root.KCPWAA.registerModule('validation', api.module);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  /** Most checks one page may make, however long the visitor edits (the server has its own limits too). */
  var PAGE_LIMIT = 6;
  var FIELDS = ['address', 'address2', 'city', 'state', 'postcode', 'country'];

  function valueOf(el) {
    if (!el) return '';
    if (el.tagName === 'SELECT') {
      return String(el.value || '').trim();
    }
    return String(el.value || '').trim();
  }

  /** What the server is asked: the pieces of the address and nothing else (no name, no email, no phone). */
  function gather(ctx) {
    var get = function (name) {
      return valueOf(ctx.fieldEl(name));
    };
    var region = get('country').toUpperCase();
    if (!/^[A-Z]{2}$/.test(region)) {
      var only = ctx.form.countries && ctx.form.countries.length === 1 ? ctx.form.countries[0] : '';
      region = /^[A-Z]{2}$/.test(only) ? only : '';
    }
    var lines = [get('address'), get('address2')].filter(Boolean);
    var address = {
      regionCode: region,
      postalCode: get('postcode'),
      administrativeArea: get('state'),
      locality: get('city'),
      addressLines: lines,
      formId: ctx.form.id,
    };
    // Too little to judge: wait until the visitor has given a street, a country and a town or postal code.
    if (
      !region ||
      !lines.length ||
      lines[0].length < 3 ||
      (!address.postalCode && !address.locality)
    ) {
      return null;
    }
    return address;
  }

  var module_ = {
    onAttach: function (ctx) {
      var state = { timer: null, last: '', seq: 0, count: 0, wait: null };
      ctx.validation = state;
      state.run = function (delay) {
        clearTimeout(state.timer);
        state.timer = setTimeout(function () {
          check(ctx, state);
        }, delay);
      };
      state.handler = function (event) {
        var t = event.target;
        if (!t || ctx.shared.filling > 0) return;
        for (var i = 0; i < FIELDS.length; i += 1) {
          if (t === ctx.fieldEl(FIELDS[i])) {
            state.run(900);
            return;
          }
        }
      };
      // "change" fires when a field is left, so a half-typed address is never sent.
      document.addEventListener('change', state.handler, true);
    },
    onFilled: function (ctx) {
      if (ctx.validation) ctx.validation.run(150);
    },
    onDetach: function (ctx) {
      var state = ctx.validation;
      if (!state) return;
      clearTimeout(state.timer);
      clearTimeout(state.wait);
      document.removeEventListener('change', state.handler, true);
      ctx.note('validate', '', '');
    },
  };

  function check(ctx, state) {
    var url = ctx.cfg.rest && ctx.cfg.rest.validate;
    var address = gather(ctx);
    if (!url || !address) {
      ctx.note('validate', '', '');
      return;
    }
    var key = JSON.stringify(address);
    if (key === state.last) return;
    if (state.count >= PAGE_LIMIT) return;
    state.last = key;
    state.count += 1;
    var mine = ++state.seq;
    clearTimeout(state.wait);
    // Only a slow answer is announced as "checking": a quick one just appears as its result.
    state.wait = setTimeout(function () {
      if (mine === state.seq) ctx.note('validate', 'info', ctx.i18n.checking);
    }, 700);
    ctx.post(url, address).then(function (answer) {
      if (mine !== state.seq) return;
      clearTimeout(state.wait);
      var verdict = answer && typeof answer.verdict === 'string' ? answer.verdict : 'unknown';
      if (verdict === 'ok') ctx.note('validate', 'ok', ctx.i18n.checkOk);
      else if (verdict === 'check') ctx.note('validate', 'warn', ctx.i18n.checkMaybe);
      else if (verdict === 'bad') ctx.note('validate', 'warn', ctx.i18n.checkBad);
      else ctx.note('validate', '', '');
    });
  }

  return { module: module_, gather: gather };
});
