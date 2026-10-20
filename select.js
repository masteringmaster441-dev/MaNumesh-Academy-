/* Academy – select several folders/files (teacher) and move or delete them together.
   Long-press any item to start; tap more items to add them. */
var SEL = (function () {
  var on = false, ids = {}, order = [];
  var ITEM = '[data-open],[data-folder],[data-wsfolder]';

  function idOf(el) { return el.dataset.open || el.dataset.folder || el.dataset.wsfolder; }
  function isFolderEl(el) { return !!(el.dataset.folder || el.dataset.wsfolder); }
  function count() { return order.length; }
  function canSelect() { return isTeacher() && S.mode === 'browse' && (S.tab === 'material' || S.tab === 'ws') && S.tree; }
  function selectable(el) {
    if (!el || el.closest('#sheet') || el.closest('#viewer') || el.closest('.recent')) return false;
    var id = idOf(el); if (!id) return false;
    var item = isFolderEl(el) ? S.idx.folder[id] : findFile(id);
    return !!(item && !item.pending);
  }

  function start(id, folder) {
    on = true; ids = {}; order = [];
    if (id) toggle(id, folder);
    paint();
    try { navigator.vibrate && navigator.vibrate(18); } catch (e) { }
  }
  function stop() { if (!on) return false; on = false; ids = {}; order = []; paint(); return true; }
  function toggle(id, folder) {
    if (ids[id]) { delete ids[id]; order = order.filter(function (x) { return x !== id; }); }
    else { ids[id] = folder ? 'd' : 'f'; order.push(id); }
    if (!order.length) { stop(); return; }
    paint();
  }

  /* draw ticks and the selection bar on whatever is on screen */
  function paint() {
    document.body.classList.toggle('selecting', on);
    var els = document.querySelectorAll('#app ' + ITEM.split(',').join(',#app '));
    Array.prototype.forEach.call(els, function (el) {
      var host = el.closest('.row') || el.closest('.fc') || el;
      var sel = on && !!ids[idOf(el)];
      host.classList.toggle('sel', sel);
      if (on && selectable(el)) {
        if (!host.querySelector('.tick')) { var t = document.createElement('span'); t.className = 'tick'; t.setAttribute('aria-hidden', 'true'); host.appendChild(t); }
        el.setAttribute('aria-pressed', sel ? 'true' : 'false');
      } else {
        var old = host.querySelector('.tick'); if (old) old.parentNode.removeChild(old);
        el.removeAttribute('aria-pressed');
      }
    });
    var bar = document.getElementById('selbar');
    if (!on) { if (bar) bar.parentNode.removeChild(bar); return; }
    if (!bar) { bar = document.createElement('div'); bar.id = 'selbar'; bar.setAttribute('role', 'toolbar'); document.body.appendChild(bar); }
    var n = count();
    bar.innerHTML = '<button class="ib" data-sel="cancel" aria-label="Cancel selection"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>' +
      '<span class="sinfo"><b>' + n + ' selected</b><button class="lk" data-sel="all">Select all</button></span>' +
      '<button class="sbtn" data-sel="move"><svg viewBox="0 0 24 24"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.6l2 2h8.4A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/><path d="M11 13.5h6M14.5 11l2.5 2.5-2.5 2.5"/></svg>Move</button>' +
      '<button class="sbtn" data-sel="tag"><svg viewBox="0 0 24 24"><path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/></svg>Tag</button>' +
      '<button class="sbtn danger" data-sel="del" aria-label="Delete"><svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/></svg><span class="sl">Delete</span></button>';
  }

  /* ---------- moving ---------- */
  function blockedTargets() {
    // a folder can't go inside itself or inside one of its own sub-folders
    var bad = {};
    order.forEach(function (id) { if (ids[id] === 'd') bad[id] = 1; });
    var changed = true;
    while (changed) { changed = false; S.tree.folders.forEach(function (f) { if (!bad[f.id] && bad[f.parent]) { bad[f.id] = 1; changed = true; } }); }
    return bad;
  }
  function moveSheet() {
    var bad = blockedTargets(), root = S.tree.rootId;
    var list = [{ id: root, label: S.name + ' (main folder)' }];
    S.tree.folders.forEach(function (f) { if (!bad[f.id] && !f.pending) list.push({ id: f.id, label: pathOf(f.id).map(function (x) { return x.name; }).join(' › ') }); });
    list.sort(function (a, b) { return a.id === root ? -1 : b.id === root ? 1 : a.label.localeCompare(b.label, undefined, { numeric: true }); });
    var here = S.tab === 'ws' ? null : curId();
    var n = count();
    sheet('<h3>Move ' + n + ' item' + (n > 1 ? 's' : '') + '</h3>' +
      '<input class="search" id="mvQ" type="search" placeholder="Search folders">' +
      '<div class="mvlist" id="mvList">' + list.map(function (x) {
        var depth = x.id === root ? 0 : x.label.split(' › ').length;
        return '<button class="mvopt' + (x.id === here ? ' here' : '') + '" data-sh="to:' + esc(x.id) + '" data-label="' + esc(x.label.toLowerCase()) + '">' +
          '<span class="mvi" style="margin-left:' + Math.min(depth, 4) * 12 + 'px">' + IC.folder + '</span><span class="mvt">' + esc(x.label) + (x.id === here ? ' <em>current</em>' : '') + '</span></button>';
      }).join('') + '</div>', function (act) {
        if (act.indexOf('to:') === 0) { closeSheet(); doMove(act.slice(3)); }
      });
    var q = document.getElementById('mvQ');
    if (q) q.addEventListener('input', function () {
      var v = q.value.trim().toLowerCase();
      Array.prototype.forEach.call(document.querySelectorAll('#mvList .mvopt'), function (b) { b.style.display = !v || b.dataset.label.indexOf(v) >= 0 ? '' : 'none'; });
    });
  }
  function doMove(to) {
    var moving = order.slice(), kinds = {}; moving.forEach(function (id) { kinds[id] = ids[id]; });
    var before = {};
    S.tree.folders.forEach(function (f) { if (kinds[f.id]) before[f.id] = f.parent; });
    S.tree.files.forEach(function (f) { if (kinds[f.id]) before[f.id] = f.parent; });
    var changing = moving.filter(function (id) { return before[id] !== to; });
    var name = to === S.tree.rootId ? S.name : S.idx.folder[to].name;
    stop();
    if (!changing.length) { toast('Already in ' + name + '.'); return; }
    function setParent(id, p) {
      S.tree.folders.forEach(function (f) { if (f.id === id) f.parent = p; });
      S.tree.files.forEach(function (f) { if (f.id === id) f.parent = p; });
    }
    changing.forEach(function (id) { setParent(id, to); });
    rebuild();
    toast('Moving ' + changing.length + ' item' + (changing.length > 1 ? 's' : '') + ' to ' + name + '…');
    apiPost({ a: 'moveitems', ids: changing, to: to }).then(function (j) {
      var failed = j.failed || [];
      failed.forEach(function (x) { if (before[x.id] != null) setParent(x.id, before[x.id]); });
      rebuild(); saveTree();
      if (failed.length) toast((changing.length - failed.length) + ' moved. ' + failed.length + ' couldn’t be moved: ' + failed[0].error);
      else toast('Moved ' + changing.length + ' item' + (changing.length > 1 ? 's' : '') + ' to ' + name + '.');
    }, function (e) {
      changing.forEach(function (id) { setParent(id, before[id]); });
      rebuild();
      toast(/Unknown request|update the Google script/i.test(e.message) ? 'Please update the Google script to version 8 (Academy-Code-v8) to move several items.' : 'Couldn’t move: ' + e.message);
    });
  }

  /* ---------- tagging ---------- */
  function tagSheet() {
    var files = order.filter(function (id) { return ids[id] === 'f'; });
    if (!files.length) { toast('Tags go on files — folders can’t be tagged.'); return; }
    var skipped = order.length - files.length;
    chooseTag('Tag ' + files.length + ' file' + (files.length > 1 ? 's' : ''), skipped ? skipped + ' folder' + (skipped > 1 ? 's are' : ' is') + ' left out.' : '', '', function (tag) {
      stop(); applyTags(files, tag);
    });
  }

  /* ---------- deleting ---------- */
  function delSheet() {
    var n = count(), folders = order.filter(function (id) { return ids[id] === 'd'; }).length;
    sheet('<h3>Delete ' + n + ' item' + (n > 1 ? 's' : '') + '?</h3><p class="note" style="margin-top:0">' +
      (folders ? 'Folders are deleted with everything inside them. ' : '') + 'Deleted items go to your Google Drive trash for 30 days.</p>' +
      '<button class="btn danger wide" data-sh="ok">Delete ' + n + ' item' + (n > 1 ? 's' : '') + '</button>', function (act) {
        if (act === 'ok') { closeSheet(); doDelete(); }
      });
  }
  function doDelete() {
    var list = order.slice(), snapF = S.tree.folders.slice(), snapFi = S.tree.files.slice();
    stop();
    var gone = {}; list.forEach(function (id) { gone[id] = 1; });
    var changed = true;
    while (changed) { changed = false; S.tree.folders.forEach(function (f) { if (!gone[f.id] && gone[f.parent]) { gone[f.id] = 1; changed = true; } }); }
    S.tree.folders = S.tree.folders.filter(function (f) { return !gone[f.id]; });
    S.tree.files = S.tree.files.filter(function (f) { return !gone[f.id] && !gone[f.parent]; });
    if (S.stack.some(function (id) { return gone[id]; })) S.stack = [S.tree.rootId];
    rebuild();
    toast('Deleted ' + list.length + ' item' + (list.length > 1 ? 's' : '') + '. They’re in your Google Drive trash for 30 days.');
    apiPost({ a: 'trashitems', ids: list }).then(function (j) {
      if ((j.failed || []).length) { toast(j.failed.length + ' item' + (j.failed.length > 1 ? 's' : '') + ' couldn’t be deleted. Refreshing…'); refresh(true); }
      else saveTree();
    }, function (e) {
      S.tree.folders = snapF; S.tree.files = snapFi; rebuild();
      toast(/Unknown request|update the Google script/i.test(e.message) ? 'Please update the Google script to version 8 (Academy-Code-v8) to delete several items.' : 'Couldn’t delete: ' + e.message);
    });
  }

  function selectAll() {
    var els = document.querySelectorAll('#app ' + ITEM.split(',').join(',#app '));
    var all = Array.prototype.filter.call(els, selectable);
    var everyOn = all.every(function (el) { return ids[idOf(el)]; });
    all.forEach(function (el) {
      var id = idOf(el);
      if (everyOn) { if (ids[id]) { delete ids[id]; order = order.filter(function (x) { return x !== id; }); } }
      else if (!ids[id]) { ids[id] = isFolderEl(el) ? 'd' : 'f'; order.push(id); }
    });
    if (!order.length) stop(); else paint();
  }

  /* ---------- gestures ---------- */
  var press = null, suppress = false;
  function cancelPress() { if (press) { clearTimeout(press.t); press = null; } }
  document.addEventListener('touchstart', function (e) {
    cancelPress();
    if (!canSelect() || e.touches.length !== 1) return;
    var el = e.target.closest && e.target.closest(ITEM);
    if (!selectable(el)) return;
    var t0 = e.touches[0];
    press = { x: t0.clientX, y: t0.clientY, t: setTimeout(function () {
      press = null; suppress = true;
      if (on) toggle(idOf(el), isFolderEl(el)); else start(idOf(el), isFolderEl(el));
    }, 480) };
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!press) return;
    var t = e.touches[0];
    if (Math.abs(t.clientX - press.x) > 10 || Math.abs(t.clientY - press.y) > 10) cancelPress();
  }, { passive: true });
  document.addEventListener('touchend', cancelPress, { passive: true });
  document.addEventListener('touchcancel', cancelPress, { passive: true });
  document.addEventListener('contextmenu', function (e) {
    // long-press with a mouse / some WebViews fire this; also stops the text-selection menu
    var el = e.target.closest && e.target.closest(ITEM);
    if (!canSelect() || !selectable(el)) return;
    e.preventDefault();
    if (press || suppress) return;
    suppress = true;
    if (on) toggle(idOf(el), isFolderEl(el)); else start(idOf(el), isFolderEl(el));
  });

  document.addEventListener('click', function (e) {
    var sb = e.target.closest && e.target.closest('[data-sel]');
    if (sb) {
      e.stopPropagation();
      var a = sb.dataset.sel;
      if (a === 'cancel') stop();
      else if (a === 'all') selectAll();
      else if (a === 'move') moveSheet();
      else if (a === 'del') delSheet();
      else if (a === 'tag') tagSheet();
      return;
    }
    if (suppress) { suppress = false; var s = e.target.closest && e.target.closest(ITEM + ',[data-menu]'); if (s) { e.stopPropagation(); e.preventDefault(); return; } }
    if (!on) return;
    var el = e.target.closest && e.target.closest(ITEM + ',[data-menu]');
    if (el && !el.closest('#sheet') && !el.closest('#selbar')) {
      e.stopPropagation(); e.preventDefault();
      var tgt = el.dataset.menu ? (el.closest('.row,.fc') || el).querySelector(ITEM) : el;
      if (tgt && selectable(tgt)) toggle(idOf(tgt), isFolderEl(tgt));
      return;
    }
    // other buttons (tabs, back, search…) end the selection
    var other = e.target.closest && e.target.closest('#nav button,[data-act],[data-crumb],[data-wscrumb],[data-wshome],#fab');
    if (other) stop();
  }, true);

  return {
    init: function () {
      var r = window.render;
      window.render = function () { r.apply(this, arguments); if (on && !canSelect()) { on = false; ids = {}; order = []; } paint(); };
    },
    start: start, stop: stop, active: function () { return on; },
    onBack: function () { return stop(); }
  };
})();
