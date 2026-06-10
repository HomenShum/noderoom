/**
 * Remotion config — the walkthrough pipeline keeps ALL its assets under remotion/ (frames are
 * emitted to remotion/public by scripts/walkthroughs/capture.ts), so point the static-file root
 * there instead of the repo-root /public (which belongs to the Vite app).
 */
import { Config } from "@remotion/cli/config";

Config.setPublicDir("remotion/public");
