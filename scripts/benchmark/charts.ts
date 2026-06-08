/**
 * Render docs/eval/results.json → brand-matched SVGs for the README.
 * Deterministic, no deps. The chart is downstream of a REAL benchmark run — never
 * hand-drawn. Errors are shown honestly (a failed model is a red row, not omitted).
 *   npx tsx scripts/benchmark/charts.ts
 */
import { readFileSync, writeFileSync } from "node:fs";

const BG = "#111418", PANEL = "#171B20", LINE = "#2A2F37", TEXT = "#E6E1DA", MUTE = "#8B93A1";
const ACCENT = "#D97757", PASS = "#3FB37F", FAIL = "#E0564E";
const MONO = "ui-monospace, 'JetBrains Mono', monospace";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Row = { model: string; ok: boolean; passed: number; total: number; costUsd: number; ms: number; toolCalls: number; error?: string };
const data = JSON.parse(readFileSync(new URL("../../docs/eval/results.json", import.meta.url), "utf8")) as { generatedAt: string; companies: number; checks: string[]; models: Row[] };
const rows = [...data.models].sort((a, b) => (b.passed - a.passed) || (a.costUsd - b.costUsd));
const stamp = `company-research · ${data.companies} companies · ${data.checks.length} boolean checks · ${esc(data.generatedAt.slice(0, 10))}`;

/* ── leaderboard (deepswe style) ── */
function leaderboard(): string {
  const W = 760, rowH = 34, top = 84, H = top + rows.length * rowH + 30;
  const barX = 250, barW = 300, maxChecks = data.checks.length;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${MONO}">`);
  out.push(`<rect width="${W}" height="${H}" rx="14" fill="${BG}"/>`);
  out.push(`<text x="28" y="38" fill="${TEXT}" font-size="18" font-weight="700">NodeRoom diligence benchmark</text>`);
  out.push(`<text x="28" y="60" fill="${MUTE}" font-size="11">${stamp}</text>`);
  out.push(`<line x1="28" y1="${top - 14}" x2="${W - 28}" y2="${top - 14}" stroke="${LINE}"/>`);
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    const frac = r.error ? 0 : r.passed / maxChecks;
    const col = r.error ? FAIL : r.passed === maxChecks ? PASS : ACCENT;
    out.push(`<text x="28" y="${y + 6}" fill="${MUTE}" font-size="12">${i + 1}</text>`);
    out.push(`<text x="48" y="${y + 6}" fill="${TEXT}" font-size="12.5">${esc(r.model)}</text>`);
    out.push(`<rect x="${barX}" y="${y - 7}" width="${barW}" height="14" rx="4" fill="${PANEL}"/>`);
    out.push(`<rect x="${barX}" y="${y - 7}" width="${Math.max(2, barW * frac)}" height="14" rx="4" fill="${col}"/>`);
    const label = r.error ? `ERR` : `${r.passed}/${r.total}`;
    out.push(`<text x="${barX + barW + 10}" y="${y + 5}" fill="${col}" font-size="11.5" font-weight="700">${label}</text>`);
    const cost = r.error ? "—" : `$${r.costUsd.toFixed(4)}`;
    const lat = r.error ? esc(r.error.slice(0, 22)) : `${(r.ms / 1000).toFixed(0)}s`;
    out.push(`<text x="${W - 28}" y="${y + 5}" fill="${MUTE}" font-size="11" text-anchor="end">${cost} · ${lat}</text>`);
  });
  return out.join("");
}

/* ── cost vs quality (Augment Prism style) ── */
function costQuality(): string {
  const W = 760, H = 420, padL = 70, padR = 40, padT = 70, padB = 60;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const ok = rows.filter((r) => !r.error);
  const maxCost = Math.max(0.02, ...ok.map((r) => r.costUsd));
  const x = (c: number) => padL + (c / maxCost) * plotW;
  const y = (pct: number) => padT + plotH - (pct / 100) * plotH;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${MONO}">`);
  out.push(`<rect width="${W}" height="${H}" rx="14" fill="${BG}"/>`);
  out.push(`<text x="28" y="34" fill="${TEXT}" font-size="17" font-weight="700">Cost vs quality — route to the cheapest that clears the gate</text>`);
  out.push(`<text x="28" y="54" fill="${MUTE}" font-size="11">${stamp}</text>`);
  // axes
  out.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${LINE}"/>`);
  out.push(`<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${LINE}"/>`);
  [0, 50, 100].forEach((p) => { out.push(`<text x="${padL - 10}" y="${y(p) + 4}" fill="${MUTE}" font-size="10" text-anchor="end">${p}%</text><line x1="${padL}" y1="${y(p)}" x2="${padL + plotW}" y2="${y(p)}" stroke="${LINE}" stroke-dasharray="2 4" opacity="0.5"/>`); });
  out.push(`<text x="${padL + plotW / 2}" y="${H - 16}" fill="${MUTE}" font-size="11" text-anchor="middle">cost per run (USD) →</text>`);
  out.push(`<text x="20" y="${padT + plotH / 2}" fill="${MUTE}" font-size="11" text-anchor="middle" transform="rotate(-90 20 ${padT + plotH / 2})">quality (checks passed %)</text>`);
  // gate line at 100%
  out.push(`<line x1="${padL}" y1="${y(100)}" x2="${padL + plotW}" y2="${y(100)}" stroke="${PASS}" stroke-dasharray="5 3" opacity="0.7"/><text x="${padL + plotW}" y="${y(100) - 6}" fill="${PASS}" font-size="9.5" text-anchor="end">GATE: all checks</text>`);
  // points
  ok.forEach((r) => {
    const pct = (r.passed / data.checks.length) * 100;
    const cx = x(r.costUsd), cy = y(pct);
    const col = pct === 100 ? PASS : ACCENT;
    out.push(`<circle cx="${cx}" cy="${cy}" r="7" fill="${col}"/><text x="${cx + 11}" y="${cy + 4}" fill="${TEXT}" font-size="10.5">${esc(r.model)} ($${r.costUsd.toFixed(4)})</text>`);
  });
  if (ok.length) {
    const cheapest = ok.filter((r) => r.passed === data.checks.length).sort((a, b) => a.costUsd - b.costUsd)[0];
    if (cheapest) out.push(`<text x="${padL + 6}" y="${padT + 16}" fill="${ACCENT}" font-size="11" font-weight="700">◄ route here: ${esc(cheapest.model)} — cheapest clearing the gate</text>`);
  }
  return out.join("") + "</svg>";
}

const lb = leaderboard() + "</svg>";
writeFileSync(new URL("../../docs/eval/leaderboard.svg", import.meta.url), lb);
writeFileSync(new URL("../../docs/eval/cost-quality.svg", import.meta.url), costQuality());
console.log(`wrote docs/eval/leaderboard.svg + cost-quality.svg (${rows.length} models)`);
