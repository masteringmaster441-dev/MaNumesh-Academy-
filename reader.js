/* Academy – in-app PDF reader. A note is downloaded once, kept on the phone, and opens instantly
   (also offline) after that. Falls back to Google Drive's viewer if anything goes wrong. */
var READER = (function () {
  var R = null;            // { f, key, doc, zoom, pages:[{el,canvas,w,h,rendered}], obs }
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

  /* ---------- viewer ---------- */
  function shell() {
    var v = document.getElementById('viewer');
    var old = v.querySelector('iframe'); if (old) old.parentNode.removeChild(old);
    var box = document.getElementById('pdfv');
    if (!box) { box = document.createElement('div'); box.id = 'pdfv'; box.innerHTML = '<div id="pdfin"></div>'; v.appendChild(box); }
    document.getElementById('pdfin').innerHTML = '';
    var pg = document.getElementById('pdfpg');
    if (!pg) { pg = document.createElement('div'); pg.id = 'pdfpg'; v.appendChild(pg); }
    pg.style.display = 'none';
    return box;
  }
  function status(msg) {
    var l = document.getElementById('vload');
    if (!msg) { l.style.display = 'none'; return; }
    l.style.display = 'flex'; l.textContent = msg;
  }
  function open(f, fallback) {
    close(true);
    var key = keyOf(f), box = shell();
    R = { f: f, key: key, zoom: 1, pages: [] };
    var me = R, cached = has(f);
    status(cached ? 'Opening…' : 'Downloading…');
    (cached ? Promise.resolve(key) : save(f, function (pct) { if (R === me) status(pct >= 0 ? 'Downloading… ' + pct + '%' : 'Downloading…'); }))
      .then(function () { return MCQ.loadPdfJs(); })
      .then(function () { return window.pdfjsLib.getDocument({ url: urlOf(key), disableRange: true, disableStream: true, disableAutoFetch: true, isEvalSupported: false }).promise; })
      .then(function (doc) {
        if (R !== me) { doc.destroy(); return; }
        me.doc = doc;
        return doc.getPage(1).then(function (p1) {
          var vp = p1.getViewport({ scale: 1 });
          me.ratio = vp.height / vp.width;
          layout();
          status('');
          if (!cached) toast('Saved on this phone — it will open instantly next time.');
        });
      })
      .catch(function (e) {
        if (R !== me) return;
        R = null; var b = document.getElementById('pdfv'); if (b) b.parentNode.removeChild(b);
        status('');
        fallback(e);   // show Google Drive's viewer instead
      });
    return true;
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
  function width() { var b = document.getElementById('pdfv'); return Math.max(200, (b ? b.clientWidth : window.innerWidth) - 16); }
  function layout() {
    var inner = document.getElementById('pdfin'); if (!R || !R.doc || !inner) return;
    if (R.obs) R.obs.disconnect();
    inner.innerHTML = '';
    var w = Math.round(width() * R.zoom);
    inner.style.width = (w + 16) + 'px';
    R.pages = [];
    for (var i = 1; i <= R.doc.numPages; i++) {
      var el = document.createElement('div'); el.className = 'pdfp'; el.dataset.n = i;
      el.style.width = w + 'px'; el.style.height = Math.round(w * R.ratio) + 'px';
      inner.appendChild(el);
      R.pages.push({ el: el, n: i, rendered: 0 });
    }
    var box = document.getElementById('pdfv');
    if ('IntersectionObserver' in window) {
      R.obs = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          var p = R && R.pages[Number(en.target.dataset.n) - 1]; if (!p) return;
          if (en.isIntersecting) draw(p); else if (p.rendered) undraw(p);
        });
      }, { root: box, rootMargin: '150% 0px' });
      R.pages.forEach(function (p) { R.obs.observe(p.el); });
    } else R.pages.slice(0, 6).forEach(draw);
    counter();
  }
  function draw(p) {
    var me = R; if (!me || p.rendered === me.zoom) return;
    p.rendered = me.zoom;
    me.doc.getPage(p.n).then(function (page) {
      if (R !== me || p.rendered !== me.zoom) return;
      var w = Math.round(width() * me.zoom), base = page.getViewport({ scale: 1 });
      var dpr = Math.min(window.devicePixelRatio || 1, document.documentElement.className.indexOf('lite') >= 0 ? 1.5 : 2);
      var scale = w / base.width, vp = page.getViewport({ scale: scale * dpr });
      p.el.style.height = Math.round(w * base.height / base.width) + 'px';
      var c = document.createElement('canvas'); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = '100%'; c.style.height = '100%';
      return page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () {
        if (R !== me || p.rendered !== me.zoom) return;
        p.el.innerHTML = ''; p.el.appendChild(c);
      });
    }).catch(function () { p.rendered = 0; });
  }
  function undraw(p) { p.rendered = 0; var c = p.el.querySelector('canvas'); if (c) { c.width = 0; c.height = 0; } p.el.innerHTML = ''; }
  function counter() {
    var pg = document.getElementById('pdfpg'), box = document.getElementById('pdfv');
    if (!R || !R.doc || !pg || !box) return;
    var mid = box.scrollTop + box.clientHeight / 2, n = 1;
    R.pages.forEach(function (p) { if (p.el.offsetTop <= mid) n = p.n; });
    pg.textContent = n + ' / ' + R.doc.numPages; pg.style.display = 'block';
    clearTimeout(counter.t); counter.t = setTimeout(function () { pg.style.opacity = '.0'; }, 1500); pg.style.opacity = '1';
  }
  function setZoom(z, cx, cy) {
    if (!R) return;
    var box = document.getElementById('pdfv');
    z = Math.max(1, Math.min(4, z));
    if (Math.abs(z - R.zoom) < 0.02) return;
    var fx = (box.scrollLeft + (cx || box.clientWidth / 2)) / box.scrollWidth, fy = (box.scrollTop + (cy || box.clientHeight / 2)) / box.scrollHeight;
    R.zoom = z; layout();
    box.scrollLeft = fx * box.scrollWidth - (cx || box.clientWidth / 2);
    box.scrollTop = fy * box.scrollHeight - (cy || box.clientHeight / 2);
  }
  function close(silent) {
    if (!R) return false;
    if (R.obs) R.obs.disconnect();
    try { if (R.doc) R.doc.destroy(); } catch (e) { }
    R = null;
    var b = document.getElementById('pdfv'); if (b) b.parentNode.removeChild(b);
    var hf = document.getElementById('htmlfr'); if (hf) hf.parentNode.removeChild(hf);
    var pg = document.getElementById('pdfpg'); if (pg) pg.style.display = 'none';
    return true;
  }

  /* ---------- gestures: pinch to zoom, double-tap ---------- */
  var pinch = null, lastTap = 0;
  document.addEventListener('touchstart', function (e) {
    if (!R || !e.target.closest || !e.target.closest('#pdfv')) return;
    if (e.touches.length === 2) {
      var a = e.touches[0], b = e.touches[1], box = document.getElementById('pdfv').getBoundingClientRect();
      pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z: R.zoom, cx: (a.clientX + b.clientX) / 2 - box.left, cy: (a.clientY + b.clientY) / 2 - box.top, s: 1 };
    } else if (e.touches.length === 1) {
      var t = Date.now();
      if (t - lastTap < 300) { var box2 = document.getElementById('pdfv').getBoundingClientRect(); setZoom(R.zoom > 1.2 ? 1 : 2, e.touches[0].clientX - box2.left, e.touches[0].clientY - box2.top); lastTap = 0; }
      else lastTap = t;
    }
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!pinch || e.touches.length !== 2) return;
    var a = e.touches[0], b = e.touches[1];
    pinch.s = Math.max(1 / pinch.z, Math.min(4 / pinch.z, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d));
    var inner = document.getElementById('pdfin');
    if (inner) { inner.style.transformOrigin = pinch.cx + 'px ' + pinch.cy + 'px'; inner.style.transform = 'scale(' + pinch.s + ')'; }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', function () {
    if (!pinch) return;
    var p = pinch; pinch = null;
    var inner = document.getElementById('pdfin'); if (inner) inner.style.transform = '';
    setZoom(p.z * p.s, p.cx, p.cy);
  }, { passive: true });
  document.addEventListener('scroll', function (e) { if (e.target && e.target.id === 'pdfv') counter(); }, true);
  window.addEventListener('resize', function () { if (R && R.doc) layout(); });

  return {
    can: can, has: has, open: open, openHtml: openHtml, exportPdf: exportPdf, clean: clean, close: close, save: save, keyOf: keyOf,
    size: function () { try { return Number(window.Android.noteSize()) || 0; } catch (e) { return 0; } },
    clear: function () { try { window.Android.noteClear(); } catch (e) { } },
    active: function () { return !!R; }
  };
})();
