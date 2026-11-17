/* 数独 模様帖 — 画面と操作。解法・生成は engine.js。 */
(function () {
  'use strict';
  const E = SudokuEngineFactory();
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても遊べる */ } },
  };

  const GRADE_DESC = {
    1: 'ヒント多め。行・列・箱で「ここにしか入らない」を探すだけで解けます。',
    2: 'マスに入る候補を数えて絞る場面が出てきます。メモなしでも解けます。',
    3: 'ペアやポインティングなど、候補を消す手筋がひとつは必要です。メモ推奨。',
    4: 'トリプル・X-Wing・XY-Wing 級の手筋が必要です。',
    5: '定番の手筋だけでは止まります。長い連鎖か仮置きが必要な最難問。',
  };

  // ------------------------------------------------------------ 状態
  const S = {
    puzzle: null, solution: null, grid: null, memos: null,
    meta: null, sel: 40, memoMode: false,
    history: [], hpos: -1,
    wrong: new Set(), hinted: -1, hintDigit: 0, hintsUsed: 0,
    elapsed: 0, tick: null, last: 0, paused: false, done: false, revealed: false,
    busy: false,
  };
  const prefs = store.get('sudoku2.prefs', {});
  const opts = Object.assign({ grade: 2, mode: 'sym', sym: 'random', shape: 'random', erode: false }, prefs.opts || {});

  // ------------------------------------------------------------ 盤面の組み立て
  const board = $('board');
  const cells = [];
  for (let i = 0; i < 81; i++) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'cell'; b.tabIndex = -1;
    b.setAttribute('role', 'gridcell');
    const dr = Math.abs(((i / 9) | 0) - 4), dc = Math.abs(i % 9 - 4);
    b.style.setProperty('--d', Math.round(Math.sqrt(dr * dr + dc * dc) * 3));
    b.addEventListener('click', () => { S.sel = i; S.hinted = -1; render(); });
    board.appendChild(b); cells.push(b);
  }
  const pad = $('pad');
  const keys = [];
  for (let d = 1; d <= 9; d++) {
    const k = document.createElement('button');
    k.type = 'button'; k.className = 'key';
    k.innerHTML = d + '<span class="left"></span>';
    k.addEventListener('click', () => input(d));
    pad.appendChild(k); keys.push(k);
  }

  // ------------------------------------------------------------ 描画
  function conflicts() {
    const bad = new Set();
    for (let u = 0; u < 27; u++) {
      const seen = {};
      for (const i of E.UNITS[u]) {
        const v = S.grid[i]; if (!v) continue;
        if (seen[v] !== undefined) { bad.add(i); bad.add(seen[v]); } else seen[v] = i;
      }
    }
    return bad;
  }
  function render() {
    if (!S.grid) return;
    const sel = S.sel, selV = sel >= 0 ? S.grid[sel] : 0;
    const peers = new Set(sel >= 0 ? E.PEERS[sel] : []);
    const bad = conflicts();
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i++) {
      const c = cells[i], v = S.grid[i], given = S.puzzle[i] !== 0;
      counts[v]++;
      let cls = 'cell';
      if (given) cls += ' given';
      if (i === sel) cls += ' sel';
      else if (selV && v === selV) cls += ' same';
      else if (peers.has(i)) cls += ' peer';
      if (bad.has(i)) cls += ' clash';
      if (S.wrong.has(i)) cls += ' wrong';
      if (i === S.hinted) cls += ' hinted';
      c.className = cls;
      if (v) {
        c.innerHTML = '<span class="digit">' + v + '</span>';
      } else if (S.memos[i]) {
        let h = '<span class="memos">';
        for (let d = 1; d <= 9; d++) {
          const on = S.memos[i] & (1 << (d - 1));
          h += '<span' + (on && d === selV ? ' class="hit"' : '') + '>' + (on ? d : '') + '</span>';
        }
        c.innerHTML = h + '</span>';
      } else c.innerHTML = '';
      c.setAttribute('aria-label', (((i / 9) | 0) + 1) + '行' + (i % 9 + 1) + '列 ' + (v ? v + (given ? '（ヒント）' : '') : '空き'));
    }
    for (let d = 1; d <= 9; d++) {
      const k = keys[d - 1], left = 9 - counts[d];
      k.querySelector('.left').innerHTML = left > 0 ? '<i>残り</i>' + left : '';
      k.classList.toggle('done', left <= 0);
      const on = sel >= 0 && (S.memoMode ? !S.grid[sel] && (S.memos[sel] & (1 << (d - 1))) : S.grid[sel] === d);
      k.classList.toggle('on', !!on);
    }
    $('undo-btn').disabled = S.hpos <= 0;
    $('redo-btn').disabled = S.hpos >= S.history.length - 1;
    pad.classList.toggle('memo-mode', S.memoMode);
    $('memo-btn').setAttribute('aria-pressed', S.memoMode);
    $('memo-state').textContent = S.memoMode ? '入' : '切';
    board.classList.toggle('paused', S.paused);
  }
  function note(html, warn) { const n = $('note'); n.innerHTML = html || ''; n.classList.toggle('warn', !!warn); }
  function cellName(i) { return (((i / 9) | 0) + 1) + '行' + (i % 9 + 1) + '列'; }

  // ------------------------------------------------------------ 時計
  function fmt(ms) {
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return String(m).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }
  function showTime() { $('timer').textContent = fmt(S.elapsed + (S.tick ? Date.now() - S.last : 0)); }
  function startClock() {
    stopClock();
    if (S.done || S.paused) { showTime(); return; }
    S.last = Date.now();
    S.tick = setInterval(showTime, 500);
    showTime();
  }
  function stopClock() {
    if (S.tick) { clearInterval(S.tick); S.elapsed += Date.now() - S.last; S.tick = null; }
    showTime();
  }
  function setPaused(p) {
    if (S.done || S.busy || !S.grid) return;
    S.paused = p;
    $('pause-btn').textContent = p ? '動かす' : '止める';
    $('pause-btn').setAttribute('aria-pressed', p);
    if (p) { stopClock(); veil('ひと休み中', '盤面は隠してあります', '再開する', () => setPaused(false)); }
    else { veil(null); startClock(); }
    render(); save();
  }
  function veil(text, sub, btn, fn) {
    const v = $('veil');
    if (!text) { v.hidden = true; return; }
    v.hidden = false;
    $('veil-text').textContent = text; $('veil-sub').textContent = sub || '';
    const b = $('veil-btn'); b.textContent = btn || ''; b.hidden = !btn; b.onclick = fn || null;
  }

  // ------------------------------------------------------------ 履歴・保存
  function snapshot() {
    S.history = S.history.slice(0, S.hpos + 1);
    S.history.push({ g: S.grid.slice(), m: S.memos.slice() });
    if (S.history.length > 300) S.history.shift();
    S.hpos = S.history.length - 1;
  }
  function restore(pos) {
    if (pos < 0 || pos >= S.history.length || S.done) return;
    S.hpos = pos;
    S.grid = S.history[pos].g.slice(); S.memos = S.history[pos].m.slice();
    S.wrong.clear(); S.hinted = -1;
    render(); save();
  }
  function save() {
    if (!S.grid) return;
    store.set('sudoku2.game', {
      puzzle: S.puzzle, solution: S.solution, grid: S.grid, memos: S.memos, meta: S.meta,
      elapsed: S.elapsed + (S.tick ? Date.now() - S.last : 0), done: S.done, revealed: S.revealed, hintsUsed: S.hintsUsed,
    });
  }
  function savePrefs() { prefs.opts = opts; store.set('sudoku2.prefs', prefs); }

  // ------------------------------------------------------------ 入力
  function locked() { return !S.grid || S.done || S.paused || S.busy; }
  function input(d, forceMemo) {
    if (locked() || S.sel < 0) return;
    const i = S.sel;
    if (S.puzzle[i]) { note('そこは最初からあるヒントなので書き換えられません。'); return; }
    const memo = forceMemo || S.memoMode;
    const bit = 1 << (d - 1);
    if (memo) {
      if (S.grid[i]) S.grid[i] = 0;
      S.memos[i] ^= bit;
    } else if (S.grid[i] === d) {
      S.grid[i] = 0;
    } else {
      S.grid[i] = d;
      S.memos[i] = 0;
      for (const p of E.PEERS[i]) S.memos[p] &= ~bit;   // 周りのメモから同じ数字を消す
    }
    S.wrong.delete(i); S.hinted = -1;
    snapshot(); render(); save(); note('');
    checkDone();
  }
  function erase() {
    if (locked() || S.sel < 0) return;
    const i = S.sel;
    if (S.puzzle[i] || (!S.grid[i] && !S.memos[i])) return;
    if (S.grid[i]) S.grid[i] = 0; else S.memos[i] = 0;
    S.wrong.delete(i);
    snapshot(); render(); save();
  }
  function move(dr, dc) {
    if (S.sel < 0) S.sel = 40;
    else {
      const r = Math.max(0, Math.min(8, ((S.sel / 9) | 0) + dr)), c = Math.max(0, Math.min(8, S.sel % 9 + dc));
      S.sel = r * 9 + c;
    }
    render();
  }
  function checkDone() {
    for (let i = 0; i < 81; i++) if (!S.grid[i]) return;
    for (let i = 0; i < 81; i++) if (S.grid[i] !== S.solution[i]) {
      note('すべて埋まりましたが、どこかが違っています。「答え合わせ」で場所を確かめられます。', true);
      return;
    }
    finish(false);
  }
  function finish(revealed) {
    stopClock();
    S.done = true; S.revealed = revealed; S.sel = -1; S.hinted = -1;
    if (!revealed) {
      $('stamp').classList.add('on');
      note('<b>完成です。</b> 時間 ' + fmt(S.elapsed) + (S.hintsUsed ? '、ヒント ' + S.hintsUsed + ' 回' : '、ヒントなし') + '。');
    } else note('解答を表示しました。');
    render(); save();
  }

  // ------------------------------------------------------------ 操作ボタン
  function check() {
    if (locked()) return;
    S.wrong.clear();
    let filled = 0;
    for (let i = 0; i < 81; i++) if (!S.puzzle[i] && S.grid[i]) { filled++; if (S.grid[i] !== S.solution[i]) S.wrong.add(i); }
    render();
    if (S.wrong.size) note('<b>' + S.wrong.size + ' か所</b>が違っています。朱で印をつけました。', true);
    else note(filled ? 'ここまで ' + filled + ' マス、すべて合っています。' : 'まだ何も書かれていません。');
    return S.wrong.size === 0;
  }
  function hint() {
    if (locked()) return;
    if (S.hinted >= 0 && !S.grid[S.hinted]) {           // 2 回目: 数字を入れる
      S.sel = S.hinted; const d = S.hintDigit;
      const mm = S.memoMode; S.memoMode = false; input(d); S.memoMode = mm;
      note('<b>' + d + '</b> を入れました。'); render();
      return;
    }
    for (let i = 0; i < 81; i++) if (S.grid[i] && S.grid[i] !== S.solution[i]) { check(); return; }
    S.hintsUsed++;
    const h = E.hint(S.grid);
    if (h) {
      S.hinted = S.sel = h.cell; S.hintDigit = h.digit;
      let msg = '<b>' + cellName(h.cell) + '</b> が決まります。';
      if (h.tech === 'hiddenSingle') {
        const u = h.unit < 9 ? '箱' : h.unit < 18 ? '行' : '列';
        msg += 'この' + u + 'の中で、ある数字が入れられるのはここだけです（' + h.techJa + '）。';
      } else msg += 'ほかの数字はすべて行・列・箱にあって、入るのは 1 つだけです（' + h.techJa + '）。';
      if (h.via.length) {
        const names = Array.from(new Set(h.via.map((v) => v.techJa)));
        msg += ' その前に <b>' + names.join('、') + '</b> で候補を消す必要があります。';
      }
      note(msg + ' もう一度「ヒント」で数字を入れます。');
    } else {
      // 定番の手筋では進めない局面: 候補がいちばん少ないマスを教える
      const cand = E.candidates(S.grid);
      let best = -1, bc = 10;
      for (let i = 0; i < 81; i++) if (!S.grid[i]) { let n = 0; for (let b = cand[i]; b; b &= b - 1) n++; if (n < bc) { bc = n; best = i; } }
      if (best < 0) return;
      S.hinted = S.sel = best; S.hintDigit = S.solution[best];
      note('ここからは定番の手筋では進めません。<b>' + cellName(best) + '</b> は候補が ' + bc + ' つなので、仮置きの起点に向いています。もう一度「ヒント」で正解を入れます。');
    }
    render(); save();
  }
  function autoMemo() {
    if (locked()) return;
    const cand = E.candidates(S.grid);
    for (let i = 0; i < 81; i++) if (!S.grid[i]) S.memos[i] = cand[i];
    snapshot(); render(); save();
    note('空きマスすべてに、いま入りうる数字をメモしました。');
  }
  function ask(text, yes, fn) {
    const d = $('confirm');
    $('confirm-text').textContent = text; $('confirm-yes').textContent = yes;
    d.returnValue = 'no';
    d.onclose = () => { if (d.returnValue === 'yes') fn(); };
    d.showModal();
  }
  function reset() {
    if (!S.grid || S.busy) return;
    ask('書いた数字とメモをすべて消して、最初からやり直しますか？ 時計も 0 に戻ります。', 'やり直す', () => {
      load({ puzzle: S.puzzle, solution: S.solution, meta: S.meta }, false);
      note('最初の状態に戻しました。');
    });
  }
  function reveal() {
    if (locked()) return;
    ask('解答を表示しますか？ この問題はここで終わりになります。', '解答を見る', () => {
      S.grid = S.solution.slice(); S.memos = new Array(81).fill(0); S.wrong.clear();
      finish(true);
    });
  }

  // ------------------------------------------------------------ 問題の読み込み
  function patternLabel(m) {
    if (m.fallback) return E.SYMS[m.sym].ja;
    if (m.shape) return E.SHAPES[m.shape].ja + (m.exact ? '' : '（崩し）');
    return E.SYMS[m.sym].ja;
  }
  function load(g, animate) {
    stopClock();
    S.puzzle = g.puzzle.slice(); S.solution = g.solution.slice();
    S.grid = (g.grid || g.puzzle).slice();
    S.memos = (g.memos || new Array(81).fill(0)).slice();
    S.meta = g.meta;
    S.elapsed = g.elapsed || 0; S.done = !!g.done; S.revealed = !!g.revealed; S.hintsUsed = g.hintsUsed || 0;
    S.paused = false; S.wrong.clear(); S.hinted = -1; S.sel = S.done ? -1 : 40;
    S.history = []; S.hpos = -1; snapshot();
    $('s-grade').textContent = E.GRADES[S.meta.tier].ja;
    $('s-pattern').textContent = patternLabel(S.meta);
    $('s-hints').textContent = S.meta.hints;
    $('pause-btn').textContent = '止める';
    $('stamp').classList.toggle('on', S.done && !S.revealed);
    veil(null);
    render();
    if (animate) {
      board.classList.remove('printing'); void board.offsetWidth; board.classList.add('printing');
      setTimeout(() => board.classList.remove('printing'), 1200);
    }
    startClock(); save();
  }

  // ------------------------------------------------------------ 生成（Web Worker）
  // engine.js を文字列化して Blob の Worker にするので file:// でも動く。
  let worker = null;
  function makeWorker() {
    const src = 'const E=(' + SudokuEngineFactory.toString() + ')();' +
      'onmessage=function(e){var t=0;var r=E.generate(e.data,function(p){var n=Date.now();if(n-t>80){t=n;postMessage({p:p});}});postMessage({r:r});};';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
  }
  function generate() {
    if (S.busy) return;
    S.busy = true; stopClock();
    $('stamp').classList.remove('on');
    const o = Object.assign({ budgetMs: 6000 }, opts);
    const t0 = Date.now();
    const finishGen = (r) => {
      S.busy = false;
      const meta = { grade: r.grade, tier: r.tier, hints: r.hints, sym: r.sym, shape: r.shape, exact: r.exact, fallback: !!r.fallback, uses: r.uses };
      load({ puzzle: r.puzzle, solution: r.solution, meta }, true);
      const techs = Object.keys(r.uses).filter((k) => E.TECH[k].tier >= 3).map((k) => E.TECH[k].ja);
      let msg = '<b>' + E.GRADES[r.tier].ja + '</b>、ヒント ' + r.hints + ' 個、' + patternLabel(meta) + '。';
      if (r.tier !== r.grade) msg += ' この模様では「' + E.GRADES[r.grade].ja + '」ちょうどが見つからず、いちばん近いものを出しました。';
      else if (r.fallback) msg += ' 図形どおりには作れなかったので、点対称で作りました。';
      else if (r.shape && !r.exact && !opts.erode) msg += ' 一意解にするため、図形に少しマスを足しています。';
      if (techs.length) msg += ' 使う手筋: ' + techs.join('、') + '。';
      note(msg);
    };
    veil('問題をつくっています', '', 'やめる', () => {
      if (worker) { worker.terminate(); worker = null; }
      S.busy = false;
      if (S.grid) { veil(null); startClock(); } else { opts.mode = 'sym'; opts.grade = 2; generate(); }
    });
    const onProgress = (p) => { $('veil-sub').textContent = '試行 ' + p.attempts + ' 回 / ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒'; };
    try {
      if (!worker) worker = makeWorker();
      worker.onmessage = (e) => { if (e.data.p) onProgress(e.data.p); else finishGen(e.data.r); };
      worker.onerror = () => { worker = null; setTimeout(() => finishGen(E.generate(o)), 30); };
      worker.postMessage(o);
    } catch (err) {
      worker = null;
      setTimeout(() => finishGen(E.generate(o)), 30);     // Worker が使えない環境
    }
  }

  // ------------------------------------------------------------ 問題づくりのダイアログ
  function thumbSvg(mask) {
    let s = '<svg viewBox="0 0 9 9" aria-hidden="true">';
    for (let i = 0; i < 81; i++) if (mask[i]) s += '<rect class="on" x="' + (i % 9 + .08) + '" y="' + (((i / 9) | 0) + .08) + '" width=".84" height=".84"/>';
    s += '<path class="grid" d="M3 0V9M6 0V9M0 3H9M0 6H9" fill="none"/></svg>';
    return s;
  }
  function sampleSymMask(sym) {              // 対称の見本（毎回同じ絵になるよう固定の乱数）
    const r = E.seeded(sym.length * 97 + sym.charCodeAt(0) * 13 + sym.charCodeAt(sym.length - 1));
    const orbs = E.orbits(sym), m = new Uint8Array(81);
    let n = 0;
    while (n < 26) { const o = orbs[(r() * orbs.length) | 0]; if (!m[o[0]]) { for (const i of o) m[i] = 1; n += o.length; } }
    return m;
  }
  const symThumbs = {};
  function buildGallery() {
    const g = $('gallery');
    const isShape = opts.mode === 'shape';
    $('tab-sym').setAttribute('aria-selected', !isShape);
    $('tab-shape').setAttribute('aria-selected', isShape);
    $('erode-row').hidden = !isShape;
    const items = isShape ? E.SHAPES : E.SYMS;
    const cur = isShape ? opts.shape : opts.sym;
    let h = '<button type="button" class="thumb" role="radio" data-k="random" aria-checked="' + (cur === 'random') + '"><span class="q">?</span>おまかせ</button>';
    for (const k of Object.keys(items)) {
      const mask = isShape ? items[k].mask : (symThumbs[k] || (symThumbs[k] = sampleSymMask(k)));
      h += '<button type="button" class="thumb" role="radio" data-k="' + k + '" aria-checked="' + (cur === k) + '">' + thumbSvg(mask) + items[k].ja + '</button>';
    }
    g.innerHTML = h;
  }
  function buildGrades() {
    let h = '';
    for (let k = 1; k <= 5; k++) h += '<button type="button" role="radio" data-g="' + k + '" aria-checked="' + (opts.grade === k) + '">' + E.GRADES[k].ja + '</button>';
    $('grade-row').innerHTML = h;
    $('grade-desc').textContent = GRADE_DESC[opts.grade];
  }
  $('grade-row').addEventListener('click', (e) => { const b = e.target.closest('[data-g]'); if (b) { opts.grade = +b.dataset.g; buildGrades(); } });
  $('gallery').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    if (opts.mode === 'shape') opts.shape = b.dataset.k; else opts.sym = b.dataset.k;
    buildGallery();
  });
  $('tab-sym').addEventListener('click', () => { opts.mode = 'sym'; buildGallery(); });
  $('tab-shape').addEventListener('click', () => { opts.mode = 'shape'; buildGallery(); });
  $('erode').addEventListener('change', (e) => { opts.erode = e.target.checked; });
  $('maker-cancel').addEventListener('click', () => $('maker').close());
  $('maker-form').addEventListener('submit', () => { savePrefs(); generate(); });
  function openMaker() {
    if (S.busy) return;
    $('erode').checked = !!opts.erode;
    buildGrades(); buildGallery();
    $('maker').showModal();
  }

  // ------------------------------------------------------------ ボタン・キー
  $('new-btn').addEventListener('click', openMaker);
  $('memo-btn').addEventListener('click', () => { S.memoMode = !S.memoMode; render(); });
  $('erase-btn').addEventListener('click', erase);
  $('undo-btn').addEventListener('click', () => restore(S.hpos - 1));
  $('redo-btn').addEventListener('click', () => restore(S.hpos + 1));
  $('hint-btn').addEventListener('click', hint);
  $('check-btn').addEventListener('click', check);
  $('automemo-btn').addEventListener('click', autoMemo);
  $('reset-btn').addEventListener('click', reset);
  $('solve-btn').addEventListener('click', reveal);
  $('pause-btn').addEventListener('click', () => setPaused(!S.paused));
  $('help-btn').addEventListener('click', () => $('help').showModal());

  function applyTheme() {
    const dark = prefs.theme ? prefs.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    $('theme-btn').textContent = dark ? 'ノートにする' : '黒板にする';
  }
  $('theme-btn').addEventListener('click', () => {
    prefs.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    savePrefs(); applyTheme();
  });

  document.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); restore(S.hpos - 1); return; }
    if (ctrl && (k === 'y' || k === 'Y' || ((k === 'z' || k === 'Z') && e.shiftKey))) { e.preventDefault(); restore(S.hpos + 1); return; }
    if (ctrl || e.altKey) return;
    if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
    else if (k === 'ArrowDown') { e.preventDefault(); move(1, 0); }
    else if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1); }
    else if (k === 'ArrowRight') { e.preventDefault(); move(0, 1); }
    else if (/^Digit[1-9]$/.test(e.code) || /^Numpad[1-9]$/.test(e.code)) { e.preventDefault(); input(+e.code.slice(-1), e.shiftKey); }
    else if (k === '0' || k === 'Backspace' || k === 'Delete') { e.preventDefault(); erase(); }
    else if (k === 'm' || k === 'M') { S.memoMode = !S.memoMode; render(); }
    else if (k === 'h' || k === 'H') hint();
    else if (k === 'c' || k === 'C') check();
    else if (k === 'p' || k === 'P') setPaused(!S.paused);
    else if (k === 'n' || k === 'N') { e.preventDefault(); openMaker(); }
    else if (k === 'Escape') { S.sel = -1; S.hinted = -1; render(); }
  });
  document.addEventListener('visibilitychange', () => {
    if (!S.grid || S.done || S.paused || S.busy) return;
    if (document.hidden) { stopClock(); save(); } else startClock();
  });
  window.addEventListener('beforeunload', save);

  // ------------------------------------------------------------ 起動
  applyTheme();
  const saved = store.get('sudoku2.game', null);
  if (saved && saved.puzzle && saved.puzzle.length === 81 && saved.meta) {
    load(saved, false);
    if (!saved.done) note('前回の続きから始めます。');
    else if (!saved.revealed) note('この問題は完成しています。「新しい問題をつくる」から次へどうぞ。');
  } else generate();
})();
