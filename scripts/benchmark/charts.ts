/**
 * Render docs/eval/results.json into README SVG charts.
 * Deterministic, dependency-free, and downstream of real benchmark output.
 * Rows that never produced a meaningful scored work product stay visible, but
 * are quarantined from the cost-quality candidate set.
 */
import { readFileSync, writeFileSync } from "node:fs";

const BG = "#111418";
const PANEL = "#171B20";
const LINE = "#2A2F37";
const TEXT = "#E6E1DA";
const MUTE = "#8B93A1";
const ACCENT = "#D97757";
const PASS = "#3FB37F";
const FAIL = "#E0564E";
const MONO = "ui-monospace, 'JetBrains Mono', monospace";
const BENCHMARK_VERSION = "company-research-v2-9checks-router";

type Row = {
  model: string;
  requestedModel?: string;
  resolvedModel?: string;
  ok: boolean;
  passed: number;
  total: number;
  costUsd: number;
  ms: number;
  steps?: number;
  toolCalls: number;
  error?: string;
};

type Results = {
  benchmarkVersion?: string;
  generatedAt: string;
  companies: number;
  checks: string[];
  models: Row[];
};

type RowBucket = "competed" | "unmeasured" | "error";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const data = JSON.parse(readFileSync(new URL("../../docs/eval/results.json", import.meta.url), "utf8")) as Results;

if (data.benchmarkVersion !== BENCHMARK_VERSION) {
  throw new Error(`benchmark results are stale or missing benchmarkVersion=${BENCHMARK_VERSION}; rerun npm run benchmark or npm run benchmark:free`);
}

const staleRows = data.models.filter((r) => r.total !== data.checks.length);
if (staleRows.length > 0) {
  throw new Error(`benchmark results contain stale rows with totals that do not match ${data.checks.length} checks: ${staleRows.map((r) => `${r.model}=${r.total}`).join(", ")}`);
}

function bucket(row: Row): RowBucket {
  if (row.error) return "error";
  if (row.passed === 0 && row.costUsd === 0 && row.toolCalls <= 6) return "unmeasured";
  return "competed";
}

const bucketRank = (row: Row) => ({ competed: 0, unmeasured: 1, error: 2 })[bucket(row)];
const rows = [...data.models].sort((a, b) => bucketRank(a) - bucketRank(b) || (b.passed - a.passed) || (a.costUsd - b.costUsd));
const competedRows = rows.filter((r) => bucket(r) === "competed");
const quarantinedRows = rows.filter((r) => bucket(r) !== "competed");
const rowLabel = (r: Row) => r.resolvedModel && r.resolvedModel !== r.model ? `${r.model} -> ${r.resolvedModel}` : r.model;
const shortLabel = (label: string, max = 36) => label.length <= max ? label : `${label.slice(0, max - 1)}...`;
const stamp = `company-research - ${data.companies} companies - ${data.checks.length} boolean checks - ${esc(data.generatedAt.slice(0, 10))}`;

function leaderboard(): string {
  const width = 900;
  const rowH = 34;
  const top = 102;
  const sectionH = quarantinedRows.length ? 28 : 0;
  const height = top + rows.length * rowH + sectionH + 38;
  const barX = 330;
  const barW = 300;
  const maxChecks = data.checks.length;
  const out: string[] = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${MONO}">`);
  out.push(`<rect width="${width}" height="${height}" rx="14" fill="${BG}"/>`);
  out.push(`<text x="28" y="38" fill="${TEXT}" font-size="18" font-weight="700">NodeRoom diligence benchmark</text>`);
  out.push(`<text x="28" y="60" fill="${MUTE}" font-size="11">${stamp}</text>`);
  out.push(`<text x="28" y="80" fill="${MUTE}" font-size="10.5">Scored candidates first. Zero-cost dead routes and integration errors are quarantined below.</text>`);
  out.push(`<line x1="28" y1="${top - 16}" x2="${width - 28}" y2="${top - 16}" stroke="${LINE}"/>`);

  let y = top;
  let rank = 1;
  const drawRow = (r: Row, quarantined: boolean) => {
    const frac = quarantined ? 0 : r.passed / maxChecks;
    const col = r.error ? FAIL : quarantined ? MUTE : r.passed === maxChecks ? PASS : ACCENT;
    const label = r.error ? "ERR" : quarantined ? "unmeasured" : `${r.passed}/${r.total}`;
    const cost = quarantined ? "not scored" : `$${r.costUsd.toFixed(4)}`;
    const lat = r.error ? esc(r.error.slice(0, 28)) : `${(r.ms / 1000).toFixed(0)}s`;
    out.push(`<text x="28" y="${y + 6}" fill="${MUTE}" font-size="12">${quarantined ? "-" : rank++}</text>`);
    out.push(`<text x="52" y="${y + 6}" fill="${quarantined ? MUTE : TEXT}" font-size="12.5">${esc(shortLabel(rowLabel(r), 38))}</text>`);
    out.push(`<rect x="${barX}" y="${y - 7}" width="${barW}" height="14" rx="4" fill="${PANEL}"/>`);
    out.push(`<rect x="${barX}" y="${y - 7}" width="${Math.max(2, barW * frac)}" height="14" rx="4" fill="${col}"/>`);
    out.push(`<text x="${barX + barW + 10}" y="${y + 5}" fill="${col}" font-size="11.5" font-weight="700">${label}</text>`);
    out.push(`<text x="${width - 28}" y="${y + 5}" fill="${MUTE}" font-size="11" text-anchor="end">${cost} - ${lat} - ${r.toolCalls} tools</text>`);
    y += rowH;
  };

  competedRows.forEach((r) => drawRow(r, false));
  if (quarantinedRows.length) {
    out.push(`<text x="28" y="${y + 5}" fill="${MUTE}" font-size="10.5" font-weight="700">Quarantined: no scored work product or benchmark integration error</text>`);
    y += sectionH;
    quarantinedRows.forEach((r) => drawRow(r, true));
  }
  out.push(`<text x="28" y="${height - 16}" fill="${MUTE}" font-size="10">Quarantine keeps provider/router failures visible without treating them as cost-quality candidates.</text>`);
  out.push("</svg>");
  return out.join("");
}

