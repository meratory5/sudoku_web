/*
 * 数独エンジン (sudoku_web_2)
 *  - ビット演算 + MRV の高速ソルバ（解の個数を数える / 一意性判定）
 *  - 人間の解き方をなぞる採点器（難易度判定・ヒント）
 *  - 対称ディグ / 図形マスクの局所探索による問題生成
 *
 * ブラウザ本体・Web Worker・Node のどこからでも使えるよう、全体を
 * 1 つの関数 SudokuEngineFactory に閉じ込めてある（Worker には
 * toString() した文字列を Blob で渡すので file:// でも動く）。
 */
(function (root) {
function SudokuEngineFactory() {
  'use strict';

  // ---------------------------------------------------------------- 基本表
  const PC = new Uint8Array(512);            // popcount
  for (let i = 1; i < 512; i++) PC[i] = PC[i >> 1] + (i & 1);
  const DIG = new Uint8Array(512);           // 単一ビット → 数字
  for (let d = 1; d <= 9; d++) DIG[1 << (d - 1)] = d;

  const R = new Uint8Array(81), C = new Uint8Array(81), B = new Uint8Array(81);
  const UNITS = [];                          // 0-8 箱, 9-17 行, 18-26 列
  for (let u = 0; u < 27; u++) UNITS.push([]);
  for (let i = 0; i < 81; i++) {
    R[i] = (i / 9) | 0; C[i] = i % 9; B[i] = ((R[i] / 3) | 0) * 3 + ((C[i] / 3) | 0);
    UNITS[B[i]].push(i); UNITS[9 + R[i]].push(i); UNITS[18 + C[i]].push(i);
  }
  const PEERS = [];
  const SEES = new Uint8Array(81 * 81);
  for (let i = 0; i < 81; i++) {
    const p = [];
    for (let j = 0; j < 81; j++) {
      if (i !== j && (R[i] === R[j] || C[i] === C[j] || B[i] === B[j])) { p.push(j); SEES[i * 81 + j] = 1; }
    }
    PEERS.push(p);
  }

  let rnd = Math.random;
  function setRandom(fn) { rnd = fn || Math.random; }
  function seeded(seed) {                    // mulberry32
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // ---------------------------------------------------------------- 高速ソルバ
  // 解を limit 個まで数える。out1/out2 に 1 個目・2 個目の解を書き込む。
  function solveCount(puz, limit, out1, out2, random) {
    const g = new Uint8Array(81);
    const rm = new Uint16Array(9), cm = new Uint16Array(9), bm = new Uint16Array(9);
    const empt = [];
    for (let i = 0; i < 81; i++) {
      const d = puz[i];
      if (d) {
        const b = 1 << (d - 1);
        if ((rm[R[i]] | cm[C[i]] | bm[B[i]]) & b) return 0;
        rm[R[i]] |= b; cm[C[i]] |= b; bm[B[i]] |= b; g[i] = d;
      } else empt.push(i);
    }
    let count = 0;
    (function rec(n) {
      if (n === 0) {
        count++;
        if (count === 1 && out1) out1.set(g); else if (count === 2 && out2) out2.set(g);
        return;
      }
      let bk = -1, bc = 10, mask = 0;
      for (let k = 0; k < n; k++) {
        const i = empt[k];
        const m = 511 & ~(rm[R[i]] | cm[C[i]] | bm[B[i]]);
        const p = PC[m];
        if (p < bc) {
          if (p === 0) return;
          bc = p; bk = k; mask = m;
          if (p === 1) break;
        }
      }
      const i = empt[bk]; empt[bk] = empt[n - 1]; empt[n - 1] = i;
      const r = R[i], c = C[i], x = B[i];
      while (mask) {
        let b;
        if (random) {
          let idx = (rnd() * PC[mask]) | 0, t = mask;
          while (idx--) t &= t - 1;
          b = t & -t;
        } else b = mask & -mask;
        mask ^= b;
        rm[r] |= b; cm[c] |= b; bm[x] |= b; g[i] = DIG[b];
        rec(n - 1);
        rm[r] ^= b; cm[c] ^= b; bm[x] ^= b;
        if (count >= limit) break;
      }
      g[i] = 0;
      empt[n - 1] = empt[bk]; empt[bk] = i;
    })(empt.length);
    return count;
  }
  function isUnique(puz) { return solveCount(puz, 2) === 1; }
  function solve(puz) {
    const out = new Uint8Array(81);
    return solveCount(puz, 1, out) ? Array.from(out) : null;
  }
  function randomSolution() {
    const out = new Uint8Array(81);
    solveCount(new Uint8Array(81), 1, out, null, true);
    return out;
  }

  // ---------------------------------------------------------------- 人間的解法
  // tier 1: 隠れシングル / 2: 裸のシングル / 3: ロック候補・ペア
  // tier 4: トリプル・X-Wing・XY-Wing・ソードフィッシュ・クアッド / 5: それ以上
  const TECH = {
    hiddenSingle: { tier: 1, w: 1,  ja: '隠れシングル' },
    nakedSingle:  { tier: 2, w: 2,  ja: '裸のシングル' },
    pointing:     { tier: 3, w: 8,  ja: 'ポインティング' },
    claiming:     { tier: 3, w: 10, ja: 'ボックスライン' },
    nakedPair:    { tier: 3, w: 12, ja: '裸のペア' },
    hiddenPair:   { tier: 3, w: 16, ja: '隠れペア' },
    nakedTriple:  { tier: 4, w: 24, ja: '裸のトリプル' },
    hiddenTriple: { tier: 4, w: 30, ja: '隠れトリプル' },
    xWing:        { tier: 4, w: 36, ja: 'X-Wing' },
    xyWing:       { tier: 4, w: 40, ja: 'XY-Wing' },
    swordfish:    { tier: 4, w: 50, ja: 'ソードフィッシュ' },
    nakedQuad:    { tier: 4, w: 50, ja: '裸のクアッド' },
  };

  function makeHuman(puz) {
    const val = new Uint8Array(81), cand = new Uint16Array(81);
    let left = 0;
    for (let i = 0; i < 81; i++) val[i] = puz[i];
    for (let i = 0; i < 81; i++) {
      if (val[i]) continue;
      let used = 0;
      const p = PEERS[i];
      for (let k = 0; k < 20; k++) { const v = val[p[k]]; if (v) used |= 1 << (v - 1); }
      cand[i] = 511 & ~used; left++;
    }
    return { val, cand, left };
  }
  function place(h, i, d) {
    h.val[i] = d; h.cand[i] = 0; h.left--;
    const nb = ~(1 << (d - 1)), p = PEERS[i];
    for (let k = 0; k < 20; k++) h.cand[p[k]] &= nb;
  }
  // 候補削除を適用。1 つでも消えたら true
  function applyElim(h, elim) {
    let any = false;
    for (let k = 0; k < elim.length; k++) {
      const i = elim[k][0], m = elim[k][1];
      if (h.cand[i] & m) { h.cand[i] &= ~m; any = true; }
    }
    return any;
  }

  function tHiddenSingle(h) {
    const cand = h.cand;
    for (let u = 0; u < 27; u++) {
      const cells = UNITS[u];
      let once = 0, twice = 0;
      for (let k = 0; k < 9; k++) { const c = cand[cells[k]]; twice |= once & c; once |= c; }
      const s = once & ~twice;
      if (s) {
        const b = s & -s;
        for (let k = 0; k < 9; k++) if (cand[cells[k]] & b) {
          place(h, cells[k], DIG[b]);
          return { tech: 'hiddenSingle', cell: cells[k], digit: DIG[b], unit: u };
        }
      }
    }
    return null;
  }
  function tNakedSingle(h) {
    for (let i = 0; i < 81; i++) {
      const c = h.cand[i];
      if (c && PC[c] === 1) { place(h, i, DIG[c]); return { tech: 'nakedSingle', cell: i, digit: DIG[c] }; }
    }
    return null;
  }
  function tPointing(h) {
    const cand = h.cand;
    for (let u = 0; u < 9; u++) {
      const cells = UNITS[u];
      for (let b = 1; b < 512; b <<= 1) {
        let n = 0, r = -1, c = -1, sameR = true, sameC = true;
        const src = [];
        for (let k = 0; k < 9; k++) {
          const i = cells[k];
          if (cand[i] & b) {
            if (n === 0) { r = R[i]; c = C[i]; } else { if (R[i] !== r) sameR = false; if (C[i] !== c) sameC = false; }
            n++; src.push(i);
          }
        }
        if (n < 2 || (!sameR && !sameC)) continue;
        const line = sameR ? UNITS[9 + r] : UNITS[18 + c];
        const elim = [];
        for (let k = 0; k < 9; k++) { const i = line[k]; if (B[i] !== u && (cand[i] & b)) elim.push([i, b]); }
        if (elim.length) { applyElim(h, elim); return { tech: 'pointing', cells: src, digit: DIG[b], elim }; }
      }
    }
    return null;
  }
  function tClaiming(h) {
    const cand = h.cand;
    for (let u = 9; u < 27; u++) {
      const cells = UNITS[u];
      for (let b = 1; b < 512; b <<= 1) {
        let n = 0, bx = -1, same = true;
        const src = [];
        for (let k = 0; k < 9; k++) {
          const i = cells[k];
          if (cand[i] & b) { if (n === 0) bx = B[i]; else if (B[i] !== bx) same = false; n++; src.push(i); }
        }
        if (n < 2 || !same) continue;
        const box = UNITS[bx], elim = [];
        for (let k = 0; k < 9; k++) {
          const i = box[k];
          if ((cand[i] & b) && (u < 18 ? R[i] !== u - 9 : C[i] !== u - 18)) elim.push([i, b]);
        }
        if (elim.length) { applyElim(h, elim); return { tech: 'claiming', cells: src, digit: DIG[b], elim }; }
      }
    }
    return null;
  }
  // n 個の組合せを列挙（items の添字）。fn が真を返したら打ち切り
  function combos(len, n, fn) {
    const idx = [];
    return (function rec(start) {
      if (idx.length === n) return fn(idx);
      for (let i = start; i <= len - (n - idx.length); i++) {
        idx.push(i);
        const r = rec(i + 1);
        idx.pop();
        if (r) return r;
      }
      return null;
    })(0);
  }
  function tNakedSubset(h, n, name) {
    const cand = h.cand;
    for (let u = 0; u < 27; u++) {
      const open = [];
      const cells = UNITS[u];
      let unsolved = 0;
      for (let k = 0; k < 9; k++) { const c = cand[cells[k]]; if (c) { unsolved++; if (PC[c] <= n) open.push(cells[k]); } }
      if (unsolved <= n || open.length < n) continue;
      const res = combos(open.length, n, (idx) => {
        let m = 0;
        for (let k = 0; k < n; k++) m |= cand[open[idx[k]]];
        if (PC[m] !== n) return null;
        const set = idx.map((k) => open[k]), elim = [];
        for (let k = 0; k < 9; k++) {
          const i = cells[k];
          if ((cand[i] & m) && set.indexOf(i) < 0) elim.push([i, cand[i] & m]);
        }
        return elim.length ? { tech: name, cells: set, mask: m, elim } : null;
      });
      if (res) { applyElim(h, res.elim); return res; }
    }
    return null;
  }
  function tHiddenSubset(h, n, name) {
    const cand = h.cand;
    for (let u = 0; u < 27; u++) {
      const cells = UNITS[u];
      const digs = [], pos = [];
      for (let d = 0; d < 9; d++) {
        let pm = 0;
        for (let k = 0; k < 9; k++) if (cand[cells[k]] & (1 << d)) pm |= 1 << k;
        if (pm && PC[pm] <= n) { digs.push(d); pos.push(pm); }
      }
      if (digs.length < n) continue;
      const res = combos(digs.length, n, (idx) => {
        let pm = 0, dm = 0;
        for (let k = 0; k < n; k++) { pm |= pos[idx[k]]; dm |= 1 << digs[idx[k]]; }
        if (PC[pm] !== n) return null;
        const set = [], elim = [];
        for (let k = 0; k < 9; k++) if (pm & (1 << k)) {
          const i = cells[k]; set.push(i);
          if (cand[i] & ~dm) elim.push([i, cand[i] & ~dm]);
        }
        return elim.length ? { tech: name, cells: set, mask: dm, elim } : null;
      });
      if (res) { applyElim(h, res.elim); return res; }
    }
    return null;
  }
  function tFish(h, n, name) {
    const cand = h.cand;
    for (let b = 1; b < 512; b <<= 1) {
      for (let orient = 0; orient < 2; orient++) {
        const lines = [], pos = [];
        for (let l = 0; l < 9; l++) {
          let pm = 0;
          for (let k = 0; k < 9; k++) if (cand[orient ? k * 9 + l : l * 9 + k] & b) pm |= 1 << k;
          if (PC[pm] >= 2 && PC[pm] <= n) { lines.push(l); pos.push(pm); }
        }
        if (lines.length < n) continue;
        const res = combos(lines.length, n, (idx) => {
          let pm = 0;
          for (let k = 0; k < n; k++) pm |= pos[idx[k]];
          if (PC[pm] !== n) return null;
          const base = idx.map((k) => lines[k]), elim = [], set = [];
          for (let l = 0; l < 9; l++) for (let k = 0; k < 9; k++) {
            if (!(pm & (1 << k))) continue;
            const i = orient ? k * 9 + l : l * 9 + k;
            if (!(cand[i] & b)) continue;
            if (base.indexOf(l) < 0) elim.push([i, b]); else set.push(i);
          }
          return elim.length ? { tech: name, cells: set, digit: DIG[b], elim } : null;
        });
        if (res) { applyElim(h, res.elim); return res; }
      }
    }
    return null;
  }
  function tXYWing(h) {
    const cand = h.cand;
    for (let p = 0; p < 81; p++) {
      const pc = cand[p];
      if (PC[pc] !== 2) continue;
      const wings = [];
      const pp = PEERS[p];
      for (let k = 0; k < 20; k++) { const c = cand[pp[k]]; if (PC[c] === 2 && PC[c & pc] === 1) wings.push(pp[k]); }
      for (let a = 0; a < wings.length; a++) for (let b2 = a + 1; b2 < wings.length; b2++) {
        const wa = wings[a], wb = wings[b2];
        const ca = cand[wa], cb = cand[wb];
        if ((ca & pc) === (cb & pc)) continue;
        const z = ca & cb & ~pc;
        if (!z || PC[z] !== 1) continue;
        const elim = [];
        for (let i = 0; i < 81; i++) {
          if ((cand[i] & z) && i !== wa && i !== wb && SEES[i * 81 + wa] && SEES[i * 81 + wb]) elim.push([i, z]);
        }
        if (elim.length) { applyElim(h, elim); return { tech: 'xyWing', cells: [p, wa, wb], digit: DIG[z], elim }; }
      }
    }
    return null;
  }

  const ORDER = [
    ['hiddenSingle', tHiddenSingle],
    ['nakedSingle', tNakedSingle],
    ['pointing', tPointing],
    ['claiming', tClaiming],
    ['nakedPair', (h) => tNakedSubset(h, 2, 'nakedPair')],
    ['hiddenPair', (h) => tHiddenSubset(h, 2, 'hiddenPair')],
    ['nakedTriple', (h) => tNakedSubset(h, 3, 'nakedTriple')],
    ['hiddenTriple', (h) => tHiddenSubset(h, 3, 'hiddenTriple')],
    ['xWing', (h) => tFish(h, 2, 'xWing')],
    ['xyWing', tXYWing],
    ['swordfish', (h) => tFish(h, 3, 'swordfish')],
    ['nakedQuad', (h) => tNakedSubset(h, 4, 'nakedQuad')],
  ];
  function nextStep(h, maxTier) {
    for (let k = 0; k < ORDER.length; k++) {
      if (TECH[ORDER[k][0]].tier > maxTier) break;
      const s = ORDER[k][1](h);
      if (s) return s;
    }
    return null;
  }
  // 人間的解法で解く。tier = 必要だった最高段階（解けなければ 5）
  function rate(puz, maxTier) {
    if (maxTier === undefined) maxTier = 4;
    const h = makeHuman(puz);
    const uses = {};
    let tier = 0, score = 0;
    while (h.left > 0) {
      const s = nextStep(h, maxTier);
      if (!s) break;
      const t = TECH[s.tech];
      uses[s.tech] = (uses[s.tech] || 0) + 1;
      if (t.tier > tier) tier = t.tier;
      score += t.w;
    }
    const solved = h.left === 0;
    return { solved, tier: solved ? Math.max(tier, 1) : 5, uses, score, left: h.left };
  }
  // 次に確定できる 1 マスを、そこに至る理由つきで返す
  function hint(grid) {
    const h = makeHuman(grid);
    const via = [];
    for (;;) {
      const s = nextStep(h, 4);
      if (!s) return null;
      if (s.cell !== undefined) {
        return { cell: s.cell, digit: s.digit, tech: s.tech, techJa: TECH[s.tech].ja, unit: s.unit,
                 via: via.map((v) => ({ tech: v.tech, techJa: TECH[v.tech].ja, cells: v.cells })) };
      }
      if (via.length < 12) via.push(s);
    }
  }
  function candidates(grid) { return Array.from(makeHuman(grid).cand); }

  // ---------------------------------------------------------------- 対称
  const SYMS = {
    none:     { ja: '対称なし',     gen: [] },
    rot180:   { ja: '点対称',       gen: [(r, c) => [8 - r, 8 - c]] },
    rot90:    { ja: '90°回転',      gen: [(r, c) => [c, 8 - r]] },
    mirrorLR: { ja: '左右鏡映',     gen: [(r, c) => [r, 8 - c]] },
    mirrorUD: { ja: '上下鏡映',     gen: [(r, c) => [8 - r, c]] },
    diag:     { ja: '対角鏡映',     gen: [(r, c) => [c, r]] },
    anti:     { ja: '逆対角鏡映',   gen: [(r, c) => [8 - c, 8 - r]] },
    cross:    { ja: '上下左右鏡映', gen: [(r, c) => [r, 8 - c], (r, c) => [8 - r, c]] },
    diag2:    { ja: '両対角鏡映',   gen: [(r, c) => [c, r], (r, c) => [8 - c, 8 - r]] },
    full:     { ja: '全対称',       gen: [(r, c) => [r, 8 - c], (r, c) => [c, r]] },
  };
  const RANDOM_SYMS = ['rot180', 'rot180', 'rot90', 'mirrorLR', 'mirrorUD', 'diag', 'anti', 'cross', 'diag2', 'full'];
  function orbits(sym, within) {
    const gen = SYMS[sym].gen, seen = new Uint8Array(81), out = [];
    for (let i = 0; i < 81; i++) {
      if (seen[i] || (within && !within[i])) continue;
      const orb = [i]; seen[i] = 1;
      for (let k = 0; k < orb.length; k++) {
        for (let g = 0; g < gen.length; g++) {
          const rc = gen[g](R[orb[k]], C[orb[k]]), j = rc[0] * 9 + rc[1];
          if (!seen[j]) { seen[j] = 1; orb.push(j); }
        }
      }
      out.push(orb);
    }
    return out;
  }
  function maskHasSym(mask, sym) {
    const gen = SYMS[sym].gen;
    for (let i = 0; i < 81; i++) for (let g = 0; g < gen.length; g++) {
      const rc = gen[g](R[i], C[i]);
      if (!!mask[i] !== !!mask[rc[0] * 9 + rc[1]]) return false;
    }
    return true;
  }
  function bestMaskSym(mask) {
    const pref = ['full', 'cross', 'diag2', 'rot90', 'mirrorLR', 'mirrorUD', 'diag', 'anti', 'rot180'];
    for (let k = 0; k < pref.length; k++) if (maskHasSym(mask, pref[k])) return pref[k];
    return 'none';
  }

  // ---------------------------------------------------------------- 図形マスク
  function M(rows) { const m = new Uint8Array(81); rows.join('').split('').forEach((ch, i) => { m[i] = ch === '#' ? 1 : 0; }); return m; }
  function F(fn) { const m = new Uint8Array(81); for (let i = 0; i < 81; i++) m[i] = fn(R[i], C[i], Math.abs(R[i] - 4), Math.abs(C[i] - 4)) ? 1 : 0; return m; }
  function ROT(list) { const m = new Uint8Array(81); list.forEach((rc) => { let r = rc[0], c = rc[1]; for (let k = 0; k < 4; k++) { m[r * 9 + c] = 1; const t = r; r = c; c = 8 - t; } }); return m; }
  const SHAPES = {
    heart: { ja: 'ハート', mask: M([
      '.##...##.',
      '####.####',
      '##.###.##',
      '#...#...#',
      '##.....##',
      '.##...##.',
      '..##.##..',
      '...###...',
      '....#....']) },
    diamond:  { ja: 'ひし形', mask: F((r, c, a, b) => a + b === 4 || a + b === 2 || a + b === 0) },
    sparkle:  { ja: 'きらめき', mask: F((r, c, a, b) => a === b || a + b === 4) },
    ring:     { ja: 'リング', mask: F((r, c, a, b) => { const d = Math.sqrt(a * a + b * b); return (d > 3.1 && d < 4.3) || d === 0; }) },
    pinwheel: { ja: '風車', mask: ROT([[0, 3], [0, 4], [1, 4], [1, 5], [2, 5], [2, 6], [3, 4], [4, 4]]) },
    stripes:  { ja: '斜め縞', mask: F((r, c) => (r + c) % 3 === 0) },
    checker:  { ja: '市松', mask: F((r, c, a, b) => (r + c) % 2 === 0 && a + b !== 2) },
    smile: { ja: 'スマイル', mask: M([
      '..#####..',
      '.#.....#.',
      '#..#.#..#',
      '#..#.#..#',
      '#.......#',
      '#.#...#.#',
      '#..###..#',
      '.#.....#.',
      '..#####..']) },
    flower: { ja: '花', mask: M([
      '...#.#...',
      '..#.#.#..',
      '.#..#..#.',
      '#..#.#..#',
      '.##.#.##.',
      '#..#.#..#',
      '.#..#..#.',
      '..#.#.#..',
      '...#.#...']) },
    zigzag: { ja: 'ジグザグ', mask: M([
      '#...#...#',
      '.#.#.#.#.',
      '..#...#..',
      '#...#...#',
      '.#.#.#.#.',
      '..#...#..',
      '#...#...#',
      '.#.#.#.#.',
      '..#...#..']) },
    cat: { ja: 'ねこ', mask: M([
      '#.......#',
      '##.....##',
      '#.#####.#',
      '#.......#',
      '#.#...#.#',
      '#...#...#',
      '#..#.#..#',
      '.#.....#.',
      '..#####..']) },
    hourglass: { ja: '砂時計', mask: M([
      '#########',
      '.#.....#.',
      '..#...#..',
      '...#.#...',
      '....#....',
      '...#.#...',
      '..#...#..',
      '.#.....#.',
      '#########']) },
    snow:   { ja: '雪の結晶', mask: F((r, c, a, b) => a === b || ((a === 0 || b === 0) && (a + b) !== 1 && (a + b) !== 3)) },
    stairs: { ja: '階段', mask: F((r, c) => { const d = c - r; return d === 0 || d === 1 || d === -1 || Math.abs(d) === 5; }) },
    frame:  { ja: '額縁', mask: F((r, c, a, b) => { const m = Math.max(a, b); return (m === 4 && (a + b) % 2 === 0) || m === 2 || m === 0; }) },
    butterfly: { ja: 'ちょう', mask: M([
      '##.....##',
      '#.#...#.#',
      '#..#.#..#',
      '.#.###.#.',
      '....#....',
      '.#.###.#.',
      '#..#.#..#',
      '#.#...#.#',
      '##.....##']) },
  };

  // ---------------------------------------------------------------- 生成
  const GRADES = {
    1: { ja: 'やさしい',   floor: [36, 40] },
    2: { ja: 'ふつう',     floor: [28, 32] },
    3: { ja: 'むずかしい', floor: [0, 0] },
    4: { ja: '達人',       floor: [0, 0] },
    5: { ja: '鬼',         floor: [0, 0] },
  };
  function countHints(p) { let n = 0; for (let i = 0; i < 81; i++) if (p[i]) n++; return n; }
  // その段階までの解法で解けるか（5 は一意性のみ）
  function passes(p, grade) { return grade >= 5 ? isUnique(p) : rate(p, grade).solved; }
  function actualTier(p) { return rate(p, 4); }

  // 軌道（対称な組）単位で、条件を保てる限りヒントを抜く
  function dig(p, orbs, grade, floor) {
    let hints = countHints(p);
    shuffle(orbs);
    for (let k = 0; k < orbs.length; k++) {
      const o = orbs[k];
      if (!p[o[0]] || hints - o.length < floor) continue;
      const save = o.map((i) => p[i]);
      for (let j = 0; j < o.length; j++) p[o[j]] = 0;
      if (passes(p, grade)) hints -= o.length;
      else for (let j = 0; j < o.length; j++) p[o[j]] = save[j];
    }
    return hints;
  }
  function pickFloor(grade) { const f = GRADES[grade].floor; return f[0] + ((rnd() * (f[1] - f[0] + 1)) | 0); }

  // 候補どうしの優劣: 目標段階に近い → (難問は) ヒントが少ない
  function better(a, b, grade) {
    if (!b) return true;
    const da = Math.abs(a.tier - grade), db = Math.abs(b.tier - grade);
    if (da !== db) return da < db;
    if (a.exact !== b.exact) return a.exact;
    return grade >= 3 ? a.hints < b.hints : false;
  }

  function genSymmetric(opts, deadline, progress) {
    const grade = opts.grade;
    const sym = opts.sym === 'random' ? RANDOM_SYMS[(rnd() * RANDOM_SYMS.length) | 0] : opts.sym;
    const wantMatches = grade >= 3 ? 4 : 1;
    let best = null, attempts = 0, matches = 0;
    while (true) {
      attempts++;
      const sol = randomSolution();
      const p = Array.from(sol);
      const hints = dig(p, orbits(sym), grade, pickFloor(grade));
      const r = actualTier(p);
      const cand = { puzzle: p, solution: Array.from(sol), hints, tier: r.tier, uses: r.uses, score: r.score, exact: true };
      if (better(cand, best, grade)) best = cand;
      if (r.tier === grade) matches++;
      if (progress) progress({ attempts, bestTier: best.tier, bestHints: best.hints });
      if (matches >= wantMatches || now() > deadline) break;
    }
    best.sym = sym; best.shape = null; best.attempts = attempts; best.matched = best.tier === grade;
    return best;
  }

  // 図形マスクにぴったりヒントを置く: 「解の個数」を下げる向きの局所探索で
  // 一意解になる数字の割り当てを探し、その後は一意性を保ったまま難易度を寄せる。
  function genShape(opts, deadline, progress) {
    const grade = opts.grade, CAP = 200;
    const shape = opts.shape === 'random' ? Object.keys(SHAPES)[(rnd() * Object.keys(SHAPES).length) | 0] : opts.shape;
    const mask = Uint8Array.from(SHAPES[shape].mask);
    const msym = bestMaskSym(mask);
    let exact = true, best = null, attempts = 0, matches = 0;
    const t0 = now();
    const sol = new Uint8Array(81), sol2 = new Uint8Array(81);
    const wantMatches = grade >= 3 ? 2 : 1;

    function clueCells() { const a = []; for (let i = 0; i < 81; i++) if (mask[i]) a.push(i); return a; }
    function allowed(p, i) {
      let used = 0; const pp = PEERS[i];
      for (let k = 0; k < 20; k++) { const v = p[pp[k]]; if (v) used |= 1 << (v - 1); }
      return 511 & ~used & ~(1 << (p[i] - 1));
    }
    function randomBit(m) { let idx = (rnd() * PC[m]) | 0; while (idx--) m &= m - 1; return m & -m; }

    outer:
    while (true) {
      // --- 第 1 段: 一意解になる割り当てを探す
      let cells = clueCells();
      const full = randomSolution();
      const p = new Array(81).fill(0);
      for (const i of cells) p[i] = full[i];
      let cnt = solveCount(p, CAP, sol, sol2);
      let stall = 0;
      while (cnt !== 1) {
        if (now() > deadline) break outer;
        const i = cells[(rnd() * cells.length) | 0];
        const al = allowed(p, i);
        if (!al) continue;
        const old = p[i];
        p[i] = DIG[randomBit(al)];
        const c2 = solveCount(p, CAP, sol, sol2);
        attempts++;
        if (c2 >= 1 && c2 <= cnt) { if (c2 < cnt) stall = 0; else stall++; cnt = c2; }
        else { p[i] = old; stall++; }
        if (stall > 400) {
          // この図形では一意解が出にくい: 2 つの解が食い違うマスを対称に足す
          if (now() - t0 > 2500) {
            solveCount(p, 2, sol, sol2);
            const diff = [];
            for (let j = 0; j < 81; j++) if (sol[j] !== sol2[j]) diff.push(j);
            if (diff.length) {
              const j = diff[(rnd() * diff.length) | 0];
              const orb = orbits(msym).find((o) => o.indexOf(j) >= 0);
              for (const q of orb) mask[q] = 1;
              exact = false;
            }
          }
          continue outer;
        }
        if (progress && attempts % 50 === 0) progress({ attempts, bestTier: best ? best.tier : 0, bestHints: best ? best.hints : 0 });
      }
      solveCount(p, 1, sol);
      // --- 「さらに削る」: 図形の内側を対称に間引く（元アプリの EXTREME 相当）
      const consider = (q) => {
        const r = actualTier(q);
        const cand = { puzzle: q.slice(), solution: Array.from(sol), hints: countHints(q), tier: r.tier, uses: r.uses, score: r.score, exact: exact && !opts.erode };
        if (better(cand, best, grade)) best = cand;
        return r.tier;
      };
      let tier;
      if (opts.erode) {
        const q = p.slice();
        dig(q, orbits(msym, mask), grade, pickFloor(grade));
        tier = consider(q);
      } else {
        // --- 第 2 段: 一意性を保ったまま数字を入れ替えて難易度を寄せる
        tier = consider(p);
        let tries = 0;
        while (tier !== grade && tries < 300 && now() < deadline) {
          tries++; attempts++;
          const i = cells[(rnd() * cells.length) | 0];
          const al = allowed(p, i);
          if (!al) continue;
          const old = p[i];
          p[i] = DIG[randomBit(al)];
          if (solveCount(p, 2, sol) !== 1) { p[i] = old; continue; }
          const t2 = actualTier(p).tier;
          if (Math.abs(t2 - grade) <= Math.abs(tier - grade)) { tier = t2; consider(p); }
          else { p[i] = old; }
        }
        solveCount(p, 1, sol);
      }
      if (tier === grade) matches++;
      if (progress) progress({ attempts, bestTier: best.tier, bestHints: best.hints });
      if (matches >= wantMatches || now() > deadline) break;
    }
    if (!best) return null;
    best.sym = msym; best.shape = shape; best.attempts = attempts; best.matched = best.tier === grade;
    return best;
  }

  /*
   * opts: { grade:1-5, mode:'sym'|'shape', sym:'random'|キー, shape:'random'|キー,
   *         erode:bool, budgetMs:number }
   */
  function generate(opts, progress) {
    const t0 = now();
    const budget = opts.budgetMs || 6000;
    let res = null;
    if (opts.mode === 'shape') res = genShape(opts, t0 + budget, progress);
    if (!res) {
      res = genSymmetric({ grade: opts.grade, sym: opts.mode === 'shape' ? 'rot180' : (opts.sym || 'random') }, t0 + budget, progress);
      if (opts.mode === 'shape') res.fallback = true;
    }
    res.grade = opts.grade;
    res.ms = Math.round(now() - t0);
    return res;
  }

  return {
    solveCount, isUnique, solve, randomSolution, rate, hint, candidates, generate,
    orbits, bestMaskSym, countHints, setRandom, seeded,
    SYMS, SHAPES, GRADES, TECH, PEERS, UNITS, R, C, B,
  };
}

root.SudokuEngineFactory = SudokuEngineFactory;
if (typeof module !== 'undefined' && module.exports) module.exports = SudokuEngineFactory;
})(typeof self !== 'undefined' ? self : globalThis);
