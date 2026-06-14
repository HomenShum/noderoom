# Gemini Media Judge

Generated: 2026-06-14T22:32:55.470Z
Model: `gemini-3.5-flash`
Run id: `20260614T223224Z`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 1
- Judged: 1
- Errors: 0
- Verdicts: publish=1
- Defects: P2=1

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `docs/walkthroughs/startup-diligence-live-join.mp4` | readme_walkthrough | publish | 8/16 | 0/0/1 | The video successfully demonstrates a multi-user live join workflow for a startup banking diligence room, showing the creation, code sharing, and collaborative chat interface. |

## Open Defects

- **P2** `docs/walkthroughs/startup-diligence-live-join.mp4` @ 00:08: Abrupt transition between Maya's view and Priya's landing page view. -> Add a brief fade transition or visual separator to clarify the perspective switch.

## Re-run

```bash
npm run media:gemini-judge -- --all
```
