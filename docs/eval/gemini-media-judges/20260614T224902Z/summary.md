# Gemini Media Judge

Generated: 2026-06-14T22:49:49.039Z
Model: `gemini-3.5-flash`
Run id: `20260614T224902Z`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 1
- Judged: 1
- Errors: 0
- Verdicts: publish=1
- Defects: P1=1

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `docs/walkthroughs/startup-diligence-war-room.mp4` | readme_walkthrough | publish | 12.1/16 | 0/1/0 | The walkthrough effectively demonstrates a collaborative startup diligence war room featuring multi-agent execution, public/private lanes, and structured handoffs. The UI is highly functional, though dense with information. |

## Open Defects

- **P1** `docs/walkthroughs/startup-diligence-war-room.mp4` @ 00:07: The Room Trace log text is extremely small and dense, making it hard to read without zooming. -> Increase the default font size of the trace log or use a zoomed-in layout for video walkthroughs.

## Re-run

```bash
npm run media:gemini-judge -- --only startup-diligence-war-room --include-ignored
```
