/*!
 * KCPrintWorks Address Autocomplete: the Visual Selector Tool, the half that runs on YOUR page (original code, GPL-2.0-or-later).
 *
 * It exists only while an administrator has opened a page from the plugin's Forms screen (the page address carries a one-time token the
 * server checks, so nobody else can switch it on). It lets the administrator point at a field, then sends the ways of finding that field
 * (its id, name, class, placeholder, ...) back to the Forms screen. It changes nothing on the page and saves nothing.
 *
 * Pointing: hover to see a field outlined, click it. Keyboard: Tab to the field and press Enter. Escape cancels.
 * While it is on, clicks do not follow links and forms cannot be submitted, so exploring a checkout cannot place an order.
 */
(function () {
  'use strict';

  var cfg = window.KCPW_AA_PICKER || {};
  var t = cfg.strings || {};
  var target = window.parent !== window ? window.parent : window.opener;

  // A theme can print this script in the page head, before <body> exists: wait for it.
  function run() {
    // ----- Ways of finding a field -----------------------------------------------------------------------------------------------

    function esc(value) {
      return window.CSS && CSS.escape
        ? CSS.escape(value)
        : String(value).replace(/[^\w-]/g, '\\$&');
    }
    function attr(value) {
      return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }
    function count(selector) {
      try {
        return document.querySelectorAll(selector).length;
      } catch (e) {
        return 0;
      }
    }

    var STATE_CLASS =
      /^(is-|has-|js-|active|focus|hover|open|show|hidden|disabled|selected|valid|invalid|error|empty|filled|touched|dirty|pristine|ng-)/i;
    /** A class that looks generated (css-1x2y3z, sc-AbCdEf, a long run of letters and digits) would not survive the next site update. */
    function stableClass(name) {
      if (!name || name.length < 2 || name.length > 40) return false;
      if (STATE_CLASS.test(name)) return false;
      if (/\d{3,}/.test(name)) return false;
      if (/^(css|sc|jsx|emotion|svelte|styled)[-_]/i.test(name)) return false;
      if (/^[a-z0-9]{8,}$/i.test(name) && /\d/.test(name) && /[a-z]/i.test(name)) return false;
      return true;
    }

    function path(el) {
      var parts = [];
      var node = el;
      while (node && node.nodeType === 1 && node !== document.body && parts.length < 9) {
        if (node !== el && node.id && count('#' + esc(node.id)) === 1) {
          parts.unshift('#' + esc(node.id));
          return parts.join(' > ');
        }
        var part = node.tagName.toLowerCase();
        var parent = node.parentElement;
        if (parent) {
          var same = Array.prototype.filter.call(parent.children, function (c) {
            return c.tagName === node.tagName;
          });
          if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      if (node === document.body) parts.unshift('body');
      return parts.join(' > ');
    }

    /** All the ways of finding this field, each with how many things on the page it matches. Unique ones come first. */
    function candidates(el) {
      var tag = el.tagName.toLowerCase();
      var out = [];
      function add(kind, selector) {
        if (
          !selector ||
          out.some(function (c) {
            return c.selector === selector;
          })
        )
          return;
        var n = count(selector);
        out.push({ kind: kind, selector: selector, count: n, unique: n === 1 });
      }
      if (el.id) add('id', '#' + esc(el.id));
      var name = el.getAttribute('name');
      if (name) {
        add('name', '[name="' + attr(name) + '"]');
        add('name', tag + '[name="' + attr(name) + '"]');
      }
      var autocomplete = el.getAttribute('autocomplete');
      if (autocomplete && autocomplete !== 'off' && autocomplete !== 'on')
        add('autocomplete', tag + '[autocomplete="' + attr(autocomplete) + '"]');
      Array.prototype.some.call(el.attributes, function (a) {
        if (
          /^data-/.test(a.name) &&
          !/^data-(kcpw|reactid|react|testid-?auto)/.test(a.name) &&
          a.value.length <= 60
        ) {
          add('data', a.value ? '[' + a.name + '="' + attr(a.value) + '"]' : '[' + a.name + ']');
          return true;
        }
        return false;
      });
      var placeholder = el.getAttribute('placeholder');
      if (placeholder && placeholder.length <= 60)
        add('placeholder', tag + '[placeholder="' + attr(placeholder) + '"]');
      var classes = Array.prototype.filter.call(el.classList, stableClass);
      if (classes.length) {
        add('class', tag + '.' + esc(classes[0]));
        if (classes.length > 1) add('class', tag + '.' + esc(classes[0]) + '.' + esc(classes[1]));
      }
      add('path', path(el));

      var priority = {
        id: 0,
        name: 1,
        autocomplete: 2,
        data: 3,
        placeholder: 4,
        class: 5,
        path: 6,
      };
      out.sort(function (a, b) {
        if (a.unique !== b.unique) return a.unique ? -1 : 1;
        return priority[a.kind] - priority[b.kind];
      });
      return out;
    }

    // ----- Finding the field a click means ---------------------------------------------------------------------------------------

    var NOT_TEXT = /^(hidden|button|submit|reset|image|file|checkbox|radio|range|color)$/i;
    function isField(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.tagName === 'SELECT' || node.tagName === 'TEXTAREA') return true;
      return node.tagName === 'INPUT' && !NOT_TEXT.test(node.getAttribute('type') || 'text');
    }

    function fieldOf(node) {
      if (!node || node.nodeType !== 1) return null;
      if (isField(node)) return node;
      var label = node.closest && node.closest('label');
      if (label && label.control && isField(label.control)) return label.control;
      // selectWoo / select2 hides the real <select> and draws its own box beside it
      var drawn = node.closest && node.closest('.select2-container');
      if (
        drawn &&
        drawn.previousElementSibling &&
        drawn.previousElementSibling.tagName === 'SELECT'
      )
        return drawn.previousElementSibling;
      var box =
        node.closest &&
        node.closest(
          '[class*="text-input"], [class*="select"], .form-row, .form-group, .field, p, li',
        );
      if (box) {
        var inside = box.querySelectorAll('input, select, textarea');
        var fields = Array.prototype.filter.call(inside, isField);
        if (fields.length === 1) return fields[0];
      }
      return null;
    }

    function labelOf(el) {
      var text = '';
      if (el.id) {
        var l = document.querySelector('label[for="' + attr(el.id) + '"]');
        if (l) text = l.textContent;
      }
      if (!text && el.getAttribute('aria-label')) text = el.getAttribute('aria-label');
      if (!text && el.getAttribute('placeholder')) text = el.getAttribute('placeholder');
      return String(text).replace(/\s+/g, ' ').trim().slice(0, 80);
    }

    window.KCPW_AA_PICKER_API = { candidates: candidates, fieldOf: fieldOf };

    // ----- The page's own controls: an outline and a note ------------------------------------------------------------------------

    function node(tag, className, text) {
      var n = document.createElement(tag);
      n.className = 'kcpw-aa-pk-ui ' + className;
      if (text) n.textContent = text;
      return n;
    }

    var outline = node('div', 'kcpw-aa-pk-outline');
    outline.hidden = true;
    var bar = node(
      'div',
      'kcpw-aa-pk-bar',
      t.bar || 'Click the field you want. Press Esc to cancel.',
    );
    bar.setAttribute('role', 'status');
    document.body.appendChild(outline);
    document.body.appendChild(bar);

    var shown = null;
    function show(el) {
      shown = el;
      if (!el) {
        outline.hidden = true;
        return;
      }
      var r = el.getBoundingClientRect();
      outline.style.left = r.left - 3 + 'px';
      outline.style.top = r.top - 3 + 'px';
      outline.style.width = r.width + 6 + 'px';
      outline.style.height = r.height + 6 + 'px';
      outline.hidden = false;
    }
    window.addEventListener(
      'scroll',
      function () {
        if (shown) show(shown);
      },
      true,
    );
    window.addEventListener('resize', function () {
      if (shown) show(shown);
    });

    function ours(n) {
      return !!(n && n.closest && n.closest('.kcpw-aa-pk-ui'));
    }

    function send(message) {
      message.source = 'kcpw-aa-picker';
      try {
        if (target) target.postMessage(message, window.location.origin);
      } catch (e) {
        /* the other window went away */
      }
    }

    function say(text) {
      bar.textContent = text;
    }

    function pick(el) {
      show(el);
      send({
        type: 'pick',
        tag: el.tagName.toLowerCase(),
        label: labelOf(el),
        candidates: candidates(el),
      });
      say(t.bar || '');
    }

    // Capture phase and stopImmediatePropagation: the page's own handlers (a checkout's "place order", a link) never see the click.
    document.addEventListener(
      'mouseover',
      function (e) {
        if (ours(e.target)) return;
        show(fieldOf(e.target));
      },
      true,
    );
    document.addEventListener(
      'focusin',
      function (e) {
        if (ours(e.target)) return;
        show(fieldOf(e.target));
      },
      true,
    );
    document.addEventListener(
      'click',
      function (e) {
        if (ours(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        var field = fieldOf(e.target);
        if (field) pick(field);
        else say(t.noField || 'That is not a field.');
      },
      true,
    );
    document.addEventListener(
      'submit',
      function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
      },
      true,
    );
    document.addEventListener(
      'keydown',
      function (e) {
        if (e.key === 'Escape') {
          e.preventDefault();
          send({ type: 'cancel' });
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
          var field = fieldOf(document.activeElement);
          if (field && field === document.activeElement) {
            // Enter in a text box would submit the form; here it means "this is the one".
            e.preventDefault();
            e.stopImmediatePropagation();
            pick(field);
          }
        }
      },
      true,
    );
  }

  if (document.body) run();
  else document.addEventListener('DOMContentLoaded', run);
})();
