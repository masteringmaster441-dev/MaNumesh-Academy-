/* Academy – Board tab: upcoming tests, syllabus, CBSE paper pattern, updates and notices.
   Students read it (saved on the phone, works offline); only the teacher can add, edit or delete. */
var BOARD = (function () {
  var KEY = 'academy.board', SEEN = 'academy.boardseen';
  var B = { items: [], bv: 0, loading: false, at: 0, err: '', filter: 'all', old: false };
  var TYPES = {
    test: { label: 'Upcoming test', tab: 'Tests', icon: '📝', hint: 'Topics, marks, time, what to bring…' },
    syllabus: { label: 'Syllabus', tab: 'Syllabus', icon: '📚', hint: 'Chapters / units covered' },
    pattern: { label: 'Paper pattern', tab: 'Paper pattern', icon: '📊', hint: 'Sections, marks, question types, choices…' },
    news: { label: 'What’s new', tab: 'Updates', icon: '✨', hint: 'New feature, new material, new worksheet…' },
    ad: { label: 'Advertisement', tab: 'Ads', icon: '📣', hint: 'What you’re promoting, who it’s for, how to respond…' },
    notice: { label: 'Notice', tab: 'Notices', icon: '📢', hint: 'Anything students should know' }
  };
  var ORDER = ['test', 'syllabus', 'pattern', 'news', 'ad', 'notice'];
  var TEMPLATE = {
    pattern: 'Total marks: \nTime: \n\nSection A – MCQ: \nSection B – Very short answer: \nSection C – Short answer: \nSection D – Long answer: \nSection E – Case / source based: \n\nInternal choice: ',
    syllabus: 'Unit 1: \nUnit 2: \nUnit 3: \nUnit 4: \n\nNot included: ',
    test: 'Chapters: \nMarks: \nTime: \nBring: '
  };
  function getJ(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function setJ(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  (function init() { var c = getJ(KEY, null); if (c && c.items) { B.items = c.items; B.bv = c.bv || 0; } })();

  function save() { setJ(KEY, { bv: B.bv, items: B.items }); }
  function apply(o) {
    if (!o || !o.items) return;
    B.items = o.items; B.bv = o.bv || 0; B.old = false; save(); paintDot();
    if (S.tab === 'board' && S.mode === 'browse') { var y = window.scrollY; render(); window.scrollTo(0, y); }
  }
  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function dayOf(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : 0; }
  function fmtDate(s) { var t = dayOf(s); return t ? new Date(t).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : ''; }
  function left(s) { var t = dayOf(s); return t ? Math.round((t - today()) / 864e5) : null; }
  function leftText(n) { return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 ? 'In ' + n + ' days' : n === -1 ? 'Yesterday' : Math.abs(n) + ' days ago'; }
  function myClass() { try { var m = PEOPLE.me(); return m && m.cls ? String(m.cls).trim().toLowerCase() : ''; } catch (e) { return ''; } }
  function classNames() { return S.tree ? S.tree.folders.filter(function (f) { return f.parent === S.tree.rootId; }).map(function (f) { return f.name; }) : []; }
  function visible() {
    if (isTeacher()) return B.items.slice();
    var mc = myClass();
    return B.items.filter(function (x) {
      if (x.cls && mc && x.cls.trim().toLowerCase() !== mc) return false;
      if (x.type === 'test' && x.date && left(x.date) < -1) return false;   // finished tests drop off for students
      return true;
    });
  }

  /* ---------- the little dot on the Board tab when something new was posted ---------- */
  function unseen() { return !isTeacher() && B.bv && getJ(SEEN, 0) !== B.bv && visible().length > 0; }
  function paintDot() { var b = document.querySelector('#nav button[data-tab="board"]'); if (b) b.classList.toggle('dot', !!unseen()); }
  function markSeen() { if (B.bv) { setJ(SEEN, B.bv); paintDot(); } }

  /* ---------- loading ---------- */
  function load(force) {
    if (!S.api || B.loading) return Promise.resolve();
    if (!force && B.at && Date.now() - B.at < 2 * 60000) return Promise.resolve();
    B.loading = true;
    return apiPost({ a: 'board', bv: B.bv }).then(function (j) {
      B.loading = false; B.at = Date.now(); B.err = ''; B.old = false;
      if (!j.same) apply(j);
      if (S.tab === 'board' && S.mode === 'browse') render();
    }, function (e) {
      B.loading = false; B.at = Date.now() - 90000;
      if (/Unknown request|update the Google script/i.test(e.message)) B.old = true; else B.err = e.message;
      if (S.tab === 'board' && S.mode === 'browse') render();
    });
  }

  /* ---------- page ---------- */
  function mediaHTML(x) {
    if (!x.media) return '';
    var id = encodeURIComponent(x.media.id);
    if (/^video\//.test(x.media.mime)) return '<video class="bdmvid" controls playsinline preload="metadata" src="https://drive.usercontent.google.com/download?id=' + id + '&export=download&confirm=t"></video>';
    // googleusercontent serves the original bytes (so a GIF stays animated); if that is refused, fall back to Drive's still thumbnail
    return '<img class="bdmimg" loading="lazy" alt="" src="https://lh3.googleusercontent.com/d/' + id + '" onerror="this.onerror=null;this.src=\'https://drive.google.com/thumbnail?id=' + id + '&sz=w1000\'">';
  }
  function card(x) {
    var T = TYPES[x.type] || TYPES.notice, h = '<div class="bd ' + x.type + (x.pin ? ' pinned' : '') + '" data-bid="' + esc(x.id) + '">';
    h += '<div class="bdh"><span class="bdi">' + T.icon + '</span><span class="bdt"><b>' + esc(x.title || T.label) + '</b><small>' + esc(T.label) + (x.cls && isTeacher() ? ' · ' + esc(x.cls) : '') + (x.pin ? ' · 📌 pinned' : '') + '</small></span>';
    if (x.type === 'test' && x.date) { var n = left(x.date); h += '<span class="bdc' + (n < 0 ? ' past' : n <= 1 ? ' soon' : '') + '"><b>' + esc(leftText(n)) + '</b><small>' + esc(fmtDate(x.date)) + '</small></span>'; }
    h += '</div>';
    if (x.type !== 'test' && x.date) h += '<div class="bdd">' + esc(fmtDate(x.date)) + '</div>';
    if (x.body) h += '<div class="bdb' + (x.body.length > 240 || x.body.split('\n').length > 6 ? ' clamp' : '') + '">' + esc(x.body) + '</div>' + (x.body.length > 240 || x.body.split('\n').length > 6 ? '<button class="lk bdm" data-b="more">Read more</button>' : '');
    h += mediaHTML(x);
    if (isTeacher()) h += '<div class="bde"><button class="lk" data-b="edit" data-id="' + esc(x.id) + '">Edit</button></div>';
    return h + '</div>';
  }
  function render() {
    var app = document.getElementById('app'), vis = visible(), h = barHTML('Board', isTeacher() ? 'Students see this · only you can edit' : (PEOPLE.me() ? esc(PEOPLE.me().cls || '') : ''), false);
    var counts = {}; vis.forEach(function (x) { counts[x.type] = (counts[x.type] || 0) + 1; });
    var present = ORDER.filter(function (t) { return counts[t]; });
    if (B.filter !== 'all' && !counts[B.filter]) B.filter = 'all';
    if (present.length > 1) h += '<div class="chips2"><button data-b="f" data-v="all" class="' + (B.filter === 'all' ? 'on' : '') + '">All <i>' + vis.length + '</i></button>' + present.map(function (t) { return '<button data-b="f" data-v="' + t + '" class="' + (B.filter === t ? 'on' : '') + '">' + TYPES[t].tab + ' <i>' + counts[t] + '</i></button>'; }).join('') + '</div>';
    if (B.old) h += '<div class="err"><b>' + (isTeacher() ? 'Update the Google script to enable the Board.' : 'The Board isn’t switched on yet.') + '</b> ' + (isTeacher() ? 'Replace Code.gs with Academy-Code-v15 and deploy a new version.' : 'Your teacher needs to finish setting it up.') + '</div>';
    else if (B.err && !vis.length) h += '<div class="err"><b>Couldn’t load the Board.</b> ' + esc(B.err) + '</div><button class="btn wide" data-b="reload">Try again</button>';
    var list = vis.filter(function (x) { return B.filter === 'all' || x.type === B.filter; });
    var tests = list.filter(function (x) { return x.type === 'test'; }).sort(function (a, b) { return (dayOf(a.date) || 9e15) - (dayOf(b.date) || 9e15); });
    var rest = list.filter(function (x) { return x.type !== 'test'; }).sort(function (a, b) { return (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.at - a.at; });
    if (tests.length) h += '<div class="sec">Upcoming tests</div>' + tests.map(card).join('');
    if (rest.length) h += (tests.length ? '<div class="sec">Notices &amp; information</div>' : '') + rest.map(card).join('');
    if (!list.length && !B.old && !(B.err && !vis.length)) h += B.loading && !B.bv ? '<div class="loading"><div class="dots"><i></i><i></i><i></i></div>Loading…</div>' :
      '<div class="empty"><b>Nothing here yet</b>' + (isTeacher() ? 'Tap + to post an upcoming test, the syllabus, the CBSE paper pattern or a notice.' : 'Upcoming tests, syllabus, paper pattern and notices from your teacher will appear here.') + '</div>';
    app.innerHTML = h + '<div style="height:90px"></div>';
    markSeen();
    load(false);
  }

  /* ---------- attaching a photo/video/GIF (Advertisement posts) ---------- */
  var MU = null;   // { tok, pendingInfo, onDone } — the attachment upload currently in flight, if any
  function mediaBodyHTML(x) {
    if (x.media) return '<div class="bdmedia"><span>' + (/^video\//.test(x.media.mime) ? '🎬' : '🖼️') + ' ' + esc(x.media.name || 'Attachment') + '</span><button class="lk" data-sh="rmmedia">Remove</button></div>';
    return '<button class="opt" data-sh="pickmedia"><span class="tile" style="background:var(--yt)">📎</span><span><b>Attach a photo, video or GIF</b><small>Shown with the post</small></span></button>';
  }
  function mediaWrapHTML(x) { return '<div id="bdMediaWrap" style="margin:10px 0">' + mediaBodyHTML(x) + '</div>'; }
  function setMediaWrap(html) { var w = document.getElementById('bdMediaWrap'); if (w) w.innerHTML = html; }
  window.__mediaPicked = function (file) {
    if (!MU) return;
    setMediaWrap('<div class="bdmedia"><span>Uploading… 0%</span></div>');
    apiPost({ a: 'boardupload', name: file.name, mime: file.mime, size: file.size }).then(function (j) {
      if (!MU) return;
      MU.tok = file.tok; MU.pendingInfo = { mime: file.mime, name: file.name };
      window.Android.upload(file.tok, j.uploadUrl);
    }, function (e) {
      var m = MU; MU = null;
      toast('Couldn’t start the upload: ' + e.message);
      if (m) setMediaWrap(mediaBodyHTML(m.x));
    });
  };
  function ownsTok(tok) { return !!(MU && MU.tok === tok); }
  function onUpProgress(tok, sent, total) { if (ownsTok(tok)) setMediaWrap('<div class="bdmedia"><span>Uploading… ' + (total ? Math.round(sent * 100 / total) : 0) + '%</span></div>'); }
  function onUpDone(tok, ok, info) {
    if (!ownsTok(tok)) return;
    var m = MU; MU = null;
    if (ok) { m.x.media = { id: info, mime: m.pendingInfo.mime, name: m.pendingInfo.name }; setMediaWrap(mediaBodyHTML(m.x)); }
    else { toast('Upload failed: ' + info); setMediaWrap(mediaBodyHTML(m.x)); }
  }

  /* ---------- teacher: add / edit ---------- */
  function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function form(x) {
    if (!isTeacher()) return;
    var isNew = !x; x = x || { id: rid(), type: 'test', title: '', body: '', date: '', cls: '', pin: false, media: null };
    var cs = classNames();
    var sheetEl = sheet('<h3>' + (isNew ? 'New post' : 'Edit post') + '</h3>' +
      '<div class="seg wide bdtypes">' + ORDER.map(function (t) { return '<button data-sh="t:' + t + '" class="' + (x.type === t ? 'on' : '') + '">' + TYPES[t].icon + '<small>' + TYPES[t].tab + '</small></button>'; }).join('') + '</div>' +
      '<label class="fl">Title<input id="bdTitle" maxlength="120" value="' + esc(x.title) + '" placeholder="e.g. Unit test 2 – Solutions"></label>' +
      '<div class="two"><label class="fl" id="bdDateL">Date<input type="date" id="bdDate" value="' + esc(x.date) + '"></label>' +
      '<label class="fl">For<select id="bdCls"><option value="">All classes</option>' + cs.map(function (c) { return '<option' + (x.cls === c ? ' selected' : '') + ' value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('') + (x.cls && cs.indexOf(x.cls) < 0 ? '<option selected value="' + esc(x.cls) + '">' + esc(x.cls) + '</option>' : '') + '</select></label></div>' +
      '<label class="fl">Details<textarea id="bdBody" rows="7" maxlength="3000" placeholder="">' + esc(x.body) + '</textarea></label>' +
      '<button class="lk" id="bdTpl" data-sh="tpl" style="display:none">Insert an outline</button>' +
      mediaWrapHTML(x) +
      '<label class="tog" style="display:flex;justify-content:flex-start;gap:8px"><input style="display:inline-block;width:20px;height:20px;margin:0;flex:none" type="checkbox" id="bdPin"' + (x.pin ? ' checked' : '') + '> 📌 Pin to the top</label>' +
      '<button class="btn wide" data-sh="save">' + (isNew ? 'Post' : 'Save changes') + '</button>' +
      (isNew ? '' : '<button class="btn danger wide" data-sh="del">Delete this post</button>'),
      function (act, btn) {
        if (act.indexOf('t:') === 0) { x.type = act.slice(2); sync(); Array.prototype.forEach.call(document.querySelectorAll('.bdtypes button'), function (b) { b.classList.toggle('on', b === btn); }); }
        else if (act === 'tpl') { var ta = document.getElementById('bdBody'); if (ta && TEMPLATE[x.type]) { if (ta.value.trim()) toast('Clear the details first to insert an outline.'); else { ta.value = TEMPLATE[x.type]; ta.focus(); } } }
        else if (act === 'pickmedia') {
          if (!(window.Android && window.Android.pickMedia)) { toast('Attachments work in the Android app.'); return; }
          MU = { x: x, tok: null, pendingInfo: null };
          window.Android.pickMedia();
        }
        else if (act === 'rmmedia') { x.media = null; MU = null; setMediaWrap(mediaBodyHTML(x)); }
        else if (act === 'del') { if (!btn.dataset.armed) { btn.dataset.armed = '1'; btn.textContent = 'Tap again to delete'; return; } closeSheet(); commit(B.items.filter(function (y) { return y.id !== x.id; }), 'Deleted from the Board.'); }
        else if (act === 'save') {
          var title = document.getElementById('bdTitle').value.trim(), body = document.getElementById('bdBody').value.trim();
          if (MU && MU.tok) { toast('Wait for the attachment to finish uploading.'); return; }
          if (!title && !body && !x.media) { toast('Write a title, some details, or attach something first.'); return; }
          var n = { id: x.id, type: x.type, title: title, body: body, date: document.getElementById('bdDate').value || '', cls: document.getElementById('bdCls').value, pin: document.getElementById('bdPin').checked, at: x.at || Date.now(), media: x.media || null };
          if (x.type === 'test' && !n.date) { toast('Pick the date of the test.'); return; }
          closeSheet();
          var list = B.items.slice(), i = list.findIndex(function (y) { return y.id === x.id; });
          if (i >= 0) list[i] = n; else list.unshift(n);
          commit(list, isNew ? 'Posted. Students can see it now.' : 'Saved. Students can see the change.');
        }
      }, function () { MU = null; });
    function sync() {
      var t = TYPES[x.type], ta = document.getElementById('bdBody'), tp = document.getElementById('bdTpl'), dl = document.getElementById('bdDateL');
      if (ta) ta.placeholder = t.hint; if (tp) tp.style.display = TEMPLATE[x.type] ? 'block' : 'none';
      if (dl) dl.firstChild.nodeValue = x.type === 'test' ? 'Date of test' : 'Date (optional)';
    }
    sync();
  }
  function commit(list, msg) {
    var before = { items: B.items, bv: B.bv };
    B.items = list; save(); render();
    apiPost({ a: 'boardsave', items: list }).then(function (j) { apply(j); toast(msg); }, function (e) {
      B.items = before.items; B.bv = before.bv; save(); render();
      toast(/Unknown request|update the Google script/i.test(e.message) ? 'Update the Google script to Academy-Code-v15 first.' : 'Couldn’t save: ' + e.message);
    });
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button[data-b]'); if (!b || S.tab !== 'board' || b.closest('#sheet')) return;
    e.stopPropagation();
    var a = b.dataset.b;
    if (a === 'f') { B.filter = b.dataset.v; render(); window.scrollTo(0, 0); }
    else if (a === 'more') { var c = b.previousElementSibling; if (c) { var open = c.classList.toggle('clamp'); b.textContent = open ? 'Read more' : 'Show less'; } }
    else if (a === 'edit') { var x = B.items.filter(function (y) { return y.id === b.dataset.id; })[0]; if (x) form(x); }
    else if (a === 'reload') { load(true); }
  }, true);

  return { render: render, load: load, apply: apply, add: function () { form(null); }, bv: function () { return B.bv; }, paintDot: paintDot, reset: function () { B.at = 0; },
    ownsTok: ownsTok, onUpProgress: onUpProgress, onUpDone: onUpDone };
})();
