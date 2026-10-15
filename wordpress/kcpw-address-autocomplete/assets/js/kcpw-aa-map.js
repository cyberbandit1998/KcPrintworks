/*!
 * KCPrintWorks Address Autocomplete: "Choose on a map" (original code, GPL-2.0-or-later).
 *
 * Runs ONLY when the visitor presses the button. It opens a window with a Google map and a pin that can be clicked, tapped, dragged or
 * moved with four buttons (so it works without a mouse). Each place the pin lands asks Google's Geocoding service once what address is
 * there; "Use this address" fills the form exactly as choosing a suggestion does. Nothing is stored and nothing goes to this site's server.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root.KCPWAA && root.KCPWAA.registerModule) {
    root.KCPWAA.registerModule('map_picker', api.module);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  // The stylesheet sits next to the script's folder; it is fetched only now, when the map is first opened.
  var STYLE_URL = '';
  try {
    var own = root.document && root.document.currentScript && root.document.currentScript.src;
    if (own) STYLE_URL = own.replace(/\/js\/kcpw-aa-map\.js(\?.*)?$/, '/css/kcpw-aa-map.css$1');
  } catch (e) {
    STYLE_URL = '';
  }

  /** Where the map starts: [latitude, longitude, zoom]. A few common countries; anything else starts on the whole world. */
  var CENTERS = {
    US: [39.8, -98.6, 4],
    CA: [56.1, -106.3, 3],
    GB: [54.0, -2.5, 5],
    IE: [53.4, -8.2, 6],
    AU: [-25.3, 133.8, 4],
    NZ: [-41.5, 172.8, 5],
    DE: [51.2, 10.4, 5],
    FR: [46.6, 2.2, 5],
    ES: [40.4, -3.7, 5],
    IT: [42.8, 12.6, 5],
    NL: [52.2, 5.3, 7],
    MX: [23.6, -102.5, 4],
  };
  var LOOKUPS_PER_OPEN = 10;

  function toComponents(list) {
    return (list || []).map(function (c) {
      return { types: c.types || [], longText: c.long_name, shortText: c.short_name };
    });
  }

  function pick(results) {
    var wanted = ['street_address', 'premise', 'subpremise', 'route'];
    for (var w = 0; w < wanted.length; w += 1) {
      for (var i = 0; i < (results || []).length; i += 1) {
        if ((results[i].types || []).indexOf(wanted[w]) !== -1) return results[i];
      }
    }
    return null;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function loadStyle() {
    if (!STYLE_URL || document.getElementById('kcpw-aa-map-css')) return;
    var link = document.createElement('link');
    link.id = 'kcpw-aa-map-css';
    link.rel = 'stylesheet';
    link.href = STYLE_URL;
    document.head.appendChild(link);
  }

  function startView(ctx) {
    var s = ctx.shared;
    if (s.lastLocation) return { center: s.lastLocation, zoom: 15 };
    if (s.locationBias && s.locationBias.center) return { center: s.locationBias.center, zoom: 11 };
    var first = ctx.form.countries && ctx.form.countries[0];
    var c = first && CENTERS[first];
    return c
      ? { center: { lat: c[0], lng: c[1] }, zoom: c[2] }
      : { center: { lat: 20, lng: 0 }, zoom: 2 };
  }

  var windowState = null;

  function build(ctx) {
    var i18n = ctx.i18n;
    var dialog = el('dialog', 'kcpw-aa-map');
    var titleId = 'kcpw-aa-map-title';
    dialog.setAttribute('aria-labelledby', titleId);
    var head = el('div', 'kcpw-aa-map-head');
    var title = el('h2', 'kcpw-aa-map-title', i18n.mapTitle);
    title.id = titleId;
    var close = el('button', 'kcpw-aa-map-btn kcpw-aa-map-close', i18n.mapClose);
    close.type = 'button';
    head.appendChild(title);
    head.appendChild(close);
    var help = el('p', 'kcpw-aa-map-help', i18n.mapHelp);
    var canvas = el('div', 'kcpw-aa-map-canvas');
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', i18n.mapTitle);
    var status = el('p', 'kcpw-aa-map-status', '');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    var foot = el('div', 'kcpw-aa-map-foot');
    var nudges = el('div', 'kcpw-aa-map-nudges');
    nudges.setAttribute('role', 'group');
    var arrows = [
      ['north', '↑', i18n.mapNorth, 1, 0],
      ['south', '↓', i18n.mapSouth, -1, 0],
      ['west', '←', i18n.mapWest, 0, -1],
      ['east', '→', i18n.mapEast, 0, 1],
    ];
    var nudgeButtons = arrows.map(function (a) {
      var b = el('button', 'kcpw-aa-map-btn kcpw-aa-map-nudge', a[1]);
      b.type = 'button';
      b.setAttribute('aria-label', a[2]);
      b.setAttribute('data-dir', a[0]);
      nudges.appendChild(b);
      return b;
    });
    nudges.setAttribute('aria-label', i18n.mapMove);
    var use = el('button', 'kcpw-aa-map-btn kcpw-aa-map-use', i18n.mapUse);
    use.type = 'button';
    use.setAttribute('aria-disabled', 'true');
    foot.appendChild(nudges);
    foot.appendChild(use);
    [head, help, canvas, status, foot].forEach(function (n) {
      dialog.appendChild(n);
    });
    document.body.appendChild(dialog);
    return {
      dialog: dialog,
      canvas: canvas,
      status: status,
      use: use,
      close: close,
      nudges: arrows.map(function (a, i) {
        return { button: nudgeButtons[i], dLat: a[3], dLng: a[4] };
      }),
      map: null,
      marker: null,
      position: null,
      current: null,
      lookups: 0,
      seq: 0,
      ctx: ctx,
    };
  }

  function setStatus(w, text) {
    w.status.textContent = text;
  }

  function enableUse(w, on) {
    w.use.setAttribute('aria-disabled', on ? 'false' : 'true');
  }

  async function lookup(w, here) {
    var ctx = w.ctx;
    var mine = ++w.seq;
    w.current = null;
    enableUse(w, false);
    if (w.lookups >= LOOKUPS_PER_OPEN) {
      setStatus(w, ctx.i18n.limit);
      return;
    }
    w.lookups += 1;
    ctx.usage().d += 1;
    try {
      var lib = await w.maps.importLibrary('geocoding');
      var response = await new lib.Geocoder().geocode({ location: here });
      if (mine !== w.seq) return;
      var best = pick(response && response.results);
      if (!best) {
        setStatus(w, ctx.i18n.mapNoAddress);
        return;
      }
      w.current = ctx.mapAddress(
        {
          components: toComponents(best.address_components),
          formatted: best.formatted_address || '',
          lat: here.lat,
          lng: here.lng,
        },
        { unitLabel: ctx.i18n.unit },
      );
      setStatus(w, ctx.i18n.mapNear.replace('%s', best.formatted_address || w.current.line1));
      enableUse(w, true);
    } catch (error) {
      if (mine !== w.seq) return;
      ctx.countError(ctx.errorCode(error));
      setStatus(w, ctx.i18n.mapFailed);
    }
  }

  function place(w, here) {
    w.position = here;
    if (w.marker) w.marker.position = here;
    lookup(w, here);
  }

  function latLng(point) {
    if (!point) return null;
    var lat = typeof point.lat === 'function' ? point.lat() : point.lat;
    var lng = typeof point.lng === 'function' ? point.lng() : point.lng;
    return typeof lat === 'number' && typeof lng === 'number' ? { lat: lat, lng: lng } : null;
  }

  async function draw(w) {
    var ctx = w.ctx;
    setStatus(w, ctx.i18n.mapLoading);
    try {
      w.maps = await ctx.loadGoogle();
      var lib = await w.maps.importLibrary('maps');
      var markerLib = await w.maps.importLibrary('marker');
      var view = startView(ctx);
      w.map = new lib.Map(w.canvas, {
        center: view.center,
        zoom: view.zoom,
        mapId: ctx.cfg.mapId || 'DEMO_MAP_ID',
        gestureHandling: 'cooperative',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      w.position = view.center;
      w.marker = new markerLib.AdvancedMarkerElement({
        map: w.map,
        position: view.center,
        gmpDraggable: true,
        title: ctx.i18n.mapTitle,
      });
      w.map.addListener('click', function (event) {
        var here = latLng(event && event.latLng);
        if (here) place(w, here);
      });
      w.marker.addListener('dragend', function () {
        var here = latLng(w.marker.position);
        if (here) place(w, here);
      });
      setStatus(w, '');
      // A town-sized start is only a guess: ask what is under the pin once it is somewhere the visitor chose.
      if (ctx.shared.lastLocation) lookup(w, view.center);
    } catch (error) {
      ctx.countError(ctx.errorCode(error));
      setStatus(w, ctx.i18n.mapFailed);
    }
  }

  function nudge(w, dLat, dLng) {
    if (!w.position) return;
    var step = 0.0005;
    var b = w.map && typeof w.map.getBounds === 'function' ? w.map.getBounds() : null;
    if (b && b.getNorthEast && b.getSouthWest) {
      var ne = latLng(b.getNorthEast());
      var sw = latLng(b.getSouthWest());
      if (ne && sw) step = Math.max(Math.abs(ne.lat - sw.lat), Math.abs(ne.lng - sw.lng)) / 10;
    }
    var next = { lat: w.position.lat + dLat * step, lng: w.position.lng + dLng * step };
    place(w, next);
    if (w.map && typeof w.map.panTo === 'function') w.map.panTo(next);
  }

  var module_ = {
    onTool: async function (ctx) {
      loadStyle();
      if (!windowState || !windowState.dialog.isConnected) {
        windowState = build(ctx);
        var w = windowState;
        w.close.addEventListener('click', function () {
          w.dialog.close();
        });
        w.use.addEventListener('click', async function () {
          if (w.use.getAttribute('aria-disabled') === 'true' || !w.current) return;
          var mapped = w.current;
          w.dialog.close();
          await w.ctx.apply(mapped);
        });
        w.nudges.forEach(function (n) {
          n.button.addEventListener('click', function () {
            nudge(w, n.dLat, n.dLng);
          });
        });
        w.dialog.addEventListener('close', function () {
          w.lookups = 0;
        });
      }
      var w2 = windowState;
      // The window belongs to the field whose button was pressed.
      w2.ctx = ctx;
      if (typeof w2.dialog.showModal === 'function') w2.dialog.showModal();
      else w2.dialog.setAttribute('open', '');
      if (!w2.map) await draw(w2);
    },
  };

  return { module: module_, toComponents: toComponents, pick: pick };
});
