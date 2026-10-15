/*!
 * KCPrintWorks Address Autocomplete: administrator screens (original code, GPL-2.0-or-later).
 * The "Test my key" button, the confirmation before going live, the Visual Selector Tool's window, and loading an exported file.
 * Runs only on this plugin's own screens.
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

  // ----- Visual Selector Tool: the window on the Forms screen -------------------------------------------------------------
  // "Pick" opens one of your own pages in a frame with the picking script switched on (the page address carries a one-time token the
  // server checks). The script answers with the ways of finding the field you click; you choose one and it is typed into the box.

  function initPicker() {
    var picker = cfg.picker;
    var dialog = document.getElementById('kcpw-aa-picker');
    if (!picker || !dialog) return;
    var frame = document.getElementById('kcpw-aa-picker-frame');
    var pageSelect = document.getElementById('kcpw-aa-picker-page');
    var results = document.getElementById('kcpw-aa-picker-results');
    var help = document.getElementById('kcpw-aa-picker-help');
    var title = document.getElementById('kcpw-aa-picker-title');
    var closeButton = document.getElementById('kcpw-aa-picker-close');
    var windowButton = document.getElementById('kcpw-aa-picker-window');
    var current = null;
    var popup = null;

    (picker.pages || []).forEach(function (page, index) {
      var option = document.createElement('option');
      option.value = page.url;
      option.textContent = page.label;
      option.selected = index === 0;
      pageSelect.appendChild(option);
    });
    var wanted = Array.prototype.filter.call(pageSelect.options, function (o) {
      return /checkout/i.test(o.textContent);
    })[0];
    if (wanted) wanted.selected = true;

    function address(base) {
      var url = new URL(base, window.location.href);
      url.searchParams.set(picker.query, picker.token);
      return url.toString();
    }
    function load() {
      results.textContent = t.pickWaiting;
      frame.src = address(pageSelect.value);
    }
    function open(button) {
      current = {
        input: document.getElementById(button.getAttribute('data-target')),
        button: button,
        label: button.getAttribute('data-label') || '',
      };
      if (!current.input) return;
      title.textContent = (t.pickFor || '%s').replace('%s', current.label);
      help.textContent = t.pickHelp || '';
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      load();
    }
    function close() {
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
    dialog.addEventListener('close', function () {
      frame.removeAttribute('src');
      results.textContent = '';
      if (current && current.button) current.button.focus();
    });

    document.addEventListener('click', function (event) {
      var button =
        event.target && event.target.closest ? event.target.closest('.kcpw-aa-pick') : null;
      if (button) open(button);
    });
    closeButton.addEventListener('click', close);
    pageSelect.addEventListener('change', load);
    windowButton.addEventListener('click', function () {
      popup = window.open(
        address(pageSelect.value),
        'kcpw-aa-picker',
        'popup=yes,width=1100,height=800',
      );
      if (!popup) results.textContent = t.pickWindow + ': ' + (t.hint_unknown || '');
    });

    function render(message) {
      results.textContent = '';
      var list = document.createElement('div');
      (message.candidates || []).forEach(function (candidate) {
        var card = document.createElement('div');
        card.className = 'kcpw-aa-card-pick' + (candidate.unique ? ' is-unique' : '');
        var kind = document.createElement('strong');
        kind.textContent = t['kind_' + candidate.kind] || candidate.kind;
        var code = document.createElement('code');
        code.textContent = candidate.selector;
        var note = document.createElement('span');
        note.className = 'description';
        note.textContent =
          candidate.count === 0
            ? t.pickNone
            : candidate.unique
              ? t.pickUnique
              : (t.pickMany || '%d').replace('%d', String(candidate.count));
        var use = document.createElement('button');
        use.type = 'button';
        use.className = 'button' + (candidate.unique ? ' button-primary' : '');
        use.textContent = t.pickUse;
        use.addEventListener('click', function () {
          current.input.value = candidate.selector;
          current.input.dispatchEvent(new Event('input', { bubbles: true }));
          close();
        });
        card.appendChild(kind);
        card.appendChild(code);
        card.appendChild(note);
        card.appendChild(use);
        list.appendChild(card);
      });
      results.appendChild(list);
    }

    // Only messages from the page this screen opened (its frame, or the window it opened) and from this very site are believed.
    window.addEventListener('message', function (event) {
      if (event.origin !== window.location.origin) return;
      var data = event.data;
      if (!data || data.source !== 'kcpw-aa-picker') return;
      if (event.source !== frame.contentWindow && event.source !== popup) return;
      if (data.type === 'cancel') close();
      else if (data.type === 'pick') render(data);
    });
  }

  // ----- Import: fill the box from a chosen file ---------------------------------------------------------------------------

  function initImport() {
    var file = document.getElementById('kcpw-aa-import-file');
    var box = document.getElementById('kcpw-aa-import-json');
    if (!file || !box || !window.FileReader) return;
    file.addEventListener('change', function () {
      if (!file.files || !file.files[0]) return;
      var reader = new FileReader();
      reader.onload = function () {
        box.value = String(reader.result || '');
      };
      reader.readAsText(file.files[0]);
    });
  }

  initPicker();
  initImport();

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
