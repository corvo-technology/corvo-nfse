// TEMPORARIO: compara o motor ao arredondamento exato (metade para o par) com as aliquotas de 2026.
import { readFileSync } from 'node:fs';

const base = process.env.RTC_URL;
const fx = (n) => JSON.parse(readFileSync(new URL(`../docs/fiscal/rtc/fixtures/${n}.json`, import.meta.url), 'utf8'));
const cases = [
  { fixture: 'ok-consultoria-2026', cbsPct: 90, ufPct: 10 }, // em centésimos de ponto percentual: 0,90% e 0,10%
  { fixture: 'ok-reducao-60-2026', cbsPct: 36, ufPct: 4 },
];
// valor = round_half_even(centavos * pct / 10000)
const rhe = (num, den) => {
  const q = num / den, r = num % den;
  if (r * 2n > den) return q + 1n;
  if (r * 2n < den) return q;
  return q % 2n === 0n ? q : q + 1n;
};
const fmt = (c) => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
const bases = [];
for (let i = 1; i <= 400; i += 1) bases.push(BigInt(i * 137 + (i % 7)));
bases.push(2500n, 1200n, 1400n, 231579n, 69052n, 100000000n);
let diffs = 0, total = 0;
for (const c of cases) {
  const req = fx(c.fixture).steps[0].request;
  for (const b of bases) {
    req.itens[0].baseCalculo = Number(b) / 100;
    const res = await fetch(`${base}/calculadora/regime-geral`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
    const g = (await res.json()).objetos[0].tribCalc.IBSCBS.gIBSCBS;
    const expCbs = fmt(rhe(b * BigInt(c.cbsPct), 10000n));
    const expUf = fmt(rhe(b * BigInt(c.ufPct), 10000n));
    total += 1;
    const ibsOk = g.vIBS === g.gIBSUF.vIBSUF; // municipio 0% em 2026
    if (g.gCBS.vCBS !== expCbs || g.gIBSUF.vIBSUF !== expUf || !ibsOk) {
      diffs += 1;
      console.log(`DIFF ${c.fixture} base=${fmt(b)} motor: cbs=${g.gCBS.vCBS} uf=${g.gIBSUF.vIBSUF} ibs=${g.vIBS} esperado: cbs=${expCbs} uf=${expUf}`);
    }
  }
}
console.log(`varredura: ${total} cálculos, ${diffs} diferenças contra o arredondamento exato`);
