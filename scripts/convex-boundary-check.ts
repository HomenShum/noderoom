import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { scanConvexBoundarySource } from "../src/eval/convexBoundaryPolicy";

const convexDir = join(process.cwd(), "convex");
const files = readdirSync(convexDir)
  .filter((name) => name.endsWith(".ts") && !name.startsWith("_"))
  .map((name) => join(convexDir, name));

let violationCount = 0;
for (const file of files) {
  const source = readFileSync(file, "utf8");
  const violations = scanConvexBoundarySource(source);
  for (const violation of violations) {
    violationCount++;
    console.error(`${relative(file)}:${violation.index} ${violation.message}`);
  }
}

if (violationCount === 0) {
  console.log("convex boundaries: ok");
} else {
  process.exitCode = 1;
}

function relative(path: string): string {
  return path.replace(process.cwd(), "").replace(/^[/\\]/, "").replace(/\\/g, "/");
}
