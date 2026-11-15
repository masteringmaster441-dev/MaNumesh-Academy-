/* Academy – web-page (HTML) notes. A page is downloaded once, kept on the phone, and opens instantly
   (also offline) after that, with its scripts switched off. PDFs are no longer shown inside the app:
   tapping one hands the file straight to whichever PDF app the student has on their phone. */
var READER = (function () {
  var R = null;            // { f, key, html:true, clean }
  var waiting = {};        // key -> callbacks while downloading

  function can() { return !!(window.Android && window.Android.noteSave && window.Android.noteHas); }
  function keyOf(f) { return (String(f.id) + '_' + String(f.mod || 0)).replace(/[^A-Za-z0-9_\-]/g, '').slice(0, 120); }
  function has(f) { try { return can() && window.Android.noteHas(keyOf(f)); } catch (e) { return false; } }
  function urlOf(key) { var w = window.__noteUrl && window.__noteUrl(key); return w || 'https://academy.files/' + key + '.pdf'; }

  /* ---------- download into the phone's note store ---------- */
  function save(f, onProg) {
    var key = keyOf(f);
    return new Promise(function (res, rej) {
      if (has(f)) { res(key); return; }
      var w = waiting[key];
      if (w) { w.push({ res: res, rej: rej, prog: onProg }); return; }
      waiting[key] = [{ res: res, rej: rej, prog: onProg }];
      if (kind(f) === 'html') { if (window.Android.noteSaveHtml) window.Android.noteSaveHtml(key, f.id); else __noteDone(key, false, 'Please update the app.'); }
      else window.Android.noteSave(key, f.id);
    });
  }
  window.__noteProgress = function (key, pct) { (waiting[key] || []).forEach(function (w) { if (w.prog) w.prog(pct); }); };
  window.__noteDone = function (key, ok, msg) {
    var ws = waiting[key] || []; delete waiting[key];
    ws.forEach(function (w) { if (ok) w.res(key); else w.rej(new Error(msg || 'Download failed')); });
  };

  function status(msg) {
    var l = document.getElementById('vload');
    if (!msg) { l.style.display = 'none'; return; }
    l.style.display = 'flex'; l.textContent = msg;
  }
  /* ---------- web-page (HTML) notes ---------- */
  /* The page is shown with its scripts switched off (a note is text, pictures, tables and styling), inside a sandboxed frame. */
  function clean(src) {
    var doc = new DOMParser().parseFromString(String(src), 'text/html');
    Array.prototype.forEach.call(doc.querySelectorAll('script,iframe,frame,object,embed,applet,base,meta[http-equiv],form'), function (n) { n.parentNode.removeChild(n); });
    Array.prototype.forEach.call(doc.querySelectorAll('*'), function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        var nm = a.name.toLowerCase(), v = String(a.value).replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
        if (nm.indexOf('on') === 0 || ((nm === 'href' || nm === 'src' || nm === 'xlink:href' || nm === 'action' || nm === 'formaction') && /^(javascript|vbscript|data:text\/html)/.test(v))) n.removeAttribute(a.name);
      });
    });
    Array.prototype.forEach.call(doc.querySelectorAll('a[href]'), function (a) { if (/^https?:/i.test(a.getAttribute('href'))) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); } });
    var head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
    if (!doc.querySelector('meta[name=viewport]')) { var m = doc.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width, initial-scale=1'; head.insertBefore(m, head.firstChild); }
    var st = doc.createElement('style'); st.textContent = 'html{-webkit-text-size-adjust:100%}img,video,svg,canvas{max-width:100%;height:auto}body{overflow-wrap:break-word}pre{white-space:pre-wrap}table{max-width:100%}@media print{a{color:inherit}}';
    head.appendChild(st);
    return '<!DOCTYPE html>\n' + doc.documentElement.outerHTML;
  }
  function openHtml(f, fallback) {
    close(true);
    var v = document.getElementById('viewer'), key = keyOf(f), cached = has(f);
    var old = v.querySelector('iframe'); if (old) old.parentNode.removeChild(old);
    R = { f: f, key: key, html: true };
    var me = R;
    status(cached ? 'Opening…' : 'Downloading…');
    (cached ? Promise.resolve(key) : save(f, function (pct) { if (R === me) status(pct >= 0 ? 'Downloading… ' + pct + '%' : 'Downloading…'); }))
      .then(function () { return fetch(urlOf(key).replace(/\.pdf$/, '.html')); })
      .then(function (r) { if (!r.ok) throw new Error('missing'); return r.text(); })
      .then(function (txt) {
        if (R !== me) return;
        me.clean = clean(txt);
        var fr = document.createElement('iframe');
        fr.id = 'htmlfr'; fr.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
        fr.onload = function () { status(''); };
        fr.srcdoc = me.clean;
        v.appendChild(fr);
        setTimeout(function () { if (R === me) status(''); }, 1500);
        if (!cached) toast('Saved on this phone — it will open instantly next time.');
      })
      .catch(function (e) {
        if (R !== me) return;
        R = null; var b = document.getElementById('htmlfr'); if (b) b.parentNode.removeChild(b);
        status(''); fallback(e);
      });
    return true;
  }
  /* "Save as PDF": Android's print screen, where the student chooses Save as PDF */
  function exportPdf() {
    if (!R || !R.html || !R.clean) { toast('Open the page first.'); return; }
    if (window.Android && window.Android.printHtml) {
      toast(window.__WEB ? 'In the print window, set the printer to “Save as PDF”.' : 'Choose “Save as PDF” at the top of the next screen.');
      window.Android.printHtml(R.clean, String(R.f.name || 'Notes').replace(/\.html?$/i, ''));
    } else {
      var fr = document.getElementById('htmlfr');
      try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { toast('Printing isn’t available here.'); }
    }
  }
  function close(silent) {
    if (!R) return false;
    R = null;
    var hf = document.getElementById('htmlfr'); if (hf) hf.parentNode.removeChild(hf);
    return true;
  }

  return {
    can: can, has: has, openHtml: openHtml, exportPdf: exportPdf, clean: clean, close: close, save: save, keyOf: keyOf,
    size: function () { try { return Number(window.Android.noteSize()) || 0; } catch (e) { return 0; } },
    clear: function () { try { window.Android.noteClear(); } catch (e) { } },
    active: function () { return !!R; }
  };
})();
