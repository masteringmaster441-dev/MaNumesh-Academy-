/* Academy – sign-in (teacher / student), student registration and the teacher's Students section. */
var PEOPLE = (function () {
  var ME_KEY = 'academy.me', ROSTER_KEY = 'academy.roster', OUT_KEY = 'academy.outbox';
  var G = { step: 'choose', busy: false, err: '' };      // welcome screen state
  var R = { list: null, url: '', loading: false, err: '', q: '', cls: 'all', at: 0 };

  function getJ(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function setJ(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function me() { return getJ(ME_KEY, null); }
  function newId() {
    var a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789', s = '', r = [];
    try { var u = new Uint8Array(24); window.crypto.getRandomValues(u); r = Array.prototype.slice.call(u); } catch (e) { for (var i = 0; i < 24; i++) r.push(Math.floor(Math.random() * 256)); }
    r.forEach(function (x) { s += a.charAt(x % a.length); });
    return s;
  }
  var GENDERS = ['Male', 'Female', 'Rather not say'];
  function curGender() { var b = document.querySelector('.gsel button.on'); return b ? b.dataset.gender : ''; }
  function rel(s) { return s.gender === 'Male' ? 'S/o ' : s.gender === 'Female' ? 'D/o ' : 'Parent: '; }
  function digits(p) { return String(p || '').replace(/\D/g, ''); }
  function prettyPhone(p) { var d = digits(p); if (d.length === 12 && d.indexOf('91') === 0) d = d.slice(2); return d.length === 10 ? d.slice(0, 5) + ' ' + d.slice(5) : String(p || ''); }
  function waNum(p) { var d = digits(p); if (d.length === 11 && d[0] === '0') d = d.slice(1); if (d.length === 10) d = '91' + d; return d; }
  function classes() {
    if (!S.tree) return [];
    return S.tree.folders.filter(function (f) { return f.parent === S.tree.rootId && !f.pending; }).sort(byName);
  }
  function classFolder(name) {
    var n = String(name || '').trim().toLowerCase();
    return classes().filter(function (f) { return f.name.trim().toLowerCase() === n; })[0] || null;
  }
  function initials(n) { var p = String(n || '?').trim().split(/\s+/); return ((p[0] || '?').charAt(0) + (p.length > 1 ? p[p.length - 1].charAt(0) : '')).toUpperCase(); }

  /* ---------------- welcome / sign-in ---------------- */
  function needsGate() { return !isTeacher() && !me(); }
  function classField(val, id) {
    var cs = classes();
    if (!cs.length) return '<input id="' + id + '" maxlength="60" placeholder="e.g. Class 11" value="' + esc(val || '') + '">';
    var known = cs.some(function (f) { return f.name === val; });
    return '<select id="' + id + '"><option value="">Choose your class</option>' + cs.map(function (f) { return '<option' + (f.name === val ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') +
      (val && !known ? '<option selected>' + esc(val) + '</option>' : '') + '</select>';
  }
  function formHTML(d, btn) {
    d = d || {};
    return '<label class="fl">Student’s name<input id="rgName" maxlength="60" autocomplete="name" value="' + esc(d.name || '') + '" placeholder="Full name"></label>' +
      '<div class="fl">Gender<div class="gsel" role="radiogroup" aria-label="Gender">' + GENDERS.map(function (g) {
        return '<button type="button" role="radio" data-gender="' + g + '" class="' + (d.gender === g ? 'on' : '') + '" aria-checked="' + (d.gender === g) + '">' + g + '</button>'; }).join('') + '</div></div>' +
      '<label class="fl">Father’s/Mother’s name<input id="rgFather" maxlength="60" value="' + esc(d.father || '') + '" placeholder="Parent’s full name"></label>' +
      '<label class="fl">Class' + classField(d.cls, 'rgClass') + '</label>' +
      '<label class="fl">Phone number<input id="rgPhone" type="tel" inputmode="tel" maxlength="16" autocomplete="tel" value="' + esc(d.phone || '') + '" placeholder="10-digit mobile number"></label>' +
      '<button class="btn wide big" data-g="save">' + btn + '</button>';
  }
  function readForm() {
    var v = function (id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; };
    var d = { name: v('rgName'), gender: curGender(), father: v('rgFather'), cls: v('rgClass'), phone: v('rgPhone') };
    var bad = !d.name ? 'rgName' : !d.gender ? 'gender' : !d.father ? 'rgFather' : !d.cls ? 'rgClass' : digits(d.phone).length < 10 ? 'rgPhone' : '';
    if (bad) {
      toast(bad === 'rgPhone' ? 'Please enter a valid 10-digit phone number.' : bad === 'gender' ? 'Please choose a gender option.' : 'Please fill in all the details.');
      var el = bad === 'gender' ? document.querySelector('.gsel button') : document.getElementById(bad); if (el) el.focus();
      return null;
    }
    return d;
  }
  function renderGate() {
    var app = document.getElementById('app'), h = '<div class="gate">';
    h += '<div class="gtop"><span class="glogo"><svg viewBox="0 0 24 24"><path d="M12 4 2 9l10 5 10-5-10-5z" fill="currentColor"/><path d="M6 11.2V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-4.8" fill="none" stroke="currentColor" stroke-width="2"/></svg></span>' +
      '<h1>' + esc(S.name || 'Academy') + '</h1><p>' + (G.step === 'student' ? 'Tell us about yourself to get started.' : G.step === 'teacher' ? 'Enter your teacher PIN.' : 'Welcome! How are you using the app?') + '</p></div>';
    if (G.step === 'choose') {
      h += '<button class="gopt" data-g="student"><span class="gi st">🎓</span><span><b>I’m a student</b><small>See notes, lectures and worksheets</small></span></button>' +
        '<button class="gopt" data-g="teacher"><span class="gi te">👩‍🏫</span><span><b>I’m the teacher</b><small>Add material and see students</small></span></button>';
      if (G.removed) h += '<p class="note" style="text-align:center">Your teacher has reset your registration. Please register again.</p>';
    } else if (G.step === 'teacher') {
      h += '<div class="card"><label class="fl">Teacher PIN<input id="gPin" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"></label>' +
        '<button class="btn wide big" data-g="pin">Sign in</button></div><button class="lk gback" data-g="choose">‹ Back</button>';
    } else {
      if (!S.tree && !S.err) h += '<div class="card"><div class="loading" style="min-height:120px"><div class="dots"><i></i><i></i><i></i></div>Loading classes…</div></div>';
      else h += '<div class="card">' + formHTML(G.draft, 'Continue') + '</div><p class="note" style="text-align:center">Your details are shared only with your teacher.</p>';
      h += '<button class="lk gback" data-g="choose">‹ Back</button>';
    }
    app.innerHTML = h + '</div>';
  }
  function saveDraftFromForm() { if (document.getElementById('rgName')) G.draft = { name: val('rgName'), gender: curGender(), father: val('rgFather'), cls: val('rgClass'), phone: val('rgPhone') }; }
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function register(d, btn, onDone) {
    var cur = me(), sid = (cur && cur.sid) || newId();
    busy(btn, true, 'Saving…');
    apiPost({ a: 'register', sid: sid, name: d.name, gender: d.gender, father: d.father, cls: d.cls, phone: d.phone }).then(function () {
      setJ(ME_KEY, { sid: sid, name: d.name, gender: d.gender, father: d.father, cls: d.cls, phone: d.phone, seen: Date.now() });
      onDone();
    }, function (e) {
      busy(btn, false);
      toast(/internet/i.test(e.message) ? 'No internet. Connect to the internet to register.' : /Unknown request|update the Google script/i.test(e.message) ? 'Registration isn’t ready yet. Ask your teacher to update the academy.' : e.message);
    });
  }
  function gClick(b) {
    var g = b.dataset.g;
    if (g === 'choose' || g === 'student' || g === 'teacher') { saveDraftFromForm(); G.step = g; render(); window.scrollTo(0, 0);
      setTimeout(function () { var el = document.getElementById(g === 'teacher' ? 'gPin' : 'rgName'); if (el && !el.value) el.focus(); }, 60); return; }
    if (g === 'pin') {
      var pin = val('gPin').trim(); if (!pin) { document.getElementById('gPin').focus(); return; }
      busy(b, true, 'Checking…'); var old = S.pin; S.pin = pin;
      apiPost({ a: 'login' }).then(function () { saveCfg(); G.step = 'choose'; S.tab = 'material'; render(); toast('Welcome! You’re signed in as the teacher.'); },
        function (e) { S.pin = old; busy(b, false); toast(e.message); });
      return;
    }
    if (g === 'save') {
      var d = readForm(); if (!d) return;
      register(d, b, function () { G = { step: 'choose' }; S.tab = 'material'; S.stack = S.tree ? [S.tree.rootId] : []; render(); window.scrollTo(0, 0); toast('Welcome, ' + d.name.split(' ')[0] + '!'); });
    }
  }

  /* ---------------- student: profile & home card ---------------- */
  function profile() {
    var m = me(); if (!m) return;
    sheet('<h3>My details</h3>' + formHTML(m, 'Save changes') +
      '<button class="btn ghost wide" data-sh="out">Sign out</button>', function (act, b) {
        if (act === 'out') {
          if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to sign out'; return; }
          setJ(ME_KEY, null); closeSheet(); G = { step: 'choose' }; render(); return;
        }
      });
    var sv = document.querySelector('#sheet [data-g="save"]');
    if (sv) sv.onclick = function (e) {
      e.stopPropagation();
      var d = readForm(); if (!d) return;
      var changedCls = d.cls !== m.cls;
      register(d, sv, function () { closeSheet(); render(); toast(changedCls ? 'Class changed to ' + d.cls + '.' : 'Details saved.'); });
    };
  }
  function homeCard() {
    var m = me(); if (!m || isTeacher()) return '';
    var f = classFolder(m.cls), c = f && S.idx.counts[f.id];
    return '<div class="mecard"><div class="mrow"><span class="av">' + esc(initials(m.name)) + '</span><span class="mt"><b>Hi, ' + esc(m.name.split(' ')[0]) + '</b><small>' + esc(m.cls) + '</small></span>' +
      '<button class="lk" data-p="profile">Edit</button></div>' +
      (f ? '<button class="mygo" data-folder="' + esc(f.id) + '"><span>Open my class</span><small>' + esc(c ? countText(c) : '') + '</small><svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg></button>' : '') + '</div>';
  }
  function myClassId() { var m = me(); if (!m || isTeacher()) return ''; var f = classFolder(m.cls); return f ? f.id : ''; }
  /* the teacher's sheet doesn't have this student: re-send the saved details, unless the teacher removed them */
  var healing = false;
  function lost(m, removed, then) {
    if (removed) { setJ(ME_KEY, null); setJ(OUT_KEY, []); G = { step: 'choose', removed: true }; render(); return; }
    if (healing || !m || !m.name) return;
    healing = true;
    apiPost({ a: 'register', sid: m.sid, name: m.name, gender: m.gender || '', father: m.father, cls: m.cls, phone: m.phone }).then(function () {
      healing = false; m.seen = Date.now(); setJ(ME_KEY, m); if (then) then();
      setTimeout(flush, 300);  // send any results that waited for the repair
    }, function () { healing = false; });
  }
  function ping() {
    var m = me(); if (!m || isTeacher() || Date.now() - (m.seen || 0) < 6 * 3600e3) return;
    apiPost({ a: 'seen', sid: m.sid }).then(function (j) { applySeen(m.sid, j); }, function () { });
  }
  function pingDue() { var m = me(); return !!(m && !isTeacher() && Date.now() - (m.seen || 0) >= 6 * 3600e3); }
  function applySeen(sid, j) {
    var cur = me(); if (!cur || cur.sid !== sid || !j) return;
    if (j.known === false) { lost(cur, !!j.removed); return; }
    if (j.student) { cur.name = j.student.name || cur.name; cur.father = j.student.father || cur.father; cur.cls = j.student.cls || cur.cls; if (j.student.gender) cur.gender = j.student.gender; }
    cur.seen = Date.now(); setJ(ME_KEY, cur); render();
  }

  /* ---------------- student: progress sent to the teacher ---------------- */
  function queue(ev) {
    var m = me(); if (!m || isTeacher()) return;
    var q = getJ(OUT_KEY, []); ev.at = Date.now(); q.push(ev);
    if (q.length > 500) q = q.slice(-500);
    setJ(OUT_KEY, q);
  }
  function trackResult(f, ws, res, total, mode) {
    queue({ t: 'r', ws: f.id, title: cleanName(f.name) || String(ws.title || ''), right: res.right, wrong: res.wrong, skip: res.skip, total: total, secs: res.secs, mode: mode });
    try { DASH.logResult(f, ws, res, total, mode); } catch (e) { }
    // sent a few seconds later at a random moment, so a whole class finishing a test together doesn't hit Google in one second
    clearTimeout(trackResult.t); trackResult.t = setTimeout(flush, 500 + Math.random() * 7500);
  }
  var lastView = {};
  function trackView(f) {
    if (!me() || isTeacher() || !f || f.pending) return;
    var k = kind(f); if (k === 'quiz') return;
    if (lastView[f.id] && Date.now() - lastView[f.id] < 30 * 60000) return;
    lastView[f.id] = Date.now();
    queue({ t: 'v', id: f.id, title: cleanName(f.name), k: (k === 'video' || k === 'yt') ? 'lecture' : 'notes' });
    try { DASH.logView(f, (k === 'video' || k === 'yt') ? 'lecture' : 'notes'); } catch (e) { }
    clearTimeout(trackView.t); trackView.t = setTimeout(flush, 3000 + Math.random() * 9000);
  }
  var flushing = false, flushFails = 0;
  function flush() {
    var m = me(), q = getJ(OUT_KEY, []);
    if (flushing || !m || isTeacher() || !q.length) return;
    flushing = true;
    var batch = q.slice(0, 100);
    apiPost({ a: 'track', sid: m.sid, events: batch }).then(function (j) {
      flushing = false; flushFails = 0;
      if (j && j.known === false) { lost(m, !!j.removed, function () { setTimeout(flush, 300); }); return; }  // keep the results until they're saved
      var cur = getJ(OUT_KEY, []); setJ(OUT_KEY, cur.slice(batch.length));
      if (cur.length > batch.length) setTimeout(flush, 500);
    }, function () {
      // Google busy or no internet: keep the results on the phone and try again, waiting longer each time (5 s, 10 s, … up to 5 min)
      flushing = false; flushFails = Math.min(flushFails + 1, 7);
      clearTimeout(flush.retry); flush.retry = setTimeout(flush, Math.min(300000, 5000 * Math.pow(2, flushFails - 1)) * (0.7 + Math.random() * 0.6));
    });
  }

  /* ---------------- teacher: Students section ---------------- */
  function loadRoster(force) {
    if (R.loading) return;
    if (!R.list) { var c = getJ(ROSTER_KEY, null); if (c) { R.list = c.list; R.url = c.url; R.at = c.at; } }
    if (!force && R.at && Date.now() - R.at < 60000) return;
    R.loading = true; R.err = ''; if (S.tab === 'students') render();
    apiPost({ a: 'students', fresh: force ? 1 : 0 }).then(function (j) {
      R.loading = false; applyRoster(j);
    }, function (e) {
      R.loading = false;
      var temp = /Server error (404|408|429|5\d\d)|No internet|No answer/.test(e.message);
      // with a saved list, a temporary failure stays quiet and retries once in the background
      if (R.list && temp) { R.err = ''; R.stale = true; if (!R.retried) { R.retried = true; setTimeout(function () { loadRoster(true); }, 4000); } }
      else R.err = temp ? 'Couldn’t reach Google right now. Pull down or tap ⟳ to try again.' : e.message;
      if (S.tab === 'students') render();
    });
  }
  function applyRoster(j) {
    if (!j) return;
    R.stale = false; R.retried = false; R.err = ''; R.list = j.students || []; R.url = j.url || ''; R.at = Date.now();
    setJ(ROSTER_KEY, { list: R.list, url: R.url, at: R.at });
    if (S.tab === 'students') render();
    prefetchProgress();
  }
  /* teacher: keep each student's progress page on the phone so it opens instantly */
  var PC_KEY = 'academy.pcache';
  function prefetchProgress() {
    if (!isTeacher() || !R.list || !R.list.length || prefetchProgress.busy) return;
    var pc = getJ(PC_KEY, {}), now = Date.now();
    // most recently active students first; only refresh pages older than 10 minutes, a few per start-up
    var todo = R.list.slice().sort(function (a, b) { return (b.seen || 0) - (a.seen || 0); })
      .filter(function (s) { return !pc[s.sid] || now - pc[s.sid].at > 10 * 60000; }).slice(0, 8);
    prefetchProgress.busy = true;
    (function next() {
      var s = todo.shift();
      if (!s) { prefetchProgress.busy = false; return; }
      apiPost({ a: 'progress', sid: s.sid }).then(function (j) { saveProg(s.sid, j); setTimeout(next, 250); }, function () { prefetchProgress.busy = false; });
    })();
  }
  function saveProg(sid, j) {
    var pc = getJ(PC_KEY, {});
    pc[sid] = { at: Date.now(), results: j.results || [], views: j.views || [] };
    var keys = Object.keys(pc);
    if (keys.length > 120) keys.sort(function (a, b) { return pc[a].at - pc[b].at; }).slice(0, keys.length - 120).forEach(function (k) { delete pc[k]; });
    if (!setJ(PC_KEY, pc)) { /* storage full: keep only the newest 30 */
      keys = Object.keys(pc).sort(function (a, b) { return pc[b].at - pc[a].at; }); var small = {}; keys.slice(0, 30).forEach(function (k) { small[k] = pc[k]; }); setJ(PC_KEY, small);
    }
  }
  function band(p) { return p >= 75 ? 'good' : p >= 50 ? 'mid' : 'low'; }
  function seenText(t) { if (!t) return 'Never'; return ago(t); }
  function renderStudents() {
    if (R.view) { renderProgress(); return; }
    var app = document.getElementById('app');
    if (!R.list && !R.loading && !R.err) loadRoster(false);
    var list = R.list || [];
    var h = barHTML('Students', esc(list.length + ' registered' + (R.loading ? ' · refreshing…' : R.at ? ' · updated ' + ago(R.at) : '')), false);
    h += '<div id="pull"><span class="dots"><i></i><i></i><i></i></span></div>';
    if (R.err) h += '<div class="err"><b>Couldn’t load students.</b> ' + esc(/Unknown request|update the Google script/i.test(R.err) ? 'Please update the Google script to the latest version (Academy-Code-v14).' : R.err) + '</div>';
    if (!R.list) { app.innerHTML = h + (R.loading ? '<div class="loading"><div class="dots"><i></i><i></i><i></i></div>Loading students…</div>' : '<button class="btn wide" data-p="reload">Try again</button>'); return; }
    if (!list.length) {
      app.innerHTML = h + '<div class="empty" style="margin-top:12px"><b>No students yet</b>Students appear here after they open the app and register. Share the Academy app with them.</div>' +
        (R.url ? '<button class="btn ghost wide" data-p="sheet">Open the student list in Google Sheets</button>' : ''); return;
    }
    var counts = {}; list.forEach(function (s) { counts[s.cls] = (counts[s.cls] || 0) + 1; });
    var clsNames = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); });
    if (R.cls !== 'all' && !counts[R.cls]) R.cls = 'all';
    h += '<div class="chips2">' + '<button data-p="cls" data-v="all" class="' + (R.cls === 'all' ? 'on' : '') + '">All <i>' + list.length + '</i></button>' +
      clsNames.map(function (c) { return '<button data-p="cls" data-v="' + esc(c) + '" class="' + (R.cls === c ? 'on' : '') + '">' + esc(c) + ' <i>' + counts[c] + '</i></button>'; }).join('') + '</div>';
    h += '<input class="search" id="stuQ" type="search" placeholder="Search name, parent’s name or phone" value="' + esc(R.q) + '">';
    h += '<div id="stuList">' + listHTML() + '</div>';
    if (R.url) h += '<button class="btn ghost wide" data-p="sheet" style="margin-top:14px">Open the full list in Google Sheets</button>';
    app.innerHTML = h;
  }
  function filtered() {
    var q = R.q.trim().toLowerCase(), qd = digits(q);
    return (R.list || []).filter(function (s) {
      if (R.cls !== 'all' && s.cls !== R.cls) return false;
      if (!q) return true;
      return (s.name + ' ' + s.father).toLowerCase().indexOf(q) >= 0 || (qd.length >= 3 && digits(s.phone).indexOf(qd) >= 0);
    }).sort(function (a, b) { return a.cls.localeCompare(b.cls, undefined, { numeric: true }) || a.name.localeCompare(b.name); });
  }
  function listHTML() {
    var l = filtered();
    if (!l.length) return '<div class="empty"><b>No matching students</b>Try a different name or class.</div>';
    var showCls = R.cls === 'all';
    return '<ul class="list">' + l.map(function (s) {
      var fresh = s.seen && Date.now() - s.seen < 7 * 864e5;
      return '<li><div class="row"><button class="main" data-stu="' + esc(s.sid) + '"><span class="av">' + esc(initials(s.name)) + '</span><span class="txt"><b>' + esc(s.name) + '</b>' +
        '<span>' + esc(rel(s) + s.father + (showCls ? ' · ' + s.cls : '')) + '</span><span class="sm">' + esc(prettyPhone(s.phone)) + ' · <em class="' + (fresh ? 'on' : '') + '">' + esc(s.seen ? 'active ' + ago(s.seen) : 'not active yet') + '</em></span></span>' +
        (s.avg != null ? '<span class="pbadge ' + band(s.avg) + '"><b>' + s.avg + '%</b><small>' + s.wsDone + ' ws</small></span>' : '') + '</button></div></li>';
    }).join('') + '</ul>';
  }
  function detail(sid) {
    var s = (R.list || []).filter(function (x) { return x.sid === sid; })[0]; if (!s) return;
    var cs = classes(), opts = cs.map(function (f) { return f.name; });
    if (opts.indexOf(s.cls) < 0) opts.unshift(s.cls);
    sheet('<div class="sdh"><span class="av big">' + esc(initials(s.name)) + '</span><div><h3>' + esc(s.name) + '</h3><p class="muted" style="margin:0">' + esc(s.cls) + '</p></div></div>' +
      '<dl class="sdl"><dt>Gender</dt><dd>' + esc(s.gender || '—') + '</dd><dt>Father’s/Mother’s name</dt><dd>' + esc(s.father) + '</dd><dt>Phone</dt><dd>' + esc(prettyPhone(s.phone)) + '</dd>' +
      '<dt>Registered</dt><dd>' + esc(s.reg ? fmtDate(s.reg) : '—') + '</dd><dt>Last opened the app</dt><dd>' + esc(seenText(s.seen)) + '</dd></dl>' +
      '<button class="btn wide big" data-sh="prog">View progress' + (s.avg != null ? ' · avg ' + s.avg + '%' : '') + '</button>' +
      '<div class="two" style="margin-top:10px"><button class="btn ghost" data-sh="call">Call</button><button class="btn wa2" data-sh="wa">WhatsApp</button></div>' +
      '<label class="fl" style="margin-top:14px">Change class<select id="stuCls">' + opts.map(function (o) { return '<option' + (o === s.cls ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select></label>' +
      '<button class="btn ghost wide" data-sh="savecls">Save class</button>' +
      '<button class="btn ghost wide dangertext" data-sh="del">Remove student</button>', function (act, b) {
        if (act === 'prog') { closeSheet(); openProgress(s.sid); return; }
        if (act === 'call') { openExternal('tel:+' + waNum(s.phone)); return; }
        if (act === 'wa') { openExternal('https://wa.me/' + waNum(s.phone)); return; }
        if (act === 'savecls') {
          var c = document.getElementById('stuCls').value; if (c === s.cls) { closeSheet(); return; }
          busy(b, true, 'Saving…');
          apiPost({ a: 'editstudent', sid: s.sid, cls: c }).then(function () { s.cls = c; setJ(ROSTER_KEY, { list: R.list, url: R.url, at: R.at }); closeSheet(); render(); toast(s.name + ' moved to ' + c + '.'); },
            function (e) { busy(b, false); toast(e.message); });
          return;
        }
        if (act === 'del') {
          if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to remove ' + s.name.split(' ')[0]; return; }
          busy(b, true, 'Removing…');
          apiPost({ a: 'delstudent', sid: s.sid }).then(function () { R.list = R.list.filter(function (x) { return x.sid !== s.sid; }); setJ(ROSTER_KEY, { list: R.list, url: R.url, at: R.at }); closeSheet(); render(); toast('Student removed.'); },
            function (e) { busy(b, false); toast(e.message); });
        }
      });
  }

  /* ---------------- teacher: one student's progress ---------------- */
  var PG = {};
  function openProgress(sid) {
    R.view = sid;
    var c = getJ(PC_KEY, {})[sid];
    function show(j) { PG = { sid: sid, results: (j.results || []).slice().sort(function (a, b) { return b.at - a.at; }), views: (j.views || []).slice().sort(function (a, b) { return b.at - a.at; }) }; }
    if (c) { show(c); PG.updating = true; } else PG = { sid: sid, loading: true };
    render(); window.scrollTo(0, 0);
    apiPost({ a: 'progress', sid: sid }).then(function (j) {
      saveProg(sid, j);
      if (R.view !== sid) return;
      var y = window.scrollY; show(j); render(); window.scrollTo(0, y);
    }, function (e) { if (R.view !== sid) return; if (c) { PG.updating = false; render(); toast('Showing saved progress — couldn’t reach Google.'); return; } PG = { sid: sid, err: e.message }; render(); });
  }
  function closeProgress() { R.view = null; PG = {}; render(); window.scrollTo(0, 0); return true; }
  function mins(s) { s = Math.round(s || 0); return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min' + (s % 60 ? ' ' + (s % 60) + ' s' : ''); }
  function classWorksheets(clsName) {
    var f = classFolder(clsName); if (!f) return [];
    var out = [];
    (function walk(id, d) {
      (S.idx.files[id] || []).forEach(function (x) { if (kind(x) === 'quiz') out.push(x); });
      if (d < 30) (S.idx.kids[id] || []).forEach(function (k) { walk(k.id, d + 1); });
    })(f.id, 0);
    return out;
  }
  function renderProgress() {
    var app = document.getElementById('app');
    var s = (R.list || []).filter(function (x) { return x.sid === R.view; })[0];
    if (!s) { R.view = null; renderStudents(); return; }
    var h = barHTML(s.name, esc('Progress · ' + s.cls), true);
    h += '<div class="phead"><span class="av big">' + esc(initials(s.name)) + '</span><div class="pht"><b>' + esc(s.name) + '</b><span>' + esc(rel(s) + s.father) + ' · ' + esc(prettyPhone(s.phone)) + '</span></div></div>';
    if (PG.loading) { app.innerHTML = h + '<div class="loading"><div class="dots"><i></i><i></i><i></i></div>Loading progress…</div>'; return; }
    if (PG.err) { app.innerHTML = h + '<div class="err"><b>Couldn’t load progress.</b> ' + esc(/Unknown request|update the Google script/i.test(PG.err) ? 'Please update the Google script to the latest version (Academy-Code-v14).' : PG.err) + '</div><button class="btn wide" data-p="progreload">Try again</button>'; return; }
    var rs = PG.results || [], vs = PG.views || [];
    var best = {}; rs.forEach(function (r) { best[r.ws] = Math.max(best[r.ws] || 0, r.pct); });
    var avg = rs.length ? Math.round(rs.reduce(function (a, r) { return a + r.pct; }, 0) / rs.length) : null;
    var top = rs.length ? Math.max.apply(null, rs.map(function (r) { return r.pct; })) : null;
    var notes = vs.filter(function (v) { return !/lecture/i.test(v.k); }).length, lec = vs.length - notes;
    h += '<div class="ptiles">' +
      '<div><b>' + Object.keys(best).length + '</b><span>worksheet' + (Object.keys(best).length === 1 ? '' : 's') + ' done</span></div>' +
      '<div><b>' + (avg == null ? '–' : avg + '%') + '</b><span>average score</span></div>' +
      '<div><b>' + (top == null ? '–' : Math.round(top) + '%') + '</b><span>best score</span></div>' +
      '<div><b>' + notes + '</b><span>note' + (notes === 1 ? '' : 's') + ' opened</span></div>' +
      '<div><b>' + lec + '</b><span>lecture' + (lec === 1 ? '' : 's') + ' opened</span></div>' +
      '<div><b class="sm">' + esc(s.seen ? ago(s.seen) : 'never') + '</b><span>last active</span></div></div>';
    if (rs.length >= 2) {
      var pts = rs.slice(0, 12).reverse();
      h += '<div class="sec">Scores, last ' + pts.length + ' attempts</div><div class="pchart" role="img" aria-label="Scores of the last ' + pts.length + ' attempts, from ' + Math.round(pts[0].pct) + '% to ' + Math.round(pts[pts.length - 1].pct) + '%">' +
        '<div class="pgrid"><i style="bottom:100%"><em>100%</em></i><i style="bottom:75%"><em>75%</em></i><i style="bottom:50%"><em>50%</em></i><i style="bottom:0"></i></div><div class="pbars">' +
        pts.map(function (r, i) {
          return '<button class="pbar" data-p="bar" data-t="' + esc(r.title + ': ' + r.right + '/' + r.total + ' (' + Math.round(r.pct) + '%) · ' + fmtDate(r.at)) + '" aria-label="' + esc(r.title + ', ' + Math.round(r.pct) + ' percent') + '">' +
            '<i style="height:' + Math.max(2, r.pct) + '%"></i>' + (i === pts.length - 1 ? '<em>' + Math.round(r.pct) + '%</em>' : '') + '</button>';
        }).join('') + '</div></div><p class="note" style="margin-top:4px">Oldest on the left, latest on the right. Tap a bar for details.</p>';
    }
    var pend = classWorksheets(s.cls).filter(function (f) { return best[f.id] == null; });
    if (pend.length) h += '<div class="sec">Not attempted yet in ' + esc(s.cls) + ' (' + pend.length + ')</div><ul class="list">' + pend.slice(0, 30).map(function (f) {
      var fo = S.idx.folder[f.parent];
      return '<li><div class="row"><div class="main static"><span class="tile k-quiz">MCQ</span><span class="txt"><b>' + esc(cleanName(f.name)) + '</b><span>' + esc((fo ? fo.name + ' · ' : '') + (f.mcq ? f.mcq + ' questions' : '')) + '</span></span></div></div></li>';
    }).join('') + '</ul>';
    if (rs.length) h += '<div class="sec">Worksheet attempts (' + rs.length + ')</div><ul class="list">' + rs.map(function (r) {
      return '<li><div class="row"><div class="main static"><span class="pscore ' + band(r.pct) + '"><b>' + Math.round(r.pct) + '%</b></span><span class="txt"><b>' + esc(r.title) + '</b>' +
        '<span>' + esc(r.right + '/' + r.total + ' correct · ' + r.wrong + ' wrong' + (r.skip ? ' · ' + r.skip + ' skipped' : '')) + '</span><span class="sm">' + esc(fmtDate(r.at) + ' · ' + r.mode + ' · ' + mins(r.secs)) + '</span></span></div></div></li>';
    }).join('') + '</ul>';
    else h += '<div class="empty" style="margin-top:12px"><b>No worksheets attempted yet</b>Scores appear here as soon as ' + esc(s.name.split(' ')[0]) + ' finishes a worksheet.</div>';
    if (vs.length) h += '<div class="sec">Recently opened</div><ul class="list">' + vs.slice(0, 20).map(function (v) {
      var lecture = /lecture/i.test(v.k);
      return '<li><div class="row"><div class="main static"><span class="tile ' + (lecture ? 'k-video' : 'k-pdf') + '">' + (lecture ? IC.play : 'PDF') + '</span><span class="txt"><b>' + esc(v.title) + '</b><span>' + esc((lecture ? 'Lecture' : 'Notes') + ' · ' + fmtDate(v.at)) + '</span></span></div></div></li>';
    }).join('') + '</ul>';
    h += '<div class="two" style="margin-top:16px"><button class="btn ghost" data-p="pcall">Call</button><button class="btn wa2" data-p="pwa">WhatsApp</button></div>';
    app.innerHTML = h;
  }

  /* ---------------- teacher: results of one worksheet ---------------- */
  function wsResults(f) {
    sheet('<h3>' + esc(cleanName(f.name)) + '</h3><div class="loading" style="min-height:120px"><div class="dots"><i></i><i></i><i></i></div>Loading results…</div>', function () { });
    var path = pathOf(f.parent), cls = path.length ? path[0].name : '';
    var go = function () {
      return apiPost({ a: 'wsresults', ws: f.id }).then(function (j) {
        var rs = (j.results || []).sort(function (a, b) { return b.best - a.best; });
        var done = {}; rs.forEach(function (r) { done[r.sid] = 1; });
        var missing = (R.list || []).filter(function (s) { return cls && s.cls === cls && !done[s.sid]; });
        var avg = rs.length ? Math.round(rs.reduce(function (a, r) { return a + r.best; }, 0) / rs.length) : null;
        var h = '<h3>' + esc(cleanName(f.name)) + '</h3><p class="note" style="margin-top:-6px">' + rs.length + ' student' + (rs.length === 1 ? '' : 's') + ' attempted' + (avg != null ? ' · average best score ' + avg + '%' : '') + '</p>';
        if (rs.length) h += '<ul class="list">' + rs.map(function (r) {
          return '<li><div class="row"><button class="main" data-sh="s' + esc(r.sid) + '"><span class="pscore ' + band(r.best) + '"><b>' + Math.round(r.best) + '%</b></span><span class="txt"><b>' + esc(r.name) + '</b><span>' + esc(r.cls + ' · ' + r.tries + ' attempt' + (r.tries > 1 ? 's' : '') + ' · last ' + Math.round(r.lastPct) + '% ' + fmtDate(r.last).toLowerCase()) + '</span></span></button></div></li>';
        }).join('') + '</ul>';
        else h += '<div class="empty"><b>No attempts yet</b>Results appear when students finish this worksheet.</div>';
        if (missing.length) h += '<div class="sec">Not attempted in ' + esc(cls) + ' (' + missing.length + ')</div><p class="miss">' + missing.map(function (s) { return esc(s.name); }).join(', ') + '</p>';
        var el = document.querySelector('#sheet .sheet');
        if (el) { el.innerHTML = '<div class="grab"></div>' + h + '<button class="cancel" data-sh="cancel">Close</button>'; }
      });
    };
    var bg = document.getElementById('sheet');
    if (bg) bg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sh]'); if (!b || b.dataset.sh.charAt(0) !== 's' || b.dataset.sh === 'cancel') return;
      var sid = b.dataset.sh.slice(1); closeSheet(); S.tab = 'students'; S.mode = 'browse'; openProgress(sid);
    });
    (R.list ? Promise.resolve() : new Promise(function (res) { loadRoster(true); var n = 0, iv = setInterval(function () { if (R.list || ++n > 40) { clearInterval(iv); res(); } }, 250); }))
      .then(go).catch(function (e) { var el = document.querySelector('#sheet .sheet'); if (el) el.innerHTML = '<div class="grab"></div><h3>Couldn’t load results</h3><p class="note">' + esc(/Unknown request|update the Google script/i.test(e.message) ? 'Please update the Google script to the latest version (Academy-Code-v14).' : e.message) + '</p><button class="cancel" data-sh="cancel">Close</button>'; });
  }

  /* ---------------- student: report a question whose answer looks wrong ---------------- */
  var FLAG_KEY = 'academy.flagged';
  function isFlagged(f, qi) { var m = getJ(FLAG_KEY, {}); return !!m[f.id + '|' + qi]; }
  // opts: { q, marked, options:[text...] (MCQ only) }
  function flagSheet(f, qi, opts, done) {
    if (isTeacher()) { toast('Teachers can edit the question directly'); return; }
    if (isFlagged(f, qi)) { toast('You already reported this question'); return; }
    var sel = -1, opt = opts.options || [];
    var h = '<h3>Report a wrong answer</h3><p class="note" style="margin-top:0">Tell your teacher this question’s answer looks wrong. It will be checked.</p>' +
      (opt.length ? '<div class="sec" style="margin-top:6px">I think the correct answer is…</div><div class="flagopts">' + opt.map(function (o, j) { return '<button class="btn ghost" data-sh="o' + j + '">' + String.fromCharCode(65 + j) + '</button>'; }).join('') + '</div>' : '') +
      '<textarea id="flagnote" maxlength="300" rows="3" placeholder="' + (opt.length ? 'Why? (optional)' : 'What should the answer be? (optional)') + '" style="width:100%;margin:8px 0"></textarea>' +
      '<button class="btn wide" data-sh="send">Send report</button>';
    sheet(h, function (act, btn) {
      if (/^o\d$/.test(act)) {
        sel = sel === Number(act.slice(1)) ? -1 : Number(act.slice(1));
        Array.prototype.forEach.call(document.querySelectorAll('.flagopts button'), function (x, i) { x.classList.toggle('on', i === sel); });
      } else if (act === 'send') {
        var note = (document.getElementById('flagnote') || {}).value || '';
        queue({ t: 'f', ws: f.id, qi: qi, title: cleanName(f.name), q: String(opts.q || '').slice(0, 300), marked: String(opts.marked || '').slice(0, 200), thinks: sel >= 0 ? String.fromCharCode(65 + sel) + '. ' + String(opt[sel] || '').slice(0, 150) : '', note: note.slice(0, 300) });
        var m = getJ(FLAG_KEY, {}); m[f.id + '|' + qi] = Date.now(); setJ(FLAG_KEY, m);
        closeSheet(); toast('Thanks — your teacher will check it');
        clearTimeout(flagSheet.t); flagSheet.t = setTimeout(flush, 1500 + Math.random() * 6000);
        if (done) done();
      }
    });
  }

  /* ---------------- teacher: flagged questions ---------------- */
  function flagsView(f) {
    sheet('<h3>Reported questions</h3><div class="loading" style="min-height:120px"><div class="dots"><i></i><i></i><i></i></div>Loading…</div>', function () { });
    var paint = function (h) { var el = document.querySelector('#sheet .sheet'); if (el) el.innerHTML = '<div class="grab"></div>' + h + '<button class="cancel" data-sh="cancel">Close</button>'; };
    var load = function () {
      return apiPost({ a: 'flags', ws: f ? f.id : '' }).then(function (j) {
        var fl = j.flags || [];
        var h = '<h3>Reported questions</h3>';
        if (!fl.length) h += '<div class="empty"><b>Nothing reported</b>When a student reports a wrong answer it shows up here.</div>';
        h += fl.map(function (g, i) {
          return '<div class="rv no"><div class="rvh"><b>' + esc(g.title) + ' · Q' + (g.qi + 1) + '</b><span>' + g.n + ' report' + (g.n > 1 ? 's' : '') + '</span></div><div class="qtext">' + esc(g.q) + '</div>' +
            '<p class="note" style="margin:4px 0">Marked answer: <b>' + esc(g.marked) + '</b></p>' +
            g.reports.slice(0, 6).map(function (r) { return '<p class="note" style="margin:2px 0">• ' + esc(r.name) + (r.thinks ? ' thinks <b>' + esc(r.thinks) + '</b>' : '') + (r.note ? ' — “' + esc(r.note) + '”' : '') + '</p>'; }).join('') +
            '<div class="two" style="margin-top:8px"><button class="btn ghost" data-sh="e' + i + '">Edit worksheet</button><button class="btn" data-sh="d' + i + '">Resolved</button></div></div>';
        }).join('');
        paint(h);
        var bg = document.getElementById('sheet');
        if (bg) bg.onclick = function (e) {
          var b = e.target.closest('[data-sh]'); if (!b) return; var a = b.dataset.sh, g = fl[Number(a.slice(1))];
          if (a === 'cancel') { closeSheet(); return; }
          if (!g) return;
          if (a.charAt(0) === 'd') { b.disabled = true; apiPost({ a: 'flagsdone', ws: g.ws, qi: g.qi }).then(function () { toast('Marked resolved'); flagsView(f); }, function (er) { b.disabled = false; toast(er.message); }); }
          else if (a.charAt(0) === 'e') { var file = (S.tree && S.tree.files || []).filter(function (x) { return x.id === g.ws; })[0]; closeSheet(); if (file) { if (window.QA && QA.isQA && QA.isQA(file)) QA.edit(file); else MCQ.edit(file); } else toast('Worksheet not found'); }
        };
      });
    };
    load().catch(function (e) { paint('<h3>Couldn’t load reports</h3><p class="note">' + esc(/Unknown request|update the Google script/i.test(e.message) ? 'Please update the Google script to the latest version (Academy-Code-v14).' : e.message) + '</p>'); });
  }

  /* ---------------- events ---------------- */
  document.addEventListener('click', function (e) {
    var gb = e.target.closest && e.target.closest('[data-gender]');
    if (gb) {
      e.stopPropagation();
      Array.prototype.forEach.call(gb.parentNode.querySelectorAll('button'), function (x) { var on = x === gb; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
      return;
    }
    var b = e.target.closest('button'); if (!b) return;
    if (b.dataset.g && !b.closest('#sheet')) { e.stopPropagation(); gClick(b); return; }
    if (b.closest('#sheet')) return;
    var p = b.dataset.p;
    if (p === 'profile') { e.stopPropagation(); profile(); }
    else if (p === 'reload') { e.stopPropagation(); loadRoster(true); }
    else if (p === 'sheet') { e.stopPropagation(); openExternal(R.url); }
    else if (p === 'cls') { e.stopPropagation(); R.cls = b.dataset.v; render(); }
    else if (b.dataset.stu) { e.stopPropagation(); detail(b.dataset.stu); }
    else if (p === 'bar') { e.stopPropagation(); toast(b.dataset.t); }
    else if (p === 'progreload') { e.stopPropagation(); openProgress(R.view); }
    else if (p === 'pcall' || p === 'pwa') { e.stopPropagation(); var st = (R.list || []).filter(function (x) { return x.sid === R.view; })[0]; if (st) openExternal(p === 'pcall' ? 'tel:+' + waNum(st.phone) : 'https://wa.me/' + waNum(st.phone)); }
    else if (S.tab === 'students' && R.view && b.dataset.act === 'back') { e.stopPropagation(); closeProgress(); }
    else if (S.tab === 'students' && b.dataset.act === 'refresh') { e.stopPropagation(); loadRoster(true); toast('Refreshing…'); }
    else if (S.tab === 'students' && b.dataset.act === 'search') { e.stopPropagation(); var q = document.getElementById('stuQ'); if (q) q.focus(); }
  }, true);
  document.addEventListener('input', function (e) { if (e.target.id === 'stuQ') { R.q = e.target.value; var l = document.getElementById('stuList'); if (l) l.innerHTML = listHTML(); } });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.target.id === 'gPin') { var b1 = document.querySelector('[data-g="pin"]'); if (b1) b1.click(); }
  });

  return {
    me: me, needsGate: needsGate, renderGate: renderGate, renderStudents: renderStudents, loadRoster: loadRoster,
    homeCard: homeCard, myClassId: myClassId, profile: profile, ping: ping, pingDue: pingDue, applySeen: applySeen, applyRoster: applyRoster,
    classWorksheets: classWorksheets,
    trackResult: trackResult, trackView: trackView, flush: flush, wsResults: wsResults, flagSheet: flagSheet, isFlagged: isFlagged, flagsView: flagsView, openProgress: openProgress,
    onBack: function () {
      if (needsGate() && G.step !== 'choose') { G.step = 'choose'; render(); return true; }
      if (S.tab === 'students' && R.view && S.mode === 'browse') return closeProgress();
      return false;
    },
    signOutTeacher: function () { G = { step: 'choose' }; setJ(PC_KEY, null); }
  };
})();
