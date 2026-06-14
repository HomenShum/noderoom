# Gemini Media Judge

Generated: 2026-06-14T23:24:32.496Z
Model: `gemini-3.5-flash`
Run id: `20260614T232251Z`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 2
- Judged: 2
- Errors: 0
- Verdicts: publish=2
- Defects: P2=2

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `docs/walkthroughs/startup-diligence-live-join.mp4` | readme_walkthrough | publish | 11.8/16 | 0/0/1 | The video clearly demonstrates multi-user collaboration in a shared diligence room, showing real-time joining and trace updates. |
| `docs/walkthroughs/startup-diligence-war-room.mp4` | readme_walkthrough | publish | 10/16 | 0/0/1 | Excellent walkthrough demonstrating multi-agent startup diligence, public/private scoping, and draft handoffs with clear state changes. |

## Open Defects

- **P2** `docs/walkthroughs/startup-diligence-live-join.mp4` @ 00:08: Sudden cut transition between Maya's perspective and Priya's landing page entry. -> Add a subtle visual transition or label indicating a switch to a different user's browser window.
- **P2** `docs/walkthroughs/startup-diligence-war-room.mp4` @ 00:07: High text density in the Room Trace log makes it hard to quickly read the payload details. -> Slightly increase line height or highlight key status changes in the trace log.

## Re-run

```bash
npm run media:gemini-judge -- --only startup-diligence --include-ignored
```
