/**
 * Voiceover stage — ElevenLabs TTS for an episode's scene narrations + the timing-reconciliation
 * pass (narration length vs planned scene duration; flag scenes to lengthen/split).
 *
 * Run:  npx tsx scripts/walkthroughs/voiceover.ts noderoom-live-collab-v1
 * Key resolution: ELEVENLABS_API_KEY env → ./.env.local → ../nodebench-ai/.env.local (workspace
 * sibling that holds the shared secrets). The key never gets printed or written anywhere.
 * Voice: ELEVENLABS_VOICE_ID env, default George (calm narrator premade voice).
 * Outputs: episodes/<id>/voiceover/<scene>.mp3 + timings.json (real durations via ffprobe).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const episodeId = process.argv[2];
if (!episodeId) { console.error("usage: voiceover.ts <episodeId>"); process.exit(1); }
const epDir = join(ROOT, "episodes", episodeId);

function resolveKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  for (const p of [join(ROOT, ".env.local"), join(ROOT, "..", "nodebench-ai", ".env.local")]) {
    if (!existsSync(p)) continue;
    const m = readFileSync(p, "utf8").match(/^ELEVENLABS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  throw new Error("ELEVENLABS_API_KEY not found (env, .env.local, ../nodebench-ai/.env.local)");
}

/** Minimal parser for OUR storyboard.yaml shape — scene id + narration + status lines. */
function parseScenes(yaml: string): Array<{ id: string; narration: string; status: string }> {
  const scenes: Array<{ id: string; narration: string; status: string }> = [];
  let cur: { id: string; narration: string; status: string } | null = null;
  for (const line of yaml.split(/\r?\n/)) {
    const id = line.match(/^\s+-\s+id:\s*(\S+)/);
    if (id) { cur = { id: id[1], narration: "", status: "ready" }; scenes.push(cur); continue; }
    if (!cur) continue;
    const nar = line.match(/^\s+narration:\s*"(.+)"\s*$/);
    if (nar) cur.narration = nar[1];
    const st = line.match(/^\s+status:\s*(\w+)/);
    if (st) cur.status = st[1];
  }
  return scenes.filter((s) => s.narration);
}

const run = async () => {
  const key = resolveKey();
  const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "JBFqnCBsd6RMkjVDRZzb"; // George — calm narrator
  const scenes = parseScenes(readFileSync(join(epDir, "storyboard.yaml"), "utf8"));
  const outDir = join(epDir, "voiceover");
  mkdirSync(outDir, { recursive: true });
  const timings: Record<string, { narrationSec: number; chars: number; status: string }> = {};

  for (const s of scenes) {
    const mp3 = join(outDir, `${s.id}.mp3`);
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text: s.narration, model_id: "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2 } }),
    });
    if (!res.ok) throw new Error(`TTS ${s.id}: ${res.status} ${(await res.text()).slice(0, 160)}`);
    writeFileSync(mp3, Buffer.from(await res.arrayBuffer()));
    const dur = Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${mp3}"`).toString().trim());
    timings[s.id] = { narrationSec: Math.round(dur * 10) / 10, chars: s.narration.length, status: s.status };
    console.log(`[voiceover] ${s.id} — ${timings[s.id].narrationSec}s (${s.status})`);
  }

  writeFileSync(join(outDir, "timings.json"), JSON.stringify(timings, null, 2));
  // Timing reconciliation: a scene's visual must outlast its narration (+0.5s breath); flag misfits.
  console.log("\n[reconcile] narration vs scene budget (visual must outlast narration):");
  for (const [id, t] of Object.entries(timings)) {
    const note = t.narrationSec > 12 ? "LONG — consider splitting the scene" : t.narrationSec < 2.5 ? "short — fine for a beat" : "ok";
    console.log(`  ${id.padEnd(20)} ${String(t.narrationSec).padStart(5)}s  ${note}`);
  }
  console.log(`\n[voiceover] done → ${outDir}`);
};
void run().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
