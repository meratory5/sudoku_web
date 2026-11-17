// node test/verify.js [回数] — 生成器とソルバの実測検証
const E = require('../engine.js')();
const N = +process.argv[2] || 10;
const BUDGET = +process.argv[3] || 6000;

function median(a) { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
function checkValid(res) {
  // 一意解であること・解が正しいこと・ヒントが解と一致すること
  const out = new Uint8Array(81);
  const n = E.solveCount(res.puzzle, 2, out);
  if (n !== 1) return 'not unique (' + n + ')';
  for (let i = 0; i < 81; i++) if (out[i] !== res.solution[i]) return 'solution mismatch';
  for (let u = 0; u < 27; u++) { let m = 0; for (const i of E.UNITS[u]) m |= 1 << res.solution[i]; if (m !== 1022) return 'bad solution'; }
  return null;
}
function isSym(p, sym) { return E.orbits(sym).every((o) => o.every((i) => !!p[i] === !!p[o[0]])); }

// 既知の難問で高速ソルバを確認
const hard = '800000000003600000070090200050007000000045700000100030001000068008500010090000400';
let t = performance.now();
const cnt = E.solveCount(hard.split('').map(Number), 2);
console.log('solver: "world hardest" solutions=' + cnt + ' in ' + (performance.now() - t).toFixed(1) + 'ms');
t = performance.now();
for (let i = 0; i < 200; i++) E.randomSolution();
console.log('randomSolution x200: ' + (performance.now() - t).toFixed(0) + 'ms');

let bad = 0;
console.log('\n== 対称モード (sym=random), 各 ' + N + ' 回, 予算 ' + BUDGET + 'ms');
for (let g = 1; g <= 5; g++) {
  const ms = [], hints = [], tiers = {};
  let matched = 0, symOK = 0;
  for (let k = 0; k < N; k++) {
    const r = E.generate({ grade: g, mode: 'sym', sym: 'random', budgetMs: BUDGET });
    const err = checkValid(r); if (err) { bad++; console.log('  INVALID', err); }
    ms.push(r.ms); hints.push(r.hints); tiers[r.tier] = (tiers[r.tier] || 0) + 1;
    if (r.matched) matched++;
    if (isSym(r.puzzle, r.sym)) symOK++;
  }
  console.log(`grade ${g} ${E.GRADES[g].ja}: 一致 ${matched}/${N} tiers=${JSON.stringify(tiers)} 対称OK ${symOK}/${N} hints ${Math.min(...hints)}-${Math.max(...hints)} (med ${median(hints)}) ms med ${median(ms)} max ${Math.max(...ms)}`);
}

console.log('\n== 対称なし 鬼 (最小ヒント狙い) x' + N);
{
  const hints = [], ms = [];
  for (let k = 0; k < N; k++) { const r = E.generate({ grade: 5, mode: 'sym', sym: 'none', budgetMs: BUDGET }); if (checkValid(r)) bad++; hints.push(r.hints); ms.push(r.ms); }
  console.log(`hints ${Math.min(...hints)}-${Math.max(...hints)} (med ${median(hints)}) ms med ${median(ms)}`);
}

console.log('\n== 図形モード: 各図形 × grade 2,3,4 を ' + Math.max(2, N >> 2) + ' 回');
for (const key of Object.keys(E.SHAPES)) {
  const cells = E.SHAPES[key].mask.reduce((a, b) => a + b, 0);
  let line = `${key.padEnd(10)} ${String(cells).padStart(2)}マス sym=${E.bestMaskSym(E.SHAPES[key].mask).padEnd(8)}`;
  for (const g of [1, 2, 3, 4, 5]) {
    let exact = 0, matched = 0, fb = 0; const ms = [], tiers = [];
    const n = Math.max(2, N >> 2);
    for (let k = 0; k < n; k++) {
      const r = E.generate({ grade: g, mode: 'shape', shape: key, budgetMs: BUDGET });
      const err = checkValid(r); if (err) { bad++; console.log('  INVALID', key, err); }
      if (r.fallback) fb++;
      else if (r.exact && r.puzzle.every((v, i) => !!v === !!E.SHAPES[key].mask[i])) exact++;
      if (r.matched) matched++;
      ms.push(r.ms); tiers.push(r.tier);
    }
    line += ` | g${g}: ぴったり${exact}/${n} 一致${matched}/${n} t=${tiers.join('')} ${median(ms)}ms${fb ? ' FB' + fb : ''}`;
  }
  console.log(line);
}

console.log('\n== 図形 + さらに削る (heart, 鬼) x3');
for (let k = 0; k < 3; k++) {
  const r = E.generate({ grade: 5, mode: 'shape', shape: 'heart', erode: true, budgetMs: BUDGET });
  if (checkValid(r)) bad++;
  console.log(`  hints ${r.hints} tier ${r.tier} ${r.ms}ms`);
}
console.log('\nINVALID total: ' + bad);
