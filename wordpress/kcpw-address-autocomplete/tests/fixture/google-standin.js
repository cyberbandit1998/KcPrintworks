/*
 * A STAND-IN for Google's Maps JavaScript API, used only by the plugin's browser tests (it is what the test server answers when the
 * plugin asks for https://maps.googleapis.com/maps/api/js). It implements the small part of the Places API (New) the plugin calls,
 * with the documented names and shapes, and records every call so tests can check cost behavior (how many requests, which session
 * token, which fields). It is NOT Google: a real key, a real Google project and real billing are checked by the install steps.
 *
 * The test controls it through window.__KCPW_G, set before this script runs:
 *   rules            -> [{prefix, results, delay?}]  the first rule whose prefix the typed text starts with answers (case-insensitive);
 *                       results are [{placeId, text?, main, secondary, matches?, types?}]
 *   suggest(input)   -> same results, computed by a function (set from page code; overrides rules)
 *   places           -> {placeId: {components: [[type, long, short?], ...], formatted, lat, lng}}
 *   delay            ms before a suggestion answer (a rule may set its own);  detailsDelay ms before place details
 *   failSuggest      -> message of the error to throw instead of answering
 *   failDetails      -> true to throw from fetchFields
 *   authFailure      -> true to call window.gm_authFailure() shortly after load, as Google does for a rejected key
 *   noImportLibrary  -> true to leave google.maps without importLibrary (an older script from another plugin)
 */
(function () {
  var S = (window.__KCPW_G = window.__KCPW_G || {});
  S.calls = S.calls || { loads: 0, suggest: [], details: [], tokens: 0, geocode: [], maps: 0 };
  S.calls.loads += 1;
  var sleep = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms || 0);
    });
  };
  var g = (window.google = window.google || {});
  var maps = (g.maps = g.maps || {});

  function text(value, matches) {
    return { text: value || '', matches: matches || [] };
  }

  function AutocompleteSessionToken() {
    S.calls.tokens += 1;
    this.id = S.calls.tokens;
  }

  function Place(options) {
    this.id = options.id;
    this._token = options.token;
  }
  Place.prototype.fetchFields = async function (request) {
    S.calls.details.push({ id: this.id, fields: request.fields.slice(), token: this._token });
    await sleep(S.detailsDelay);
    if (S.failDetails) throw new Error('INTERNAL: place details failed');
    var data = (S.places || {})[this.id];
    if (!data) throw new Error('NOT_FOUND: no such place');
    this.addressComponents = data.components.map(function (c) {
      return { types: [c[0]], longText: c[1], shortText: c[2] === undefined ? c[1] : c[2] };
    });
    this.formattedAddress = data.formatted;
    this.location = {
      lat: function () {
        return data.lat;
      },
      lng: function () {
        return data.lng;
      },
    };
    return { place: this };
  };

  var AutocompleteSuggestion = {
    fetchAutocompleteSuggestions: async function (request) {
      S.calls.suggest.push({
        input: request.input,
        token: request.sessionToken && request.sessionToken.id,
        regions: request.includedRegionCodes,
        types: request.includedPrimaryTypes,
        language: request.language,
      });
      var typed = String(request.input || '').toLowerCase();
      var rule = null;
      (S.rules || []).forEach(function (r) {
        if (!rule && typed.indexOf(String(r.prefix).toLowerCase()) === 0) rule = r;
      });
      await sleep(rule && rule.delay !== undefined ? rule.delay : S.delay);
      if (S.failSuggest) throw new Error(S.failSuggest);
      var list = S.suggest ? S.suggest(request.input) : rule ? rule.results : [];
      var token = request.sessionToken && request.sessionToken.id;
      return {
        suggestions: list.map(function (item) {
          return {
            placePrediction: {
              placeId: item.placeId,
              text: text(item.text || item.main + ', ' + item.secondary),
              mainText: text(item.main, item.matches),
              secondaryText: text(item.secondary),
              types: item.types || ['street_address'],
              toPlace: function () {
                return new Place({ id: item.placeId, token: token });
              },
            },
          };
        }),
      };
    },
  };

  function Geocoder() {}
  Geocoder.prototype.geocode = async function (request) {
    S.calls.geocode.push(request);
    await sleep(S.geocodeDelay);
    if (S.failGeocode) throw new Error(S.failGeocode);
    return { results: (S.geocodeResults && S.geocodeResults(request)) || [] };
  };

  var libraries = {
    places: { AutocompleteSessionToken: AutocompleteSessionToken, AutocompleteSuggestion: AutocompleteSuggestion, Place: Place },
    geocoding: { Geocoder: Geocoder },
    core: {},
  };
  if (!S.noImportLibrary) {
    maps.importLibrary = async function (name) {
      if (!libraries[name]) throw new Error('unknown library ' + name);
      return libraries[name];
    };
  }
  var callback = new URL(document.currentScript.src).searchParams.get('callback');
  if (S.authFailure) {
    setTimeout(function () {
      if (typeof window.gm_authFailure === 'function') window.gm_authFailure();
    }, 40);
  }
  if (callback && typeof window[callback] === 'function') window[callback]();
})();
