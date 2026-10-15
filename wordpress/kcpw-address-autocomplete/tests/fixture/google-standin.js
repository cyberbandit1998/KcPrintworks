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
 *   geocodeOk        -> true to let the Geocoder answer with one result (the place named by geocodePlace, default p_main);
 *                       failGeocode -> message of the error it throws
 *   geocodeTypes     -> the types the Geocoder gives its result (default street_address; ['locality'] is a town, not an address)
 *   mapFails         -> true to make creating a map throw (a blocked or broken Maps library)
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
        region: request.region,
        locationBias: request.locationBias,
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
    var data = S.geocodeOk ? (S.places || {})[S.geocodePlace || 'p_main'] : null;
    if (!data) return { results: [] };
    // The Geocoder answers in Google's older shape (long_name / short_name), unlike the Places classes above.
    return {
      results: [
        {
          types: S.geocodeTypes || ['street_address'],
          formatted_address: data.formatted,
          address_components: data.components.map(function (c) {
            return { types: [c[0]], long_name: c[1], short_name: c[2] === undefined ? c[1] : c[2] };
          }),
          geometry: { location: ll(data.lat, data.lng) },
        },
      ],
    };
  };

  function ll(lat, lng) {
    return {
      lat: function () {
        return lat;
      },
      lng: function () {
        return lng;
      },
    };
  }
  function plain(point) {
    return point && typeof point.lat === 'function'
      ? { lat: point.lat(), lng: point.lng() }
      : point;
  }

  // A drawn stand-in for the map: a patterned box, one clickable surface (a click is reported at the position under the pointer,
  // 0.0001 degrees per pixel from the center) and a pin. It is a picture of where the real map would be, nothing more.
  function GMap(container, options) {
    S.calls.maps += 1;
    if (S.mapFails) throw new Error('The map could not be created');
    S.calls.mapOptions = options;
    var self = this;
    this.center = plain(options.center);
    this.zoom = options.zoom;
    this._listeners = {};
    this.surface = document.createElement('div');
    this.surface.setAttribute('data-standin-map', '');
    this.surface.style.cssText =
      'position:absolute;inset:0;cursor:crosshair;background:repeating-linear-gradient(45deg,#dfe6ee,#dfe6ee 12px,#e9eef4 12px,#e9eef4 24px);color:#1a1a1a;font:14px sans-serif;padding:6px';
    this.surface.textContent = 'Map stand-in (not Google)';
    container.appendChild(this.surface);
    this.surface.addEventListener('click', function (event) {
      var rect = self.surface.getBoundingClientRect();
      var lat = self.center.lat - (event.clientY - rect.top - rect.height / 2) * 0.0001;
      var lng = self.center.lng + (event.clientX - rect.left - rect.width / 2) * 0.0001;
      self._emit('click', { latLng: ll(lat, lng) });
    });
    S.lastMap = this;
  }
  GMap.prototype.addListener = function (name, fn) {
    (this._listeners[name] = this._listeners[name] || []).push(fn);
  };
  GMap.prototype._emit = function (name, event) {
    (this._listeners[name] || []).forEach(function (fn) {
      fn(event);
    });
  };
  GMap.prototype.panTo = function (point) {
    this.center = plain(point);
    if (S.lastMarker) S.lastMarker._draw();
  };
  GMap.prototype.getBounds = function () {
    var c = this.center;
    return {
      getNorthEast: function () {
        return ll(c.lat + 0.004, c.lng + 0.004);
      },
      getSouthWest: function () {
        return ll(c.lat - 0.004, c.lng - 0.004);
      },
    };
  };

  function Marker(options) {
    S.calls.markers = (S.calls.markers || 0) + 1;
    this._map = options.map;
    this._pos = plain(options.position);
    this._listeners = {};
    this.gmpDraggable = options.gmpDraggable;
    this.pin = document.createElement('div');
    this.pin.setAttribute('data-standin-pin', '');
    this.pin.style.cssText =
      'position:absolute;width:18px;height:18px;margin:-18px 0 0 -9px;background:#b42318;border:2px solid #fff;border-radius:50% 50% 50% 0;transform:rotate(-45deg);pointer-events:none';
    options.map.surface.appendChild(this.pin);
    S.lastMarker = this;
    this._draw();
  }
  Marker.prototype._draw = function () {
    var rect = this._map.surface.getBoundingClientRect();
    this.pin.style.left = rect.width / 2 + (this._pos.lng - this._map.center.lng) / 0.0001 + 'px';
    this.pin.style.top = rect.height / 2 - (this._pos.lat - this._map.center.lat) / 0.0001 + 'px';
  };
  Object.defineProperty(Marker.prototype, 'position', {
    get: function () {
      return ll(this._pos.lat, this._pos.lng);
    },
    set: function (value) {
      this._pos = plain(value);
      this._draw();
    },
  });
  Marker.prototype.addListener = function (name, fn) {
    (this._listeners[name] = this._listeners[name] || []).push(fn);
  };
  // For tests: what dragging the pin and letting go does.
  S.dragMarker = function (lat, lng) {
    S.lastMarker.position = { lat: lat, lng: lng };
    (S.lastMarker._listeners.dragend || []).forEach(function (fn) {
      fn({});
    });
  };

  var libraries = {
    places: {
      AutocompleteSessionToken: AutocompleteSessionToken,
      AutocompleteSuggestion: AutocompleteSuggestion,
      Place: Place,
    },
    geocoding: { Geocoder: Geocoder },
    maps: { Map: GMap },
    marker: { AdvancedMarkerElement: Marker },
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
