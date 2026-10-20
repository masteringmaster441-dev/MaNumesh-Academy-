/* Academy – speed helpers: one-request start-up, worksheets saved ahead of time, notes saved on Wi-Fi. */
var FAST = (function () {
  function getJ(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function setJ(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  var NO_BOOT = 'academy.noboot', BOOT_AT = 'academy.bootat';   // remembers that the Google script is older than v11

  /* ---------- start-up: folders, app update, student check-in and students list in ONE request ---------- */
  function boot() {
    if (!S.api) return Promise.resolve(false);
    var old = getJ(NO_BOOT, null);
    if (old && old.api === S.api && Date.now() - old.at < 6 * 3600e3) return Promise.resolve(false);
    // reopening the app within 4 minutes: the folders on the phone are fresh enough, so Google isn't asked again
    var last = getJ(BOOT_AT, 0);
    if (!isTeacher() && S.tree && last && Date.now() - last < 4 * 60000 && Date.now() >= last) return Promise.resolve(true);
    var body = { a: 'boot', bv: BOARD.bv() }, m = PEOPLE.me(), pinged = false;
    if (m && !isTeacher() && PEOPLE.pingDue()) { body.sid = m.sid; pinged = true; }
    S.syncing = true; S.err = ''; paintSync();
    return apiPost(body).then(function (j) {
      S.syncing = false;
      if (!j.tree) throw new Error('Unknown request');
      setTree(j.tree); render(); setJ(BOOT_AT, Date.now());
      if (pinged && j.seen) PEOPLE.applySeen(m.sid, j.seen);
      if (j.board) BOARD.apply(j.board);
      if (j.app) UPDATER.apply(j.app);
      if (j.students && isTeacher()) PEOPLE.applyRoster(j.students);
      return true;
    }).catch(function (e) {
      S.syncing = false; paintSync();
      if (/Unknown request|update the Google script/i.test(e.message)) setJ(NO_BOOT, { api: S.api, at: Date.now() });
      return false;   // the app falls back to the separate requests
    });
  }

  /* ---------- worksheets the student (or teacher) is likely to open, saved on the phone ---------- */
  function cached(f) { var c = getJ('academy.q.' + f.id, null); return !!(c && c.mod === f.mod && c.ws); }
  function candidates() {
    if (!S.tree) return [];
    var all = S.tree.files.filter(function (f) { return !f.pending && /\.mcq\.json$/i.test(f.name || ''); });
    var m = PEOPLE.me(), list = all;
    if (m && !isTeacher() && m.cls) { var mine = PEOPLE.classWorksheets(m.cls); if (mine.length) list = mine; }
    return list.slice().sort(function (a, b) { return b.mod - a.mod; }).slice(0, 60);
  }
  function tidy() {
    if (!S.tree) return;
    var live = {}; S.tree.files.forEach(function (f) { live[f.id] = 1; });
    var drop = [];
    try {
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('academy.q.') === 0 && !live[k.slice(10)]) drop.push(k); }
      drop.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) { }
  }
  var busy = false;
  function prefetch() {
    if (busy || !S.api || !S.tree) return;
    var old = getJ(NO_BOOT, null); if (old && old.api === S.api) return;
    tidy();
    var todo = candidates().filter(function (f) { return !cached(f); }).map(function (f) { return f.id; });
    if (!todo.length) return;
    busy = true;
    (function next() {
      var ids = todo.splice(0, 25);
      if (!ids.length) { busy = false; return; }
      apiPost({ a: 'quizbatch', ids: ids }).then(function (j) {
        var items = j.items || {}, full = false;
        Object.keys(items).forEach(function (id) {
          if (full) return;
          try { var it = items[id]; if (it && it.r && it.r.ok) { if (!setJ('academy.q.' + id, { mod: it.m, ws: JSON.parse(it.r.data) })) full = true; } } catch (e) { }
        });
        if (full) { busy = false; return; }
        setTimeout(next, 800 + Math.random() * 1500);
      }, function () { busy = false; });
    })();
  }

  /* ---------- on Wi-Fi: save the newest notes of the student's class so they open instantly (and offline) ---------- */
  var notesBusy = false;
  function saveNotes() {
    if (notesBusy || !window.READER || !READER.can() || !S.tree) return;
    try { if (window.Android.isMetered && window.Android.isMetered()) return; } catch (e) { return; }
    var m = PEOPLE.me(); if (!m || isTeacher()) return;
    var cid = PEOPLE.myClassId(); if (!cid) return;
    var pdfs = [];
    (function walk(id, d) {
      (S.idx.files[id] || []).forEach(function (f) { if (!f.pending && kind(f) === 'pdf' && (f.size || 0) < 15 * 1048576) pdfs.push(f); });
      if (d < 30) (S.idx.kids[id] || []).forEach(function (k) { walk(k.id, d + 1); });
    })(cid, 0);
    var todo = pdfs.sort(function (a, b) { return b.mod - a.mod; }).slice(0, 6).filter(function (f) { return !READER.has(f); });
    if (!todo.length) return;
    notesBusy = true;
    (function next() {
      var f = todo.shift();
      if (!f || READER.active()) { notesBusy = false; return; }   // don't compete with a note being read
      READER.save(f).then(function () { setTimeout(next, 3000 + Math.random() * 5000); }, function () { notesBusy = false; });
    })();
  }

  /* ---------- after start-up, in the background ---------- */
  function background() {
    // random start times: when a whole class opens the app together, the phones don't all ask Google in the same second
    setTimeout(prefetch, 600 + Math.random() * 4000);
    setTimeout(function () { if (!isTeacher() && PEOPLE.me()) DASH.load(false); }, 900 + Math.random() * 5000);
    setTimeout(saveNotes, 15000 + Math.random() * 150000);
  }

  return { boot: boot, prefetch: prefetch, background: background, saveNotes: saveNotes };
})();
