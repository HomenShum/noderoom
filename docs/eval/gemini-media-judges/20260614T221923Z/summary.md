# Gemini Media Judge

Generated: 2026-06-14T22:20:14.400Z
Model: `gemini-3.5-flash`
Run id: `20260614T221923Z`

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
| `docs/walkthroughs/startup-diligence-war-room.mp4` | readme_walkthrough | publish | 8/16 | 0/0/1 | The walkthrough effectively demonstrates a multi-agent startup diligence workflow, showcasing research enrichment, public/private agent collaboration, and downstream handoffs with clear UI state changes. |

## Open Defects

- **P2** `docs/walkthroughs/startup-diligence-war-room.mp4` @ 00:07: The trace log text in the bottom-left panel is small and difficult to read at standard browser resolutions. -> Increase the font size of the trace log or provide a zoom-in overlay for that section.

## Re-run

```bash
npm run media:gemini-judge -- --all
```
