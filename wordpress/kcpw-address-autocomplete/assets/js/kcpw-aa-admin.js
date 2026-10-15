/*!
 * KCPrintWorks Address Autocomplete: administrator screens (original code, GPL-2.0-or-later).
 * The "Test my key" button and the confirmation before going live. Runs only on this plugin's own screens.
 */
(function () {
  'use strict';

  var cfg = window.KCPW_AA_ADMIN || {};
  var core = window.KCPWAA;
  var t = cfg.i18n || {};

  // A form that carries data-confirm asks first ("Go live for customers").
  document.addEventListener('submit', function (event) {
    var form = event.target;
    var message = form && form.getAttribute ? form.getAttribute('data-confirm') : null;
    if (message && !window.confirm(message)) {
      event.preventDefault();
    }
  });

  var button = document.getElementById('kcpw-aa-test');
  var list = document.getElementById('kcpw-aa-test-results');
  if (!button || !list || !core) return;

  function addRow(label) {
    var item = document.createElement('li');
    var state = document.createElement('strong');
    var text = document.createElement('span');
    var hint = document.createElement('p');
    hint.className = 'description';
    state.textContent = t.testing;
    text.textContent = ' ' + label;
    item.appendChild(state);
    item.appendChild(text);
    item.appendChild(hint);
    list.appendChild(item);
    return {
      done: function (ok, code) {
        item.className = ok ? 'is-ok' : 'is-fail';
        state.textContent = ok ? t.ok : t.fail;
        if (!ok) hint.textContent = t['hint_' + code] || t.hint_unknown;
      },
      skipped: function () {
        item.className = 'is-skip';
        state.textContent = '';
        hint.textContent = t.optional_skipped;
      },
    };
  }

  function codeOf(error) {
    return error && error.code && /^(script|auth|conflict|timeout|network)$/.test(error.code)
      ? error.code
      : core.classifyError(error);
  }

  button.addEventListener('click', async function () {
    var field = document.getElementById('kcpw-aa-browser-key');
    var key = (field && field.value.trim()) || cfg.key;
    list.textContent = '';
    if (!key) {
      var none = addRow(t.nokey);
      none.done(false, 'unknown');
      return;
    }
    button.disabled = true;
    // Google reports a rejected key through this global AFTER the script loads; note it so the Places step can say why it failed.
    var rejected = false;
    window.gm_authFailure = function () {
      rejected = true;
    };

    var load = addRow(t.load);
    var maps;
    try {
      maps = await core.loadGoogle({ key: key, language: cfg.language || '' });
      load.done(true);
    } catch (error) {
      load.done(false, codeOf(error));
      button.disabled = false;
      return;
    }

    var placesRow = addRow(t.places);
    try {
      var places = await maps.importLibrary('places');
      var response = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: '1600 Pennsylvania Avenue NW, Washington',
        sessionToken: new places.AutocompleteSessionToken(),
      });
      if (rejected) {
        placesRow.done(false, 'auth');
      } else {
        placesRow.done(Array.isArray(response && response.suggestions), 'unknown');
      }
    } catch (error) {
      placesRow.done(false, rejected ? 'auth' : codeOf(error));
    }

    var geoRow = addRow(t.geocoding);
    try {
      var geo = await maps.importLibrary('geocoding');
      var result = await new geo.Geocoder().geocode({
        address: '1600 Pennsylvania Avenue NW, Washington',
      });
      geoRow.done(!!(result && result.results && result.results.length), 'api');
    } catch (error) {
      geoRow.done(false, rejected ? 'auth' : codeOf(error) === 'unknown' ? 'api' : codeOf(error));
    }
    button.disabled = false;
  });
})();
