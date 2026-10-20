/* Academy – MCQ worksheets: PDF reading, question detection, editor and quiz player. */
var MCQ = (function () {
  var LET = ['A', 'B', 'C', 'D', 'E'];
  var HINDI = ['क', 'ख', 'ग', 'घ', 'ङ'];
  var SCORE_KEY = 'academy.scores', DRAFT_KEY = 'academy.wsdraft';

  function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ================= maths (LaTeX) ================= */
  var SEP = /^\s*[-–—_*=~]{3,}\s*$/;
  function clean(t) {
    t = String(t == null ? '' : t);
    t = t.split('\n').filter(function (l) { return !SEP.test(l); }).join('\n');
    return t.replace(/\s+[-–—_=~]{3,}\s*$/, '').replace(/^\s*[-–—_=~]{3,}\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
  }
  var HAS_TEX = /\\[a-zA-Z]+|\\[,;:!{}]|[\^_]\{|[a-zA-Z0-9)\]}][\^_][a-zA-Z0-9]/;
  /* the maths renderer (~1.3 MB with fonts) is loaded only when a worksheet needs it */
  var katexReady = null;
  function loadKatex() {
    if (window.katex) return Promise.resolve();
    if (!katexReady) katexReady = new Promise(function (res) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'katex/katex.min.css'; document.head.appendChild(l);
      loadScript('katex/katex.min.js').then(function () { return loadScript('katex/mhchem.min.js'); }).then(res, res);
    });
    return katexReady;
  }
  function needsTex(ws) { return (ws.qs || []).some(function (q) { return hasMath(q.q) || hasMath(q.e) || q.o.some(hasMath); }); }
  function tex(src, display) {
    if (!window.katex) { loadKatex().then(function () { if (S.mode === 'quiz' || S.mode === 'edit' || S.mode === 'qa' || S.mode === 'qaedit') { var y = window.scrollY; render(); window.scrollTo(0, y); } }); return esc(src); }
    try {
      if (!display && /\\(?:d?frac|binom|sqrt\[)/.test(src) && !/\\(?:begin|displaystyle|textstyle)/.test(src)) src = '\\displaystyle ' + src;
      return window.katex.renderToString(src, { displayMode: !!display, throwOnError: false, strict: 'ignore', trust: false, output: 'html', maxExpand: 500 });
    } catch (e) { return esc(src); }
  }
  /* split text into plain and maths pieces using \( \), \[ \], $$ $$, $ $ and \begin{..}..\end{..} */
  function pieces(t) {
    var out = [], i = 0, plain = '';
    function flush() { if (plain) { out.push({ t: plain }); plain = ''; } }
    while (i < t.length) {
      var c = t.charAt(i), two = t.substr(i, 2), m;
      if (two === '\\(' || two === '\\[') {
        var close = two === '\\(' ? '\\)' : '\\]', j = t.indexOf(close, i + 2);
        if (j > i) { flush(); out.push({ m: t.slice(i + 2, j), d: two === '\\[' }); i = j + 2; continue; }
      }
      if (two === '$$') {
        var k = t.indexOf('$$', i + 2);
        if (k > i + 2) { flush(); out.push({ m: t.slice(i + 2, k), d: true }); i = k + 2; continue; }
      }
      if (c === '$' && t.charAt(i - 1) !== '\\') {
        var e = i + 1;
        while ((e = t.indexOf('$', e)) > 0 && t.charAt(e - 1) === '\\') e++;
        var inner = e > 0 ? t.slice(i + 1, e) : '';
        if (e > i + 1 && !/^\s/.test(inner) && !/\s$/.test(inner) && !/^\d/.test(t.charAt(e + 1)) && inner.indexOf('\n') < 0) {
          flush(); out.push({ m: inner, d: false }); i = e + 1; continue;
        }
      }
      if (c === '\\' && (m = /^\\begin\{([a-zA-Z*]+)\}/.exec(t.slice(i)))) {
        var endTag = '\\end{' + m[1] + '}', q = t.indexOf(endTag, i);
        if (q > i) { flush(); out.push({ m: t.slice(i, q + endTag.length), d: true }); i = q + endTag.length; continue; }
      }
      plain += c; i++;
    }
    flush();
    return out;
  }
  /* bare text: keep the spaces and set words of 2+ letters (units like mol, cm) upright */
  function upright(t) {
    if (/\\(?:ce|pu|text|mathrm|operatorname|mbox)\b/.test(t)) return t;
    return t.replace(/\\[a-zA-Z]+|[a-zA-Z]{2,}|\s+/g, function (m) {
      if (m.charAt(0) === '\\') return m;
      if (/^\s+$/.test(m)) return '\\ ';
      return '\\mathrm{' + m + '}';
    });
  }
  /* LaTeX typed without any $ or \( \): render the maths-looking runs */
  function bare(t) {
    var words = t.replace(/\\[a-zA-Z]+/g, ' ').replace(/\{[^{}]*\}/g, ' ').match(/[A-Za-zऀ-ॿ]{3,}/g) || [];
    if (words.length <= 2 && t.indexOf('\n') < 0) return tex(upright(t), false);
    var toks = t.split(/(\s+)/), out = '', buf = '', depth = 0;
    function put() {
      if (!buf) return;
      out += HAS_TEX.test(buf) ? tex(buf, false) : esc(buf);
      buf = '';
    }
    toks.forEach(function (tk) {
      if (/^\s+$/.test(tk)) { if (depth > 0) buf += tk; else { put(); out += /\n/.test(tk) ? '<br>' : ' '; } return; }
      var mathy = HAS_TEX.test(tk) || depth > 0;
      if (!mathy) { put(); out += esc(tk); return; }
      buf += tk;
      depth += (tk.match(/\{/g) || []).length - (tk.match(/\}/g) || []).length;
      if (depth < 0) depth = 0;
    });
    put();
    return out;
  }
  /* text -> safe HTML with formulas drawn */
  function rich(t) {
    t = clean(t);
    if (!t) return '';
    var ps = pieces(t);
    if (ps.length === 1 && ps[0].t !== undefined) return HAS_TEX.test(t) ? bare(t) : esc(t).replace(/\n/g, '<br>');
    return ps.map(function (p) {
      if (p.m !== undefined) return p.d ? '<span class="mdisp">' + tex(p.m, true) + '</span>' : tex(p.m, false);
      return HAS_TEX.test(p.t) ? bare(p.t) : esc(p.t).replace(/\n/g, '<br>');
    }).join('');
  }
  function hasMath(t) { t = String(t || ''); return /\\\(|\\\[|\$/.test(t) || HAS_TEX.test(t); }

  function norm(s) { return String(s || '').replace(/[  -​　]/g, ' ').replace(/[ \t]+/g, ' ').trim(); }

  /* ================= PDF → lines ================= */
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res;
      s.onerror = function () { rej(new Error('Could not load the PDF reader')); };
      document.head.appendChild(s);
    });
  }
  var pdfReady = null;
  function loadPdfJs() {
    if (!pdfReady) pdfReady = loadScript('pdfjs/pdf.worker.min.js').then(function () { return loadScript('pdfjs/pdf.min.js'); })
      .then(function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs/pdf.worker.min.js'; });
    return pdfReady;
  }

  function pageLines(items, W, cols) {
    var its = [];
    items.forEach(function (it) {
      if (!it.str || !it.transform) return;
      its.push({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || Math.abs(it.height) || 10 });
    });
    var mid = W / 2, left = 0, right = 0, cross = 0;
    its.forEach(function (it) {
      if (!it.s.trim()) return;
      if (it.x + it.w < mid - 4) left++; else if (it.x >= mid - 4) right++;
      if (it.x < mid - 20 && it.x + it.w > mid + 20) cross++;
    });
    var n = left + right, two = n > 20 && left > n * 0.25 && right > n * 0.25 && cross < n * 0.06;
    if (cols === 1) two = false; if (cols === 2) two = true;
    var groups = [its];
    if (two) {
      var isCross = function (i) { return i.x < mid - 20 && i.x + i.w > mid + 20; };
      var colItems = its.filter(function (i) { return !isCross(i); });
      var top = -1e9, bot = 1e9;
      colItems.forEach(function (i) { if (i.s.trim()) { if (i.y > top) top = i.y; if (i.y < bot) bot = i.y; } });
      var cross = its.filter(isCross);
      groups = [cross.filter(function (i) { return i.y >= top; }),
        colItems.filter(function (i) { return i.x < mid - 2; }).concat(cross.filter(function (i) { return i.y < top && i.y > bot; })),
        colItems.filter(function (i) { return i.x >= mid - 2; }),
        cross.filter(function (i) { return i.y <= bot && i.y < top; })];
    }
    var out = [];
    groups.forEach(function (g) {
      g.sort(function (a, b) { return Math.abs(b.y - a.y) > 0.5 ? b.y - a.y : a.x - b.x; });
      var lines = [], cur = null;
      g.forEach(function (it) {
        if (!cur || Math.abs(it.y - cur.y) > Math.max(2, Math.min(it.h, cur.h) * 0.45)) { cur = { y: it.y, h: it.h, items: [] }; lines.push(cur); }
        cur.items.push(it);
      });
      lines.forEach(function (l) {
        l.items.sort(function (a, b) { return a.x - b.x; });
        var s = '', end = null;
        l.items.forEach(function (it) {
          if (end !== null && it.x - end > it.h * 0.15 && !/\s$/.test(s) && !/^\s/.test(it.s)) s += ' ';
          s += it.s; end = it.x + it.w;
        });
        s = norm(s);
        if (s) out.push(s);
      });
    });
    return { lines: out, two: two };
  }

  function extractPdf(buf, cols, onProg) {
    return loadPdfJs().then(function () {
      return window.pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)), disableFontFace: true, isEvalSupported: false }).promise;
    }).then(function (doc) {
      var pages = [], twoAny = false, chain = Promise.resolve();
      for (var p = 1; p <= doc.numPages; p++) (function (p) {
        chain = chain.then(function () {
          if (onProg) onProg(p, doc.numPages);
          return doc.getPage(p).then(function (pg) {
            var vp = pg.getViewport({ scale: 1 });
            return pg.getTextContent().then(function (tc) { var r = pageLines(tc.items, vp.width, cols); if (r.two) twoAny = true; pages.push(r.lines); });
          });
        });
      })(p);
      return chain.then(function () {
        // drop repeating headers / footers and bare page numbers
        var freq = {}, key = function (l) { return l.replace(/\d+/g, '#').toLowerCase(); };
        if (pages.length >= 3) pages.forEach(function (ls) {
          var seen = {};
          ls.slice(0, 2).concat(ls.slice(-2)).forEach(function (l) { var k = key(l); if (!seen[k]) { seen[k] = 1; freq[k] = (freq[k] || 0) + 1; } });
        });
        var lines = [], chars = 0;
        pages.forEach(function (ls) {
          ls.forEach(function (l, i) {
            if (/^(page\s*)?\d{1,3}(\s*(of|\/)\s*\d{1,3})?$/i.test(l)) return;
            if ((i < 2 || i >= ls.length - 2) && freq[key(l)] >= Math.max(3, pages.length * 0.5)) return;
            lines.push(l); chars += l.length;
          });
        });
        return { lines: lines, pages: doc.numPages, chars: chars, two: twoAny };
      });
    });
  }

  /* ================= text → questions ================= */
  var KEYHDR = /^\s*(?:final\s+)?(answer\s*keys?|answers?(?:\s*sheet)?|keys?|solutions?|hints?\s*(?:&|and)\s*solutions?|उत्तर\s*(?:कुंजी|माला|तालिका)|उत्तरमाला|उत्तर)\s*[:\-–.]?\s*(.*)$/i;
  var QRE_P = /^\s*(?:Q(?:ue(?:s(?:tion)?)?)?|प्रश्न)\s*\.?\s*(?:no\.?\s*)?(\d{1,3})\s*(?:[.):\]\-–]\s*)?(.*)$/i;
  var QRE = /^\s*(\d{1,3})\s*([.):\]\-–])\s*(\S.*)?$/;
  var ANSRE = /(^|\n|\s)(?:ans(?:wer)?|correct\s+(?:answer|option)|right\s+answer|सही\s+उत्तर|उत्तर)\s*(?:is)?\s*[.:\-–=)]*\s*(?:option\s*)?[(\[]?\s*([a-eA-E1-5]|[कखगघङ])\s*[)\]]?(?=[\s.,;]|$)/i;
  var EXPRE = /(^|\n)\s*(?:explanation|solution|sol|hint|reason|व्याख्या|हल)\s*[.:\-–]/i;

  function letterIdx(t) {
    t = String(t).trim();
    var i = 'abcde'.indexOf(t.toLowerCase()); if (i >= 0) return i;
    if (/^[1-5]$/.test(t)) return Number(t) - 1;
    return HINDI.indexOf(t);
  }

  function keyPairs(text) {
    var out = [], m, re = /(?:^|[\s,;|(\[])(?:Q\.?\s*)?(\d{1,3})\s*[.):\-–=]?\s*[(\[]?\s*([a-eA-E]|[कखगघङ]|[1-5](?=\s*[)\]]))\s*[)\]]?(?=$|[\s,;|.])/g;
    while ((m = re.exec(text))) out.push({ n: Number(m[1]), a: letterIdx(m[2]), at: m.index, end: re.lastIndex });
    if (out.length < 2) {
      var out2 = [], re2 = /(?:^|[\s,;|])(\d{1,3})\s*[.):\-–=]\s*([1-5])(?=$|[\s,;|])/g;
      while ((m = re2.exec(text))) out2.push({ n: Number(m[1]), a: Number(m[2]) - 1, at: m.index, end: re2.lastIndex });
      if (out2.length > out.length) out = out2;
    }
    return out;
  }

  function parseKey(lines) {
    var pairs = [], solMode = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      var toks = l.split(/\s+/), nxt = lines[i + 1] ? lines[i + 1].split(/\s+/) : [];
      // table style: "1 2 3 4" then "b c a d"
      var numRow = toks.length >= 2 && toks.every(function (t) { return /^\d{1,3}$/.test(t); });
      var seqRow = function (ts) { return ts.every(function (t, k) { return k === 0 || Number(t) === Number(ts[k - 1]) + 1; }); };
      var letRow = nxt.length === toks.length && nxt.every(function (t) { return /^[(\[]?([a-eA-E]|[कखगघ])[)\]]?$/.test(t); });
      var digRow = nxt.length === toks.length && nxt.every(function (t) { return /^[(\[]?[1-5][)\]]?$/.test(t); }) &&
        !(seqRow(nxt) && Number(nxt[0]) === Number(toks[toks.length - 1]) + 1);
      if (numRow && seqRow(toks) && (letRow || digRow)) {
        toks.forEach(function (t, k) { pairs.push({ n: Number(t), a: letterIdx(nxt[k].replace(/[()\[\]]/g, '')), e: '' }); });
        i++; continue;
      }
      var ps = keyPairs(l);
      if (ps.length === 1 && l.length - ps[0].end > 12) {
        pairs.push({ n: ps[0].n, a: ps[0].a, e: l.slice(ps[0].end).replace(/^[\s.:\-–)]+/, '') }); solMode = true; continue;
      }
      if (ps.length) { ps.forEach(function (p) { pairs.push({ n: p.n, a: p.a, e: '' }); }); solMode = false; continue; }
      if (solMode && pairs.length) pairs[pairs.length - 1].e += ' ' + l;
    }
    return pairs;
  }

  function markerList(set, k) {
    var e = rx(k);
    if (set === 'num') return [new RegExp('(^|\\s)[(\\[]' + e + '[)\\]]', 'g'), new RegExp('(^|\\n)\\s*' + e + '\\)(?=\\s)', 'g')];
    if (set === 'hindi') return [new RegExp('(^|\\s)[(\\[]' + e + '[)\\]]', 'g'), new RegExp('(^|\\s)' + e + '[).](?=\\s)', 'g')];
    return [new RegExp('(^|\\s)[(\\[]' + e + '[)\\]]', 'g'), new RegExp('(^|\\s)' + e + '\\)(?=\\s)', 'g'), new RegExp('(^|\\n)\\s*' + e + '\\.(?=\\s)', 'g')];
  }
  function findMarker(text, set, k, from) {
    var best = null;
    markerList(set, k).forEach(function (re) {
      re.lastIndex = from; var m = re.exec(text);
      if (m) { var at = m.index + m[1].length; while (/\s/.test(text.charAt(at))) at++; var end = m.index + m[0].length; if (!best || at < best.at) best = { at: at, end: end }; }
    });
    return best;
  }
  var SETS = [{ n: 'lower', k: ['a', 'b', 'c', 'd', 'e'] }, { n: 'upper', k: ['A', 'B', 'C', 'D', 'E'] }, { n: 'num', k: ['1', '2', '3', '4', '5'] }, { n: 'hindi', k: HINDI }];

  function splitOptions(text) {
    var best = null;
    SETS.forEach(function (set) {
      var from = 0, tries = 0;
      while (tries++ < 6) {
        var first = findMarker(text, set.n, set.k[0], from);
        if (!first) break;
        var ms = [first], pos = first.end;
        for (var j = 1; j < set.k.length; j++) { var m = findMarker(text, set.n, set.k[j], pos); if (!m) break; ms.push(m); pos = m.end; }
        if (ms.length >= 2 && (!best || ms.length > best.ms.length || (ms.length === best.ms.length && set === best.set && first.at > best.ms[0].at))) best = { set: set, ms: ms };
        from = first.end;
      }
    });
    if (!best) return { stem: text, o: [] };
    var o = best.ms.map(function (m, i) { return clean(norm(text.slice(m.end, i + 1 < best.ms.length ? best.ms[i + 1].at : text.length).replace(/\n/g, ' '))); });
    return { stem: text.slice(0, best.ms[0].at), o: o };
  }

  function tidyStem(s) {
    var lines = s.split('\n').map(norm).filter(Boolean), out = '';
    lines.forEach(function (l, i) {
      if (i === 0) { out = l; return; }
      var listy = /^(?:\(?[ivx]{1,4}[).]|\(?\d\)|statement|assertion|reason|column|list|[A-D]\s*[-–:.]\s|[•●▪-]\s)/i.test(l);
      out += (listy ? '\n' : ' ') + l;
    });
    return out;
  }

  function parse(rawLines) {
    var lines = rawLines.map(norm).filter(function (l) { return l && !SEP.test(l); });
    // 1. answer key section (last header-like line followed by number–answer pairs)
    var keyStart = -1;
    for (var i = lines.length - 1; i >= 0; i--) {
      var h = lines[i].match(KEYHDR);
      if (!h) continue;
      var rest = h[2] || '';
      if (rest && keyPairs(rest).length < 2) continue;
      if (parseKey((rest ? [rest] : []).concat(lines.slice(i + 1))).length >= 2) { keyStart = i; break; }
    }
    var body = keyStart >= 0 ? lines.slice(0, keyStart) : lines;
    var keyLines = [];
    if (keyStart >= 0) { var hh = lines[keyStart].match(KEYHDR); if (hh[2]) keyLines.push(hh[2]); keyLines = keyLines.concat(lines.slice(keyStart + 1)); }
    var key = parseKey(keyLines);

    // 2. split body into question blocks
    var blocks = [], cur = null, pre = [], last = 0;
    function curOpts() { return cur ? splitOptions(cur.lines.join('\n')).o.length : 0; }
    body.forEach(function (l) {
      var m = l.match(QRE_P), explicit = true, num, text, sep = '';
      if (!m) { explicit = false; m = l.match(QRE); if (m) { num = Number(m[1]); sep = m[2]; text = m[3] || ''; } }
      else { num = Number(m[1]); text = m[2] || ''; }
      var isQ = false;
      if (m) {
        if (!cur) isQ = num <= 5 || explicit;
        else if (num === last + 1) {
          isQ = true;
          if (sep === ')' && curOpts() < 4 && cur.lines.some(function (x) { return /^\s*1\)/.test(x); })) isQ = false;
        }
        else if (num === 1 && curOpts() >= 2) isQ = true;
        else if (num > last + 1 && num <= last + 4 && curOpts() >= 2 && (explicit || text.length > 3)) isQ = true;
      }
      if (isQ) { cur = { n: num, lines: [text] }; blocks.push(cur); last = num; }
      else if (cur) cur.lines.push(l);
      else pre.push(l);
    });

    // 3. each block → question, options, inline answer, explanation
    var qs = blocks.map(function (b) {
      var text = b.lines.join('\n').trim(), a = -1, e = '';
      var am = text.match(ANSRE);
      if (am) {
        var idx = am.index + am[1].length;
        a = letterIdx(am[2]);
        e = text.slice(am.index + am[0].length);
        text = text.slice(0, idx);
      } else {
        var em = text.match(EXPRE);
        if (em) { e = text.slice(em.index + em[0].length); text = text.slice(0, em.index); }
      }
      e = norm(e.replace(EXPRE, ' ').replace(/^[\s.:\-–)]+/, '').replace(/\n/g, ' '));
      var sp = splitOptions(text);
      return { n: b.n, q: tidyStem(sp.stem), o: sp.o, a: a, e: e };
    });

    // 4. apply the answer key
    var dupNums = qs.some(function (q, i) { return qs.some(function (r, j) { return j < i && r.n === q.n; }); });
    if (key.length) {
      if (dupNums && key.length === qs.length) key.forEach(function (k, i) { if (qs[i].a < 0) qs[i].a = k.a; if (!qs[i].e && k.e) qs[i].e = norm(k.e); });
      else {
        var used = {};
        key.forEach(function (k) {
          for (var i = 0; i < qs.length; i++) if (qs[i].n === k.n && !used[i]) { used[i] = 1; if (qs[i].a < 0) qs[i].a = k.a; if (!qs[i].e && k.e) qs[i].e = norm(k.e); break; }
        });
      }
    }
    qs.forEach(function (q) { if (q.a >= q.o.length) q.a = -1; });
    var title = pre.filter(function (l) { return l.length > 3 && l.length < 90 && !/^(name|date|class|roll|time|marks|max)/i.test(l); })[0] || '';
    return { qs: qs, keyFound: key.length > 0, keyCount: key.length, title: title };
  }

  function issues(q) {
    var out = [];
    if (!norm(q.q)) out.push('Question is empty');
    var filled = q.o.filter(function (o) { return norm(o); }).length;
    if (filled < 2) out.push('Needs at least 2 options');
    else if (q.o.some(function (o) { return !norm(o); })) out.push('An option is empty');
    if (q.a < 0 || q.a >= q.o.length) out.push('Correct answer not marked');
    return out;
  }

  /* ================= storage helpers ================= */
  function getJ(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } }
  function setJ(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function wsTitle(f) { return String(f.name).replace(/(\.qa)?\.mcq\.json$/i, ''); }
  function scoreOf(id) { return getJ(SCORE_KEY, {})[id] || null; }
  function saveScore(id, right, total) {
    var all = getJ(SCORE_KEY, {}), s = all[id] || { best: 0, tries: 0 };
    s.last = right; s.total = total; s.tries++; s.at = Date.now(); if (right > s.best) s.best = right;
    all[id] = s; setJ(SCORE_KEY, all); return s;
  }

  function b64(buf) {
    var bytes = new Uint8Array(buf), s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function folderOptions(sel) {
    var root = S.tree.rootId, list = [{ id: root, label: 'Main folder' }];
    S.tree.folders.forEach(function (f) { list.push({ id: f.id, label: pathOf(f.id).map(function (x) { return x.name; }).join(' › ') }); });
    list.sort(function (a, b) { return a.id === root ? -1 : b.id === root ? 1 : a.label.localeCompare(b.label, undefined, { numeric: true }); });
    return list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('');
  }
  function loader(msg) {
    var el = document.getElementById('busyov');
    if (!msg) { if (el) el.parentNode.removeChild(el); return; }
    if (!el) { el = document.createElement('div'); el.id = 'busyov'; document.body.appendChild(el); }
    el.innerHTML = '<div class="bo"><div class="dots"><i></i><i></i><i></i></div><p>' + esc(msg) + '</p></div>';
  }

  /* ================= worksheets tab ================= */
  /* ---------- worksheet folders ---------- */
  function wsStack() {
    var root = S.tree.rootId;
    if (!S.wsStack || S.wsStack[0] !== root) S.wsStack = [root];
    S.wsStack = S.wsStack.filter(function (id, i) { return i === 0 || S.idx.folder[id]; });
    return S.wsStack;
  }
  function curWs() { var st = wsStack(); return st[st.length - 1]; }
  function wsGo(id) {
    S.wsStack = [S.tree.rootId].concat(id === S.tree.rootId ? [] : pathOf(id).map(function (f) { return f.id; }));
    S.anim = 'fwd'; render(); window.scrollTo(0, 0);
  }
  function wsBack() { var st = wsStack(); if (st.length > 1) { st.pop(); S.anim = 'bwd'; render(); window.scrollTo(0, 0); return true; } return false; }
  function wsCount(id) { var c = S.idx.counts[id]; return c ? c.ws : 0; }
  function wsTried(id) {
    var n = 0, all = getJ(SCORE_KEY, {});
    (function walk(fid, d) {
      (S.idx.files[fid] || []).forEach(function (f) { if (kind(f) === 'quiz' && all[f.id]) n++; });
      if (d < 30) (S.idx.kids[fid] || []).forEach(function (k) { walk(k.id, d + 1); });
    })(id, 0);
    return n;
  }
  var FOLD = '<svg viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2h8.4A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>';

  function renderList() {
    var app = document.getElementById('app');
    if (!S.tree) { app.innerHTML = barHTML('Worksheets', '', false) + '<div class="loading"><div class="dots"><i></i><i></i><i></i></div>Loading…</div>'; return; }
    var root = S.tree.rootId, id = curWs(), isRoot = id === root, teacher = isTeacher();
    var title = isRoot ? 'Worksheets' : S.idx.folder[id].name, sub = '';
    if (!isRoot) sub = '<span class="crumb" data-wshome="1">Worksheets</span>' + pathOf(id).slice(0, -1).map(function (x) { return ' › <span class="crumb" data-wscrumb="' + esc(x.id) + '">' + esc(x.name) + '</span>'; }).join('');
    else sub = esc('MCQ practice from ' + S.name);
    var h = barHTML(title, sub, !isRoot) + '<div class="content ' + (S.anim || '') + '">';
    S.anim = '';
    var total = wsCount(root);
    if (!total && !teacher) { app.innerHTML = h + '<div class="empty" style="margin-top:12px"><b>No worksheets yet</b>Your teacher hasn’t added any worksheets yet.</div></div>'; return; }
    var folders = (S.idx.kids[id] || []).filter(function (f) { return teacher || wsCount(f.id) > 0; }).sort(byName);
    var files = (S.idx.files[id] || []).filter(function (f) { return kind(f) === 'quiz'; }).sort(function (a, b) { return byName(a, b); });
    if (isRoot) {
      var tried = wsTried(root);
      h += UPDATER.banner();
      h += '<div class="hero ws"><b>' + total + ' worksheet' + (total === 1 ? '' : 's') + '</b><span>' + (tried ? 'You’ve attempted ' + tried + '. ' : '') + (total ? 'Pick a class or chapter to practise.' : 'Tap + to make a folder or your first worksheet.') + '</span></div>';
      var recent = S.tree.files.filter(function (f) { return kind(f) === 'quiz' && Date.now() - f.mod < 14 * 864e5; }).sort(function (a, b) { return b.mod - a.mod; }).slice(0, 8);
      if (recent.length && (folders.length || files.length > recent.length)) {
        h += '<div class="sec">New worksheets</div><div class="recent">' + recent.map(function (f) {
          var fo = S.idx.folder[f.parent];
          return '<button class="rc" data-open="' + esc(f.id) + '">' + (QA.isQA(f) ? '<span class="tile k-qa">Q&amp;A</span>' : '<span class="tile k-quiz">MCQ</span>') + '<span class="t">' + esc(cleanName(f.name)) + '</span><span class="m">' + esc((fo ? fo.name + ' · ' : '') + (f.mcq ? f.mcq + ' Qs' : '')) + '</span></button>';
        }).join('') + '</div>';
      }
    } else {
      var here = wsCount(id), t2 = wsTried(id);
      h += '<div class="wsinfo"><b>' + here + ' worksheet' + (here === 1 ? '' : 's') + '</b>' + (t2 ? ' · ' + t2 + ' attempted' : '') + '</div>';
    }
    if (folders.length) {
      h += '<div class="sec">' + (isRoot ? 'Classes & subjects' : 'Folders') + '</div><div class="grid">' + folders.map(function (f) {
        var n = wsCount(f.id), dn = n ? wsTried(f.id) : 0;
        return '<div class="fc wsf' + (f.pending ? ' pending' : '') + (n ? '' : ' none') + '"><button class="fmain" data-wsfolder="' + esc(f.id) + '"><span class="fi">' + FOLD + '</span><span class="n">' + esc(f.name) +
          '<small>' + (n ? n + ' worksheet' + (n > 1 ? 's' : '') + (dn ? ' · ' + dn + ' done' : '') : 'Empty') + '</small></span></button>' +
          (teacher && !f.pending ? '<button class="more fm" data-menu="' + esc(f.id) + '" data-isfolder="1" aria-label="Options for ' + esc(f.name) + '">⋯</button>' : '') + '</div>';
      }).join('') + '</div>';
    }
    if (files.length) h += '<div class="sec">Worksheets (' + files.length + ')</div><ul class="list">' + files.map(function (f) { return fileRow(f); }).join('') + '</ul>';
    if (!folders.length && !files.length) {
      h += '<div class="empty" style="margin-top:12px"><b>' + (isRoot ? 'No worksheets yet' : 'This folder is empty') + '</b>' +
        (teacher ? 'Tap + to add a worksheet or a folder here.' : 'Your teacher hasn’t added worksheets here yet.') + '</div>';
    }
    if (teacher && isRoot && folders.length) h += '<p class="note">Folders are shared with the Material tab, so a chapter’s notes, lectures and worksheets stay together. Students only see folders that contain worksheets.</p>';
    app.innerHTML = h + '</div>';
  }
  function addMenu() {
    var id = curWs(), here = id === S.tree.rootId ? 'Worksheets' : S.idx.folder[id].name;
    sheet('<h3>Add to ' + esc(here) + '</h3>' +
      '<button class="opt" data-sh="ws"><span class="tile k-quiz">MCQ</span><span><b>New MCQ worksheet</b><small>From a PDF, pasted text, or typed by you</small></span></button>' +
      '<button class="opt" data-sh="qa"><span class="tile k-qa">Q&amp;A</span><span><b>New subjective worksheet</b><small>Questions with answers — students tap Show answer</small></span></button>' +
      '<button class="opt" data-sh="mkdir"><span class="tile" style="background:var(--folder)">' + IC.newfolder + '</span><span><b>New folder</b><small>For a class, subject or chapter</small></span></button>',
      function (act) {
        if (act === 'ws') { closeSheet(); create(id); }
        else if (act === 'qa') { closeSheet(); QA.create(id); }
        else if (act === 'mkdir') askText('New folder', 'Folder name', '', 'e.g. Chapter 3 – Electrochemistry', 'Create', function (name) {
          var tmp = { id: 'tmp' + Date.now(), name: name, parent: id, mod: Date.now(), pending: true };
          addLocal('folders', tmp);
          apiPost({ a: 'mkdir', parent: id, name: name }).then(function (j) { replaceLocal('folders', tmp.id, j.item); saveTree(); toast('Folder created.'); },
            function (e) { removeLocal(tmp.id); rebuild(); toast('Couldn’t create the folder: ' + e.message); });
        });
      });
  }
  function move(f) {
    sheet('<h3>Move “' + esc(cleanName(f.name)) + '”</h3><label class="fl">Move to<select id="mvTo">' + folderOptions(f.parent) + '</select></label><button class="btn wide" data-sh="ok">Move</button>',
      function (act, b) {
        if (act !== 'ok') return;
        var to = document.getElementById('mvTo').value;
        if (to === f.parent) { closeSheet(); return; }
        busy(b, true, 'Moving…');
        getData(f).then(function (ws) {
          return apiPost({ a: 'savequiz', id: f.id, parent: to, name: f.name, data: JSON.stringify(ws), count: (ws.qs || []).length });
        }).then(function (j) {
          closeSheet();
          S.tree.files = S.tree.files.filter(function (x) { return x.id !== j.item.id; }); S.tree.files.push(j.item);
          setJ('academy.q.' + j.item.id, null);
          rebuild(); saveTree();
          toast('Moved to ' + (to === S.tree.rootId ? 'the main folder' : S.idx.folder[to].name) + '.');
        }, function (e) { busy(b, false); toast(e.message); });
      });
  }
  function scoreChip(f) {
    var s = scoreOf(f.id); if (!s) return '';
    var pct = s.total ? Math.round(s.best * 100 / s.total) : 0;
    return '<span class="chip ' + (pct >= 80 ? 'good' : pct >= 50 ? 'mid' : 'low') + '">' + (QA.isQA(f) ? 'Knew ' : 'Best ') + s.best + '/' + s.total + '</span>';
  }

  /* ================= teacher: create & edit ================= */
  var E = null, fileIn = null;
  function create(parent) {
    var d = getJ(DRAFT_KEY, null);
    var h = '<h3>New MCQ worksheet</h3>' +
      '<button class="opt" data-sh="ai"><span class="tile" style="background:linear-gradient(135deg,#7C3AED,#4338CA);color:#fff">✦</span><span><b>Make with AI</b><small>Just give the topic, number of questions and level</small></span></button>' +
      (d && d.qs && d.qs.length ? '<button class="opt" data-sh="draft"><span class="tile k-quiz">✎</span><span><b>Continue unfinished worksheet</b><small>' + esc(d.title || 'Untitled') + ' · ' + d.qs.length + ' questions</small></span></button>' : '') +
      '<button class="opt" data-sh="pdf"><span class="tile k-pdf">PDF</span><span><b>From a PDF with answer key</b><small>The app finds the questions, options and answers for you to check</small></span></button>' +
      '<button class="opt" data-sh="paste"><span class="tile k-doc">' + IC.doc + '</span><span><b>Paste text</b><small>Copy MCQs from anywhere, including the answer key</small></span></button>' +
      '<button class="opt" data-sh="blank"><span class="tile" style="background:var(--accent)">+</span><span><b>Type questions myself</b><small>Start with an empty worksheet</small></span></button>';
    sheet(h, function (act) {
      parent = parent || (S.tab === 'ws' ? curWs() : curId());
      if (act === 'ai') { closeSheet(); askAI(parent); }
      else if (act === 'draft') { closeSheet(); E = d; E.filter = 'all'; openEditor(); }
      else if (act === 'pdf') { closeSheet(); pickPdf(parent); }
      else if (act === 'paste') askPaste(parent);
      else if (act === 'blank') { closeSheet(); E = { parent: parent, title: '', time: 0, qs: [{ q: '', o: ['', '', '', ''], a: -1, e: '' }], filter: 'all' }; openEditor(); }
    });
  }
  function pickPdf(parent) {
    if (!fileIn) {
      fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'application/pdf,.pdf'; fileIn.style.display = 'none';
      document.body.appendChild(fileIn);
      fileIn.addEventListener('change', function () {
        var f = fileIn.files && fileIn.files[0]; fileIn.value = '';
        if (!f) return;
        if (f.size > 40 * 1024 * 1024) { toast('That PDF is too large (max 40 MB).'); return; }
        var r = new FileReader();
        r.onload = function () { importPdf(r.result, f.name, fileIn._parent, 0); };
        r.onerror = function () { toast('Couldn’t open that file.'); };
        loader('Opening PDF…'); r.readAsArrayBuffer(f);
      });
    }
    fileIn._parent = parent; fileIn.click();
  }
  function importPdf(buf, name, parent, cols) {
    loader('Reading PDF…');
    extractPdf(buf, cols, function (p, n) { loader('Reading page ' + p + ' of ' + n + '…'); }).then(function (r) {
      loader();
      var scanned = r.chars < 60 * r.pages;
      var res = parse(r.lines);
      var base = String(name || '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ');
      E = { parent: parent, title: (E && E.buf === buf && E.title) || res.title || base, time: 0, qs: res.qs, filter: 'all', src: name, buf: buf, cols: cols || (r.two ? 2 : 1),
        raw: r.lines.join('\n'), keyFound: res.keyFound, scanned: scanned, via: 'pdf' };
      if (!E.qs.length && scanned) { openEditor(); askOcr(); return; }
      openEditor();
      if (!res.qs.length) toast('No questions found. Try reading it differently, or with Google OCR.');
    }, function (e) { loader(); toast('Couldn’t read this PDF: ' + (e && e.message || e)); });
  }
  function askPaste(parent) {
    sheet('<h3>Paste MCQs</h3><label class="fl">Questions, options and answer key<textarea id="pasteIn" rows="10" placeholder="1. Question…\n(a) …  (b) …  (c) …  (d) …\n\nAnswer key\n1. b  2. d …"></textarea></label><button class="btn wide" data-sh="ok">Find questions</button>',
      function (act) {
        if (act !== 'ok') return;
        var t = document.getElementById('pasteIn').value; if (!t.trim()) return;
        closeSheet();
        var res = parse(t.split(/\r?\n/));
        E = { parent: parent, title: res.title, time: 0, qs: res.qs, filter: 'all', raw: t, keyFound: res.keyFound, via: 'paste' };
        openEditor();
        if (!res.qs.length) toast('No numbered questions found. Questions should start with 1. 2. 3. …');
      });
  }
  /* ================= teacher: make questions with AI ================= */
  var AIK = 'academy.aiopts';
  function aiStatus() { return apiPost({ a: 'aistatus' }); }
  function askAI(parent) {
    loader('Checking…');
    aiStatus().then(function (st) {
      loader();
      if (!st.configured) aiSetup(function () { aiForm(parent); }, st); else aiForm(parent);
    }, function (e) { loader(); toast(e.message); });
  }
  function aiForm(parent) {
    var last = getJ(AIK, {}), ctx = pathOf(parent).map(function (f) { return f.name; }).join(', ');
    function opts(list, sel) { return list.map(function (x) { return '<option value="' + x[0] + '"' + (String(x[0]) === String(sel) ? ' selected' : '') + '>' + x[1] + '</option>'; }).join(''); }
    var bg = sheet('<h3>Make questions with AI</h3>' +
      '<label class="fl">Topic<input id="aiTopic" maxlength="200" placeholder="e.g. Post-fertilisation events in plants" value="' + esc(last.topic || '') + '"></label>' +
      '<label class="fl">Class / subject (helps match your syllabus)<input id="aiCtx" maxlength="200" value="' + esc(ctx) + '" placeholder="e.g. Class 12 Biology"></label>' +
      '<div class="two"><label class="fl">Questions<select id="aiN">' + opts([5, 10, 15, 20, 25, 30, 40, 50].map(function (n) { return [n, n]; }), last.n || 10) + '</select></label>' +
      '<label class="fl">Level<select id="aiLv">' + opts([['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['mixed', 'Mixed']], last.level || 'medium') + '</select></label></div>' +
      '<label class="fl">Language<select id="aiLang">' + opts([['en', 'English'], ['hi', 'हिन्दी (Hindi)']], last.lang || 'en') + '</select></label>' +
      '<button class="btn wide" data-sh="go">Create questions</button><button class="lk" data-sh="key">AI settings</button>',
      function (act) {
        if (act === 'key') { closeSheet(); aiSettings(function () { aiForm(parent); }); return; }
        if (act !== 'go') return;
        var topic = norm(document.getElementById('aiTopic').value);
        if (!topic) { document.getElementById('aiTopic').focus(); toast('Please enter a topic.'); return; }
        var o = { topic: topic, ctx: norm(document.getElementById('aiCtx').value), n: Number(document.getElementById('aiN').value) || 10,
          level: document.getElementById('aiLv').value, lang: document.getElementById('aiLang').value, parent: parent };
        setJ(AIK, { topic: topic, n: o.n, level: o.level, lang: o.lang });
        closeSheet(); aiRun(o, false);
      });
    return bg;
  }
  var aiToken = 0;
  function aiBatch(o, n, avoid, tries) {
    var my = ++aiToken;
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { aiToken++; rej(new Error('Google took too long to answer.')); }, 110000);
      apiPost({ a: 'aigen', topic: o.topic, ctx: o.ctx, n: n, level: o.level, lang: o.lang, avoid: avoid }).then(function (j) { clearTimeout(t); if (my === aiToken) res(j.qs || []); },
        function (e) { clearTimeout(t); if (my === aiToken) rej(e); });
    }).catch(function (e) {
      if (tries > 0 && /Server error|No internet|No answer|took too long/.test(e.message)) return aiBatch(o, n, avoid, tries - 1);
      throw e;
    });
  }
  function aiRun(o, append) {
    var qs = [], err = '', batches = [], left = Math.max(1, Math.min(50, o.n));
    while (left > 0) { var k = Math.min(8, left); batches.push(k); left -= k; }
    var want = batches.reduce(function (a, b) { return a + b; }, 0);
    var have = append && E ? E.qs.filter(function (q) { return norm(q.q); }).map(function (q) { return q.q; }) : [];
    (function next(i) {
      if (i >= batches.length || err) { done(); return; }
      loader('Writing questions… ' + qs.length + ' of ' + want + (i ? '' : ' — about ' + Math.max(10, batches.length * 12) + ' seconds'));
      aiBatch(o, batches[i], have.concat(qs.map(function (q) { return q.q; })).slice(-60).map(function (x) { return x.slice(0, 100); }), 1).then(function (r) { qs = qs.concat(r); next(i + 1); }, function (e) { err = e.message; done(); });
    })(0);
    function done() {
      loader();
      if (!qs.length) { toast(err || 'No questions were made. Try again.'); if (!append && o.parent) aiForm(o.parent); return; }
      var fresh = qs.map(function (q) { return { q: q.q, o: q.o, a: q.a, e: q.e || '' }; });
      if (append && E) { E.qs = E.qs.concat(fresh); E.filter = 'all'; }
      else E = { parent: o.parent, title: o.topic.charAt(0).toUpperCase() + o.topic.slice(1), time: 0, qs: fresh, filter: 'all', via: 'ai', keyFound: true,
        ai: { topic: o.topic, ctx: o.ctx, level: o.level, lang: o.lang, parent: o.parent } };
      saveDraft();
      var go = function () { S.mode = 'edit'; render(); window.scrollTo(0, append ? document.body.scrollHeight : 0); toast(err ? 'Made ' + qs.length + ' of ' + want + ' questions. ' + err : 'Made ' + qs.length + ' questions. Please check them before publishing.'); };
      if (needsTex(E)) loadKatex().then(go, go); else go();
    }
  }
  function aiSettings(after) {
    loader('Checking…');
    aiStatus().then(function (st) { loader(); aiSetup(after, st); }, function (e) { loader(); toast(e.message); });
  }
  function aiSetup(after, st) {
    st = st || {};
    var how = {
      gemini: 'Free key: open <b>aistudio.google.com/apikey</b>, sign in with your Google account, tap <b>Create API key</b>, copy it and paste it below.',
      claude: 'Open <b>console.anthropic.com</b> → <b>API keys</b> → <b>Create key</b>. The API needs its own credit balance; it is separate from the Claude chat subscription.'
    };
    var prov = st.provider || 'gemini';
    var bg = sheet('<h3>AI worksheet maker</h3>' +
      (st.configured ? '<p class="note" style="margin-top:0">✓ Set up with <b>' + (st.provider === 'claude' ? 'Claude' : 'Google Gemini') + '</b> (' + esc(st.model || '') + '). You can replace the key below.</p>' : '<p class="note" style="margin-top:0">Set this up once. Your key stays private inside your Google script and is never sent to students’ phones.</p>') +
      '<label class="fl">AI service<select id="aiProv"><option value="gemini"' + (prov === 'gemini' ? ' selected' : '') + '>Google Gemini (has a free plan)</option><option value="claude"' + (prov === 'claude' ? ' selected' : '') + '>Claude (Anthropic API, paid)</option></select></label>' +
      '<p class="note" id="aiHow">' + how[prov] + '</p>' +
      '<label class="fl">Key<input id="aiKey" type="password" autocomplete="off" placeholder="Paste the key here"></label>' +
      '<label class="fl">Model name (optional)<input id="aiModel" autocomplete="off" placeholder="Leave empty — only if the app says a model was not found"></label>' +
      '<button class="btn wide" data-sh="save">Save and test</button>' + (st.configured ? '<button class="lk" data-sh="clear">Remove saved key</button>' : ''),
      function (act, b) {
        if (act === 'save') {
          var key = document.getElementById('aiKey').value.trim(); if (!key) { document.getElementById('aiKey').focus(); toast('Paste your key first.'); return; }
          busy(b, true, 'Testing the key…');
          apiPost({ a: 'aikey', provider: document.getElementById('aiProv').value, key: key, model: document.getElementById('aiModel').value.trim() }).then(function () {
            closeSheet(); toast('AI is ready.'); if (after) after();
          }, function (e) { busy(b, false); toast(e.message); });
        } else if (act === 'clear') {
          busy(b, true, 'Removing…');
          apiPost({ a: 'aikey', clear: 1 }).then(function () { closeSheet(); toast('Key removed.'); }, function (e) { busy(b, false); toast(e.message); });
        }
      });
    bg.addEventListener('change', function (e) { if (e.target.id === 'aiProv') document.getElementById('aiHow').innerHTML = how[e.target.value]; });
  }
  function askOcr() {
    sheet('<h3>Read with Google OCR</h3><p class="note" style="margin-top:0">' + (E.scanned ? 'This PDF looks scanned, so the app can’t read its text directly. ' : '') +
      'Google Drive can recognise the text. This takes 10–60 seconds. Works best for clear scans up to about 10 pages.</p>' +
      '<label class="fl">Main language of the PDF<select id="ocrLang"><option value="en">English</option><option value="hi">Hindi</option></select></label>' +
      '<button class="btn wide" data-sh="ok">Read with Google OCR</button>', function (act) {
        if (act !== 'ok') return;
        var lang = document.getElementById('ocrLang').value; closeSheet(); runOcr(lang);
      });
  }
  function runOcr(lang) {
    if (!E || !E.buf) return;
    if (E.buf.byteLength > 15 * 1024 * 1024) { toast('This PDF is too large for OCR. Split it into parts under 15 MB.'); return; }
    loader('Google is reading the PDF… this can take up to a minute');
    apiPost({ a: 'ocr', b64: b64(E.buf), lang: lang }).then(function (j) {
      loader();
      var res = parse(String(j.text || '').split(/\r?\n/));
      E.qs = res.qs; E.raw = j.text; E.keyFound = res.keyFound; E.via = 'ocr'; E.scanned = false;
      if (!E.title && res.title) E.title = res.title;
      saveDraft(); openEditor();
      toast(res.qs.length ? 'Found ' + res.qs.length + ' questions. Please check them carefully.' : 'Still no questions found in the recognised text.');
    }, function (e) { loader(); toast(e.message); });
  }
  function edit(f) {
    loader('Opening worksheet…');
    getData(f).then(function (ws) {
      loader();
      E = { id: f.id, parent: f.parent, title: ws.title || wsTitle(f), time: ws.time || 0, qs: JSON.parse(JSON.stringify(ws.qs || [])), filter: 'all', via: 'edit' };
      openEditor();
    }, function (e) { loader(); toast(e.message); });
  }
  function openEditor() {
    var go = function () { S.mode = 'edit'; render(); window.scrollTo(0, 0); };
    if (E && needsTex(E)) loadKatex().then(go, go); else go();
  }
  var draftT = null;
  function saveDraft() {
    clearTimeout(draftT);
    draftT = setTimeout(function () { if (E && !E.id) setJ(DRAFT_KEY, { parent: E.parent, title: E.title, time: E.time, qs: E.qs, keyFound: E.keyFound }); }, 500);
  }

  function renderPreview() {
    var app = document.getElementById('app');
    var h = '<div class="bar" id="bar"><button class="ib" data-ed="pvx" aria-label="Back to editing">' + IC.back + '</button><h1>Student preview<small>' + E.qs.length + ' question' + (E.qs.length === 1 ? '' : 's') + ' · exactly how students see them</small></h1></div><div class="edwrap">';
    h += '<div class="info"><b>' + esc(E.title || 'Untitled worksheet') + '</b> The green option is the correct answer. Nothing is saved or published from this screen.</div>';
    E.qs.forEach(function (q, i) {
      h += '<div class="rv ok"><div class="rvh"><b>Q' + (i + 1) + '</b></div><div class="qtext">' + rich(q.q) + '</div>' +
        q.o.map(function (o, j) { return '<div class="ro' + (j === q.a ? ' right' : '') + '"><span class="ol">' + LET[j] + '</span><span class="rt">' + rich(o) + '</span>' + (j === q.a ? ' <em>correct answer</em>' : '') + '</div>'; }).join('') +
        (q.e ? '<p class="rexp"><b>Explanation:</b> ' + rich(q.e) + '</p>' : '') + '</div>';
    });
    h += '<button class="btn wide" data-ed="pvx">Back to editing</button></div>';
    app.innerHTML = h;
  }
  function renderEditor() {
    var app = document.getElementById('app');
    if (E && E.pv) { renderPreview(); return; }
    var bad = 0; E.qs.forEach(function (q) { if (issues(q).length) bad++; });
    if (E.filter === 'bad' && !bad) E.filter = 'all';
    var h = '<div class="bar" id="bar"><button class="ib" data-ed="close" aria-label="Close">' + IC.back + '</button><h1>' + (E.id ? 'Edit worksheet' : 'New worksheet') + '<small>' + E.qs.length + ' question' + (E.qs.length === 1 ? '' : 's') + '</small></h1><button class="lk" data-ed="pv">👁 Preview</button></div><div class="edwrap">';
    h += '<div class="card"><label class="fl">Title<input data-ef="title" value="' + esc(E.title) + '" maxlength="120" placeholder="e.g. Chapter 3 – Motion MCQs"></label>' +
      '<div class="two"><label class="fl">Save in<select data-ef="parent">' + folderOptions(E.parent) + '</select></label>' +
      '<label class="fl" style="flex:0 0 38%">Time limit<select data-ef="time">' + [0, 5, 10, 15, 20, 30, 45, 60, 90, 120].map(function (m) { return '<option value="' + m + '"' + (Number(E.time) === m ? ' selected' : '') + '>' + (m ? m + ' min' : 'None') + '</option>'; }).join('') + '</select></label></div></div>';
    if (E.via === 'ai') {
      h += '<div class="info warn"><b>Made by AI' + (E.ai && E.ai.level ? ' · ' + esc(E.ai.level) : '') + '.</b> AI can make mistakes. Please read every question and check the green answer before publishing.</div>';
    }
    if (E.via === 'pdf' || E.via === 'ocr' || E.via === 'paste') {
      var kinfo = !E.qs.length ? (E.scanned ? 'This PDF looks scanned — use Google OCR below.' : 'Try “Read as two columns”, Google OCR, or check that questions are numbered 1. 2. 3.') :
        E.keyFound ? 'Answer key found.' : 'No answer key found — tap the correct option for each question.';
      h += '<div class="info' + (bad ? ' warn' : '') + '"><b>' + (E.qs.length ? 'Found ' + E.qs.length + ' questions.' : 'No questions found.') + '</b> ' + esc(kinfo) +
        (!E.qs.length ? '' : bad ? ' <b>' + bad + ' need checking.</b>' : ' Please still read through them once.') + '</div>';
      if (E.buf) h += '<div class="tools"><button data-ed="cols">Read as ' + (E.cols === 2 ? 'one column' : 'two columns') + '</button><button data-ed="ocr">Text looks wrong? Use Google OCR</button></div>';
      if (E.raw) h += '<details class="raw"><summary>Show the text the app read</summary><pre>' + esc(E.raw.slice(0, 20000)) + '</pre></details>';
    }
    if (bad) h += '<div class="seg wide"><button data-ed="fall" class="' + (E.filter !== 'bad' ? 'on' : '') + '">All (' + E.qs.length + ')</button><button data-ed="fbad" class="' + (E.filter === 'bad' ? 'on' : '') + '">Needs checking (' + bad + ')</button></div>';
    E.qs.forEach(function (q, i) {
      var iss = issues(q);
      if (E.filter === 'bad' && !iss.length) return;
      h += '<div class="qc' + (iss.length ? ' bad' : '') + '" data-qi="' + i + '"><div class="qh"><b>Q' + (i + 1) + '</b><span class="qwarn">' + esc(iss.join(' · ')) + '</span><button class="lk" data-ed="qdel">Delete</button></div>' +
        '<textarea data-qf="q" rows="2" placeholder="Question">' + esc(q.q) + '</textarea><div class="ops">' +
        q.o.map(function (o, j) {
          return '<div class="orow"><button class="rad' + (q.a === j ? ' on' : '') + '" data-ed="ans" data-oi="' + j + '" aria-label="Mark option ' + LET[j] + ' correct" aria-pressed="' + (q.a === j) + '">' + LET[j] + '</button>' +
            '<input data-qf="o" data-oi="' + j + '" value="' + esc(o) + '" placeholder="Option ' + LET[j] + '"><button class="x" data-ed="odel" data-oi="' + j + '" aria-label="Remove option">×</button></div>';
        }).join('') + '</div>' +
        (q.o.length < 5 ? '<button class="lk" data-ed="oadd">+ Add option</button>' : '') +
        '<p class="hint">Tap a letter to mark the correct answer.</p>' +
        '<textarea data-qf="e" rows="1" class="exp" placeholder="Explanation shown after answering (optional)">' + esc(q.e || '') + '</textarea><div class="pv">' + preview(q) + '</div></div>';
    });
    h += '<button class="btn ghost wide" data-ed="qadd">+ Add question</button>' + (E.ai ? '<button class="btn ghost wide" data-ed="aimore" style="margin-top:8px">✦ Make 5 more with AI</button>' : '') + '</div>' +
      '<div class="pubbar"><button class="btn" data-ed="publish"' + (E.qs.length ? '' : ' disabled') + '>' + (E.id ? 'Save changes' : 'Publish worksheet') + '</button></div>';
    app.innerHTML = h;
    Array.prototype.forEach.call(app.querySelectorAll('textarea[data-qf]'), grow);
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = (t.scrollHeight + 2) + 'px'; }
  function rerenderKeep() { var y = window.scrollY; renderEditor(); window.scrollTo(0, y); saveDraft(); }
  function qOf(el) { var c = el.closest('[data-qi]'); return c ? E.qs[Number(c.dataset.qi)] : null; }
  function preview(q) {
    if (!hasMath(q.q) && !q.o.some(hasMath) && !hasMath(q.e)) return '';
    return '<div class="pvh">How students will see it</div><div class="pvq">' + rich(q.q) + '</div>' +
      q.o.map(function (o, j) { return '<div class="pvo' + (q.a === j ? ' ok' : '') + '"><b>' + LET[j] + '</b> <span>' + rich(o) + '</span></div>'; }).join('') +
      (q.e ? '<div class="pve">' + rich(q.e) + '</div>' : '');
  }
  var pvT = null;
  function refreshCard(el) {
    var c = el.closest('[data-qi]'); if (!c) return;
    var iss = issues(E.qs[Number(c.dataset.qi)]);
    c.classList.toggle('bad', !!iss.length); c.querySelector('.qwarn').textContent = iss.join(' · ');
  }
  function edClick(b) {
    var a = b.dataset.ed, q = qOf(b);
    if (a === 'close') { leaveEditor(); }
    else if (a === 'pv') { E.pv = true; renderEditor(); window.scrollTo(0, 0); }
    else if (a === 'pvx') { E.pv = false; rerenderKeep(); }
    else if (a === 'ans') { q.a = Number(b.dataset.oi); rerenderKeep(); }
    else if (a === 'odel') { if (q.o.length <= 2) { toast('A question needs at least 2 options.'); return; } var j = Number(b.dataset.oi); q.o.splice(j, 1); if (q.a === j) q.a = -1; else if (q.a > j) q.a--; rerenderKeep(); }
    else if (a === 'oadd') { q.o.push(''); rerenderKeep(); }
    else if (a === 'qdel') {
      if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; return; }
      E.qs.splice(E.qs.indexOf(q), 1); rerenderKeep();
    }
    else if (a === 'qadd') { E.filter = 'all'; E.qs.push({ q: '', o: ['', '', '', ''], a: -1, e: '' }); renderEditor(); saveDraft(); setTimeout(function () { var ts = document.querySelectorAll('textarea[data-qf="q"]'); var t = ts[ts.length - 1]; if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); } }, 50); }
    else if (a === 'aimore') { aiRun(Object.assign({}, E.ai, { n: 5 }), true); }
    else if (a === 'fall') { E.filter = 'all'; renderEditor(); }
    else if (a === 'fbad') { E.filter = 'bad'; renderEditor(); window.scrollTo(0, 0); }
    else if (a === 'cols') { importPdf(E.buf, E.src, E.parent, E.cols === 2 ? 1 : 2); }
    else if (a === 'ocr') askOcr();
    else if (a === 'publish') publish(b);
  }
  function edInput(t) {
    if (t.dataset.ef === 'title') { E.title = t.value; saveDraft(); return; }
    var q = qOf(t); if (!q) return;
    if (t.dataset.qf === 'q') q.q = t.value; else if (t.dataset.qf === 'e') q.e = t.value; else if (t.dataset.qf === 'o') q.o[Number(t.dataset.oi)] = t.value;
    if (t.tagName === 'TEXTAREA') grow(t);
    refreshCard(t); saveDraft();
    var card = t.closest('[data-qi]');
    clearTimeout(pvT); pvT = setTimeout(function () { var pv = card && card.querySelector('.pv'); if (pv) pv.innerHTML = preview(E.qs[Number(card.dataset.qi)] || q); }, 250);
  }
  function edChange(t) {
    if (t.dataset.ef === 'parent') E.parent = t.value;
    if (t.dataset.ef === 'time') E.time = Number(t.value);
    saveDraft();
  }
  function leaveEditor(force) {
    if (!force && !E.id && E.qs.length) {
      sheet('<h3>Leave the worksheet?</h3><p class="note" style="margin-top:0">Your work is saved as a draft on this phone. You can continue it from + → New MCQ worksheet.</p><button class="btn wide" data-sh="ok">Leave</button>',
        function (act) { if (act === 'ok') { closeSheet(); setJ(DRAFT_KEY, { parent: E.parent, title: E.title, time: E.time, qs: E.qs, keyFound: E.keyFound }); leaveEditor(true); } });
      return;
    }
    E = null; S.mode = 'browse'; render(); window.scrollTo(0, 0);
  }
  function publish(btn) {
    var title = norm(E.title);
    if (!title) { toast('Please give the worksheet a title.'); window.scrollTo(0, 0); var ti = document.querySelector('[data-ef="title"]'); if (ti) ti.focus(); return; }
    var bad = E.qs.filter(function (q) { return issues(q).length; }).length;
    if (bad) { E.filter = 'bad'; renderEditor(); window.scrollTo(0, 0); toast(bad + ' question' + (bad > 1 ? 's need' : ' needs') + ' fixing before publishing.'); return; }
    var ws = { v: 1, title: title, time: Number(E.time) || 0, qs: E.qs.map(function (q) { return { q: norm(q.q.replace(/\n/g, '\u0001')).replace(/\u0001/g, '\n'), o: q.o.map(norm), a: q.a, e: norm(q.e || '') }; }), at: Date.now() };
    busy(btn, true, 'Saving…');
    var oldId = E.id;
    saveSafely({ a: 'savequiz', id: E.id || '', parent: E.parent, name: title.replace(/[\\/]/g, '-') + '.mcq.json', data: JSON.stringify(ws), count: ws.qs.length }, btn).then(function (j) {
      S.tree.files = S.tree.files.filter(function (x) { return x.id !== j.item.id; });
      S.tree.files.push(j.item);
      setJ('academy.q.' + j.item.id, { mod: j.item.mod, ws: ws });
      if (!oldId) setJ(DRAFT_KEY, null);
      var parent = j.item.parent;
      E = null; S.mode = 'browse'; rebuild(); saveTree();
      if (S.tab === 'ws') wsGo(S.idx.folder[parent] ? parent : S.tree.rootId);
      else if (S.idx.folder[parent]) goFolder(parent); else { S.stack = [S.tree.rootId]; render(); }
      toast(oldId ? 'Worksheet saved.' : 'Worksheet published. Students can see it now.');
    }).catch(function (e) { if (S.mode === 'edit') { busy(btn, false); toast(e.message); } });
  }

  /* ================= student: quiz player ================= */
  var P = null, timer = null;
  function getData(f) {
    var c = getJ('academy.q.' + f.id, null);
    if (c && c.mod === f.mod && c.ws) return Promise.resolve(c.ws);
    return apiGet({ a: 'quiz', id: f.id, m: f.mod }).then(function (j) {
      var ws = JSON.parse(j.data); setJ('academy.q.' + f.id, { mod: f.mod, ws: ws }); return ws;
    }, function (e) { if (c && c.ws) return c.ws; throw e; });
  }
  function open(f) {
    P = { f: f, stage: 'loading', mode: getJ('academy.qmode', 'practice'), shuffle: false };
    S.mode = 'quiz'; render(); window.scrollTo(0, 0);
    getData(f).then(function (ws) { return (needsTex(ws) ? loadKatex() : Promise.resolve()).then(function () { return ws; }); })
      .then(function (ws) { if (!P || P.f !== f) return; P.ws = ws; P.stage = 'intro'; render(); },
      function (e) { if (!P || P.f !== f) return; P.stage = 'error'; P.err = e.message; render(); });
  }
  function shuffled(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); for (var j = n - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)); var t = a[j]; a[j] = a[k]; a[k] = t; } return a; }
  function start(only) {
    var n = P.ws.qs.length, order = only;
    if (!order) { order = []; for (var i = 0; i < n; i++) order.push(i); if (P.shuffle) order = shuffled(n); }
    P.order = order; P.cur = 0; P.ans = {}; P.flag = {}; P.stage = 'q'; P.t0 = Date.now(); P.retry = !!only;
    P.left = P.mode === 'test' && P.ws.time ? P.ws.time * 60 : 0;
    clearInterval(timer);
    P.end = P.left ? Date.now() + P.left * 1000 : 0;
    if (P.left) timer = setInterval(tick, 1000);
    setJ('academy.qmode', P.mode);
    render(); window.scrollTo(0, 0);
  }
  function tick() {
    if (!P || P.stage !== 'q') { clearInterval(timer); return; }
    // count against the real end time, so leaving the app doesn't pause the clock
    if (!P.end) P.end = Date.now() + P.left * 1000;
    P.left = Math.max(0, Math.ceil((P.end - Date.now()) / 1000));
    var el = document.getElementById('qtimer'); if (el) { el.textContent = mmss(P.left); el.classList.toggle('low', P.left <= 60); }
    if (P.left <= 0) { clearInterval(timer); toast('Time’s up!'); finish(); }
  }
  function mmss(s) { s = Math.max(0, s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function goQ(i, dir) {
    if (!P || P.stage !== 'q' || i < 0 || i >= P.order.length) return;
    P.cur = i; render(); window.scrollTo(0, 0);
    var c = document.getElementById('qcard');
    if (c && dir) c.classList.add(dir > 0 ? 'fwd' : 'bwd');
  }
  function showList() {
    var practice = P.mode === 'practice', n = P.order.length, cnt = { r: 0, w: 0, d: 0, f: 0 };
    function st(x) {
      var a = P.ans[x];
      if (a === undefined) return '';
      if (practice) return a === P.ws.qs[x].a ? 'r' : 'w';
      return 'd';
    }
    P.order.forEach(function (x) { var t = st(x); if (t) cnt[t]++; if (P.flag && P.flag[x]) cnt.f++; });
    var lv = P.lv === 'list';
    var legend = practice
      ? '<span><i class="lg r"></i>Correct ' + cnt.r + '</span><span><i class="lg w"></i>Wrong ' + cnt.w + '</span><span><i class="lg"></i>Not answered ' + (n - cnt.r - cnt.w) + '</span>'
      : '<span><i class="lg d"></i>Answered ' + cnt.d + '</span><span><i class="lg"></i>Not answered ' + (n - cnt.d) + '</span>' + (cnt.f ? '<span><i class="lg f"></i>Review ' + cnt.f + '</span>' : '');
    var body;
    if (lv) {
      body = '<ul class="qlist">' + P.order.map(function (x, i) {
        var t = st(x), f = P.flag && P.flag[x];
        return '<li><button data-sh="g' + i + '" class="' + (i === P.cur ? 'cur' : '') + '"><span class="qn ' + t + (f ? ' f' : '') + '">' + (i + 1) + '</span><span class="qp">' + rich(P.ws.qs[x].q) + '</span></button></li>';
      }).join('') + '</ul>';
    } else {
      body = '<div class="qgrid">' + P.order.map(function (x, i) {
        var t = st(x), f = P.flag && P.flag[x];
        return '<button data-sh="g' + i + '" class="' + t + (f ? ' f' : '') + (i === P.cur ? ' cur' : '') + '" aria-label="Question ' + (i + 1) + '">' + (i + 1) + '</button>';
      }).join('') + '</div>';
    }
    var bg = sheet('<div class="qlh"><h3>All questions</h3><span class="seg"><button data-sh="vgrid" class="' + (!lv ? 'on' : '') + '">Grid</button><button data-sh="vlist" class="' + (lv ? 'on' : '') + '">List</button></span></div>' +
      '<div class="legend">' + legend + '</div><div class="qlbody">' + body + '</div>' +
      '<button class="btn wide" data-sh="fin">' + (practice ? 'Finish worksheet' : 'Submit test') + '</button>',
      function (act) {
        if (act === 'vgrid' || act === 'vlist') { P.lv = act === 'vlist' ? 'list' : 'grid'; showList(); return; }
        if (act === 'fin') { closeSheet(); qClick({ dataset: { q: 'finish' } }); return; }
        if (act.charAt(0) === 'g') { closeSheet(); goQ(Number(act.slice(1)), 0); }
      });
    bg.classList.add('qsheet');
    setTimeout(function () { var c = bg.querySelector('.cur'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'center' }); }, 40);
  }
  function finish() {
    clearInterval(timer);
    if (document.getElementById('sheet')) closeSheet();
    var right = 0, wrong = 0;
    P.order.forEach(function (qi) { var a = P.ans[qi]; if (a === undefined) return; if (a === P.ws.qs[qi].a) right++; else wrong++; });
    P.res = { right: right, wrong: wrong, skip: P.order.length - right - wrong, secs: Math.round((Date.now() - P.t0) / 1000) };
    if (!P.retry) {
      P.score = saveScore(P.f.id, right, P.order.length);
      try { PEOPLE.trackResult(P.f, P.ws, P.res, P.order.length, P.mode); } catch (e) { }
    }
    P.stage = 'result'; render(); window.scrollTo(0, 0);
  }
  function qHead(title, right) {
    return '<div class="bar qbar" id="bar"><button class="ib" data-q="exit" aria-label="Close">' + '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button><h1>' + esc(title) + '</h1>' + (right || '') + '</div>';
  }
  function renderQuiz() {
    var app = document.getElementById('app'), ws = P.ws, h;
    if (P.stage === 'loading') { app.innerHTML = qHead(wsTitle(P.f)) + '<div class="loading"><div class="dots"><i></i><i></i><i></i></div>Opening worksheet…</div>'; return; }
    if (P.stage === 'error') { app.innerHTML = qHead(wsTitle(P.f)) + '<div class="err"><b>Couldn’t open the worksheet.</b> ' + esc(P.err) + '</div><button class="btn wide" data-q="reload">Try again</button>'; return; }
    if (P.stage === 'intro') {
      var s = scoreOf(P.f.id), path = P.f.parent === S.tree.rootId ? S.name : pathOf(P.f.parent).map(function (x) { return x.name; }).join(' › ');
      h = qHead('') + '<div class="intro"><span class="tile k-quiz big">MCQ</span><h2>' + esc(wsTitle(P.f) || ws.title) + '</h2><p class="muted">' + esc(path) + '</p>' +
        '<div class="stats3"><div><b>' + ws.qs.length + '</b><span>questions</span></div><div><b>' + (ws.time ? ws.time + ' min' : '—') + '</b><span>time limit</span></div><div><b>' + (s ? s.best + '/' + s.total : '—') + '</b><span>your best</span></div></div>' +
        '<div class="modes"><button data-q="mode" data-m="practice" class="' + (P.mode === 'practice' ? 'on' : '') + '"><b>Practice</b><small>See the answer after each question</small></button>' +
        '<button data-q="mode" data-m="test" class="' + (P.mode === 'test' ? 'on' : '') + '"><b>Test</b><small>Answer all, then see your score' + (ws.time ? ' · timed' : '') + '</small></button></div>' +
        '<label class="tog"><input type="checkbox" id="shuf"' + (P.shuffle ? ' checked' : '') + '> Shuffle the questions</label>' +
        '<button class="btn wide big" data-q="start">Start</button>' +
        (isTeacher() ? '<button class="btn ghost wide" data-q="edit">Edit questions</button>' : '') + '</div>';
      app.innerHTML = h; return;
    }
    if (P.stage === 'q') {
      var qi = P.order[P.cur], q = ws.qs[qi], a = P.ans[qi], n = P.order.length, practice = P.mode === 'practice', locked = practice && a !== undefined;
      var answered = Object.keys(P.ans).length, last = P.cur + 1 >= n, flagged = !!(P.flag && P.flag[qi]);
      var right = (P.left ? '<span class="timer' + (P.left <= 60 ? ' low' : '') + '" id="qtimer">' + mmss(P.left) + '</span>' : '') +
        (!practice ? '<button class="ib' + (flagged ? ' flagon' : '') + '" data-q="flag" aria-label="' + (flagged ? 'Remove review mark' : 'Mark for review') + '" aria-pressed="' + flagged + '"><svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"' + (flagged ? ' fill="currentColor"' : '') + '/></svg></button>' : '') +
        '<button class="ib" data-q="list" aria-label="All questions"><svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/></svg></button>';
      h = qHead('Question ' + (P.cur + 1) + ' of ' + n, right) +
        '<div class="qprog"><i style="width:' + Math.round(answered * 100 / n) + '%"></i></div>' +
        '<div class="qcard" id="qcard">' + (flagged ? '<div class="flagnote">Marked for review</div>' : '') + '<div class="qtext">' + rich(q.q) + '</div><div class="qopts">' +
        q.o.map(function (o, j) {
          var cls = '';
          if (locked) { if (j === q.a) cls = ' right'; else if (j === a) cls = ' wrong'; else cls = ' dim'; }
          else if (a === j) cls = ' sel';
          return '<button class="qo' + cls + '" data-q="pick" data-oi="' + j + '"' + (locked ? ' disabled' : '') + '><span class="ol">' + (locked && j === q.a ? '✓' : locked && j === a ? '✕' : LET[j]) + '</span><span class="ot">' + rich(o) + '</span></button>';
        }).join('') + '</div>';
      if (locked) {
        var ok = a === q.a;
        h += '<div class="fb ' + (ok ? 'ok' : 'no') + '"><b>' + (ok ? 'Correct!' : 'Not quite. The answer is ' + LET[q.a] + '.') + '</b>' + (q.e ? '<p>' + rich(q.e) + '</p>' : '') + '</div>' + (isTeacher() ? '' : '<button class="lk rpt" data-q="rpt" data-qi="' + qi + '">' + (PEOPLE.isFlagged(P.f, qi) ? '⚑ Reported' : '⚑ Report wrong answer') + '</button>');
      }
      if (!practice && a !== undefined) h += '<button class="lk clr" data-q="clear">Clear my answer</button>';
      h += '</div>';
      h += '<div class="qnav"><button class="btn ghost nb" data-q="prev"' + (P.cur ? '' : ' disabled') + ' aria-label="Previous question"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg><span>Previous</span></button>' +
        '<button class="btn ghost sq" data-q="list" aria-label="All questions, ' + answered + ' of ' + n + ' answered"><b>' + answered + '</b>/' + n + '</button>' +
        (last ? '<button class="btn nb" data-q="finish"><span>' + (practice ? 'Finish' : 'Submit') + '</span></button>'
          : '<button class="btn nb' + (practice && !locked ? ' ghost' : '') + '" data-q="next" aria-label="Next question"><span>' + (practice && !locked ? 'Skip' : 'Next') + '</span><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>') + '</div>';
      app.innerHTML = h; return;
    }
    if (P.stage === 'result') {
      var r = P.res, tot = P.order.length, pct = tot ? Math.round(r.right * 100 / tot) : 0, C = 2 * Math.PI * 52;
      var msg = pct >= 90 ? 'Excellent work!' : pct >= 75 ? 'Great job!' : pct >= 50 ? 'Good effort — keep practising.' : 'Keep going — review the answers and try again.';
      h = qHead(wsTitle(P.f) || ws.title) + '<div class="result"><div class="ring big"><svg viewBox="0 0 120 120"><circle class="bg" cx="60" cy="60" r="52"/><circle class="fg ' + (pct >= 75 ? 'good' : pct >= 50 ? 'mid' : 'low') + '" cx="60" cy="60" r="52" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/></svg><span><b>' + r.right + '/' + tot + '</b><small>' + pct + '%</small></span></div>' +
        '<h2>' + msg + '</h2>' + (P.retry ? '<p class="muted">Practice round of the questions you got wrong.</p>' : P.score && P.score.tries > 1 ? '<p class="muted">Your best: ' + P.score.best + '/' + P.score.total + ' · attempt ' + P.score.tries + '</p>' : '') +
        '<div class="stats3"><div><b class="g">' + r.right + '</b><span>correct</span></div><div><b class="r">' + r.wrong + '</b><span>wrong</span></div><div><b>' + r.skip + '</b><span>skipped</span></div></div>' +
        '<p class="muted">Time taken: ' + mmss(r.secs) + '</p>' +
        '<button class="btn wide" data-q="review">Review answers</button>' +
        (r.wrong + r.skip ? '<button class="btn ghost wide" data-q="retrywrong">Practise the ' + (r.wrong + r.skip) + ' I missed</button>' : '') +
        '<button class="btn ghost wide" data-q="again">Try the whole worksheet again</button></div>';
      app.innerHTML = h; return;
    }
    if (P.stage === 'review') {
      var onlyWrong = P.rf === 'wrong';
      h = qHead('Review') + '<div class="seg wide"><button data-q="rf" data-v="all" class="' + (!onlyWrong ? 'on' : '') + '">All</button><button data-q="rf" data-v="wrong" class="' + (onlyWrong ? 'on' : '') + '">Wrong &amp; skipped</button></div>';
      P.order.forEach(function (qi, i) {
        var q = ws.qs[qi], a = P.ans[qi], ok = a === q.a;
        if (onlyWrong && ok) return;
        h += '<div class="rv ' + (ok ? 'ok' : 'no') + '"><div class="rvh"><b>Q' + (i + 1) + '</b><span>' + (a === undefined ? 'Skipped' : ok ? 'Correct' : 'Wrong') + '</span></div><div class="qtext">' + rich(q.q) + '</div>' +
          q.o.map(function (o, j) { return '<div class="ro' + (j === q.a ? ' right' : j === a ? ' wrong' : '') + '"><span class="ol">' + LET[j] + '</span><span class="rt">' + rich(o) + '</span>' + (j === q.a ? ' <em>correct answer</em>' : j === a ? ' <em>your answer</em>' : '') + '</div>'; }).join('') +
          (q.e ? '<p class="rexp"><b>Explanation:</b> ' + rich(q.e) + '</p>' : '') + (isTeacher() ? '' : '<button class="lk rpt" data-q="rpt" data-qi="' + qi + '">' + (PEOPLE.isFlagged(P.f, qi) ? '⚑ Reported' : '⚑ Report wrong answer') + '</button>') + '</div>';
      });
      h += '<button class="btn wide" data-q="back2res">Back to score</button>';
      app.innerHTML = h; return;
    }
  }
  function qClick(b) {
    var a = b.dataset.q;
    if (a === 'exit') { exitQuiz(); return; }
    if (a === 'reload') { open(P.f); return; }
    if (a === 'mode') { P.mode = b.dataset.m; render(); return; }
    if (a === 'start') { var sh = document.getElementById('shuf'); P.shuffle = !!(sh && sh.checked); start(); return; }
    if (a === 'edit') { var f = P.f; P = null; edit(f); return; }
    var qi = P.order ? P.order[P.cur] : 0;
    if (a === 'pick') {
      var j = Number(b.dataset.oi);
      if (P.mode === 'practice') { if (P.ans[qi] !== undefined) return; P.ans[qi] = j; try { navigator.vibrate && navigator.vibrate(j === P.ws.qs[qi].a ? 12 : [20, 60, 20]); } catch (e) { } }
      else P.ans[qi] = P.ans[qi] === j ? undefined : j;
      if (P.ans[qi] === undefined) delete P.ans[qi];
      var y = window.scrollY; render(); window.scrollTo(0, y);
      if (P.mode === 'practice') setTimeout(function () { var fb = document.querySelector('.fb'); if (fb && fb.getBoundingClientRect().bottom > window.innerHeight - 80) fb.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, 30);
      return;
    }
    if (a === 'rpt') {
      var rq = Number(b.dataset.qi), qq = P.ws.qs[rq];
      PEOPLE.flagSheet(P.f, rq, { q: qq.q, marked: LET[qq.a] + '. ' + qq.o[qq.a], options: qq.o }, function () { var y3 = window.scrollY; render(); window.scrollTo(0, y3); });
      return;
    }
    if (a === 'next' || a === 'skip') { goQ(P.cur + 1, 1); return; }
    if (a === 'prev') { goQ(P.cur - 1, -1); return; }
    if (a === 'list') { showList(); return; }
    if (a === 'flag') { P.flag = P.flag || {}; if (P.flag[qi]) delete P.flag[qi]; else P.flag[qi] = 1; var yy = window.scrollY; render(); window.scrollTo(0, yy); return; }
    if (a === 'clear') { delete P.ans[qi]; var y2 = window.scrollY; render(); window.scrollTo(0, y2); return; }
    if (a === 'finish' || a === 'submit') {
      var left = P.order.length - Object.keys(P.ans).length;
      var pr = P.mode === 'practice';
      if (pr && !left) { finish(); return; }
      var fl = P.flag ? Object.keys(P.flag).length : 0;
      sheet('<h3>' + (pr ? 'Finish the worksheet?' : 'Submit the test?') + '</h3><p class="note" style="margin-top:0">' + (left ? 'You haven’t answered ' + left + ' question' + (left > 1 ? 's' : '') + '.' : 'You’ve answered every question.') +
        (fl && !pr ? ' ' + fl + ' marked for review.' : '') + '</p>' +
        (left ? '<button class="btn ghost wide" data-sh="first">Go to first unanswered</button>' : '') +
        '<button class="btn wide" data-sh="ok">' + (pr ? 'Finish' : 'Submit') + '</button>',
        function (act) {
          if (act === 'ok') { closeSheet(); finish(); }
          else if (act === 'first') { closeSheet(); for (var i = 0; i < P.order.length; i++) if (P.ans[P.order[i]] === undefined) { goQ(i, 0); break; } }
        });
      return;
    }
    if (a === 'review') { P.stage = 'review'; P.rf = P.res.wrong + P.res.skip ? 'wrong' : 'all'; render(); window.scrollTo(0, 0); return; }
    if (a === 'rf') { P.rf = b.dataset.v; render(); return; }
    if (a === 'back2res') { P.stage = 'result'; render(); window.scrollTo(0, 0); return; }
    if (a === 'again') { P.retry = false; start(); return; }
    if (a === 'retrywrong') { var miss = P.order.filter(function (x) { return P.ans[x] !== P.ws.qs[x].a; }); P.mode = 'practice'; start(miss); return; }
  }
  function exitQuiz(force) {
    if (!force && P && P.stage === 'q' && Object.keys(P.ans).length) {
      sheet('<h3>Leave the worksheet?</h3><p class="note" style="margin-top:0">Your answers so far won’t be saved.</p><button class="btn danger wide" data-sh="ok">Leave</button>',
        function (act) { if (act === 'ok') { closeSheet(); exitQuiz(true); } });
      return;
    }
    clearInterval(timer); P = null; S.mode = 'browse'; render(); window.scrollTo(0, 0);
  }

  /* swipe left / right between questions */
  var qsw = null;
  function scrollableX(el) {
    for (; el && el !== document.body; el = el.parentElement) if (el.scrollWidth > el.clientWidth + 2 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
    return false;
  }
  document.addEventListener('touchstart', function (e) {
    qsw = null;
    if (S.mode !== 'quiz' || !P || P.stage !== 'q' || e.touches.length !== 1 || document.getElementById('sheet')) return;
    if (!e.target.closest('#qcard') || scrollableX(e.target)) return;
    qsw = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!qsw) return;
    var t = e.changedTouches[0], dx = t.clientX - qsw.x, dy = t.clientY - qsw.y, dt = Date.now() - qsw.t; qsw = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8 || dt > 700) return;
    goQ(P.cur + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  }, { passive: true });

  /* ================= events ================= */
  document.addEventListener('click', function (e) {
    var c = e.target.closest && e.target.closest('[data-wscrumb],[data-wshome]');
    if (c && S.tab === 'ws' && S.mode === 'browse') { e.stopPropagation(); wsGo(c.dataset.wscrumb || S.tree.rootId); return; }
    var b = e.target.closest('button'); if (!b || b.closest('#sheet')) return;
    if (S.mode === 'browse' && S.tab === 'ws' && b.dataset.act === 'back') { e.stopPropagation(); wsBack(); return; }
    if (S.mode === 'edit' && b.dataset.ed) { e.stopPropagation(); edClick(b); }
    else if (S.mode === 'browse' && S.tab === 'ws' && b.dataset.wsfolder) { e.stopPropagation(); var fo = S.idx.folder[b.dataset.wsfolder]; if (fo && fo.pending) { toast('Creating folder…'); return; } wsGo(b.dataset.wsfolder); }
    else if (S.mode === 'quiz' && b.dataset.q) { e.stopPropagation(); qClick(b); }
  }, true);
  document.addEventListener('input', function (e) { if (S.mode === 'edit' && E && (e.target.dataset.qf || e.target.dataset.ef)) edInput(e.target); });
  document.addEventListener('change', function (e) { if (S.mode === 'edit' && E && e.target.dataset.ef) edChange(e.target); });

  return {
    parse: parse, extractPdf: extractPdf, issues: issues, loadPdfJs: loadPdfJs,
    renderList: renderList, renderEditor: renderEditor, renderQuiz: renderQuiz, scoreChip: scoreChip,
    open: open, edit: edit, create: create, aiSettings: function () { aiSettings(); }, addMenu: addMenu, move: move, wsBack: wsBack,
    onBack: function () {
      if (S.mode === 'quiz') { if (P && P.stage === 'review') { P.stage = 'result'; render(); return true; } exitQuiz(); return true; }
      if (S.mode === 'edit') { if (E && E.pv) { E.pv = false; rerenderKeep(); return true; } leaveEditor(); return true; }
      return false;
    },
    _state: function () { return { E: E, P: P }; },
    _rich: rich
  };
})();
