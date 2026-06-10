import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Issue = {
  file: string;
  message: string;
};

const root = process.cwd();
const audienceDir = join(root, "episodes", "_audiences");
const episodeDir = join(root, "episodes");
const bannedTerms = [
  /\belite\b/i,
  /\bpremium\b/i,
  /\bexclusive\b/i,
  /\bvip\b/i,
  /luxury ai/i,
  /disrupting wealth/i,
  /\byachts?\b/i,
  /\bprivate jets?\b/i,
  /\bwatches\b/i,
];

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

function hasListItem(text: string, key: string): boolean {
  const index = text.indexOf(`${key}:`);
  if (index < 0) return false;
  const rest = text.slice(index + key.length + 1);
  const nextKey = rest.search(/\n[a-zA-Z_][\w-]*:/);
  const block = nextKey >= 0 ? rest.slice(0, nextKey) : rest;
  return /-\s+["']?[^"'\n#][^\n]*/.test(block) || /\[[^\]]+\]/.test(block);
}

function hasMapping(text: string, key: string): boolean {
  const index = text.indexOf(`${key}:`);
  if (index < 0) return false;
  const rest = text.slice(index + key.length + 1);
  const nextKey = rest.search(/\n[a-zA-Z_][\w-]*:/);
  const block = nextKey >= 0 ? rest.slice(0, nextKey) : rest;
  return /[a-zA-Z0-9_ -]+:\s*["']?[^"'\n#][^\n]*/.test(block);
}

function pushIfMissing(issues: Issue[], file: string, condition: boolean, message: string) {
  if (!condition) issues.push({ file, message });
}

function checkAudienceFile(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  for (const key of [
    "cultural_values",
    "repeated_questions",
    "recognizable_artifacts",
    "lexicon_use",
    "lexicon_avoid",
    "trust_signals_required",
    "sources",
  ]) {
    pushIfMissing(issues, file, hasListItem(text, key), `missing non-empty ${key}`);
  }
  pushIfMissing(issues, file, hasMapping(text, "product_mapping"), "missing product_mapping entries");
  pushIfMissing(issues, file, /provenance|source accountability|audit trail/i.test(text), "must include provenance/source-accountability language");
  pushIfMissing(issues, file, /discretion|privacy|sensitive-context/i.test(text), "must include discretion/privacy language");
  return issues;
}

function checkEpisodeBrief(file: string, text: string): Issue[] {
  const issues: Issue[] = [];
  pushIfMissing(issues, file, /episodes\/_audiences\/[\w-]+\.ya?ml/.test(text), "brief must reference its audience context file");
  pushIfMissing(issues, file, /Thesis/i.test(text), "brief must state a thesis");
  pushIfMissing(issues, file, /Scene|recognition layer|world map/i.test(text), "brief must contain a recognizable audience-world scene");
  pushIfMissing(issues, file, /Feature mapping|Evidence|Existing evidence/i.test(text), "brief must map scene beats to product proof/evidence");
  pushIfMissing(issues, file, /Tone|restraint|quiet competence/i.test(text), "brief must state tone/restraint guidance");
  pushIfMissing(issues, file, /Staged|Deferred|not built|do not imply/i.test(text), "brief must label staged or not-yet-built capabilities");

  for (const term of bannedTerms) {
    if (term.test(text) && !/avoid|do not|not fake|cheap/i.test(text.slice(Math.max(0, text.search(term) - 80), text.search(term) + 120))) {
      issues.push({ file, message: `contains banned cheap-luxury term without an avoid/caveat context: ${term}` });
    }
  }
  return issues;
}

const issues: Issue[] = [];

if (!existsSync(audienceDir)) {
  issues.push({ file: "episodes/_audiences", message: "missing audience context directory" });
} else {
  const audienceFiles = readdirSync(audienceDir).filter((name) => /\.ya?ml$/i.test(name));
  pushIfMissing(issues, "episodes/_audiences", audienceFiles.length > 0, "no audience YAML files found");
  for (const name of audienceFiles) {
    const rel = `episodes/_audiences/${name}`;
    issues.push(...checkAudienceFile(rel, read(rel)));
  }
}

const episodeBriefs = readdirSync(episodeDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => `episodes/${entry.name}/brief.md`)
  .filter((rel) => existsSync(join(root, rel)));

pushIfMissing(issues, "episodes", episodeBriefs.length > 0, "no episode briefs found");
for (const rel of episodeBriefs) {
  const text = read(rel);
  if (/Audience:\s*`episodes\/_audiences\//i.test(text) || /private|family|wealth|advisor|investment committee/i.test(text)) {
    issues.push(...checkEpisodeBrief(rel, text));
  }
}

if (issues.length) {
  console.error("content fluency check failed:");
  for (const issue of issues) console.error(`- ${issue.file}: ${issue.message}`);
  process.exit(1);
}

console.log(`content fluency check passed (${episodeBriefs.length} episode brief(s), ${readdirSync(audienceDir).filter((name) => /\.ya?ml$/i.test(name)).length} audience file(s))`);
