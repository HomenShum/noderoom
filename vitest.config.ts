import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@engine": fileURLToPath(new URL("./src/engine", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@agents": fileURLToPath(new URL("./src/agents", import.meta.url)),
      "@nodeagent": fileURLToPath(new URL("./src/nodeagent", import.meta.url)),
    },
  },
  test: {
    // Node by default (keeps the ~85 logic/contract tests fast); component-render tests
    // (*.test.tsx) opt into jsdom so we can drive React state and catch the effect-loop /
    // latch / bound classes that pure-node tests structurally cannot. See docs/COMPONENT_STATE_AUDIT.md.
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts", "src/**/*.test.tsx"],
    environmentMatchGlobs: [["**/*.test.tsx", "jsdom"]],
    setupFiles: ["tests/setup/dom.ts"],
  },
});
