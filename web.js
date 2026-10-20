/* Academy – browser adapter. Inside the Android app this file does nothing (the app provides window.Android).
   In a normal browser on a PC it provides the same bridge, so the same app runs on the web. */
(function () {
  if (window.Android) return;
  window.__WEB = true;
  document.documentElement.className += ' web';
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'web.css'; document.head.appendChild(css);

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------- network: same retry rules as the Android app ---------- */
  function http(id, method, url, body) {
    (async function () {
      var code = -1, text = 'No internet connection', post = method === 'POST';
      for (var attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) await sleep(700 * attempt + Math.random() * 900 * attempt);
        var transient = false, sent = false;
        try {
          var opt = post ? { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow' } : { redirect: 'follow' };
          sent = post;
          var r = await fetch(url, opt);
          if (r.status >= 400) { text = 'Server error ' + r.status; transient = r.status === 404 || r.status === 408 || r.status === 429 || r.status >= 500; code = -1; }
          else { text = await r.text(); code = 200; }
        } catch (e) {
          code = -1;
          var maybeDone = post && sent;   // the request may have reached Google: don't send it twice
          text = maybeDone ? 'No answer from Google' : 'No internet connection';
          transient = !maybeDone;
        }
        if (!transient) break;
      }
      window.__net(id, code, text);
    })();
  }

  /* ---------- web-page (HTML) notes: read through the Google script, kept in memory ---------- */
  var notes = {}, urls = {};
  function noteHas(key) { return notes[key] != null; }
  function noteSaveHtml(key, id) {
    apiPost({ a: 'getfile', id: id }).then(function (j) {
      if (typeof j.text !== 'string') throw new Error('Google Drive didn’t send the file');
      notes[key] = j.text;
      urls[key] = URL.createObjectURL(new Blob([j.text], { type: 'text/html' }));
      window.__noteDone(key, true, '');
    }).catch(function (e) {
      window.__noteDone(key, false, /Unknown request/i.test(e.message) ? 'Update the Google script to Academy-Code-v16 to open web-page notes here.' : e.message);
    });
  }
  window.__noteUrl = function (key) { return urls[key] || ''; };

  /* ---------- save as PDF: the browser's print dialog ---------- */
  function printHtml(html, title) {
    var fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;height:1200px;border:0';
    fr.setAttribute('sandbox', 'allow-modals allow-same-origin');
    fr.onload = function () {
      try { fr.contentWindow.document.title = title || 'Notes'; fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.toast && toast('Printing isn’t available here.'); }
      setTimeout(function () { if (fr.parentNode) fr.parentNode.removeChild(fr); }, 60000);
    };
    fr.srcdoc = html;
    document.body.appendChild(fr);
  }

  /* ---------- links and downloads ---------- */
  function openUrl(url) {
    if (!/^(https?:|tel:)/i.test(url || '')) return 'unsupported link';
    window.open(url, '_blank', 'noopener');
    return 'ok';
  }
  function download(url, name) {
    var a = document.createElement('a'); a.href = url; a.download = name || ''; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
    return 'ok';
  }

  /* ---------- choosing and uploading files (teacher) ---------- */
  var picked = {}, tokN = 0;
  function pickFiles() {
    var inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.style.display = 'none'; document.body.appendChild(inp);
    inp.onchange = function () {
      var list = [];
      Array.prototype.forEach.call(inp.files || [], function (f) {
        var tok = 'w' + (++tokN) + Date.now().toString(36); picked[tok] = f;
        list.push({ tok: tok, name: f.name, size: f.size, mime: f.type || 'application/octet-stream' });
      });
      if (inp.parentNode) inp.parentNode.removeChild(inp);
      if (list.length) window.__picked(list);
    };
    inp.click();
  }
  var PIECE = 1572864;   // 6 x 256 KB: Drive needs multiples of 256 KB for every piece but the last
  function readB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { res(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { rej(new Error('Couldn’t read the file')); };
      r.readAsDataURL(blob);
    });
  }
  function upload(tok, uploadUrl) {
    var f = picked[tok];
    (async function () {
      try {
        if (!f) throw new Error('File is no longer available');
        if (f.size === 0) throw new Error('This file is empty');
        var start = 0, id = '';
        while (start < f.size) {
          var end = Math.min(f.size, start + PIECE), b64 = await readB64(f.slice(start, end)), j = null, tries = 0;
          for (;;) {
            try { j = await apiPost({ a: 'uploadchunk', url: uploadUrl, b64: b64, start: start, total: f.size }); break; }
            catch (e) {
              if (/Unknown request/i.test(e.message)) throw new Error('Update the Google script to Academy-Code-v16 to upload from the web.');
              if (++tries >= 3 || !/internet|No answer/i.test(e.message)) throw e;
              await sleep(1500 * tries);
            }
          }
          start = end;
          if (j.done && j.id) id = j.id;
          window.__upProgress(tok, start, f.size);
        }
        delete picked[tok];
        window.__upDone(tok, true, id || 'ok');
      } catch (e) { window.__upDone(tok, false, e.message || 'Upload failed'); }
    })();
  }

  var wake = null;
  function keepAwake(on) {
    try {
      if (on && navigator.wakeLock) navigator.wakeLock.request('screen').then(function (l) { wake = l; }, function () { });
      else if (!on && wake) { wake.release(); wake = null; }
    } catch (e) { }
  }

  window.Android = {
    http: http, noteHas: noteHas, noteSaveHtml: noteSaveHtml, noteSave: function (key) { window.__noteDone(key, false, 'web'); },
    noteSize: function () { return '0'; }, noteClear: function () { }, isMetered: function () { return false; },
    printHtml: printHtml, openUrl: openUrl, download: download, pickFiles: pickFiles, upload: upload, keepAwake: keepAwake
  };
})();

/* browser Back button and Esc key behave like the Android back button */
(function () {
  if (!window.__WEB) return;
  try { history.replaceState({ a: 0 }, ''); history.pushState({ a: 1 }, ''); } catch (e) { }
  window.addEventListener('popstate', function () {
    var handled = false;
    try { handled = !!(window.onBack && window.onBack()); } catch (e) { }
    if (handled) { try { history.pushState({ a: 1 }, ''); } catch (e) { } }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    try { window.onBack && window.onBack(); } catch (x) { }
  });
})();
