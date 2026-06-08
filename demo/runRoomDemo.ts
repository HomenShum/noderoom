/**
 * runRoomDemo.ts — drive the real engine through the collaboration story in the
 * terminal (no UI, no keys):  npm run demo
 *
 * Prints the trace log, the smart-merge verdict, and the final sheet state, so
 * you can see the lock → draft → merge mechanics without opening the browser.
 */

import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom, playCollab } from "../src/engine/demoRoom";

async function main() {
  const conflict = process.argv.includes("--conflict");
  const engine = new RoomEngine(); // deterministic clock
  const d = buildDemoRoom(engine);
  const logs: string[] = [];
  await playCollab(engine, d, { reduced: true, conflict, log: (s) => logs.push(s) });

  const bar = "─".repeat(64);
  console.log(`\n${bar}\nNodeRoom — collaboration demo${conflict ? " (conflict variant)" : ""}\n${bar}`);
  console.log("\nSCRIPT");
  for (const l of logs) console.log("  · " + l);

  console.log("\nTRACE LOG (per room)");
  for (const t of engine.listTraces(d.roomId).slice(-14)) {
    console.log(`  ${t.type.padEnd(18)} ${t.summary}`);
  }

  console.log("\nDRAFTS");
  for (const dr of engine.listDrafts(d.roomId)) {
    console.log(`  [${dr.status}] ${dr.author.name}: ${dr.note}`);
    if (dr.resolution) console.log(`     ↳ ${dr.resolution.note}`);
  }

  console.log("\nFINAL SHEET (Q3 variance)");
  const sheet = engine.getArtifact(d.sheetId)!;
  for (const id of ["r_rev__variance", "r_cogs__variance", "r_gp__variance", "r_ni__variance"]) {
    const el = sheet.elements[id];
    console.log(`  ${id.replace("__", " · ")} = ${String(el?.value)}  (v${el?.version})`);
  }
  console.log(`${bar}\n`);
}

main();
