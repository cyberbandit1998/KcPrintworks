/*!
 * KCPrintWorks Address Autocomplete: core (original code, GPL-2.0-or-later).
 *
 * What it does, in the order a visitor meets it:
 *  1. Finds the configured address fields (and keeps looking: WooCommerce's Checkout Block draws its fields after the page loads).
 *  2. Loads Google's script only when a visitor first focuses one of them (nothing is requested at page load).
 *  3. After a pause (debounce) and a minimum number of characters, asks Google's Places API (New) for suggestions, with ONE session
 *     token per typing session so Google bills a session, not every keystroke.
 *  4. Shows them in an accessible listbox (ARIA combobox pattern), with Google's attribution.
 *  5. On selection asks Google for the address parts only (the cheapest field set), maps them to the form's fields and fills them
 *     ONE FIELD AT A TIME in a way React-controlled forms accept (see "Filling fields").
 *  6. If anything fails (script blocked, bad key, API off, quota, no results), the field simply stays a normal text field.
 *
 * Optional features (map picker, GPS, validation, PO box) are separate files loaded only when switched on; see registerModule().
 * The pure helpers (mapAddress, matchOption, ...) are exported for the Node tests (module.exports).
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.KCPWAA = api;
  }
  if (root.document && root.KCPW_AA && !root.KCPW_AA_MANUAL) {
    api.start(root.KCPW_AA);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  // ------------------------------------------------------------------------------------------------------------------
  // Address mapping (pure)
  // ------------------------------------------------------------------------------------------------------------------

  /** Countries whose street line is written "street number" (Hauptstrasse 12), not "number street" (12 Main St). */
  var NUMBER_AFTER = toSet(
    'AR AT BE BG BR CH CL CO CZ DE DK EE ES FI GR HR HU IS IT LT LV MX NL NO PE PL PT RO RS RU SE SI SK TR UA UY',
  );
  /** Of those, the ones that put a comma between street and number ("Calle Mayor, 12"). */
  var NUMBER_COMMA = toSet('AR BR CL CO ES MX PE PT UY');
  var WORDS_TO_DROP =
    /\b(county|co|province of|state of|province|prefecture|region|department|governorate|municipality|district)\b/g;

  function toSet(text) {
    var set = {};
    text.split(' ').forEach(function (code) {
      set[code] = true;
    });
    return set;
  }

  /** Lower case, no accents, no punctuation, no "county"/"province" style words: the form that two spellings of a place share. */
  function fold(value) {
    var s = String(value == null ? '' : value);
    if (s.normalize) {
      s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    }
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(WORDS_TO_DROP, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Reads a part of a Google address under either spelling (Places "longText"/"shortText", Geocoder "long_name"/"short_name"). */
  function part(components, type, short) {
    for (var i = 0; i < components.length; i += 1) {
      var c = components[i];
      if (c && c.types && c.types.indexOf(type) !== -1) {
        var value = short
          ? c.shortText !== undefined
            ? c.shortText
            : c.short_name
          : c.longText !== undefined
            ? c.longText
            : c.long_name;
        return value == null ? '' : String(value);
      }
    }
    return '';
  }

  /**
   * Turns Google's address parts into what a form needs.
   *
   * @param {{components: Array, formatted?: string, lat?: number, lng?: number}} place
   * @param {{unitLabel?: string, zipPlus4?: boolean}} [opts]
   * @returns {{country:{code:string,name:string}, state:{code:string,name:string}, city:string, postcode:string, line1:string, line2:string, formatted:string, lat:(number|null), lng:(number|null)}}
   */
  function mapAddress(place, opts) {
    opts = opts || {};
    var comps = (place && place.components) || [];
    var cc = part(comps, 'country', true).toUpperCase();
    var number = part(comps, 'street_number');
    var route = part(comps, 'route');
    var formatted = (place && place.formatted) || '';

    var line1;
    if (route && number) {
      line1 = NUMBER_AFTER[cc]
        ? route + (NUMBER_COMMA[cc] ? ', ' : ' ') + number
        : number + ' ' + route;
    } else {
      // No street and number (many Asian addresses, buildings, rural routes): the finest parts Google gave, in order.
      line1 =
        route ||
        number ||
        [
          part(comps, 'sublocality_level_2'),
          part(comps, 'sublocality_level_3'),
          part(comps, 'sublocality_level_4'),
          part(comps, 'premise'),
        ]
          .filter(Boolean)
          .join(' ') ||
        (formatted ? formatted.split(',')[0].trim() : '');
    }

    var unit = part(comps, 'subpremise');
    var line2 = unit ? (opts.unitLabel === undefined ? 'Unit' : opts.unitLabel) + ' ' + unit : '';
    line2 = line2.trim();

    // "Postal town" is the town the post is addressed to (always right in the UK); then the usual levels.
    var city =
      part(comps, 'postal_town') ||
      part(comps, 'locality') ||
      part(comps, 'sublocality_level_1') ||
      part(comps, 'sublocality') ||
      part(comps, 'administrative_area_level_3') ||
      part(comps, 'administrative_area_level_2');
    // New York City's boroughs are cities for the post office (Brooklyn, not New York).
    if (
      cc === 'US' &&
      fold(part(comps, 'locality')) === 'new york' &&
      part(comps, 'sublocality_level_1')
    ) {
      city = part(comps, 'sublocality_level_1');
    }

    var state = {
      code: part(comps, 'administrative_area_level_1', true),
      name: part(comps, 'administrative_area_level_1'),
    };
    if (cc === 'GB') {
      // A UK "county" is optional on forms and is the second level (England and Scotland are the first).
      var county = part(comps, 'administrative_area_level_2');
      state = { code: '', name: county };
    }

    var postcode = part(comps, 'postal_code');
    var suffix = part(comps, 'postal_code_suffix');
    if (postcode && suffix && cc === 'US' && opts.zipPlus4) {
      postcode += '-' + suffix;
    }

    var lat = null;
    var lng = null;
    if (place && place.lat !== undefined && place.lat !== null) {
      lat = Number(place.lat);
      lng = Number(place.lng);
    }
    return {
      country: { code: cc, name: part(comps, 'country') },
      state: state,
      city: city,
      postcode: postcode,
      line1: line1,
      line2: line2,
      formatted: formatted,
      lat: lat,
      lng: lng,
    };
  }

  /**
   * Finds the <option> of a <select> that means the given place: by value (WooCommerce stores codes: MI, ON, NSW), then by name,
   * ignoring accents, case, punctuation and words like "County" or "Province of".
   *
   * @param {{options: ArrayLike<{value: string, text: string}>}} select
   * @param {{code?: string, name?: string}} want
   */
  function matchOption(select, want) {
    var options = Array.prototype.slice.call(select.options || []);
    var code = String((want && want.code) || '').toLowerCase();
    var name = fold(want && want.name);
    var codeFolded = fold(want && want.code);
    var i;
    if (code) {
      for (i = 0; i < options.length; i += 1) {
        if (String(options[i].value).toLowerCase() === code) return options[i];
      }
    }
    if (name) {
      for (i = 0; i < options.length; i += 1) {
        if (fold(options[i].value) === name) return options[i];
      }
      for (i = 0; i < options.length; i += 1) {
        if (fold(options[i].text) === name) return options[i];
      }
    }
    if (codeFolded && codeFolded.length > 1) {
      for (i = 0; i < options.length; i += 1) {
        if (fold(options[i].text) === codeFolded) return options[i];
      }
    }
    if (name && name.length >= 4) {
      for (i = 0; i < options.length; i += 1) {
        var text = fold(options[i].text);
        if (text && (text.indexOf(name) === 0 || name.indexOf(text) === 0) && text.length >= 4)
          return options[i];
      }
    }
    return null;
  }

  /** Strips what a person would not type, so two suggestions for the same text share one cache entry. */
  function cacheKey(value) {
    return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
  }

  /** Sorts Google's error into one of a few codes the page can act on. Never includes the message in any output. */
  function classifyError(error) {
    var text = String(
      (error && (error.code || error.message || error.name)) || error || '',
    ).toLowerCase();
    if (
      /api_key_invalid|invalid.?key|invalidkey|key_invalid|referernotallowed|referer.*not.*allowed|api key not valid/.test(
        text,
      )
    )
      return 'auth';
    if (/billing/.test(text)) return 'billing';
    if (
      /permission_denied|request_denied|apinotactivated|api_not_activated|has not been used|is not enabled|not authorized|accessnotconfigured/.test(
        text,
      )
    )
      return 'api';
    if (/resource_exhausted|over_query_limit|quota|rate.?limit|429/.test(text)) return 'quota';
    if (/invalid_argument|invalidrequest|invalid_request/.test(text)) return 'request';
    if (
      /failed to fetch|networkerror|network error|load failed|timeout|timed out|offline/.test(text)
    )
      return 'network';
    return 'unknown';
  }

  /** Error codes after which asking again on this page would only repeat the failure (and, for quota, the cost). */
  var STOP_CODES = {
    auth: true,
    api: true,
    quota: true,
    billing: true,
    script: true,
    conflict: true,
    timeout: true,
  };

  var DEFAULT_I18N = {
    attribution: 'Powered by Google',
    listLabel: 'Address suggestions',
    count:
      '%d address suggestions available. Use the up and down arrow keys, then Enter to choose.',
    noResults: 'No suggestions. Keep typing, or enter your address yourself.',
    unavailable:
      'Address suggestions are not available right now. Please enter your address yourself.',
    limit: 'Suggestions paused. Please finish typing your address yourself.',
    loading: 'Looking up addresses\u2026',
    placeFailed: 'We could not load that address. Please finish it yourself.',
    filled: 'Address filled in. Please check each field.',
    unit: 'Unit',
    preview: 'Address suggestions: preview for administrators only. Customers do not see them yet.',
    previewDismiss: 'Dismiss this notice',
    problem: 'Address suggestions are not working on this page',
    tools: 'Other ways to enter your address',
    gps: 'Use my location',
    gpsWorking: 'Finding your location\u2026',
    gpsDenied: 'We could not get your location. You can type your address instead.',
    gpsFailed: 'We could not turn your location into an address. Please type it instead.',
    map: 'Choose on a map',
    mapTitle: 'Choose your address on the map',
    mapHelp:
      'Click or tap the map, or drag the pin, to mark where you are. The buttons below move the pin one step. You can also close this window and type your address.',
    mapLoading: 'Loading the map\u2026',
    mapFailed: 'The map could not be loaded. Please type your address instead.',
    mapNear: 'Pin is near: %s',
    mapNoAddress: 'There is no address at the pin. Move it, or type your address.',
    mapMove: 'Move the pin',
    mapUse: 'Use this address',
    mapClose: 'Close the map',
    mapNorth: 'Move pin north',
    mapSouth: 'Move pin south',
    mapEast: 'Move pin east',
    mapWest: 'Move pin west',
    poBoxWarn: 'This looks like a PO box. Please check that we can deliver to it.',
    poBoxBlock: 'This looks like a PO box. We can only deliver to a street address.',
    military:
      'This looks like a military (APO/FPO) address. Please check that we can deliver to it.',
    checking: 'Checking your address\u2026',
    checkOk: 'This address looks right.',
    checkMaybe: 'Please double-check this address.',
    checkBad: 'We could not verify this address. Please check it.',
  };

  /** Our own load failures carry a code; Google's errors are sorted by what their text says. */
  var OWN_CODES = { script: true, auth: true, conflict: true, timeout: true, network: true };
  function errorCode(error) {
    return error && OWN_CODES[error.code] ? error.code : classifyError(error);
  }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(failure('network', 'The request took too long.'));
      }, ms);
      promise.then(
        function (value) {
          clearTimeout(timer);
          resolve(value);
        },
        function (error) {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Small DOM helpers
  // ------------------------------------------------------------------------------------------------------------------

  function create(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function tick(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms === undefined ? 40 : ms);
    });
  }

  /** Resolves when the page has stopped changing (React finished re-drawing) or after `max` ms, whichever comes first. */
  function settle(quiet, max) {
    quiet = quiet || 120;
    max = max || 1200;
    return new Promise(function (resolve) {
      var start = Date.now();
      var last = start;
      var observer = new MutationObserver(function () {
        last = Date.now();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      (function check() {
        var now = Date.now();
        if (now - last >= quiet || now - start >= max) {
          observer.disconnect();
          resolve();
        } else {
          setTimeout(check, 30);
        }
      })();
    });
  }

  function queryAll(selector, scope) {
    try {
      return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
    } catch (e) {
      warnOnce(
        'selector:' + selector,
        'KCPW address autocomplete: the selector "' + selector + '" is not valid and was skipped.',
      );
      return [];
    }
  }

  var warned = {};
  function warnOnce(key, message) {
    if (!warned[key]) {
      warned[key] = true;
      if (root.console && root.console.warn) root.console.warn(message);
    }
  }

  function parseColor(value) {
    var m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)(?:[ ,/]+([\d.]+))?/.exec(value || '');
    return m
      ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
      : null;
  }

  function luminance(rgb) {
    var channels = [rgb[0], rgb[1], rgb[2]].map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Filling fields: what a React-controlled form needs
  //
  // React keeps its own copy of every input's value and ignores a plain `input.value = x`. The way in is the browser's own value
  // setter followed by a real `input` (and `change`) event. WooCommerce's address form also rebuilds the whole address from the
  // value it last drew each time one field changes, so this script writes ONE FIELD AT A TIME and waits for the form to draw in
  // between, and waits for the page to settle after the country (which redraws the state field). In the plugin's own React 19
  // stand-in a quicker fill did not lose values, so this is a precaution, not a proven need: it costs about 45 ms per field.
  // The values are read back at the end and anything React reverted is written once more.
  // ------------------------------------------------------------------------------------------------------------------

  function nativeSetter(el) {
    var proto =
      el.tagName === 'SELECT'
        ? root.HTMLSelectElement.prototype
        : el.tagName === 'TEXTAREA'
          ? root.HTMLTextAreaElement.prototype
          : root.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    return descriptor && descriptor.set;
  }

  function fire(el, type) {
    el.dispatchEvent(new root.Event(type, { bubbles: true }));
  }

  function setNativeValue(el, value) {
    var setter = nativeSetter(el);
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
  }

  /** classic WooCommerce styles its country and state lists with selectWoo, which listens to jQuery's change event */
  function jqueryChange(el) {
    var $ = root.jQuery;
    if ($ && el.className && String(el.className).indexOf('select2') !== -1) {
      $(el).trigger('change');
    }
  }

  function writeText(el, value) {
    if (el.value === value) return Promise.resolve(false);
    setNativeValue(el, value);
    fire(el, 'input');
    fire(el, 'change');
    jqueryChange(el);
    return tick(45).then(function () {
      return true;
    });
  }

  function writeSelect(el, option) {
    if (el.value === option.value) return Promise.resolve(false);
    setNativeValue(el, option.value);
    fire(el, 'input');
    fire(el, 'change');
    jqueryChange(el);
    return tick(45).then(function () {
      return true;
    });
  }

  /** Older WooCommerce blocks drew country and state as a text combobox (type, then click the matching row). Best effort only. */
  function writeCombobox(el, want) {
    var label = want.name || want.code;
    if (!label) return Promise.resolve(false);
    if (fold(el.value) === fold(label)) return Promise.resolve(false);
    el.focus();
    setNativeValue(el, label);
    fire(el, 'input');
    return tick(120).then(function () {
      var scope = el.closest('.wc-block-components-combobox, [class*="combobox"]') || document;
      var rows = queryAll('[role="option"], li', scope);
      var wanted = fold(label);
      var hit = null;
      rows.forEach(function (row) {
        if (!hit && fold(row.textContent) === wanted) hit = row;
      });
      if (!hit && want.code) {
        var code = fold(want.code);
        rows.forEach(function (row) {
          if (!hit && fold(row.textContent) === code) hit = row;
        });
      }
      if (hit) {
        hit.click();
      }
      return tick(80);
    });
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Google loader (one script, loaded on first use; a failed load is remembered, never retried)
  // ------------------------------------------------------------------------------------------------------------------

  var googlePromise = null;

  function failure(code, message) {
    var error = new Error(message || code);
    error.code = code;
    return error;
  }

  function loadGoogle(cfg) {
    if (googlePromise) return googlePromise;
    googlePromise = new Promise(function (resolve, reject) {
      var existing = root.google && root.google.maps;
      if (existing && existing.importLibrary) {
        resolve(existing);
        return;
      }
      if (existing) {
        reject(failure('conflict', 'Another plugin loaded an older Google Maps script.'));
        return;
      }
      var previous = root.gm_authFailure;
      root.gm_authFailure = function () {
        authFailed = true;
        try {
          if (typeof previous === 'function') previous();
        } catch (e) {
          /* the other handler's problem */
        }
        reject(failure('auth', 'Google rejected the key.'));
        if (authListener) authListener();
      };
      root.__kcpwAAMapsReady = function () {
        resolve(root.google.maps);
      };
      var params = [
        ['key', cfg.key],
        ['loading', 'async'],
        ['v', cfg.mapsVersion || 'weekly'],
        ['libraries', 'places'],
        ['callback', '__kcpwAAMapsReady'],
      ];
      if (cfg.language) params.push(['language', cfg.language]);
      var script = document.createElement('script');
      script.async = true;
      script.src =
        'https://maps.googleapis.com/maps/api/js?' +
        params
          .map(function (pair) {
            return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1]);
          })
          .join('&');
      script.onerror = function () {
        reject(failure('script', 'The Google Maps script could not be loaded.'));
      };
      document.head.appendChild(script);
      setTimeout(function () {
        reject(failure('timeout', 'Google took too long to load.'));
      }, 12000);
    });
    googlePromise.catch(function () {
      /* handled where it is used; this only stops an "unhandled rejection" report */
    });
    return googlePromise;
  }

  var authFailed = false;
  var authListener = null;

  // ------------------------------------------------------------------------------------------------------------------
  // Usage counters (numbers only; never an address, never what was typed)
  // ------------------------------------------------------------------------------------------------------------------

  var usage = { r: 0, d: 0, s: 0, m: 0, e: {} };

  function countError(code) {
    usage.e[code] = (usage.e[code] || 0) + 1;
  }

  function flushUsage(cfg) {
    if (!cfg.usage || !cfg.rest || !cfg.rest.usage) return;
    var any = usage.r || usage.d || usage.s || usage.m || Object.keys(usage.e).length;
    if (!any) return;
    var body = JSON.stringify(usage);
    usage = { r: 0, d: 0, s: 0, m: 0, e: {} };
    try {
      if (root.navigator && root.navigator.sendBeacon) {
        root.navigator.sendBeacon(
          cfg.rest.usage,
          new root.Blob([body], { type: 'application/json' }),
        );
      } else if (root.fetch) {
        root.fetch(cfg.rest.usage, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          credentials: 'omit',
        });
      }
    } catch (e) {
      /* counters are optional */
    }
  }

  // ------------------------------------------------------------------------------------------------------------------
  // This plugin's own REST routes (only the ones the owner switched on are ever listed in the page configuration)
  // ------------------------------------------------------------------------------------------------------------------

  /** GET (no body) or POST (a body). Resolves with the decoded answer, or null on ANY problem: nothing here may break a page. */
  function restCall(cfg, url, body) {
    if (!root.fetch || !url) return Promise.resolve(null);
    var headers = {};
    if (cfg.rest && cfg.rest.nonce) headers['X-WP-Nonce'] = cfg.rest.nonce;
    var init = {
      method: body === undefined ? 'GET' : 'POST',
      headers: headers,
      credentials: 'same-origin',
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    return withTimeout(root.fetch(url, init), 7000)
      .then(function (res) {
        return res && res.ok && res.status !== 204 ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  /** Opt-in: a country (and, from an IP lookup service, a city-sized position) that only softens how suggestions are ranked. */
  function loadHint(cfg, shared) {
    if (shared.hintAsked || !cfg.hint || !cfg.rest || !cfg.rest.hint) return;
    shared.hintAsked = true;
    restCall(cfg, cfg.rest.hint).then(function (hint) {
      if (!hint || typeof hint.country !== 'string' || !/^[A-Z]{2}$/.test(hint.country)) return;
      shared.region = hint.country;
      if (typeof hint.lat === 'number' && typeof hint.lng === 'number' && !shared.locationBias) {
        shared.locationBias = { center: { lat: hint.lat, lng: hint.lng }, radius: 50000 };
      }
    });
  }

  /** Opt-in: tells the server a checkout was started (it adds one to a number; nothing about the visitor is sent). */
  function countCheckoutStart(cfg, shared) {
    if (shared.startCounted || !cfg.countCheckouts || !cfg.rest || !cfg.rest.start) return;
    shared.startCounted = true;
    restCall(cfg, cfg.rest.start, {});
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Optional modules (map picker, GPS, validation, PO box): separate files, loaded on first focus, only when switched on
  // ------------------------------------------------------------------------------------------------------------------

  var modules = {};
  var moduleLoading = {};

  function registerModule(id, definition) {
    modules[id] = definition;
  }

  function loadModuleScript(cfg, id) {
    var url = cfg.modules && cfg.modules[id];
    if (modules[id]) return Promise.resolve(modules[id]);
    // A download already under way (started by pointing at the button) is waited for, not answered with "not available".
    if (moduleLoading[id]) return moduleLoading[id];
    if (!url) return Promise.resolve(null);
    moduleLoading[id] = new Promise(function (resolve) {
      var script = document.createElement('script');
      script.async = true;
      script.src = url;
      script.onload = function () {
        resolve(modules[id] || null);
      };
      script.onerror = function () {
        warnOnce(
          'module:' + id,
          'KCPW address autocomplete: the "' +
            id +
            '" feature could not be loaded and was skipped.',
        );
        resolve(null);
      };
      document.head.appendChild(script);
    });
    return moduleLoading[id];
  }

  // ------------------------------------------------------------------------------------------------------------------
  // The suggestions list (one shared element, an ARIA combobox/listbox)
  // ------------------------------------------------------------------------------------------------------------------

  var dropdown = null;

  function getDropdown(cfg) {
    if (dropdown) return dropdown;
    var wrap = create('div', 'kcpw-aa-dd');
    wrap.id = 'kcpw-aa-dd';
    wrap.hidden = true;
    var list = create('ul', 'kcpw-aa-list');
    list.id = 'kcpw-aa-listbox';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', cfg.i18n.listLabel);
    var message = create('div', 'kcpw-aa-msg');
    // Google's Places terms require its attribution next to suggestions that are not shown on a Google map. It is part of the
    // list and there is deliberately no setting to remove it.
    var attribution = create('div', 'kcpw-aa-attrib', cfg.i18n.attribution || 'Powered by Google');
    wrap.appendChild(list);
    wrap.appendChild(message);
    wrap.appendChild(attribution);
    var live = create('div', 'kcpw-aa-live');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    wrap.style.setProperty('--kcpw-aa-accent', cfg.style.accent);
    wrap.style.setProperty('--kcpw-aa-radius', cfg.style.radius + 'px');
    document.body.appendChild(wrap);
    document.body.appendChild(live);

    var state = { owner: null, items: [], active: -1, onPick: null };

    function place() {
      var input = state.owner;
      if (!input) return;
      var rect = input.getBoundingClientRect();
      var viewportWidth = document.documentElement.clientWidth;
      var width = Math.min(Math.max(rect.width, 220), viewportWidth - 16);
      var left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8)) + root.pageXOffset;
      wrap.style.width = width + 'px';
      wrap.style.left = left + 'px';
      var height = wrap.offsetHeight;
      var below = root.innerHeight - rect.bottom;
      var above = rect.top;
      var top =
        below < height + 8 && above > below
          ? rect.top + root.pageYOffset - height - 2
          : rect.bottom + root.pageYOffset + 2;
      wrap.style.top = top + 'px';
    }

    function setActive(index) {
      var rows = list.children;
      for (var i = 0; i < rows.length; i += 1) {
        rows[i].setAttribute('aria-selected', i === index ? 'true' : 'false');
      }
      state.active = index;
      if (state.owner) {
        if (index >= 0 && rows[index]) {
          state.owner.setAttribute('aria-activedescendant', rows[index].id);
          if (rows[index].scrollIntoView) rows[index].scrollIntoView({ block: 'nearest' });
        } else {
          state.owner.removeAttribute('aria-activedescendant');
        }
      }
    }

    function announce(text) {
      live.textContent = '';
      // A change of text is what makes a screen reader speak; the empty string first guarantees one even for the same sentence twice.
      setTimeout(function () {
        live.textContent = text;
      }, 30);
    }

    function theme(input) {
      var mode = cfg.style.theme;
      if (mode === 'light' || mode === 'dark') return mode;
      if (mode === 'system')
        return root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light';
      var node = input;
      while (node && node.nodeType === 1) {
        var color = parseColor(root.getComputedStyle(node).backgroundColor);
        if (color && color[3] > 0.5) return luminance(color) < 0.4 ? 'dark' : 'light';
        node = node.parentElement;
      }
      return 'light';
    }

    function renderMain(target, item) {
      var text = item.main;
      var cursor = 0;
      (item.matches || []).forEach(function (m) {
        var start = Math.max(cursor, m.startOffset || 0);
        var end = Math.max(start, m.endOffset || 0);
        if (start > cursor) target.appendChild(document.createTextNode(text.slice(cursor, start)));
        if (end > start)
          target.appendChild(create('strong', 'kcpw-aa-hit', text.slice(start, end)));
        cursor = end;
      });
      if (cursor < text.length) target.appendChild(document.createTextNode(text.slice(cursor)));
    }

    var api = {
      state: state,
      isOpenFor: function (input) {
        return !wrap.hidden && state.owner === input;
      },
      show: function (input, items, onPick) {
        state.owner = input;
        state.items = items;
        state.onPick = onPick;
        list.textContent = '';
        message.textContent = '';
        message.hidden = true;
        items.forEach(function (item, index) {
          var row = create('li', 'kcpw-aa-opt');
          row.id = 'kcpw-aa-opt-' + index;
          row.setAttribute('role', 'option');
          row.setAttribute('aria-selected', 'false');
          var main = create('span', 'kcpw-aa-main');
          renderMain(main, item);
          row.appendChild(main);
          if (item.secondary) row.appendChild(create('span', 'kcpw-aa-sec', item.secondary));
          // Keep focus in the field (a mouse press would otherwise blur it and close the list), then choose on the click.
          row.addEventListener('mousedown', function (e) {
            e.preventDefault();
          });
          row.addEventListener('click', function () {
            if (state.onPick) state.onPick(index);
          });
          row.addEventListener('mousemove', function () {
            if (state.active !== index) setActive(index);
          });
          list.appendChild(row);
        });
        list.hidden = items.length === 0;
        wrap.dataset.theme = theme(input);
        wrap.dir = root.getComputedStyle(input).direction || 'ltr';
        wrap.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-controls', list.id);
        setActive(-1);
        place();
        announce(items.length ? cfg.i18n.count.replace('%d', String(items.length)) : '');
      },
      status: function (input, kind, text) {
        state.owner = input;
        state.items = [];
        list.textContent = '';
        list.hidden = true;
        message.textContent = text;
        message.hidden = false;
        message.dataset.kind = kind;
        wrap.dataset.theme = theme(input);
        wrap.dir = root.getComputedStyle(input).direction || 'ltr';
        wrap.hidden = false;
        input.setAttribute('aria-expanded', 'false');
        place();
        announce(text);
      },
      hide: function () {
        if (wrap.hidden) return;
        wrap.hidden = true;
        if (state.owner) {
          state.owner.setAttribute('aria-expanded', 'false');
          state.owner.removeAttribute('aria-activedescendant');
        }
        state.items = [];
        state.active = -1;
      },
      move: function (delta) {
        var count = state.items.length;
        if (!count) return;
        var next = state.active + delta;
        if (next < 0) next = count - 1;
        if (next >= count) next = 0;
        setActive(next);
      },
      reposition: place,
      clearActive: function () {
        setActive(-1);
      },
      announce: announce,
    };
    dropdown = api;

    var pending = null;
    function reposition() {
      if (pending || wrap.hidden) return;
      pending = setTimeout(function () {
        pending = null;
        place();
      }, 50);
    }
    root.addEventListener('resize', reposition);
    root.addEventListener('scroll', reposition, true);
    if (root.visualViewport) {
      root.visualViewport.addEventListener('resize', reposition);
      root.visualViewport.addEventListener('scroll', reposition);
    }
    return api;
  }

  // ------------------------------------------------------------------------------------------------------------------
  // One controller per address field
  // ------------------------------------------------------------------------------------------------------------------

  var TYPE_FILTERS = {
    address: ['street_address', 'premise', 'subpremise'],
    cities: ['(cities)'],
    regions: ['(regions)'],
  };
  var SESSION_MAX_AGE = 170000;
  var noteCounter = 0;

  function attachField(input, form, group, cfg, shared) {
    var dd = getDropdown(cfg);
    var timer = null;
    var spinner = null;
    var seq = 0;
    var token = null;
    var tokenAt = 0;
    var cache = {};
    var requests = 0;
    var items = [];
    var itemsKey = '';
    var composing = false;
    var busy = false;
    var failures = 0;

    var previousAutocomplete = input.getAttribute('autocomplete');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    if (cfg.disableAutofill) input.setAttribute('autocomplete', 'off');

    function container() {
      return (group.scope && input.closest(group.scope)) || input.closest('form') || document;
    }

    function fieldEl(name) {
      var selector = group.fields[name];
      if (!selector) return null;
      // React may have drawn the field again; the selector finds the live one.
      if (name === 'address') return input.isConnected ? input : queryAll(selector)[0] || input;
      var found = queryAll(selector, container());
      if (!found.length && container() !== document) found = queryAll(selector);
      return found.length ? found[0] : null;
    }

    function resetSession() {
      token = null;
      tokenAt = 0;
      cache = {};
      requests = 0;
    }

    function limitCodes() {
      return form.countries && form.countries.length ? form.countries.slice(0, 5) : null;
    }

    function request(value, places) {
      if (!token || Date.now() - tokenAt > SESSION_MAX_AGE) {
        token = new places.AutocompleteSessionToken();
        tokenAt = Date.now();
        cache = {};
      }
      var req = { input: value, sessionToken: token };
      var codes = limitCodes();
      if (codes) req.includedRegionCodes = codes;
      if (form.language) req.language = form.language;
      var types = TYPE_FILTERS[form.placeTypes];
      if (types) req.includedPrimaryTypes = types;
      if (shared.region && !(form.countries && form.countries.length)) req.region = shared.region;
      if (shared.locationBias) req.locationBias = shared.locationBias;
      return req;
    }

    function normalize(response) {
      var out = [];
      ((response && response.suggestions) || []).forEach(function (suggestion) {
        var p = suggestion && suggestion.placePrediction;
        if (!p) return;
        if (
          form.placeTypes === 'business' &&
          p.types &&
          p.types.indexOf('establishment') === -1 &&
          p.types.indexOf('point_of_interest') === -1
        )
          return;
        var textOf = function (formattable) {
          return formattable && formattable.text !== undefined
            ? String(formattable.text)
            : formattable
              ? String(formattable)
              : '';
        };
        out.push({
          pred: p,
          full: textOf(p.text),
          main: textOf(p.mainText) || textOf(p.text),
          secondary: textOf(p.secondaryText),
          matches: (p.mainText && p.mainText.matches) || [],
        });
      });
      return out;
    }

    function hideSpinner() {
      clearTimeout(spinner);
      spinner = null;
    }

    function noticeFor(code) {
      return code === 'limit' ? cfg.i18n.limit : cfg.i18n.unavailable;
    }

    function fail(error, quiet) {
      var code = errorCode(error);
      countError(code);
      failures += 1;
      if (STOP_CODES[code] || failures >= 3) {
        shared.disabled = true;
        warnOnce(
          'stop',
          'KCPW address autocomplete is switched off for this page (' +
            code +
            '). The address fields still work normally.',
        );
        shared.problem(code);
      }
      if (quiet) return;
      if (cfg.fallbackNotice && !shared.noticed) {
        shared.noticed = true;
        dd.status(input, 'error', noticeFor(code));
      } else {
        dd.hide();
      }
    }

    function render(list) {
      items = list;
      itemsKey = cacheKey(input.value);
      if (!list.length) {
        dd.status(input, 'empty', cfg.i18n.noResults);
        return;
      }
      dd.show(input, list, choose);
    }

    async function run(value) {
      if (shared.disabled) return;
      var key = cacheKey(value);
      if (cache[key]) {
        render(cache[key]);
        return;
      }
      if (requests >= cfg.maxRequests) {
        dd.status(input, 'limit', cfg.i18n.limit);
        return;
      }
      requests += 1;
      usage.r += 1;
      var mine = ++seq;
      hideSpinner();
      spinner = setTimeout(function () {
        if (mine === seq) dd.status(input, 'loading', cfg.i18n.loading);
      }, 250);
      try {
        var maps = await loadGoogle(cfg);
        var places = await maps.importLibrary('places');
        var response = await withTimeout(
          places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request(value, places)),
          cfg.requestTimeout || 9000,
        );
        if (mine !== seq) return;
        hideSpinner();
        failures = 0;
        var list = normalize(response);
        cache[key] = list;
        render(list);
      } catch (error) {
        if (mine !== seq) return;
        hideSpinner();
        fail(error);
      }
    }

    function schedule() {
      clearTimeout(timer);
      hideSpinner();
      var value = input.value.trim();
      if (shared.disabled) return;
      if (value.length < cfg.minChars) {
        seq += 1;
        dd.hide();
        return;
      }
      timer = setTimeout(function () {
        run(value);
      }, cfg.debounce);
    }

    function isSelect(el) {
      return !!el && el.tagName === 'SELECT';
    }

    /** Writes one value into one field, in the way that kind of field needs; never throws. */
    async function put(name, want) {
      var el = fieldEl(name);
      if (!el || el.disabled || el.readOnly) return;
      try {
        if (isSelect(el)) {
          var option = want && (want.code || want.name) ? matchOption(el, want) : null;
          if (option) {
            await writeSelect(el, option);
          } else if (name !== 'country') {
            // No such region in this country's list: clear a stale value rather than keep the previous address's state.
            var blank = null;
            Array.prototype.forEach.call(el.options, function (o) {
              if (blank === null && o.value === '') blank = o;
            });
            if (blank) await writeSelect(el, blank);
          }
        } else if (
          el.getAttribute('role') === 'combobox' &&
          el !== input &&
          (name === 'country' || name === 'state')
        ) {
          await writeCombobox(el, want || {});
        } else {
          var text = typeof want === 'string' ? want : (want && (want.name || want.code)) || '';
          await writeText(el, text);
        }
      } catch (e) {
        warnOnce(
          'put:' + name,
          'KCPW address autocomplete could not fill the "' +
            name +
            '" field; it was left as it was.',
        );
      }
    }

    async function revealUnitField() {
      if (fieldEl('address2')) return;
      var selector = '[class*="address_2-toggle"], [class*="address-2-toggle"]';
      // WooCommerce draws one link per address form (shipping, billing): take the one inside THIS field's own form, never another's.
      var own = input.closest('.wc-block-components-address-form');
      var toggles = queryAll(selector, own || container());
      if (!own && toggles.length !== 1) return;
      if (toggles[0]) {
        toggles[0].click();
        await tick(80);
      }
    }

    async function fill(mapped) {
      shared.filling += 1;
      try {
        if (form.mode === 'single') {
          await put('address', mapped.formatted || mapped.line1);
          return;
        }
        // Order matters: the country re-draws the state field, so wait for the page to settle before the state is written.
        var countryEl = fieldEl('country');
        if (
          countryEl &&
          mapped.country.code &&
          String(countryEl.value).toUpperCase() !== mapped.country.code
        ) {
          await put('country', mapped.country);
          await settle();
        }
        await put('state', mapped.state);
        await put('postcode', mapped.postcode);
        await put('city', mapped.city);
        if (mapped.line2) {
          await revealUnitField();
          await put('address2', mapped.line2);
        }
        await put('address', mapped.line1 || mapped.formatted);
        await settle(80, 600);
        // React may have kept an older value for a field it re-drew meanwhile: read back and write once more where it differs.
        var wanted = [
          ['postcode', mapped.postcode],
          ['city', mapped.city],
          ['address', mapped.line1 || mapped.formatted],
        ];
        for (var i = 0; i < wanted.length; i += 1) {
          var el = fieldEl(wanted[i][0]);
          if (el && !isSelect(el) && wanted[i][1] && el.value !== wanted[i][1])
            await put(wanted[i][0], wanted[i][1]);
        }
        var stateEl = fieldEl('state');
        if (stateEl && isSelect(stateEl)) {
          var opt = matchOption(stateEl, mapped.state);
          if (opt && stateEl.value !== opt.value) await put('state', mapped.state);
        }
        // The classic checkout recalculates shipping when told; the block checkout does it from the store update the events cause.
        if (root.jQuery && document.body.classList.contains('woocommerce-checkout')) {
          root.jQuery(document.body).trigger('update_checkout');
        }
      } finally {
        shared.filling -= 1;
      }
    }

    async function choose(index) {
      var item = items[index];
      if (!item || busy) return;
      busy = true;
      dd.hide();
      var mapped = null;
      try {
        var place = item.pred.toPlace();
        usage.d += 1;
        await withTimeout(
          place.fetchFields({ fields: ['addressComponents', 'formattedAddress', 'location'] }),
          cfg.detailsTimeout || 10000,
        );
        var loc = place.location;
        mapped = mapAddress(
          {
            components: place.addressComponents || [],
            formatted: place.formattedAddress || item.full,
            lat: loc && typeof loc.lat === 'function' ? loc.lat() : undefined,
            lng: loc && typeof loc.lng === 'function' ? loc.lng() : undefined,
          },
          { unitLabel: cfg.i18n.unit },
        );
      } catch (error) {
        // Could not get the details: keep what the visitor chose to type, let them finish by hand. Never block checkout.
        usage.m += 1;
        var code = errorCode(error);
        countError(code === 'unknown' ? 'details' : code);
        resetSession();
        await put('address', item.full);
        dd.status(input, 'error', cfg.i18n.placeFailed);
        setTimeout(function () {
          dd.hide();
        }, 4000);
        busy = false;
        return;
      }
      try {
        await apply(mapped);
      } finally {
        busy = false;
      }
    }

    /** Fills the form from an address, then tells the page and the optional features. Used by suggestions, GPS and the map. */
    async function apply(mapped) {
      usage.s += 1;
      resetSession();
      // Kept in memory for this page only (where the map should open next time); never sent anywhere.
      if (
        typeof mapped.lat === 'number' &&
        typeof mapped.lng === 'number' &&
        isFinite(mapped.lat + mapped.lng)
      ) {
        shared.lastLocation = { lat: mapped.lat, lng: mapped.lng };
      }
      await fill(mapped);
      failures = 0;
      input.dispatchEvent(
        new root.CustomEvent('kcpw-aa:filled', {
          bubbles: true,
          detail: { mapped: mapped, formId: form.id },
        }),
      );
      runHook('onFilled', mapped);
      dd.announce(cfg.i18n.filled);
    }

    // A short message under the field (a PO box warning, an address check result, a GPS problem). One line per feature, polite
    // live region, a symbol as well as colour, and linked to the field with aria-describedby.
    var notes = null;
    var noteItems = {};
    var NOTE_ICONS = { ok: '\u2713', warn: '!', error: '\u00d7', info: 'i' };
    function fieldAnchor() {
      return input.closest('.wc-block-components-text-input') || input;
    }
    function describedBy(on) {
      var ids = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(function (id) {
        return id && (!notes || id !== notes.id);
      });
      if (on && notes) ids.push(notes.id);
      if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
      else input.removeAttribute('aria-describedby');
    }
    function note(id, kind, text) {
      var item = noteItems[id];
      if (!text) {
        if (item) {
          item.remove();
          delete noteItems[id];
        }
        if (notes && !notes.children.length) {
          describedBy(false);
          notes.remove();
          notes = null;
        }
        return;
      }
      if (!notes || !notes.isConnected) {
        notes = create('div', 'kcpw-aa-notes');
        notes.id = 'kcpw-aa-notes-' + ++noteCounter;
        notes.setAttribute('aria-live', 'polite');
        (tools || fieldAnchor()).insertAdjacentElement('afterend', notes);
        Object.keys(noteItems).forEach(function (key) {
          notes.appendChild(noteItems[key]);
        });
        describedBy(true);
      }
      if (!item) {
        item = create('p', 'kcpw-aa-note');
        item.appendChild(create('span', 'kcpw-aa-note-icon', ''));
        item.firstChild.setAttribute('aria-hidden', 'true');
        item.appendChild(create('span', 'kcpw-aa-note-text', ''));
        noteItems[id] = item;
        notes.appendChild(item);
      }
      item.setAttribute('data-kind', kind);
      item.firstChild.textContent = NOTE_ICONS[kind] || '';
      item.lastChild.textContent = text;
    }

    // "Use my location" and "Choose on a map": drawn at once (two small buttons) but the code behind them is fetched only when
    // asked for (or when the visitor points at the button).
    var tools = null;
    var TOOL_LABELS = { gps: 'gps', map_picker: 'map' };
    function buildTools() {
      var ids = Object.keys(TOOL_LABELS).filter(function (id) {
        return form.features && form.features[id] && cfg.modules && cfg.modules[id];
      });
      if (!ids.length) return;
      tools = create('div', 'kcpw-aa-tools');
      tools.setAttribute('role', 'group');
      tools.setAttribute('aria-label', cfg.i18n.tools);
      ids.forEach(function (id) {
        var button = create('button', 'kcpw-aa-tool', cfg.i18n[TOOL_LABELS[id]]);
        button.type = 'button';
        button.setAttribute('data-tool', id);
        var warm = function () {
          loadModuleScript(cfg, id);
        };
        button.addEventListener('pointerenter', warm);
        button.addEventListener('focus', warm);
        button.addEventListener('click', function () {
          openTool(id, button);
        });
        tools.appendChild(button);
      });
      fieldAnchor().insertAdjacentElement('afterend', tools);
    }
    function openTool(id, button) {
      if (button.getAttribute('aria-busy') === 'true') return;
      button.setAttribute('aria-busy', 'true');
      loadModuleScript(cfg, id)
        .then(function (m) {
          if (!m || typeof m.onTool !== 'function') {
            // The code could not be loaded: this way of entering an address is simply not offered; typing still works.
            button.hidden = true;
            return null;
          }
          return m.onTool(ctx, button);
        })
        .catch(function () {
          warnOnce(
            'tool:' + id,
            'KCPW address autocomplete: the "' + id + '" feature failed and was skipped.',
          );
        })
        .then(function () {
          button.removeAttribute('aria-busy');
        });
    }

    function runHook(name, a, b) {
      Object.keys(modules).forEach(function (id) {
        var m = modules[id];
        if (m && typeof m[name] === 'function' && form.features && form.features[id]) {
          try {
            m[name](ctx, a, b);
          } catch (e) {
            warnOnce(
              'hook:' + id + name,
              'KCPW address autocomplete: the "' + id + '" feature failed and was skipped.',
            );
          }
        }
      });
    }

    var ctx = {
      input: input,
      form: form,
      group: group,
      cfg: cfg,
      fieldEl: fieldEl,
      fill: fill,
      mapAddress: mapAddress,
      loadGoogle: function () {
        return loadGoogle(cfg);
      },
      put: put,
      apply: apply,
      note: note,
      i18n: cfg.i18n,
      announce: function (text) {
        dd.announce(text);
      },
      post: function (url, body) {
        return restCall(cfg, url, body === undefined ? {} : body);
      },
      errorCode: errorCode,
      usage: function () {
        return usage;
      },
      countError: countError,
      shared: shared,
    };
    buildTools();

    function onFocus() {
      if (!shared.disabled) {
        loadGoogle(cfg).catch(function (error) {
          fail(error, true);
        });
      }
      loadHint(cfg, shared);
      countCheckoutStart(cfg, shared);
      Object.keys(cfg.modules || {}).forEach(function (id) {
        // The GPS and map code waits for a click on its button; the others watch what is typed, so they load with the first focus.
        if (!TOOL_LABELS[id] && form.features && form.features[id]) {
          loadModuleScript(cfg, id).then(function (m) {
            if (m && !ctx['mod_' + id]) {
              ctx['mod_' + id] = true;
              if (typeof m.onAttach === 'function') {
                try {
                  m.onAttach(ctx);
                } catch (e) {
                  warnOnce(
                    'attach:' + id,
                    'KCPW address autocomplete: the "' + id + '" feature failed and was skipped.',
                  );
                }
              }
            }
          });
        }
      });
    }

    function onInput(event) {
      // Our own writes are synthetic events (isTrusted is false); only the visitor's typing asks Google anything.
      if (event.isTrusted === false || composing) return;
      // The highlighted row was for the old text: Enter must not choose it now.
      if (dd.isOpenFor(input)) dd.clearActive();
      schedule();
    }

    function onKeydown(event) {
      var open = dd.isOpenFor(input);
      if (!open) {
        if (
          event.key === 'ArrowDown' &&
          items.length &&
          !shared.disabled &&
          itemsKey === cacheKey(input.value)
        ) {
          dd.show(input, items, choose);
          event.preventDefault();
        }
        return;
      }
      if (event.key === 'ArrowDown') {
        dd.move(1);
        event.preventDefault();
      } else if (event.key === 'ArrowUp') {
        dd.move(-1);
        event.preventDefault();
      } else if (event.key === 'Enter') {
        if (dd.state.active >= 0) {
          // Choosing a suggestion must not also submit the form.
          event.preventDefault();
          event.stopPropagation();
          choose(dd.state.active);
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        dd.hide();
      } else if (event.key === 'Tab') {
        dd.hide();
      }
    }

    function onBlur() {
      clearTimeout(timer);
      hideSpinner();
      seq += 1;
      if (dd.isOpenFor(input)) dd.hide();
    }

    var onCompositionStart = function () {
      composing = true;
    };
    var onCompositionEnd = function () {
      composing = false;
      schedule();
    };

    input.addEventListener('focus', onFocus);
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('blur', onBlur);
    input.addEventListener('compositionstart', onCompositionStart);
    input.addEventListener('compositionend', onCompositionEnd);
    // The field already has focus when the script found it: a visitor who started typing the moment the checkout finished drawing.
    // Whatever they typed before now is looked up as if it had been typed after.
    if (document.activeElement === input) {
      onFocus();
      if (input.value.trim().length >= cfg.minChars) schedule();
    }

    return {
      ctx: ctx,
      destroy: function () {
        input.removeEventListener('focus', onFocus);
        input.removeEventListener('input', onInput);
        input.removeEventListener('keydown', onKeydown);
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('compositionstart', onCompositionStart);
        input.removeEventListener('compositionend', onCompositionEnd);
        clearTimeout(timer);
        hideSpinner();
        runHook('onDetach');
        if (tools) tools.remove();
        Object.keys(noteItems).forEach(function (key) {
          noteItems[key].remove();
        });
        noteItems = {};
        if (notes) {
          describedBy(false);
          notes.remove();
        }
        if (dd.isOpenFor(input)) dd.hide();
        input.removeAttribute('role');
        input.removeAttribute('aria-autocomplete');
        input.removeAttribute('aria-expanded');
        input.removeAttribute('aria-controls');
        input.removeAttribute('aria-activedescendant');
        if (previousAutocomplete === null) {
          if (cfg.disableAutofill) input.removeAttribute('autocomplete');
        } else {
          input.setAttribute('autocomplete', previousAutocomplete);
        }
      },
    };
  }

  // ------------------------------------------------------------------------------------------------------------------
  // Finding fields, now and later
  // ------------------------------------------------------------------------------------------------------------------

  function usable(input) {
    if (!input || input.nodeType !== 1) return false;
    if (input.tagName !== 'INPUT' && input.tagName !== 'TEXTAREA') return false;
    var type = (input.getAttribute('type') || 'text').toLowerCase();
    return (
      ['text', 'search', 'url', 'tel', ''].indexOf(type) !== -1 &&
      !input.disabled &&
      !input.readOnly
    );
  }

  // Everything this plugin adds to a page has a class that starts with kcpw-aa-; changes inside or to those are not the page's business.
  var OURS = '[class*="kcpw-aa-"]';

  /** Whether a burst of page changes involved anything other than this script's own list and notice. */
  function involvesPage(mutations) {
    return mutations.some(function (m) {
      if (m.target.nodeType === 1 && m.target.closest && m.target.closest(OURS)) return false;
      var added = Array.prototype.slice.call(m.addedNodes || []);
      var removed = Array.prototype.slice.call(m.removedNodes || []);
      var all = added.concat(removed);
      return (
        all.length === 0 ||
        all.some(function (node) {
          return !(node.nodeType === 1 && node.matches && node.matches(OURS));
        })
      );
    });
  }

  /**
   * The small notice that only administrators see: "preview" while the plugin is in preview mode, and, in any mode, what went wrong
   * if suggestions stopped working. A customer never sees a code or a diagnosis, only the plain fallback sentence in the list.
   */
  function adminNotice(cfg) {
    var pill = null;
    var text = null;
    function ensure() {
      if (pill && pill.isConnected) return pill;
      pill = create('div', 'kcpw-aa-pill');
      pill.setAttribute('role', 'note');
      text = create('span', 'kcpw-aa-pill-text', '');
      pill.appendChild(text);
      var close = create('button', 'kcpw-aa-pill-close', '\u00d7');
      close.type = 'button';
      close.setAttribute('aria-label', cfg.i18n.previewDismiss);
      close.addEventListener('click', function () {
        pill.remove();
        try {
          root.sessionStorage.setItem('kcpwAAPill', '1');
        } catch (e) {
          /* private mode */
        }
      });
      pill.appendChild(close);
      document.body.appendChild(pill);
      return pill;
    }
    return {
      preview: function () {
        var dismissed = false;
        try {
          dismissed = root.sessionStorage.getItem('kcpwAAPill') === '1';
        } catch (e) {
          /* private mode */
        }
        if (!dismissed) {
          ensure();
          text.textContent = cfg.i18n.preview;
        }
      },
      problem: function (code) {
        ensure();
        pill.dataset.kind = 'problem';
        text.textContent = cfg.i18n.problem + ' (' + code + ').';
      },
    };
  }

  function start(cfg) {
    try {
      var i18n = {};
      Object.keys(DEFAULT_I18N).forEach(function (key) {
        i18n[key] = DEFAULT_I18N[key];
      });
      Object.keys(cfg.i18n || {}).forEach(function (key) {
        i18n[key] = cfg.i18n[key];
      });
      cfg.i18n = i18n;
      cfg.style = cfg.style || { accent: '#2b59e6', radius: 8, theme: 'match' };
      cfg.minChars = cfg.minChars || 3;
      cfg.debounce = cfg.debounce || 300;
      cfg.maxRequests = cfg.maxRequests || 12;
      cfg.forms = cfg.forms || [];
      var notice = cfg.admin ? adminNotice(cfg) : null;
      var shared = {
        disabled: false,
        noticed: false,
        filling: 0,
        locationBias: null,
        problem: function (code) {
          if (notice) notice.problem(code);
        },
      };
      var controllers = [];

      var scanning = null;
      function scan() {
        scanning = null;
        controllers = controllers.filter(function (c) {
          if (c.input.isConnected) return true;
          c.controller.destroy();
          return false;
        });
        cfg.forms.forEach(function (form) {
          form.groups.forEach(function (group) {
            queryAll(group.fields.address).forEach(function (input) {
              if (!usable(input)) return;
              var known = controllers.some(function (c) {
                return c.input === input;
              });
              if (!known)
                controllers.push({
                  input: input,
                  controller: attachField(input, form, group, cfg, shared),
                });
            });
          });
        });
      }
      function scheduleScan(mutations) {
        if (!scanning && (!mutations || involvesPage(mutations))) scanning = setTimeout(scan, 40);
      }

      scan();
      new root.MutationObserver(scheduleScan).observe(document.body, {
        childList: true,
        subtree: true,
      });
      if (document.readyState !== 'complete') {
        root.addEventListener('load', function () {
          scheduleScan(null);
        });
      }

      // Google reports a rejected key AFTER its script has loaded, through this callback.
      authListener = function () {
        shared.disabled = true;
        countError('auth');
        shared.problem('auth');
        if (dropdown && dropdown.state.owner) {
          if (cfg.fallbackNotice && !shared.noticed) {
            shared.noticed = true;
            dropdown.status(dropdown.state.owner, 'error', cfg.i18n.unavailable);
          } else {
            dropdown.hide();
          }
        }
      };

      if (cfg.preview && notice) notice.preview();
      var flush = function () {
        flushUsage(cfg);
      };
      root.addEventListener('pagehide', flush);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') flush();
      });
      return { scan: scan, shared: shared };
    } catch (error) {
      // Whatever happens, the page's own fields keep working.
      warnOnce('start', 'KCPW address autocomplete could not start: ' + (error && error.message));
      return null;
    }
  }

  return {
    start: start,
    mapAddress: mapAddress,
    matchOption: matchOption,
    fold: fold,
    classifyError: classifyError,
    cacheKey: cacheKey,
    registerModule: registerModule,
    loadGoogle: loadGoogle,
    TYPE_FILTERS: TYPE_FILTERS,
    version: '0.1.0',
  };
});
