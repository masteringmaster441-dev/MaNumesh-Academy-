/* Academy – the student's own progress dashboard (Progress tab). Works offline from what is saved on the
   phone, and fills in the full history from the teacher's sheet when the Google script supports it. */
var DASH = (function () {
  var RES_KEY = 'academy.myres', VIEW_KEY = 'academy.myviews', SRV_KEY = 'academy.mysrv';
  var D = { loading: false, srv: null, at: 0, err: '' };

  function getJ(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function setJ(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function pctOf(r) { return r.total ? Math.round(r.right * 1000 / r.total) / 10 : 0; }
  function band(p) { return p >= 75 ? 'good' : p >= 50 ? 'mid' : 'low'; }
  function dayKey(t) { var d = new Date(t); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }

  /* ---------- saved on the phone as the student works ---------- */
  function logResult(f, ws, res, total, mode) {
    var l = getJ(RES_KEY, []);
    l.push({ ws: f.id, title: cleanName(f.name) || String(ws.title || ''), right: res.right, wrong: res.wrong, skip: res.skip, total: total, secs: res.secs, mode: mode === 'test' ? 'Test' : 'Practice', at: Date.now() });
    if (l.length > 400) l = l.slice(-400);
    setJ(RES_KEY, l);
  }
  function logView(f, k) {
    var l = getJ(VIEW_KEY, []);
    l.push({ id: f.id, title: cleanName(f.name), k: k === 'lecture' ? 'Lecture' : 'Notes', at: Date.now() });
    if (l.length > 200) l = l.slice(-200);
    setJ(VIEW_KEY, l);
  }

  /* ---------- full history from the teacher's sheet (script v10+) ---------- */
  function load(force) {
    var m = PEOPLE.me(); if (!m || isTeacher() || D.loading) return;
    if (!D.srv) { var c = getJ(SRV_KEY, null); if (c && c.sid === m.sid) { D.srv = c.data; D.at = c.at; } }
    if (!force && D.at && Date.now() - D.at < 2 * 60000) return;
    D.loading = true; if (S.tab === 'me') render();
    apiPost({ a: 'myprogress', sid: m.sid }).then(function (j) {
      D.loading = false; D.err = '';
      D.srv = { results: j.results || [], views: j.views || [] }; D.at = Date.now();
      setJ(SRV_KEY, { sid: m.sid, data: D.srv, at: D.at });
      if (S.tab === 'me') render();
    }, function (e) {
      D.loading = false;
      // older Google script, offline, or a hiccup: the phone's own records are still shown
      D.err = /Unknown request|update the Google script/i.test(e.message) ? '' : e.message;
      if (S.tab === 'me') render();
    });
  }

  /* ---------- combine sheet + phone records ---------- */
  function data() {
    var seen = {}, res = [], views = [];
    function addR(r) {
      var k = r.ws + '|' + Math.round((r.at || 0) / 1000);
      if (seen[k]) return; seen[k] = 1;
      r.pct = r.pct != null ? Number(r.pct) : pctOf(r);
      res.push(r);
    }
    (D.srv ? D.srv.results : []).forEach(addR);
    getJ(RES_KEY, []).forEach(addR);
    // older attempts that only exist as "best score" on this phone
    var scores = getJ('academy.scores', {}), have = {};
    res.forEach(function (r) { have[r.ws] = 1; });
    Object.keys(scores).forEach(function (id) {
      var s = scores[id]; if (have[id] || !s.total) return;
      var f = findFile(id);
      addR({ ws: id, title: f ? cleanName(f.name) : 'Worksheet', right: s.best, total: s.total, wrong: 0, skip: 0, secs: 0, mode: '', at: s.at || 0, old: true });
    });
    var vseen = {};
    (D.srv ? D.srv.views : []).concat(getJ(VIEW_KEY, [])).forEach(function (v) {
      var k = v.id + '|' + Math.round((v.at || 0) / 60000); if (vseen[k]) return; vseen[k] = 1; views.push(v);
    });
    res.sort(function (a, b) { return b.at - a.at; });
    views.sort(function (a, b) { return b.at - a.at; });
    return { res: res, views: views };
  }
  function classFolder() {
    var m = PEOPLE.me(); if (!m || !S.tree) return null;
    var n = String(m.cls || '').trim().toLowerCase();
    return S.tree.folders.filter(function (f) { return f.parent === S.tree.rootId && f.name.trim().toLowerCase() === n; })[0] || null;
  }
  function quizzesUnder(id) {
    var out = [];
    (function walk(fid, d) {
      (S.idx.files[fid] || []).forEach(function (x) { if (kind(x) === 'quiz') out.push(x); });
      if (d < 30) (S.idx.kids[fid] || []).forEach(function (k) { walk(k.id, d + 1); });
    })(id, 0);
    return out;
  }
  function streak(res, views) {
    var days = {};
    res.concat(views).forEach(function (x) { if (x.at) days[dayKey(x.at)] = 1; });
    var n = 0, t = Date.now();
    if (!days[dayKey(t)]) t -= 864e5;          // a streak still counts if today hasn't started yet
    while (days[dayKey(t)]) { n++; t -= 864e5; }
    return n;
  }

  /* ---------- the page ---------- */
  function renderPage() {
    var app = document.getElementById('app'), m = PEOPLE.me();
    if (!m) { S.tab = 'material'; render(); return; }
    load(false);
    var dd = data(), res = dd.res, views = dd.views;
    var cf = classFolder(), pool = cf ? quizzesUnder(cf.id) : S.tree.files.filter(function (f) { return kind(f) === 'quiz'; });
    var best = {};
    res.forEach(function (r) { best[r.ws] = Math.max(best[r.ws] == null ? -1 : best[r.ws], r.pct); });
    var done = pool.filter(function (f) { return best[f.id] != null; });
    var todo = pool.filter(function (f) { return best[f.id] == null; }).sort(function (a, b) { return b.mod - a.mod; });
    var weak = pool.filter(function (f) { return best[f.id] != null && best[f.id] < 60; }).sort(function (a, b) { return best[a.id] - best[b.id]; });
    var avg = res.length ? Math.round(res.reduce(function (a, r) { return a + r.pct; }, 0) / res.length) : null;
    var top = res.length ? Math.round(Math.max.apply(null, res.map(function (r) { return r.pct; }))) : null;
    var notes = views.filter(function (v) { return !/lecture/i.test(v.k); }).length, lec = views.length - notes;
    var st = streak(res, views);

    var h = barHTML('My progress', esc(m.name + ' · ' + m.cls + (D.loading ? ' · updating…' : '')), false);
    h += '<div id="pull"><span class="dots"><i></i><i></i><i></i></span></div>';

    // completion ring + streak
    var tot = pool.length, pc = tot ? Math.round(done.length * 100 / tot) : 0, C = 2 * Math.PI * 52;
    h += '<div class="dhero"><div class="ring big sm"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg good" cx="60" cy="60" r="52" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pc / 100)).toFixed(1) + '"/></svg>' +
      '<span><b>' + pc + '%</b><small>done</small></span></div><div class="dht"><b>' + done.length + ' of ' + tot + ' worksheets</b><span>' + esc(cf ? cf.name : 'all classes') + '</span>' +
      '<span class="streak' + (st ? ' on' : '') + '">' + (st ? '🔥 ' + st + '-day streak' : 'Start a streak today') + '</span></div></div>';

    h += '<div class="ptiles">' +
      '<div><b>' + (avg == null ? '–' : avg + '%') + '</b><span>average score</span></div>' +
      '<div><b>' + (top == null ? '–' : top + '%') + '</b><span>best score</span></div>' +
      '<div><b>' + res.length + '</b><span>attempt' + (res.length === 1 ? '' : 's') + '</span></div>' +
      '<div><b>' + notes + '</b><span>note' + (notes === 1 ? '' : 's') + ' opened</span></div>' +
      '<div><b>' + lec + '</b><span>lecture' + (lec === 1 ? '' : 's') + ' watched</span></div>' +
      '<div><b>' + (todo.length) + '</b><span>still to do</span></div></div>';

    if (!res.length && !views.length) {
      h += '<div class="empty" style="margin-top:14px"><b>Your progress will show here</b>Open notes and lectures, and finish worksheets — your scores, streak and progress appear on this page.</div>';
    }

    // score trend
    if (res.length >= 2) {
      var pts = res.filter(function (r) { return !r.old; }).slice(0, 12).reverse();
      if (pts.length >= 2) {
        var first = Math.round(pts[0].pct), last = Math.round(pts[pts.length - 1].pct);
        h += '<div class="sec">Your scores, last ' + pts.length + ' attempts</div><div class="pchart" role="img" aria-label="Scores from ' + first + '% to ' + last + '%">' +
          '<div class="pgrid"><i style="bottom:100%"><em>100%</em></i><i style="bottom:75%"><em>75%</em></i><i style="bottom:50%"><em>50%</em></i><i style="bottom:0"></i></div><div class="pbars">' +
          pts.map(function (r, i) {
            return '<button class="pbar" data-p="bar" data-t="' + esc(r.title + ': ' + r.right + '/' + r.total + ' (' + Math.round(r.pct) + '%) · ' + fmtDate(r.at)) + '" aria-label="' + esc(r.title + ', ' + Math.round(r.pct) + ' percent') + '">' +
              '<i style="height:' + Math.max(2, r.pct) + '%"></i>' + (i === pts.length - 1 ? '<em>' + Math.round(r.pct) + '%</em>' : '') + '</button>';
          }).join('') + '</div></div>';
        var d = last - first;
        h += '<p class="note" style="margin-top:4px">' + (d >= 5 ? 'You’re improving — up ' + d + ' points since the first of these. ' : d <= -5 ? 'A little lower lately — try the worksheets under “Needs practice”. ' : '') + 'Tap a bar for details.</p>';
      }
    }

    // by subject / chapter
    if (cf) {
      var groups = (S.idx.kids[cf.id] || []).slice().sort(byName).map(function (g) { return { name: g.name, list: quizzesUnder(g.id) }; });
      var direct = (S.idx.files[cf.id] || []).filter(function (x) { return kind(x) === 'quiz'; });
      if (direct.length) groups.push({ name: 'Other worksheets', list: direct });
      groups = groups.filter(function (g) { return g.list.length; });
      if (groups.length) {
        h += '<div class="sec">By subject & chapter</div><div class="subjs">' + groups.map(function (g) {
          var dn = g.list.filter(function (f) { return best[f.id] != null; });
          var av = dn.length ? Math.round(dn.reduce(function (a, f) { return a + best[f.id]; }, 0) / dn.length) : null;
          var w = Math.round(dn.length * 100 / g.list.length);
          return '<div class="subj"><div class="sjh"><b>' + esc(g.name) + '</b><span>' + dn.length + '/' + g.list.length + (av != null ? ' · avg ' + av + '%' : '') + '</span></div>' +
            '<div class="sjbar" role="img" aria-label="' + dn.length + ' of ' + g.list.length + ' done"><i style="width:' + w + '%"></i></div></div>';
        }).join('') + '</div>';
      }
    }

    function where(f) { var fo = S.idx.folder[f.parent]; return fo ? fo.name : ''; }
    if (weak.length) h += '<div class="sec">Needs practice (' + weak.length + ')</div><ul class="list">' + weak.slice(0, 5).map(function (f) { return fileRow(f, where(f)); }).join('') + '</ul>';
    if (todo.length) h += '<div class="sec">To do (' + todo.length + ')</div><ul class="list">' + todo.slice(0, D.allTodo ? 200 : 5).map(function (f) { return fileRow(f, where(f)); }).join('') + '</ul>' +
      (todo.length > 5 && !D.allTodo ? '<button class="btn ghost wide" data-dash="alltodo">Show all ' + todo.length + '</button>' : '');

    if (res.length) h += '<div class="sec">Recent attempts</div><ul class="list">' + res.slice(0, 8).map(function (r) {
      var f = findFile(r.ws);
      var inner = '<span class="pscore ' + band(r.pct) + '"><b>' + Math.round(r.pct) + '%</b></span><span class="txt"><b>' + esc(r.title) + '</b>' +
        '<span>' + esc(r.right + '/' + r.total + ' correct' + (r.old ? ' · best score' : (r.wrong ? ' · ' + r.wrong + ' wrong' : '') + (r.mode ? ' · ' + r.mode : ''))) + '</span><span class="sm">' + esc(r.at ? fmtDate(r.at) : '') + '</span></span>';
      return '<li><div class="row">' + (f ? '<button class="main" data-open="' + esc(f.id) + '">' + inner + '</button>' : '<div class="main static">' + inner + '</div>') + '</div></li>';
    }).join('') + '</ul>';

    if (views.length) h += '<div class="sec">Recently opened</div><ul class="list">' + views.slice(0, 6).map(function (v) {
      var lecture = /lecture/i.test(v.k), f = findFile(v.id);
      var inner = '<span class="tile ' + (lecture ? 'k-video' : 'k-pdf') + '">' + (lecture ? IC.play : 'PDF') + '</span><span class="txt"><b>' + esc(v.title) + '</b><span>' + esc((lecture ? 'Lecture' : 'Notes') + ' · ' + fmtDate(v.at)) + '</span></span>';
      return '<li><div class="row">' + (f ? '<button class="main" data-open="' + esc(f.id) + '">' + inner + '</button>' : '<div class="main static">' + inner + '</div>') + '</div></li>';
    }).join('') + '</ul>';

    if (D.err && !D.srv) h += '<p class="note">Showing progress saved on this phone. It will sync when you’re online.</p>';
    app.innerHTML = h;
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-dash]');
    if (b) { e.stopPropagation(); if (b.dataset.dash === 'alltodo') { D.allTodo = true; render(); } return; }
    var r = e.target.closest && e.target.closest('[data-act="refresh"]');
    if (r && S.tab === 'me') load(true);
  }, true);

  return {
    render: renderPage, load: load, logResult: logResult, logView: logView,
    reset: function () { D = { loading: false, srv: null, at: 0, err: '' }; }
  };
})();
