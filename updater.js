/* Academy – in-app updates. The teacher publishes a new APK from Settings; every app offers to install it. */
var UPDATER = (function () {
  var KEY = 'academy.appver', SKIP_KEY = 'academy.updskip';
  var U = { mine: null, srv: null, busy: false, pct: -1, pendingCode: 0, apkTok: '', apk: null };

  function getJ(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function setJ(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function native() { return !!(window.Android && window.Android.appVersion); }
  function mine() {
    if (!U.mine) { try { U.mine = JSON.parse(window.Android.appVersion()); } catch (e) { U.mine = { code: 0, name: '' }; } }
    return U.mine;
  }
  function avail() { var m = native() ? mine() : null; return m && U.srv && U.srv.code > m.code ? U.srv : null; }
  function blocking() { var a = avail(); return !!(a && a.required && !isTeacher()); }
  function size(n) { return n ? (n / 1048576).toFixed(1) + ' MB' : ''; }

  /* ---------- checking ---------- */
  function check(force) {
    if (!native() || !S.api) return Promise.resolve();
    var c = getJ(KEY, null);
    if (c && !U.srv) U.srv = c.v;
    if (!force && c && Date.now() - c.at < 3 * 3600e3) { afterCheck(); return Promise.resolve(); }
    return apiGet({ a: 'appver' }).then(function (j) {
      U.srv = j.code ? j : null; setJ(KEY, { v: U.srv, at: Date.now() }); afterCheck();
    }, function () { afterCheck(); });
  }
  var prompted = {};
  function afterCheck() {
    var a = avail();
    if (blocking()) { render(); return; }
    if (!a) return;
    if (S.mode === 'browse' && !document.getElementById('sheet') && !prompted[a.code] && getJ(SKIP_KEY, 0) !== a.code) { prompted[a.code] = 1; offer(); }
    else if (S.mode === 'browse') render();
  }

  /* ---------- what students see ---------- */
  function notesHTML(a) { return a.notes ? '<div class="unotes">' + esc(a.notes).replace(/\n/g, '<br>') + '</div>' : ''; }
  function offer() {
    var a = avail(); if (!a) return;
    sheet('<div class="uhead"><span class="ubadge">NEW</span><div><h3>Update available</h3><p class="muted" style="margin:0">Version ' + esc(a.name) + (a.size ? ' · ' + size(a.size) : '') + '</p></div></div>' +
      notesHTML(a) + '<button class="btn wide big" data-sh="go">Update now</button><button class="btn ghost wide" data-sh="later">Later</button>', function (act) {
        if (act === 'go') { closeSheet(); start(); }
        else if (act === 'later') { setJ(SKIP_KEY, a.code); closeSheet(); render(); }
      });
  }
  function banner() {
    var a = avail(); if (!a || U.busy) return '';
    return '<button class="ubanner" data-upd="go"><span class="ubadge">NEW</span><span class="ut"><b>Update to version ' + esc(a.name) + '</b><small>Tap to install the latest Academy app</small></span><span class="uarrow">›</span></button>';
  }
  function renderBlock() {
    var a = avail(), app = document.getElementById('app');
    app.innerHTML = '<div class="gate"><div class="gtop"><span class="glogo"><svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' +
      '<h1>Please update the app</h1><p>Your teacher has released version ' + esc(a.name) + '. Update to keep using ' + esc(S.name) + '.</p></div>' +
      '<div class="card">' + notesHTML(a) + (U.busy ? progressHTML() : '<button class="btn wide big" data-upd="go">Update now</button>') + '</div></div>';
  }
  function progressHTML() {
    return '<div class="uprog"><div class="pb"><i style="width:' + (U.pct >= 0 ? U.pct : 15) + '%"></i></div><p>' + (U.pct >= 0 ? 'Downloading… ' + U.pct + '%' : 'Downloading…') + '</p></div>';
  }
  function start() {
    var a = avail(); if (!a || U.busy) return;
    U.busy = true; U.pct = -1; U.pendingCode = a.code;
    showProgress();
    window.Android.installUpdate(a.url, a.code);
  }
  function showProgress() {
    if (blocking()) { render(); return; }
    var el = document.getElementById('updov');
    if (!el) { el = document.createElement('div'); el.id = 'updov'; document.body.appendChild(el); }
    el.innerHTML = '<div class="bo"><b>Updating Academy</b>' + progressHTML() + '</div>';
  }
  function hideProgress() { var el = document.getElementById('updov'); if (el) el.parentNode.removeChild(el); }
  window.__updProgress = function (pct) { U.pct = pct; var bar = document.querySelector('.uprog'); if (bar) bar.outerHTML = progressHTML(); };
  window.__updDone = function (ok, msg) {
    U.busy = false; hideProgress();
    if (ok) { toast('Tap “Update” on the next screen to finish.'); render(); return; }
    if (msg === 'permission') { askPermission(); render(); return; }
    render(); toast(msg || 'The update couldn’t be downloaded. Check your internet and try again.');
  };
  var waitingPerm = false;
  function askPermission() {
    sheet('<h3>One-time permission</h3><p class="note" style="margin-top:0">Android needs your OK for Academy to install its own updates. On the next screen, turn on <b>Allow from this source</b>, then come back to the app.</p>' +
      '<button class="btn wide big" data-sh="ok">Open settings</button>', function (act) {
        if (act === 'ok') { closeSheet(); waitingPerm = true; window.Android.openInstallSettings(); }
      });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    if (waitingPerm && U.pendingCode) {
      waitingPerm = false;
      if (window.Android.installDownloaded(U.pendingCode)) toast('Tap “Update” on the next screen to finish.');
      else if (window.Android.canInstall()) start();
      else toast('Permission not given yet. Tap Update to try again.');
      return;
    }
    U.mine = null; check(false);
  });

  /* ---------- teacher: publish a new version ---------- */
  function teacherPanel() {
    var m = native() ? mine() : { code: 0, name: '—' }, p = U.srv;
    sheet('<h3>App updates</h3><dl class="sdl"><dt>This phone</dt><dd>Version ' + esc(m.name || '—') + '</dd><dt>Published for students</dt><dd>' + (p ? 'Version ' + esc(p.name) + (p.required ? ' · required' : '') + ' · ' + esc(fmtDate(p.at)) : 'Nothing yet') + '</dd></dl>' +
      '<p class="note" style="margin-top:0">When I send you a new Academy.apk, publish it here. Every student’s app will offer the update the next time it opens. Students tap “Update” once on Android’s install screen.</p>' +
      '<button class="btn wide big" data-sh="pick">Publish new version…</button>' + (avail() ? '<button class="btn ghost wide" data-sh="mine">Update this phone</button>' : ''), function (act) {
        if (act === 'pick') { closeSheet(); if (!native()) { toast('Publishing works in the Android app.'); return; } window.Android.pickApk(); }
        else if (act === 'mine') { closeSheet(); start(); }
      });
  }
  window.__apkPicked = function (o) {
    U.apkTok = o.tok; U.apk = { tok: o.tok, size: o.size, file: o.name };
    loaderMsg('Checking the APK…');
    window.Android.inspectApk(o.tok);
  };
  window.__apkInfo = function (tok, info) {
    loaderMsg('');
    if (tok !== U.apkTok) return;
    if (!info.ok) { toast(info.error || 'That file can’t be used as an update.'); return; }
    var pub = U.srv ? U.srv.code : 0;
    if (info.code <= pub) { toast('Version ' + info.name + ' is not newer than the published version ' + U.srv.name + '.'); return; }
    U.apk.code = info.code; U.apk.name = info.name; U.apk.size = info.size || U.apk.size;
    sheet('<h3>Publish version ' + esc(info.name) + '?</h3><dl class="sdl"><dt>File</dt><dd>' + esc(U.apk.file) + ' · ' + size(U.apk.size) + '</dd><dt>Version</dt><dd>' + esc(info.name) + ' (build ' + info.code + ')</dd>' +
      '<dt>Signing key</dt><dd>' + (info.sig === 'same' ? '✓ Same as this app' : 'Will be checked by Android') + '</dd></dl>' +
      '<label class="fl">What’s new (shown to students)<textarea id="updNotes" rows="4" maxlength="600" placeholder="e.g. Faster app, new worksheet features"></textarea></label>' +
      '<label class="tog" style="justify-content:flex-start"><input type="checkbox" id="updReq"> Required update (students must update to keep using the app)</label>' +
      '<button class="btn wide big" data-sh="pub">Publish to all students</button>', function (act, b) {
        if (act !== 'pub') return;
        U.apk.notes = document.getElementById('updNotes').value.trim();
        U.apk.required = document.getElementById('updReq').checked;
        busy(b, true, 'Uploading…');
        apiPost({ a: 'appupload', size: U.apk.size, vname: U.apk.name }).then(function (j) {
          U.apk.btn = b;
          window.Android.upload(U.apk.tok, j.uploadUrl);
        }, function (e) { busy(b, false); toast(/Unknown request|update the Google script/i.test(e.message) ? 'Please update the Google script to version 7 (Academy-Code-v7) first.' : e.message); });
      });
  };
  function ownsTok(tok) { return !!(U.apk && U.apk.tok === tok); }
  function onUpProgress(tok, sent, total) { if (U.apk && U.apk.btn) U.apk.btn.textContent = 'Uploading… ' + (total ? Math.round(sent * 100 / total) : 0) + '%'; }
  function onUpDone(tok, ok, info) {
    var a = U.apk, b = a && a.btn;
    if (!ok) { if (b) busy(b, false); toast('Upload failed: ' + info); return; }
    if (b) b.textContent = 'Publishing…';
    apiPost({ a: 'apppublish', id: info, code: a.code, vname: a.name, notes: a.notes, required: a.required }).then(function (j) {
      U.srv = j.app; setJ(KEY, { v: U.srv, at: Date.now() }); U.apk = null; closeSheet(); render();
      toast('Version ' + j.app.name + ' published. Students will be offered the update.');
    }, function (e) { if (b) busy(b, false); toast(e.message); });
  }
  function loaderMsg(m) {
    var el = document.getElementById('busyov');
    if (!m) { if (el) el.parentNode.removeChild(el); return; }
    if (!el) { el = document.createElement('div'); el.id = 'busyov'; document.body.appendChild(el); }
    el.innerHTML = '<div class="bo"><div class="dots"><i></i><i></i><i></i></div><p>' + esc(m) + '</p></div>';
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-upd]'); if (!b) return;
    e.stopPropagation(); start();
  }, true);

  return {
    apply: function (j) { if (!native()) return; U.srv = j && j.code ? j : null; setJ(KEY, { v: U.srv, at: Date.now() }); afterCheck(); },
    check: check, banner: banner, blocking: blocking, renderBlock: renderBlock, teacherPanel: teacherPanel, offer: offer,
    ownsTok: ownsTok, onUpProgress: onUpProgress, onUpDone: onUpDone,
    versionText: function () { return native() ? 'Version ' + (mine().name || '') : ''; },
    hasUpdate: function () { return !!avail(); }
  };
})();
