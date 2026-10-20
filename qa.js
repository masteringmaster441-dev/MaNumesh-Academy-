/* Academy – subjective (Q&A) worksheets. The teacher uploads questions with answers; students see the
   question and tap "Show answer". Saved like MCQ worksheets but named "<title>.qa.mcq.json". */
var QA = (function () {
  var E = null, P = null, fileIn = null;

  function getJ(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function setJ(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function norm(s) { return String(s || '').replace(/[  -​　]/g, ' ').replace(/[ \t]+/g, ' ').trim(); }
  function rich(t) { try { return MCQ._rich(t); } catch (e) { return esc(t).replace(/\n/g, '<br>'); } }
  function isQA(f) { return /\.qa\.mcq\.json$/i.test(String(f && f.name || '')); }
  var DRAFT_KEY = 'academy.qadraft';

  /* ================= text → questions & answers ================= */
  var SEP = /^\s*[-–—_*=~]{3,}\s*$/;
  var NUM = /^\s*(?:(Q(?:ue(?:s(?:tion)?)?)?|प्रश्न)\s*\.?\s*(?:no\.?\s*)?)?(\d{1,3})\s*[.):\]\-–]?\s*(.*)$/i;
  // "Ans:", "Answer.", "Sol:", "उत्तर:" (any case) — and a capital "A:" only with a colon, so sub-parts like "a)" stay in the question
  var ANS = /^\s*(?:(?:[Aa][Nn][Ss](?:[Ww][Ee][Rr])?[Ss]?|[Ss][Oo][Ll](?:[Uu][Tt][Ii][Oo][Nn])?[Ss]?|उत्तर|हल)\s*[.:\-–)]|A\s*:)\s*(.*)$/;
  var KEYHDR = /^\s*(?:answers?(?:\s*key)?|answer\s*sheet|solutions?|model\s*answers?|उत्तरमाला|उत्तर\s*कुंजी)\s*[:\-–.]?\s*$/i;
  var QCOLON = /^\s*Q\s*[.:\-–)]\s*(.*)$/i;

  function qStart(line, explicitOnly) {
    var m = line.match(NUM); if (!m) return null;
    if (!m[1] && !/[.):\]\-–]/.test(line.slice(line.indexOf(m[2]) + m[2].length, line.indexOf(m[2]) + m[2].length + 2))) return null;
    if (explicitOnly && !m[1]) return null;
    return { n: Number(m[2]), text: m[3] || '', explicit: !!m[1] };
  }
  function parse(raw) {
    var lines = raw.map(norm).filter(function (l) { return l && !SEP.test(l) && !/^(page\s*)?\d{1,3}(\s*(of|\/)\s*\d{1,3})?$/i.test(l); });
    // "Q: … / A: …" without numbers
    var qc = lines.filter(function (l) { return QCOLON.test(l); }).length;
    if (qc >= 2 && lines.filter(function (l) { return ANS.test(l); }).length >= 1) {
      var out = [], cur = null, inA = false;
      lines.forEach(function (l) {
        var m;
        if ((m = l.match(QCOLON))) { cur = { q: m[1], a: '' }; out.push(cur); inA = false; return; }
        if (cur && (m = l.match(ANS))) { cur.a = m[1]; inA = true; return; }
        if (!cur) return;
        if (inA) cur.a += (cur.a ? '\n' : '') + l; else cur.q += (cur.q ? '\n' : '') + l;
      });
      return tidy(out, lines);
    }
    // answer section at the end
    var keyAt = -1;
    for (var i = lines.length - 1; i > 0; i--) if (KEYHDR.test(lines[i])) { keyAt = i; break; }
    var body = keyAt > 0 ? lines.slice(0, keyAt) : lines, key = keyAt > 0 ? lines.slice(keyAt + 1) : [];
    var explicitOnly = body.filter(function (l) { var s = qStart(l, true); return !!s; }).length >= 2;
    var inline = body.some(function (l) { return ANS.test(l); });
    var qs = [], cur2 = null, last = 0, inAns = false;
    function acceptAt(idx, n) {
      if (!inline) return true;
      // a numbered line is a new question only if an answer marker follows before the next question number
      for (var j = idx + 1; j < Math.min(body.length, idx + 80); j++) {
        if (ANS.test(body[j])) return true;
        var s = qStart(body[j], explicitOnly);
        if (s && (s.n === n || s.n === n + 1)) return false;
      }
      return false;
    }
    body.forEach(function (l, idx) {
      var s = qStart(l, explicitOnly), m;
      var isQ = s && (s.n === last + 1 || (!cur2 && s.n <= 5) || (s.explicit && s.n > last)) && acceptAt(idx, s.n);
      if (isQ) { cur2 = { n: s.n, q: s.text, a: '' }; qs.push(cur2); last = s.n; inAns = false; return; }
      if (!cur2) return;
      if (!inAns && (m = l.match(ANS))) { cur2.a = m[1]; inAns = true; return; }
      if (inAns) cur2.a += (cur2.a ? '\n' : '') + l; else cur2.q += (cur2.q ? '\n' : '') + l;
    });
    if (key.length) {
      var ka = {}, kc = null, kl = 0;
      key.forEach(function (l) {
        var s = qStart(l, false);
        if (s && (s.n === kl + 1 || (!kc && s.n <= 5))) { kc = { n: s.n, a: s.text.replace(ANS, '$1') }; ka[s.n] = kc; kl = s.n; return; }
        if (kc) kc.a += (kc.a ? '\n' : '') + l;
      });
      qs.forEach(function (q) { if (!norm(q.a) && ka[q.n]) q.a = ka[q.n].a; });
    }
    return tidy(qs, lines);
  }
  function tidy(qs, lines) {
    qs = qs.map(function (q) { return { q: String(q.q).trim(), a: String(q.a).trim() }; }).filter(function (q) { return q.q || q.a; });
    // the title can only come from lines above the first question
    var first = 0;
    while (first < lines.length && !qStart(lines[first]) && !QCOLON.test(lines[first])) first++;
    var title = lines.slice(0, first).filter(function (l) {
      return l.length > 3 && l.length < 90 && !ANS.test(l) && !KEYHDR.test(l) && !/^(name|date|class|roll|time|marks|max)\b/i.test(l);
    })[0] || '';
    return { qs: qs, title: title };
  }
  function issues(q) { var o = []; if (!norm(q.q)) o.push('Question is empty'); if (!norm(q.a)) o.push('Answer is empty'); return o; }

  /* ================= helpers ================= */
  function loader(msg) {
    var el = document.getElementById('busyov');
    if (!msg) { if (el) el.parentNode.removeChild(el); return; }
    if (!el) { el = document.createElement('div'); el.id = 'busyov'; document.body.appendChild(el); }
    el.innerHTML = '<div class="bo"><div class="dots"><i></i><i></i><i></i></div><p>' + esc(msg) + '</p></div>';
  }
  function folderOptions(sel) {
    var root = S.tree.rootId, list = [{ id: root, label: 'Main folder' }];
    S.tree.folders.forEach(function (f) { if (!f.pending) list.push({ id: f.id, label: pathOf(f.id).map(function (x) { return x.name; }).join(' › ') }); });
    list.sort(function (a, b) { return a.id === root ? -1 : b.id === root ? 1 : a.label.localeCompare(b.label, undefined, { numeric: true }); });
    return list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('');
  }
  function b64(buf) { var b = new Uint8Array(buf), s = '', C = 0x8000; for (var i = 0; i < b.length; i += C) s += String.fromCharCode.apply(null, b.subarray(i, i + C)); return btoa(s); }
  function getData(f) {
    var c = getJ('academy.q.' + f.id, null);
    if (c && c.mod === f.mod && c.ws) return Promise.resolve(c.ws);
    return apiGet({ a: 'quiz', id: f.id, m: f.mod }).then(function (j) { var ws = JSON.parse(j.data); setJ('academy.q.' + f.id, { mod: f.mod, ws: ws }); return ws; },
      function (e) { if (c && c.ws) return c.ws; throw e; });
  }

  /* ================= teacher: create ================= */
  function create(parent) {
    parent = parent || S.tree.rootId;
    var d = getJ(DRAFT_KEY, null);
    sheet('<h3>New subjective worksheet</h3><p class="note" style="margin-top:-4px">Questions with answers. Students see the question and tap <b>Show answer</b>.</p>' +
      (d && d.qs && d.qs.length ? '<button class="opt" data-sh="draft"><span class="tile k-qa">✎</span><span><b>Continue unfinished worksheet</b><small>' + esc(d.title || 'Untitled') + ' · ' + d.qs.length + ' questions</small></span></button>' : '') +
      '<button class="opt" data-sh="pdf"><span class="tile k-pdf">PDF</span><span><b>From a PDF</b><small>Questions with answers (“Ans:” after each, or an Answers section at the end)</small></span></button>' +
      '<button class="opt" data-sh="paste"><span class="tile k-doc">' + IC.doc + '</span><span><b>Paste text</b><small>Copy questions and answers from anywhere</small></span></button>' +
      '<button class="opt" data-sh="blank"><span class="tile" style="background:var(--accent)">+</span><span><b>Type them myself</b><small>Start with an empty worksheet</small></span></button>', function (act) {
        if (act === 'draft') { closeSheet(); E = d; openEditor(); }
        else if (act === 'pdf') { closeSheet(); pickPdf(parent); }
        else if (act === 'paste') pasteSheet(parent);
        else if (act === 'blank') { closeSheet(); E = { parent: parent, title: '', qs: [{ q: '', a: '' }] }; openEditor(); }
      });
  }
  function pickPdf(parent) {
    if (!fileIn) {
      fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'application/pdf,.pdf'; fileIn.style.display = 'none';
      document.body.appendChild(fileIn);
      fileIn.addEventListener('change', function () {
        var f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
        var r = new FileReader(); loader('Opening PDF…');
        r.onload = function () { readPdf(r.result, f.name, fileIn._parent); };
        r.onerror = function () { loader(); toast('Couldn’t open that file.'); };
        r.readAsArrayBuffer(f);
      });
    }
    fileIn._parent = parent; fileIn.click();
  }
  function readPdf(buf, name, parent) {
    loader('Reading PDF…');
    MCQ.extractPdf(buf, 0, function (p, n) { loader('Reading page ' + p + ' of ' + n + '…'); }).then(function (r) {
      loader();
      var res = parse(r.lines);
      E = { parent: parent, title: res.title || String(name || '').replace(/\.pdf$/i, '').replace(/_+/g, ' '), qs: res.qs, raw: r.lines.join('\n'), buf: buf, via: 'pdf', scanned: r.chars < 60 * r.pages };
      openEditor();
      if (!res.qs.length) toast(E.scanned ? 'This PDF looks scanned. Tap “Use Google OCR”.' : 'No numbered questions found. Check the text the app read.');
    }, function (e) { loader(); toast('Couldn’t read this PDF: ' + (e && e.message || e)); });
  }
  function ocr() {
    if (!E || !E.buf) return;
    if (E.buf.byteLength > 15 * 1024 * 1024) { toast('This PDF is too large for OCR (max 15 MB).'); return; }
    loader('Google is reading the PDF… this can take up to a minute');
    apiPost({ a: 'ocr', b64: b64(E.buf), lang: 'en' }).then(function (j) {
      loader(); var res = parse(String(j.text || '').split(/\r?\n/));
      E.qs = res.qs; E.raw = j.text; E.via = 'ocr'; E.scanned = false; if (!E.title && res.title) E.title = res.title;
      saveDraft(); openEditor();
      toast(res.qs.length ? 'Found ' + res.qs.length + ' questions. Please check them.' : 'Still no questions found.');
    }, function (e) { loader(); toast(e.message); });
  }
  function pasteSheet(parent) {
    sheet('<h3>Paste questions & answers</h3><label class="fl">Text<textarea id="qaPaste" rows="10" placeholder="1. What is photosynthesis?\nAns: The process by which…\n\n2. Define osmosis.\nAns: …"></textarea></label><button class="btn wide" data-sh="ok">Find questions</button>', function (act) {
      if (act !== 'ok') return;
      var t = document.getElementById('qaPaste').value; if (!t.trim()) return;
      closeSheet(); var res = parse(t.split(/\r?\n/));
      E = { parent: parent, title: res.title, qs: res.qs, raw: t, via: 'paste' };
      openEditor();
      if (!res.qs.length) toast('No questions found. Number them 1. 2. 3. and put “Ans:” before each answer.');
    });
  }
  function edit(f) {
    loader('Opening worksheet…');
    getData(f).then(function (ws) { loader(); E = { id: f.id, parent: f.parent, title: ws.title || cleanName(f.name), qs: JSON.parse(JSON.stringify(ws.qs || [])), via: 'edit' }; openEditor(); },
      function (e) { loader(); toast(e.message); });
  }
  var draftT = null;
  function saveDraft() { clearTimeout(draftT); draftT = setTimeout(function () { if (E && !E.id) setJ(DRAFT_KEY, { parent: E.parent, title: E.title, qs: E.qs }); }, 500); }
  function openEditor() { S.mode = 'qaedit'; render(); window.scrollTo(0, 0); }

  function renderPreview() {
    var app = document.getElementById('app');
    var h = '<div class="bar" id="bar"><button class="ib" data-qe="pvx" aria-label="Back to editing">' + IC.back + '</button><h1>Student preview<small>' + E.qs.length + ' question' + (E.qs.length === 1 ? '' : 's') + ' · exactly how students see them</small></h1></div><div class="edwrap">';
    h += '<div class="info"><b>' + esc(E.title || 'Untitled worksheet') + '</b> Students see the question first and tap “Show answer”. Nothing is saved from this screen.</div>';
    E.qs.forEach(function (q, i) {
      h += '<div class="qcard"><div class="rvh"><b>Q' + (i + 1) + '</b></div><div class="qtext">' + rich(q.q) + '</div><div class="ansv"><div class="ansh">Answer</div><div class="anst">' + rich(q.a) + '</div></div></div>';
    });
    h += '<button class="btn wide" data-qe="pvx">Back to editing</button></div>';
    app.innerHTML = h;
  }
  function renderEditor() {
    var app = document.getElementById('app'), bad = 0;
    if (E && E.pv) { renderPreview(); return; }
    E.qs.forEach(function (q) { if (issues(q).length) bad++; });
    var h = '<div class="bar" id="bar"><button class="ib" data-qe="close" aria-label="Close">' + IC.back + '</button><h1>' + (E.id ? 'Edit Q&A worksheet' : 'New Q&A worksheet') + '<small>' + E.qs.length + ' question' + (E.qs.length === 1 ? '' : 's') + '</small></h1><button class="lk" data-qe="pv">👁 Preview</button></div><div class="edwrap">';
    h += '<div class="card"><label class="fl">Title<input data-qf="title" value="' + esc(E.title) + '" maxlength="120" placeholder="e.g. Ch 4 – Short answer questions"></label>' +
      '<label class="fl">Save in<select data-qf="parent">' + folderOptions(E.parent) + '</select></label></div>';
    if (E.via === 'pdf' || E.via === 'ocr' || E.via === 'paste') {
      var withA = E.qs.filter(function (q) { return norm(q.a); }).length;
      h += '<div class="info' + (bad ? ' warn' : '') + '"><b>' + (E.qs.length ? 'Found ' + E.qs.length + ' questions' + (withA < E.qs.length ? ', ' + withA + ' with answers.' : ' with answers.') : 'No questions found.') + '</b> ' +
        (bad ? bad + ' need checking.' : 'Please read through them once.') + '</div>';
      if (E.buf) h += '<div class="tools"><button data-qe="ocr">Text looks wrong? Use Google OCR</button></div>';
      if (E.raw) h += '<details class="raw"><summary>Show the text the app read</summary><pre>' + esc(String(E.raw).slice(0, 20000)) + '</pre></details>';
    }
    E.qs.forEach(function (q, i) {
      var iss = issues(q);
      h += '<div class="qc' + (iss.length ? ' bad' : '') + '" data-qi="' + i + '"><div class="qh"><b>Q' + (i + 1) + '</b><span class="qwarn">' + esc(iss.join(' · ')) + '</span><button class="lk" data-qe="del">Delete</button></div>' +
        '<textarea data-qf="q" rows="2" placeholder="Question">' + esc(q.q) + '</textarea>' +
        '<div class="alabel">Answer (hidden until the student taps Show answer)</div>' +
        '<textarea data-qf="a" rows="3" class="ansbox" placeholder="Answer">' + esc(q.a) + '</textarea></div>';
    });
    h += '<button class="btn ghost wide" data-qe="add">+ Add question</button></div>' +
      '<div class="pubbar"><button class="btn" data-qe="publish"' + (E.qs.length ? '' : ' disabled') + '>' + (E.id ? 'Save changes' : 'Publish worksheet') + '</button></div>';
    app.innerHTML = h;
    Array.prototype.forEach.call(app.querySelectorAll('textarea[data-qf]'), grow);
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  function qOf(el) { var c = el.closest('[data-qi]'); return c ? E.qs[Number(c.dataset.qi)] : null; }
  function leave(force) {
    if (!force && !E.id && E.qs.some(function (q) { return norm(q.q) || norm(q.a); })) {
      sheet('<h3>Leave the worksheet?</h3><p class="note" style="margin-top:0">It’s saved as a draft on this phone. Continue it from + → Subjective worksheet.</p><button class="btn wide" data-sh="ok">Leave</button>',
        function (act) { if (act === 'ok') { closeSheet(); setJ(DRAFT_KEY, { parent: E.parent, title: E.title, qs: E.qs }); leave(true); } });
      return;
    }
    E = null; S.mode = 'browse'; render(); window.scrollTo(0, 0);
  }
  function publish(btn) {
    var title = norm(E.title);
    if (!title) { toast('Please give the worksheet a title.'); window.scrollTo(0, 0); var t = document.querySelector('[data-qf="title"]'); if (t) t.focus(); return; }
    var qs = E.qs.map(function (q) { return { q: String(q.q || '').trim(), a: String(q.a || '').trim() }; }).filter(function (q) { return q.q || q.a; });
    var bad = qs.filter(function (q) { return issues(q).length; }).length;
    if (!qs.length) { toast('Add at least one question.'); return; }
    if (bad) { E.qs = qs; renderEditor(); toast(bad + ' question' + (bad > 1 ? 's need' : ' needs') + ' fixing before publishing.'); var b = document.querySelector('.qc.bad'); if (b) b.scrollIntoView({ block: 'center' }); return; }
    var ws = { v: 1, type: 'qa', title: title, qs: qs, at: Date.now() };
    busy(btn, true, 'Saving…');
    var oldId = E.id;
    saveSafely({ a: 'savequiz', id: E.id || '', parent: E.parent, name: title.replace(/[\\/]/g, '-') + '.qa.mcq.json', data: JSON.stringify(ws), count: qs.length }, btn).then(function (j) {
      S.tree.files = S.tree.files.filter(function (x) { return x.id !== j.item.id; }); S.tree.files.push(j.item);
      setJ('academy.q.' + j.item.id, { mod: j.item.mod, ws: ws });
      if (!oldId) setJ(DRAFT_KEY, null);
      var parent = j.item.parent;
      E = null; S.mode = 'browse'; rebuild(); saveTree();
      if (S.tab === 'ws') { S.wsStack = [S.tree.rootId].concat(parent === S.tree.rootId ? [] : pathOf(parent).map(function (x) { return x.id; })); render(); }
      else if (S.idx.folder[parent]) goFolder(parent); else { S.stack = [S.tree.rootId]; render(); }
      toast(oldId ? 'Worksheet saved.' : 'Worksheet published. Students can see it now.');
    }).catch(function (e) { if (S.mode === 'qaedit') { busy(btn, false); toast(e.message); } });
  }

  /* ================= student: question → Show answer ================= */
  function open(f) {
    P = { f: f, stage: 'loading', cur: 0, shown: {}, mark: {}, t0: Date.now() };
    S.mode = 'qa'; render(); window.scrollTo(0, 0);
    getData(f).then(function (ws) {
      if (!P || P.f !== f) return;
      P.ws = ws; P.stage = 'q'; P.order = ws.qs.map(function (_, i) { return i; }); render();
    }, function (e) { if (!P || P.f !== f) return; P.stage = 'error'; P.err = e.message; render(); });
  }
  function head(title, right) {
    return '<div class="bar qbar" id="bar"><button class="ib" data-qa="exit" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h1>' + esc(title) + '</h1>' + (right || '') + '</div>';
  }
  function renderPlayer() {
    var app = document.getElementById('app'), ws = P.ws, h;
    if (P.stage === 'loading') { app.innerHTML = head(cleanName(P.f.name)) + '<div class="loading"><div class="dots"><i></i><i></i><i></i></div>Opening worksheet…</div>'; return; }
    if (P.stage === 'error') { app.innerHTML = head(cleanName(P.f.name)) + '<div class="err"><b>Couldn’t open the worksheet.</b> ' + esc(P.err) + '</div><button class="btn wide" data-qa="reload">Try again</button>'; return; }
    var n = P.order.length;
    if (P.stage === 'done') {
      var k = 0, r = 0;
      P.order.forEach(function (i) { if (P.mark[i] === 'k') k++; else if (P.mark[i] === 'r') r++; });
      h = head(cleanName(P.f.name) || ws.title) + '<div class="result"><div class="qadone">✓</div><h2>Worksheet finished</h2>' +
        '<div class="stats3"><div><b class="g">' + k + '</b><span>I knew it</span></div><div><b class="r">' + r + '</b><span>need to revise</span></div><div><b>' + (n - k - r) + '</b><span>not marked</span></div></div>' +
        (r ? '<button class="btn wide" data-qa="revise">Revise the ' + r + ' I marked</button>' : '') +
        '<button class="btn ghost wide" data-qa="again">Start again</button><button class="btn ghost wide" data-qa="exit">Close</button></div>';
      app.innerHTML = h; return;
    }
    var qi = P.order[P.cur], q = ws.qs[qi], shown = !!P.shown[qi], mk = P.mark[qi];
    var seenN = Object.keys(P.shown).length;
    h = head('Question ' + (P.cur + 1) + ' of ' + n, '<button class="ib" data-qa="list" aria-label="All questions"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg></button>') +
      '<div class="qprog"><i style="width:' + Math.round(seenN * 100 / n) + '%"></i></div>' +
      '<div class="qcard" id="qacard"><div class="qtext">' + rich(q.q) + '</div>';
    if (!shown) h += '<button class="btn wide big showans" data-qa="show">Show answer</button><p class="note" style="text-align:center">Think of your answer first, then check.</p>';
    else {
      h += '<div class="ansv"><div class="ansh">Answer</div><div class="anst">' + rich(q.a) + '</div></div>' +
        '<button class="lk hideans" data-qa="hide">Hide answer</button>' +
        (isTeacher() ? '' : '<button class="lk rpt" data-qa="rpt">' + (PEOPLE.isFlagged(P.f, qi) ? '⚑ Reported' : '⚑ Report wrong answer') + '</button>') +
        '<div class="selfchk"><span>How did you do?</span><div class="two"><button class="btn ghost' + (mk === 'k' ? ' on' : '') + '" data-qa="k">✓ I knew it</button><button class="btn ghost' + (mk === 'r' ? ' onr' : '') + '" data-qa="r">↻ Revise again</button></div></div>';
    }
    h += '</div><div class="qnav"><button class="btn ghost nb" data-qa="prev"' + (P.cur ? '' : ' disabled') + ' aria-label="Previous question"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>Previous</span></button>' +
      '<button class="btn ghost sq" data-qa="list" aria-label="All questions"><b>' + seenN + '</b>/' + n + '</button>' +
      (P.cur + 1 < n ? '<button class="btn nb" data-qa="next" aria-label="Next question"><span>Next</span><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>' : '<button class="btn nb" data-qa="finish"><span>Finish</span></button>') + '</div>';
    app.innerHTML = h;
  }
  function go(i, dir) {
    if (i < 0 || i >= P.order.length) return;
    P.cur = i; render(); window.scrollTo(0, 0);
    var c = document.getElementById('qacard'); if (c && dir) c.classList.add(dir > 0 ? 'fwd' : 'bwd');
  }
  function listSheet() {
    var n = P.order.length;
    var body = '<div class="qgrid">' + P.order.map(function (x, i) {
      var cls = P.mark[x] === 'k' ? 'r' : P.mark[x] === 'r' ? 'w' : P.shown[x] ? 'd' : '';
      return '<button data-sh="g' + i + '" class="' + cls + (i === P.cur ? ' cur' : '') + '" aria-label="Question ' + (i + 1) + '">' + (i + 1) + '</button>';
    }).join('') + '</div>';
    var bg = sheet('<div class="qlh"><h3>All questions</h3></div><div class="legend"><span><i class="lg r"></i>Knew it</span><span><i class="lg w"></i>Revise</span><span><i class="lg d"></i>Answer seen</span><span><i class="lg"></i>Not seen</span></div>' +
      '<div class="qlbody">' + body + '</div><button class="btn ghost wide" data-sh="all">' + (n && Object.keys(P.shown).length === n ? 'Hide all answers' : 'Show all answers') + '</button><button class="btn wide" data-sh="fin">Finish worksheet</button>', function (act) {
        if (act === 'fin') { closeSheet(); finish(); return; }
        if (act === 'all') { var allShown = Object.keys(P.shown).length === n; P.shown = {}; if (!allShown) P.order.forEach(function (x) { P.shown[x] = 1; }); closeSheet(); render(); return; }
        if (act.charAt(0) === 'g') { closeSheet(); go(Number(act.slice(1)), 0); }
      });
    if (bg) bg.classList.add('qsheet');
  }
  function finish() {
    var n = P.order.length, k = 0, r = 0;
    P.order.forEach(function (i) { if (P.mark[i] === 'k') k++; else if (P.mark[i] === 'r') r++; });
    if (!P.revising && (k + r) > 0) {
      // record the self-check like a score, so it shows in progress
      var res = { right: k, wrong: r, skip: n - k - r, secs: Math.round((Date.now() - P.t0) / 1000) };
      var all = getJ('academy.scores', {}), s = all[P.f.id] || { best: 0, tries: 0 };
      s.last = k; s.total = n; s.tries++; s.at = Date.now(); if (k > s.best) s.best = k; all[P.f.id] = s; setJ('academy.scores', all);
      try { PEOPLE.trackResult(P.f, P.ws, res, n, 'practice'); } catch (e) { }
    }
    P.stage = 'done'; render(); window.scrollTo(0, 0);
  }
  function exit() { P = null; S.mode = 'browse'; render(); window.scrollTo(0, 0); }

  /* ================= events ================= */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('button'); if (!b || b.closest('#sheet')) return;
    if (S.mode === 'qaedit' && b.dataset.qe) {
      e.stopPropagation(); var a = b.dataset.qe, q = qOf(b);
      if (a === 'close') leave();
      else if (a === 'pv') { E.pv = true; renderEditor(); window.scrollTo(0, 0); }
      else if (a === 'pvx') { E.pv = false; var yy2 = window.scrollY; renderEditor(); window.scrollTo(0, yy2); }
      else if (a === 'add') { E.qs.push({ q: '', a: '' }); renderEditor(); saveDraft(); setTimeout(function () { var ts = document.querySelectorAll('textarea[data-qf="q"]'); var t = ts[ts.length - 1]; if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); } }, 50); }
      else if (a === 'del') { if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; } var y = window.scrollY; E.qs.splice(E.qs.indexOf(q), 1); renderEditor(); window.scrollTo(0, y); saveDraft(); }
      else if (a === 'ocr') ocr();
      else if (a === 'publish') publish(b);
      return;
    }
    if (S.mode === 'qa' && b.dataset.qa && P) {
      e.stopPropagation(); var x = b.dataset.qa, qi = P.order ? P.order[P.cur] : 0, yy = window.scrollY;
      if (x === 'exit') exit();
      else if (x === 'reload') open(P.f);
      else if (x === 'show') { P.shown[qi] = 1; render(); window.scrollTo(0, yy); setTimeout(function () { var a2 = document.querySelector('.ansv'); if (a2 && a2.getBoundingClientRect().bottom > window.innerHeight - 90) a2.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 30); }
      else if (x === 'hide') { delete P.shown[qi]; render(); window.scrollTo(0, yy); }
      else if (x === 'k' || x === 'r') { P.mark[qi] = P.mark[qi] === x ? undefined : x; if (!P.mark[qi]) delete P.mark[qi]; render(); window.scrollTo(0, yy); if (P.mark[qi] && P.cur + 1 < P.order.length) setTimeout(function () { go(P.cur + 1, 1); }, 350); }
      else if (x === 'next') go(P.cur + 1, 1);
      else if (x === 'prev') go(P.cur - 1, -1);
      else if (x === 'rpt') PEOPLE.flagSheet(P.f, qi, { q: P.ws.qs[qi].q, marked: P.ws.qs[qi].a }, function () { render(); window.scrollTo(0, yy); });
      else if (x === 'list') listSheet();
      else if (x === 'finish') finish();
      else if (x === 'again') { P.cur = 0; P.shown = {}; P.mark = {}; P.revising = false; P.order = P.ws.qs.map(function (_, i) { return i; }); P.stage = 'q'; P.t0 = Date.now(); render(); }
      else if (x === 'revise') { var m = P.order.filter(function (i) { return P.mark[i] === 'r'; }); P.order = m; P.cur = 0; P.shown = {}; P.mark = {}; P.revising = true; P.stage = 'q'; render(); }
    }
  }, true);
  document.addEventListener('input', function (e) {
    if (S.mode !== 'qaedit' || !E) return;
    var t = e.target, f = t.dataset.qf; if (!f) return;
    if (f === 'title') E.title = t.value;
    else { var q = qOf(t); if (!q) return; q[f] = t.value; grow(t); var c = t.closest('[data-qi]'), iss = issues(q); c.classList.toggle('bad', !!iss.length); c.querySelector('.qwarn').textContent = iss.join(' · '); }
    saveDraft();
  });
  document.addEventListener('change', function (e) { if (S.mode === 'qaedit' && E && e.target.dataset.qf === 'parent') { E.parent = e.target.value; saveDraft(); } });
  // swipe between questions
  var sw = null;
  document.addEventListener('touchstart', function (e) { sw = null; if (S.mode !== 'qa' || !P || P.stage !== 'q' || e.touches.length !== 1 || document.getElementById('sheet')) return; if (!e.target.closest('#qacard')) return; sw = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }; }, { passive: true });
  document.addEventListener('touchend', function (e) { if (!sw) return; var t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y, dt = Date.now() - sw.t; sw = null; if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 700) return; go(P.cur + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1); }, { passive: true });

  return {
    isQA: isQA, parse: parse, create: create, edit: edit, open: open,
    render: function () { if (S.mode === 'qaedit') renderEditor(); else renderPlayer(); },
    onBack: function () {
      if (S.mode === 'qa') { if (P && P.stage === 'q' && P.cur > 0) { go(P.cur - 1, -1); return true; } exit(); return true; }
      if (S.mode === 'qaedit') { if (E && E.pv) { E.pv = false; renderEditor(); return true; } leave(); return true; }
      return false;
    },
    _state: function () { return { E: E, P: P }; }
  };
})();
