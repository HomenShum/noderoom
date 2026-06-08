/**
 * Generate the production QA cockpit from docs/qa/production-matrix.json.
 *
 * This keeps the README, guarantee matrix, and visual graphs synchronized as the
 * system grows. Add or update rows in the JSON source, then run:
 *
 *   npm run qa:matrix
 *   npm run qa:matrix:check
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

type Status = "green" | "yellow" | "red";
type Evidence = { type: string; ref: string };
type Feature = {
  id: string;
  area: string;
  claim: string;
  status: Status;
  productionGate: string;
  deterministicChecks: string[];
  liveChecks: string[];
  evidence: Evidence[];
  nextReview: string;
};
type LadderStatus = "PASS" | "FAIL" | "TIMEOUT" | "SKIP";
type ModelRoute = {
  modelRoute: string;
  provider: string;
  l1: LadderStatus;
  l2: LadderStatus;
  l3: LadderStatus;
  l4: LadderStatus;
  recommendedUse: string;
};
type Matrix = {
  schema: number;
  updatedAt: string;
  sourceOfTruth: string;
  releaseRule: string;
  features: Feature[];
  modelLadder: {
    source: string;
    gate: string;
    routes: ModelRoute[];
  };
  readme: {
    maxFeatureRows: number;
    summaryTitle: string;
  };
};

type BenchmarkResults = {
  generatedAt: string;
  task: string;
  checks: string[];
  models: Array<{ model: string; ok: boolean; passed: number; total: number; costUsd: number; ms: number }>;
};

const root = new URL("../", import.meta.url);
const checkOnly = process.argv.includes("--check");
const START = "<!-- QA_COCKPIT_START -->";
const END = "<!-- QA_COCKPIT_END -->";
const BG = "#111418";
const PANEL = "#171B20";
const LINE = "#2A2F37";
const TEXT = "#E6E1DA";
const MUTE = "#8B93A1";
const GREEN = "#3FB37F";
const YELLOW = "#D9A441";
const RED = "#E0564E";
const ACCENT = "#D97757";
const MONO = "ui-monospace, 'JetBrains Mono', monospace";

const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
const parseJson = <T>(rel: string) => JSON.parse(read(rel)) as T;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const statusColor = (s: Status | LadderStatus) => (s === "green" || s === "PASS" ? GREEN : s === "yellow" ? YELLOW : RED);
const statusLabel = (s: Status) => (s === "green" ? "Green" : s === "yellow" ? "Yellow" : "Red");
const short = (s: string, max = 86) => (s.length <= max ? s : `${s.slice(0, max - 1)}...`);
const backtickList = (items: string[]) => items.map((x) => `\`${x}\``).join(", ");

const matrix = parseJson<Matrix>("docs/qa/production-matrix.json");
const benchmark = parseJson<BenchmarkResults>("docs/eval/results.json");

function writeArtifact(rel: string, content: string, drift: string[]) {
  const path = new URL(rel, root);
  if (checkOnly) {
    let current = "";
    try {
      current = read(rel);
    } catch {
      drift.push(rel);
      return;
    }
    if (current !== content) drift.push(rel);
    return;
  }
  mkdirSync(dirname(fileURLToPath(path)), { recursive: true });
  writeFileSync(path, content);
}

function evidenceRefs(feature: Feature): string {
  return feature.evidence.map((e) => `\`${e.ref}\``).join(", ");
}

function renderFullMatrix(): string {
  const lines: string[] = [];
  lines.push("# Production Guarantee Matrix");
  lines.push("");
  lines.push(`Generated from \`docs/qa/production-matrix.json\` on ${matrix.updatedAt}.`);
  lines.push("");
  lines.push(`**Release rule:** ${matrix.releaseRule}`);
  lines.push("");
  lines.push("## Continuous Append Protocol");
  lines.push("");
  lines.push("- Add one row to `features[]` for every new user-facing feature, agent tool, provider route, or production invariant.");
  lines.push("- Keep old rows unless the feature is removed; update status and evidence instead of silently deleting history.");
  lines.push("- Run `npm run qa:matrix` after editing the source, then `npm run qa:matrix:check` in CI to catch README/doc/SVG drift.");
  lines.push("- Do not promote a live model route until the relevant ladder rungs pass in a live run and the result is recorded.");
  lines.push("");
  lines.push("## Feature Matrix");
  lines.push("");
  lines.push("| Area | Status | Claim | Production gate | Evidence | Next review |");
  lines.push("|---|---|---|---|---|---|");
  for (const f of matrix.features) {
    lines.push(
      `| ${f.area} | ${statusLabel(f.status)} | ${f.claim} | ${f.productionGate} | ${evidenceRefs(f)} | ${f.nextReview} |`,
    );
  }
  lines.push("");
  lines.push("## Live Model Ladder Gate");
  lines.push("");
  lines.push(`Source: \`${matrix.modelLadder.source}\``);
  lines.push("");
  lines.push(`Gate: ${matrix.modelLadder.gate}`);
  lines.push("");
  lines.push("| Model route | Provider | L1 | L2 | L3 | L4 | Recommended use |");
  lines.push("|---|---|---:|---:|---:|---:|---|");
  for (const r of matrix.modelLadder.routes) {
    lines.push(`| \`${r.modelRoute}\` | ${r.provider} | ${r.l1} | ${r.l2} | ${r.l3} | ${r.l4} | ${r.recommendedUse} |`);
  }
  lines.push("");
  lines.push("## Commands");
  lines.push("");
  lines.push("```bash");
  lines.push("npm run qa:matrix");
  lines.push("npm run qa:matrix:check");
  lines.push("npm run typecheck -- --pretty false");
  lines.push("npx tsc --noEmit --project convex\\tsconfig.json --pretty false");
  lines.push("npm test");
  lines.push("npm run ladder");
  lines.push("npm run provider-parser:smoke");
  lines.push("npm run build");
  lines.push("```");
  lines.push("");
  lines.push("## Visuals");
  lines.push("");
  lines.push("![QA coverage graph](eval/qa-coverage.svg)");
  lines.push("");
  lines.push("![Live model ladder graph](eval/model-ladder-matrix.svg)");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderReadmeSection(): string {
  const greens = matrix.features.filter((f) => f.status === "green").length;
  const yellows = matrix.features.filter((f) => f.status === "yellow").length;
  const fullPassRoutes = matrix.modelLadder.routes.filter((r) => [r.l1, r.l2, r.l3, r.l4].every((x) => x === "PASS"));
  const bestBenchmark = [...benchmark.models]
    .filter((m) => m.passed === m.total)
    .sort((a, b) => a.costUsd - b.costUsd)[0];

  const lines: string[] = [];
  lines.push(`## ${matrix.readme.summaryTitle}`);
  lines.push("");
  lines.push("This section is generated from `docs/qa/production-matrix.json`. When the system grows, append or update a matrix row, then run `npm run qa:matrix`; CI can run `npm run qa:matrix:check` to catch stale docs.");
  lines.push("");
  lines.push(`<sub>${matrix.features.length} feature guarantees tracked | ${greens} green | ${yellows} yellow | ${fullPassRoutes.length} live model route(s) cleared L1-L4 in the latest recorded ladder.</sub>`);
  lines.push("");
  lines.push("![QA coverage graph](docs/eval/qa-coverage.svg)");
  lines.push("");
  lines.push("![Live model ladder graph](docs/eval/model-ladder-matrix.svg)");
  lines.push("");
  lines.push("| Feature area | Status | Required production gate |");
  lines.push("|---|---|---|");
  for (const f of matrix.features.slice(0, matrix.readme.maxFeatureRows)) {
    lines.push(`| ${f.area} | ${statusLabel(f.status)} | ${f.productionGate} |`);
  }
  lines.push("");
  lines.push("| Live route | Provider | L1 | L2 | L3 | L4 | Promotion call |");
  lines.push("|---|---|---:|---:|---:|---:|---|");
  for (const r of matrix.modelLadder.routes) {
    lines.push(`| \`${r.modelRoute}\` | ${r.provider} | ${r.l1} | ${r.l2} | ${r.l3} | ${r.l4} | ${r.recommendedUse} |`);
  }
  lines.push("");
  if (bestBenchmark) {
    lines.push(`Research benchmark route: \`${bestBenchmark.model}\` is the cheapest recorded model clearing ${bestBenchmark.total}/${bestBenchmark.total} checks at $${bestBenchmark.costUsd.toFixed(4)} per run. Collaboration routing still uses the ladder gate above, not benchmark cost alone.`);
  }
  lines.push("");
  lines.push("Full QA ledger: [`docs/PRODUCTION_GUARANTEE_MATRIX.md`](docs/PRODUCTION_GUARANTEE_MATRIX.md).");
  return lines.join("\n");
}

function renderQaCoverageSvg(): string {
  const W = 1060;
  const rowH = 44;
  const top = 92;
  const H = top + matrix.features.length * rowH + 56;
  const laneX = [470, 600, 730, 860];
  const lanes = ["unit/eval", "live", "trace", "next"];
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${MONO}">`);
  out.push(`<rect width="${W}" height="${H}" rx="16" fill="${BG}"/>`);
  out.push(`<text x="28" y="36" fill="${TEXT}" font-size="19" font-weight="700">NodeRoom production QA evidence ledger</text>`);
  out.push(`<text x="28" y="58" fill="${MUTE}" font-size="11">Generated from docs/qa/production-matrix.json | ${matrix.updatedAt} | append rows as features grow</text>`);
  out.push(`<line x1="28" y1="${top - 25}" x2="${W - 28}" y2="${top - 25}" stroke="${LINE}"/>`);
  lanes.forEach((l, i) => out.push(`<text x="${laneX[i]}" y="${top - 10}" fill="${MUTE}" font-size="11" text-anchor="middle">${l}</text>`));
  matrix.features.forEach((f, i) => {
    const y = top + i * rowH;
    const color = statusColor(f.status);
    out.push(`<rect x="22" y="${y - 22}" width="${W - 44}" height="${rowH - 6}" rx="8" fill="${i % 2 ? PANEL : "#14181D"}" stroke="${LINE}" opacity="0.98"/>`);
    out.push(`<circle cx="42" cy="${y - 3}" r="6" fill="${color}"/>`);
    out.push(`<text x="58" y="${y - 8}" fill="${TEXT}" font-size="12.5" font-weight="700">${esc(f.area)}</text>`);
    out.push(`<text x="58" y="${y + 9}" fill="${MUTE}" font-size="10.5">${esc(short(f.claim, 58))}</text>`);
    const hasUnit = f.deterministicChecks.length > 0;
    const hasLive = f.liveChecks.some((x) => !/not applicable/i.test(x));
    const hasTrace = /trace|audit|evidence|proposal|CellPayload|CAS|lock/i.test(`${f.claim} ${f.productionGate} ${f.evidence.map((e) => e.ref).join(" ")}`);
    const hasNext = f.nextReview.length > 0;
    [hasUnit, hasLive, hasTrace, hasNext].forEach((ok, lane) => {
      out.push(`<rect x="${laneX[lane] - 42}" y="${y - 17}" width="84" height="24" rx="6" fill="${ok ? color : LINE}" opacity="${ok ? "0.95" : "0.55"}"/>`);
      out.push(`<text x="${laneX[lane]}" y="${y - 1}" fill="${ok ? "#111418" : MUTE}" font-size="10.5" font-weight="700" text-anchor="middle">${ok ? "covered" : "gap"}</text>`);
    });
    out.push(`<text x="${W - 34}" y="${y - 1}" fill="${color}" font-size="11" text-anchor="end" font-weight="700">${statusLabel(f.status)}</text>`);
  });
  out.push(`<text x="28" y="${H - 22}" fill="${MUTE}" font-size="10">Green = production-shaped with current evidence. Yellow = implemented but needs live scale, storage, load, or repeated-provider proof before broad claims.</text>`);
  return `${out.join("")}</svg>`;
}

function renderModelLadderSvg(): string {
  const routes = matrix.modelLadder.routes;
  const W = 980;
  const rowH = 42;
  const top = 98;
  const H = top + routes.length * rowH + 64;
  const cols = [430, 510, 590, 670];
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${MONO}">`);
  out.push(`<rect width="${W}" height="${H}" rx="16" fill="${BG}"/>`);
  out.push(`<text x="28" y="36" fill="${TEXT}" font-size="19" font-weight="700">Live model ladder gate</text>`);
  out.push(`<text x="28" y="58" fill="${MUTE}" font-size="11">${esc(matrix.modelLadder.gate)}</text>`);
  out.push(`<text x="28" y="78" fill="${MUTE}" font-size="10">Source: ${esc(matrix.modelLadder.source)}</text>`);
  ["L1", "L2", "L3", "L4"].forEach((l, i) => out.push(`<text x="${cols[i]}" y="${top - 13}" fill="${MUTE}" font-size="11" text-anchor="middle">${l}</text>`));
  routes.forEach((r, i) => {
    const y = top + i * rowH;
    const statuses = [r.l1, r.l2, r.l3, r.l4];
    const passAll = statuses.every((s) => s === "PASS");
    out.push(`<rect x="22" y="${y - 24}" width="${W - 44}" height="${rowH - 6}" rx="8" fill="${i % 2 ? PANEL : "#14181D"}" stroke="${LINE}"/>`);
    out.push(`<text x="36" y="${y - 5}" fill="${TEXT}" font-size="12.5" font-weight="700">${esc(r.modelRoute)}</text>`);
    out.push(`<text x="36" y="${y + 11}" fill="${MUTE}" font-size="10.5">${esc(r.provider)}</text>`);
    statuses.forEach((s, lane) => {
      const color = statusColor(s);
      out.push(`<rect x="${cols[lane] - 30}" y="${y - 20}" width="60" height="26" rx="6" fill="${color}"/>`);
      out.push(`<text x="${cols[lane]}" y="${y - 3}" fill="#111418" font-size="10.5" font-weight="800" text-anchor="middle">${s}</text>`);
    });
    out.push(`<text x="${W - 32}" y="${y - 4}" fill="${passAll ? GREEN : ACCENT}" font-size="10.5" text-anchor="end" font-weight="700">${esc(short(r.recommendedUse, 42))}</text>`);
  });
  out.push(`<text x="28" y="${H - 24}" fill="${MUTE}" font-size="10">Provider connectivity is not the same as collaboration safety; routes are promoted by recorded ladder evidence.</text>`);
  return `${out.join("")}</svg>`;
}

function updateReadme(readme: string, section: string): string {
  const wrapped = `${START}\n${section}\n${END}`;
  if (readme.includes(START) && readme.includes(END)) {
    const before = readme.slice(0, readme.indexOf(START));
    const after = readme.slice(readme.indexOf(END) + END.length);
    return `${before}${wrapped}${after}`;
  }
  const anchor = "\n## Multi-model benchmark";
  if (!readme.includes(anchor)) {
    throw new Error("README.md is missing the Multi-model benchmark anchor for QA cockpit insertion.");
  }
  return readme.replace(anchor, `\n${wrapped}\n${anchor}`);
}

const drift: string[] = [];
writeArtifact("docs/PRODUCTION_GUARANTEE_MATRIX.md", renderFullMatrix(), drift);
writeArtifact("docs/eval/qa-coverage.svg", renderQaCoverageSvg(), drift);
writeArtifact("docs/eval/model-ladder-matrix.svg", renderModelLadderSvg(), drift);
writeArtifact("README.md", updateReadme(read("README.md"), renderReadmeSection()), drift);

if (drift.length > 0) {
  console.error(`QA matrix artifacts are stale: ${drift.join(", ")}`);
  console.error("Run npm run qa:matrix and commit the generated changes.");
  process.exit(1);
}

console.log(
  checkOnly
    ? `qa matrix is current (${matrix.features.length} features, ${matrix.modelLadder.routes.length} model routes)`
    : `wrote QA matrix artifacts (${matrix.features.length} features, ${matrix.modelLadder.routes.length} model routes)`,
);
