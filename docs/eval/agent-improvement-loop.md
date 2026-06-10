# Agent Improvement Loop

Generated: 2026-06-10T18:39:57.762Z

Source pattern: https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop

NodeRoom adapts the cookbook loop as: traces -> human/model feedback -> reusable evals -> gate -> Codex handoff -> next harness change.

Latest run artifact: `docs/eval/agent-improvement-loop/20260610T183945Z.json`

Summary: 7 pass, 0 fail, 6 skip.

Post-run benchmark note: this generated loop skipped the full-live benchmark.
Current benchmark evidence is `docs/eval/results.json`, generated
`2026-06-10T21:48:08.700Z`, under
`company-research-v3-composite-synthesis`: `deepseek/deepseek-v4-flash`
clears 9/9, while `openrouter/free-auto -> nvidia/nemotron-3-super-120b-a12b:free`
reaches 7/9 and fails the content floor. The older v2 free-auto 9/9 trace is
invalidated as model evidence because the deterministic harness authored the
row fields.

## Step Results

| Step | Lane | Status | Duration | Command |
|---|---|---:|---:|---|
| Professional workflow catalog | deterministic | PASS | 1.6s | `npm run eval:professional` |
| GTM/finance workflow evals | deterministic | PASS | 2.5s | `npx vitest run tests/workflowEvals.test.ts` |
| Collaboration ladder L1-L6 | deterministic | PASS | 2.5s | `npm run ladder -- --record` |
| MM-banking credit decision evals | deterministic | PASS | 2.3s | `npm run eval:credit -- --record` |
| Eval regression diff | deterministic | PASS | 0.8s | `npm run eval:diff` |
| Convex query/action/mutation boundaries | deterministic | PASS | 1.5s | `npm run convex:boundaries` |
| Architecture budget review | deterministic | PASS | 0.8s | `npm run architecture:budget` |
| OpenRouter free-auto discovery | live | SKIP | 0.0s | `npm run openrouter:free -- --limit=5` |
| Provider parser live smoke | live | SKIP | 0.0s | `npm run provider-parser:smoke` |
| Convex /free job smoke | live | SKIP | 0.0s | `npm run free-job:smoke` |
| V2 multi-model benchmark | full-live | SKIP | 0.0s | `npm run benchmark -- --model-timeout-ms=180000 --model-reserve-ms=15000 --row-hard-timeout-ms=210000` |
| Free-auto router ladder | full-live | SKIP | 0.0s | `npm run ladder:free` |
| Gemini UI media review | ui | SKIP | 0.0s | `npx tsx scripts/gemini-ui-review.ts` |

## Workflow Coverage

Reviewed file profile: 70 files (23 CSV, 47 XLSX).

| Category | Cases |
|---|---:|
| gtm_company_research | 8 |
| finance_ops | 4 |
| eval_harness | 2 |
| analytics_optimization | 2 |
| legacy_agent_outputs | 1 |

## Architecture Before Eval

Research must describe the workflow, architecture gap, and existing capability fit before it proposes evals or code.

| Eval trust level | Meaning |
|---|---|
| candidate | Generated from traces or research; useful for discussion and advisory runs, not a merge gate. |
| research_validated | Backed by captured sources or online consensus; can create scoped handoffs, still not blocking by default. |
| contested | Credible sources disagree; advisory only, and the eval should check that disagreement is surfaced. |
| human_verified | Reviewed or accepted for critical use; may become blocking when deterministic and safety-safe. |

Gate modes: none, advisory, blocking.

Architecture fit checks before adding code:

- Can existing tools, prompts, context builders, and Convex mutations already handle the case?
- If not, is the missing piece a query, action, mutation, tool schema, validator, or UI review affordance?
- What is the smallest implementation that proves the workflow without a new subsystem?
- What old or proposed layer can be avoided because the existing artifact/job/lock path is enough?

Root-cause labels used for HALO diagnosis:

- `stale_context`: The agent acted on old state or missing refreshed context.
- `wrong_tool`: The model chose a tool that could not satisfy the workflow contract.
- `missing_read_before_write`: A write occurred without a current source read and version.
- `bad_mutation_contract`: The server mutation allowed an unsafe or under-specified state change.
- `weak_source_evidence`: The output lacked source-backed evidence or cited the wrong evidence.
- `bad_prompt_or_context`: Instructions or context did not define the workflow sharply enough.
- `permission_or_visibility`: Scope, privacy, or role gating was wrong or underspecified.
- `model_routing_or_budget`: The chosen model, budget, or slice policy was unfit for the task.
- `ui_review_friction`: The human review or approval surface obscured the right decision.
- `eval_measures_wrong_behavior`: The eval target itself is suspect and needs research/calibration.

## Generated Eval Ideas

| Eval candidate | Trust | Gate | Architecture fit | Handoff decision |
|---|---|---|---|---|
| candidate-gtm-pitchbook-match | candidate | advisory | existing_capability | more_research: missing research packet evidence; candidate evals are advisory only |
| research-validated-finance-reconcile | research_validated | advisory | small_gap | implementation |
| contested-eval-harness-expansion | contested | advisory | existing_capability | eval_fixture: contested claims must stay advisory until resolved or explicitly modeled |

## Codex Handoff

### Architecture Budget

Allowed scope: Only files or modules named by the failing trace, failing eval, or handoff evidence.

Default allowed areas:
- src/agent runtime, tools, context, and compaction
- Convex job/tool adapters that already participate in the failing flow
- eval fixtures and deterministic assertions for the affected workflow

Forbidden without human approval:
- new database tables
- new services or framework layers
- new UI surfaces
- graph/wiki/embedding expansion without a failing workflow eval
- weakened CAS, lock, draft, auth, privacy, or eval gates

### Recommendations

- Implement scoped handoff for eval candidate research-validated-finance-reconcile.
- Run skipped free-route-discovery once prerequisites are present: pass --live and set OPENROUTER_API_KEY to discover current free-auto candidates.
- Run skipped provider-parser-smoke once prerequisites are present: pass --live; script will skip providers without keys.
- Run skipped free-job-smoke once prerequisites are present: pass --live and set CONVEX_URL or VITE_CONVEX_URL.
- Run skipped gemini-ui-review once prerequisites are present: pass --ui-media=<screenshot-or-video> and set GOOGLE_GENERATIVE_AI_API_KEY.
- Persist each new live trace into a durable eval fixture before promoting README charts.
- Keep provider benchmarks behind row-level hard timeouts so one stuck free model cannot block the loop.
- Add browser-visible multi-user checks for public/private chat, artifact references, proposals, and trace accept-all.

## Next Live Runs

- `npm run agent:improve -- --live`
- `npm run agent:improve -- --full-live`
- `npm run agent:improve -- --ui-media=docs/eval/ui-recordings/<recording-or-screenshot>`
- `npm run benchmark:charts`
