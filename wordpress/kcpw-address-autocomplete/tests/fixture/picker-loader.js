// Stand-in for what the plugin's PHP does: on a page opened with ?kcpw_aa_pick=<token> the picking script is added.
(function () {
  if (location.search.indexOf('kcpw_aa_pick=') === -1) return;
  window.KCPW_AA_PICKER = {"strings":{"bar":"Click the field you want, or press Tab to reach it and then Enter. Press Esc to cancel.","noField":"That is not a field. Click a text box or a list."}};
  var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/kcpw-aa-picker.css'; document.head.appendChild(link);
  var script = document.createElement('script'); script.src = '/kcpw-aa-picker.js'; document.head.appendChild(script);
})();
