# Gemini Media Judge

Generated: 2026-06-14T22:41:40.072Z
Model: `gemini-3.5-flash`
Run id: `20260614T224013Z`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 1
- Judged: 0
- Errors: 1
- Verdicts: none
- Defects: none

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `docs/walkthroughs/startup-diligence-war-room.mp4` | readme_walkthrough | error | - | 0/0/0 | Failed after 3 attempts. Last error: Cannot connect to API: getaddrinfo ENOTFOUND generativelanguage.googleapis.com |

## Open Defects

(none reported)

## Re-run

```bash
npm run media:gemini-judge -- --only startup-diligence-war-room --include-ignored
```
