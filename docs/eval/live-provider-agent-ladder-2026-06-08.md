# Live Provider Agent Ladder - 2026-06-08

This records a live network run of the NodeRoom collaboration ladder across the
integrated provider routes. The result is intentionally not softened: provider
connectivity is working, but not every model route is safe enough to claim as a
default live collaboration agent.

## Result

| Model route | Provider | L1 | L2 | L3 | L4 | Notes |
|---|---|---:|---:|---:|---:|---|
| `gemini-3.5-flash` | Gemini | PASS | PASS | PASS | PASS | Cleared the lock/CAS/draft safety rungs in this run. |
| `gpt-5.4-mini` | OpenAI | PASS | PASS | FAIL | PASS | Failed conflict-recovery rung in this run. |
| `claude-haiku-4-5` | Anthropic | PASS | PASS | PASS | FAIL | Failed blocked-range/draft rung in this run. |
| `openai/gpt-4o-mini` | OpenRouter | PASS | PASS | PASS | FAIL | Failed blocked-range/draft rung in this run. |
| `gpt-5.4-nano` | OpenAI | PASS | FAIL | FAIL | FAIL | Not safe as current collaboration default. |
| `gpt-5.4` | OpenAI | PASS | FAIL | PASS | PASS | Stronger but had a time-budget failure on L2 in this run. |

The ladder command ran the full ladder despite the attempted `--levels` filter,
so L5/L6 failures appeared too. Those are not included as the pass/fail gate in
the table above, but they reinforce the same conclusion: live model behavior is
empirical and should be routed by eval evidence, not by provider brand.

## Production Statement

Safe statement:

```text
The tool layer enforces locks, CAS, drafts, proposals, and no-clobber. Live model
routes must be ladder-gated before they are used as the default collaboration
agent. Provider parser smoke is green across Gemini/OpenAI/Anthropic/OpenRouter;
agent workflow completion is model-specific.
```

Unsafe statement:

```text
Every integrated provider/model is guaranteed to complete every research or
operation workflow live.
```

## Routing Recommendation

- Keep deterministic tests and scripted ladder as the CI safety floor.
- Use live ladder results to promote model routes into interactive collaboration.
- Treat other live routes as available for parser extraction, read-only work, or
  background jobs until they pass the required rung.
- Never equate provider connectivity with collaboration safety.