function costQuality(): string {
  const width = 920;
  const height = 460;
  const padL = 70;
  const padR = 310;
  const padT = 78;
  const padB = 62;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const maxCost = Math.max(0.02, ...competedRows.map((r) => r.costUsd));
  const x = (c: number) => padL + (c / maxCost) * plotW;
  const y = (pct: number) => padT + plotH - (pct / 100) * plotH;
  const out: string[] = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${MONO}">`);
  out.push(`<rect width="${width}" height="${height}" rx="14" fill="${BG}"/>`);
  out.push(`<text x="28" y="34" fill="${TEXT}" font-size="17" font-weight="700">Cost vs quality - scored routes only</text>`);
  out.push(`<text x="28" y="54" fill="${MUTE}" font-size="11">${stamp}</text>`);
  out.push(`<text x="28" y="70" fill="${MUTE}" font-size="10.5">${quarantinedRows.length} quarantined route(s) excluded from the scatter but retained in the leaderboard.</text>`);

  out.push(`<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="${LINE}"/>`);
  out.push(`<line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="${LINE}"/>`);
  for (const p of [0, 50, 100]) {
    out.push(`<text x="${padL - 10}" y="${y(p) + 4}" fill="${MUTE}" font-size="10" text-anchor="end">${p}%</text>`);
    out.push(`<line x1="${padL}" y1="${y(p)}" x2="${padL + plotW}" y2="${y(p)}" stroke="${LINE}" stroke-dasharray="2 4" opacity="0.5"/>`);
  }
  out.push(`<text x="${padL + plotW / 2}" y="${height - 18}" fill="${MUTE}" font-size="11" text-anchor="middle">cost per run (USD)</text>`);
  out.push(`<text x="20" y="${padT + plotH / 2}" fill="${MUTE}" font-size="11" text-anchor="middle" transform="rotate(-90 20 ${padT + plotH / 2})">quality (checks passed %)</text>`);
  out.push(`<line x1="${padL}" y1="${y(100)}" x2="${padL + plotW}" y2="${y(100)}" stroke="${PASS}" stroke-dasharray="5 3" opacity="0.7"/>`);
  out.push(`<text x="${padL + plotW}" y="${y(100) - 6}" fill="${PASS}" font-size="9.5" text-anchor="end">GATE: all checks</text>`);

  competedRows.forEach((r, i) => {
    const pct = (r.passed / data.checks.length) * 100;
    const cx = x(r.costUsd);
    const cy = y(pct);
    const col = pct === 100 ? PASS : ACCENT;
    out.push(`<circle cx="${cx}" cy="${cy}" r="9" fill="${col}"/>`);
    out.push(`<text x="${cx}" y="${cy + 4}" fill="${BG}" font-size="9" text-anchor="middle" font-weight="700">${i + 1}</text>`);
  });

  const legendX = width - padR + 34;
  out.push(`<text x="${legendX}" y="${padT}" fill="${TEXT}" font-size="12" font-weight="700">Legend</text>`);
  competedRows.forEach((r, i) => {
    const ly = padT + 24 + i * 24;
    const pct = Math.round((r.passed / data.checks.length) * 100);
    const col = pct === 100 ? PASS : ACCENT;
    out.push(`<circle cx="${legendX + 7}" cy="${ly - 4}" r="7" fill="${col}"/>`);
    out.push(`<text x="${legendX + 7}" y="${ly - 1}" fill="${BG}" font-size="8" text-anchor="middle" font-weight="700">${i + 1}</text>`);
    out.push(`<text x="${legendX + 22}" y="${ly}" fill="${TEXT}" font-size="10.5">${esc(shortLabel(rowLabel(r), 30))}</text>`);
    out.push(`<text x="${width - 28}" y="${ly}" fill="${MUTE}" font-size="10" text-anchor="end">${r.passed}/${r.total} - ${pct}% - $${r.costUsd.toFixed(4)}</text>`);
  });

  const clearing = competedRows.filter((r) => r.passed === data.checks.length).sort((a, b) => a.costUsd - b.costUsd)[0];
  const best = competedRows[0];
  if (clearing) {
    out.push(`<text x="${padL + 6}" y="${padT + 16}" fill="${PASS}" font-size="11" font-weight="700">Cheapest gate-clearer: ${esc(shortLabel(rowLabel(clearing), 42))}</text>`);
  } else if (best) {
    out.push(`<text x="${padL + 6}" y="${padT + 16}" fill="${ACCENT}" font-size="11" font-weight="700">Best recorded candidate: ${esc(shortLabel(rowLabel(best), 42))} (${best.passed}/${best.total})</text>`);
  }
  out.push("</svg>");
  return out.join("");
}

writeFileSync(new URL("../../docs/eval/leaderboard.svg", import.meta.url), leaderboard());
writeFileSync(new URL("../../docs/eval/cost-quality.svg", import.meta.url), costQuality());
console.log(`wrote docs/eval/leaderboard.svg + cost-quality.svg (${rows.length} models, ${quarantinedRows.length} quarantined)`);
