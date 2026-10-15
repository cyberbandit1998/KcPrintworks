/*!
 * KCPrintWorks Address Autocomplete: PO box and military address notice (original code, GPL-2.0-or-later).
 *
 * Loaded only when this feature is switched on and a form uses it. It reads the street lines as they are typed or filled in and puts
 * one message under the address field; it never stops the customer from typing or paying (when the owner chose "block", the SERVER
 * refuses the order: this file only explains). The same rules are in src/PoBox.php; tests/vectors/pobox.json is run through both.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root.KCPWAA && root.KCPWAA.registerModule) {
    root.KCPWAA.registerModule('pobox', api.module);
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var ACCENTS = {
    é: 'e',
    è: 'e',
    ê: 'e',
    î: 'i',
    ï: 'i',
    ô: 'o',
    ç: 'c',
    ã: 'a',
    á: 'a',
    à: 'a',
    ñ: 'n',
    ü: 'u',
    ö: 'o',
    ä: 'a',
  };

  /** Lower case, accents removed, every run of other characters becomes one space ("P.O. Box 12" and "p o box 12" read the same). */
  function normalize(text) {
    return String(text === null || text === undefined ? '' : text)
      .trim()
      .toLowerCase()
      .replace(/[éèêîïôçãáàñüöä]/g, function (c) {
        return ACCENTS[c];
      })
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var BOXES = [
    ' p o box ',
    ' po box ',
    ' pobox ',
    ' post office box ',
    ' postal box ',
    ' gpo box ',
    ' p o b ',
    ' pob ',
    ' private bag ',
    ' locked bag ',
    ' postfach ',
    ' apartado postal ',
    ' apartado de correos ',
    ' caixa postal ',
    ' boite postale ',
    ' casella postale ',
    ' postbus ',
  ];

  /** @returns {'po_box'|'military'|null} */
  function detect(text) {
    var t = ' ' + normalize(text) + ' ';
    if (t === '  ') return null;
    if (
      / (?:apo|fpo|dpo) (?:a[aep]\b|\d{5}\b)/.test(t) ||
      / (?:apo|fpo|dpo) [a-z ]{0,20}\b09\d{3}\b/.test(t) ||
      / (?:psc|cmr) \d+ /.test(t) ||
      / (?:apo|fpo|dpo) a[aep] /.test(t)
    ) {
      return 'military';
    }
    for (var i = 0; i < BOXES.length; i += 1) {
      if (t.indexOf(BOXES[i]) !== -1) {
        // "p o b" and "pob" alone could also be the start of a name; they only count when a number follows.
        if ((BOXES[i] === ' p o b ' || BOXES[i] === ' pob ') && !/ (?:p o b|pob) \d/.test(t))
          continue;
        return 'po_box';
      }
    }
    return null;
  }

  function detectAny(lines) {
    for (var i = 0; i < lines.length; i += 1) {
      var found = detect(lines[i]);
      if (found) return found;
    }
    return null;
  }

  function check(ctx) {
    var address = ctx.fieldEl('address');
    var unit = ctx.fieldEl('address2');
    var found = detectAny([address ? address.value : '', unit ? unit.value : '']);
    var block = ctx.cfg.poboxMode === 'block';
    if (found === 'po_box') {
      ctx.note('pobox', block ? 'error' : 'warn', block ? ctx.i18n.poBoxBlock : ctx.i18n.poBoxWarn);
    } else if (found === 'military') {
      ctx.note('pobox', 'warn', ctx.i18n.military);
    } else {
      ctx.note('pobox', '', '');
    }
  }

  var module_ = {
    onAttach: function (ctx) {
      var state = { timer: null };
      var handler = function (event) {
        var t = event.target;
        if (t !== ctx.fieldEl('address') && t !== ctx.fieldEl('address2')) return;
        clearTimeout(state.timer);
        state.timer = setTimeout(function () {
          check(ctx);
        }, 250);
      };
      state.handler = handler;
      ctx.pobox = state;
      // Capture on the document: the checkout draws and re-draws its fields, and a listener there survives that.
      document.addEventListener('input', handler, true);
      document.addEventListener('change', handler, true);
      check(ctx);
    },
    onFilled: function (ctx) {
      check(ctx);
    },
    onDetach: function (ctx) {
      var state = ctx.pobox;
      if (!state) return;
      clearTimeout(state.timer);
      document.removeEventListener('input', state.handler, true);
      document.removeEventListener('change', state.handler, true);
      ctx.note('pobox', '', '');
    },
  };

  return { module: module_, normalize: normalize, detect: detect, detectAny: detectAny };
});
