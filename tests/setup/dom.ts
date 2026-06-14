import { afterEach } from "vitest";

// Only wire React Testing Library cleanup in the jsdom-backed (*.test.tsx) runs. The ~85 node-env
// logic/contract tests never touch the DOM, so we avoid pulling RTL into them at all (faster, and
// no accidental document references). Top-level await is supported by Vitest's ESM setup files.
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => {
    cleanup();
  });
}
