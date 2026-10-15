/*!
 * KCPrintWorks Address Autocomplete: "Use my location" (original code, GPL-2.0-or-later).
 *
 * Runs ONLY when the visitor presses the button (never on page load, never on its own). The browser asks them for permission; the
 * position is turned into an address by Google's Geocoding service in the visitor's browser and is kept in memory only. It is never
 * sent to this site's server and never stored. If anything fails the form is left as it was.
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else if (root.KCPWAA && root.KCPWAA.registerModule) {
    root.KCPWAA.registerModule('gps', api.module);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  /** Google's Geocoder answers in its older shape (long_name / short_name); the plugin's mapper reads the newer one (longText / shortText). */
  function toComponents(list) {
    return (list || []).map(function (c) {
      return { types: c.types || [], longText: c.long_name, shortText: c.short_name };
    });
  }

  /** The most useful result: a street address, a building, or at least a street. A result that names only a town is not an address. */
  function pick(results) {
    var wanted = ['street_address', 'premise', 'subpremise', 'route'];
    for (var w = 0; w < wanted.length; w += 1) {
      for (var i = 0; i < (results || []).length; i += 1) {
        if ((results[i].types || []).indexOf(wanted[w]) !== -1) return results[i];
      }
    }
    return null;
  }

  function locate() {
    return new Promise(function (resolve, reject) {
      var geo = root.navigator && root.navigator.geolocation;
      if (!geo || root.isSecureContext === false) {
        reject({ code: 'unsupported' });
        return;
      }
      geo.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      });
    });
  }

  var module_ = {
    onTool: async function (ctx) {
      ctx.note('gps', 'info', ctx.i18n.gpsWorking);
      var position;
      try {
        position = await locate();
      } catch (e) {
        // Refusing permission is the visitor's choice, not a fault: say so kindly and leave everything else alone.
        ctx.note('gps', 'warn', ctx.i18n.gpsDenied);
        return;
      }
      var here = { lat: position.coords.latitude, lng: position.coords.longitude };
      try {
        var maps = await ctx.loadGoogle();
        var lib = await maps.importLibrary('geocoding');
        ctx.usage().d += 1;
        var response = await new lib.Geocoder().geocode({ location: here });
        var best = pick(response && response.results);
        if (!best) {
          ctx.note('gps', 'warn', ctx.i18n.gpsFailed);
          return;
        }
        var mapped = ctx.mapAddress(
          {
            components: toComponents(best.address_components),
            formatted: best.formatted_address || '',
            lat: here.lat,
            lng: here.lng,
          },
          { unitLabel: ctx.i18n.unit },
        );
        // Later suggestions favor places near the visitor (kept in memory for this page only).
        ctx.shared.locationBias = { center: here, radius: 50000 };
        ctx.note('gps', '', '');
        await ctx.apply(mapped);
      } catch (error) {
        ctx.countError(ctx.errorCode(error));
        ctx.note('gps', 'warn', ctx.i18n.gpsFailed);
      }
    },
  };

  return { module: module_, toComponents: toComponents, pick: pick };
});
