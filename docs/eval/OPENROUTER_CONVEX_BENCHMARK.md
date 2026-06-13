# OpenRouter Convex Benchmark

Generated: 2026-06-13T21:20:27.542Z

This is NodeRoom's own benchmark contract for the product shape we actually ship: OpenRouter models running through Convex-owned jobs, leases, journals, mutation receipts, and artifact evidence. It is inspired by SpreadsheetBench, SpreadsheetBench 2, and BankerToolBench, but it is not an official score for those benchmarks.

## Summary

- OpenRouter routes evaluated: 19/20
- OpenRouter-on-Convex harness cases: 6/6 PASS
- Official-promotion cases: 0/1 BLOCKED

## Design Principles

- OpenRouter is a provider adapter, not the runtime owner; Convex owns durable jobs, artifacts, leases, traces, and receipts.
- Benchmark-shaped work is routed through deterministic tools first, then bounded model edit plans, then evidence-bearing writes.
- Free-auto is a long-running/background lane until ladder and p95 evidence prove it can meet interactive collaboration budgets.
- Official benchmark claims stay blocked until the external verifier path is wired; internal Convex benchmark readiness is separate.

## Benchmark Cases

| Case | Scope | Status | Inspired by | Acceptance |
|---|---|---:|---|---|
| `convex_job_journal_and_replay` | openrouter_convex_harness | pass | NodeRoom, SpreadsheetBench, BankerToolBench | A duplicate model step replays the recorded result and cannot overwrite the first output hash. |
| `convex_l1_l7_collaboration_ladder` | openrouter_convex_harness | pass | NodeRoom, SpreadsheetBench | The latest improvement loop records the collaboration ladder as PASS through L7. |
| `convex_multi_user_coordination` | openrouter_convex_harness | pass | NodeRoom, SpreadsheetBench | All recorded multi-user coordination scenarios pass with zero active lock leaks. |
| `spreadsheetbench_route_contract` | openrouter_convex_harness | pass | SpreadsheetBench, SpreadsheetBench 2 | Staged route-selection reports have tasks, and blocked_chart_visual is zero. |
| `spreadsheetbench_chart_visual_grade` | openrouter_convex_harness | pass | SpreadsheetBench 2 | The chart visual probe records chart_visual_grade_proven with an accepted positive candidate and rejected negative control. |
| `docker_agent_workspace_isolation` | openrouter_convex_harness | pass | SpreadsheetBench, BankerToolBench | Docker probe records container_isolation_proven with evaluator reads denied. |
| `bankertoolbench_official_verifier_path` | official_promotion | blocked | BankerToolBench | Official BTB contract imports verifier scores from the real Harbor/Gandalf path. |

## OpenRouter Route Plan

| Route | Role | Adapter | Eligible | Blockers |
|---|---|---|---:|---|
| `nex-agi/nex-n2-pro:free` | background_long_running_only | convexModel.openrouter_chat_completions | yes | route needs N>=5 p95 ladder evidence before interactive promotion |
| `deepseek/deepseek-v4-flash` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `ibm-granite/granite-4.1-8b` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `z-ai/glm-4.7-flash` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `inclusionai/ring-2.6-1t` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `xiaomi/mimo-v2.5` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `stepfun/step-3.7-flash` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `minimax/minimax-m3` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `deepseek/deepseek-v4-pro` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `google/gemini-3.1-flash-lite` | research_only | convexModel.openrouter_chat_completions | no | route is not ladder-tested for collaboration writes |
| `qwen/qwen3.7-plus` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `nvidia/nemotron-3-ultra-550b-a55b` | interactive_candidate | convexModel.openrouter_chat_completions | yes | none |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | background_long_running_only | convexModel.openrouter_chat_completions | yes | route needs N>=5 p95 ladder evidence before interactive promotion |
| `nvidia/nemotron-3-super-120b-a12b:free` | background_long_running_only | convexModel.openrouter_chat_completions | yes | route needs N>=5 p95 ladder evidence before interactive promotion |
| `google/gemma-4-31b-it:free` | research_only | convexModel.openrouter_chat_completions | no | route is not ladder-tested for collaboration writes |
| `openai/gpt-oss-120b:free` | research_only | convexModel.openrouter_chat_completions | no | route is not ladder-tested for collaboration writes |
| `poolside/laguna-xs.2:free` | research_only | convexModel.openrouter_chat_completions | no | route is not ladder-tested for collaboration writes |
| `poolside/laguna-m.1:free` | research_only | convexModel.openrouter_chat_completions | no | route is not ladder-tested for collaboration writes |
| `openrouter/free-auto` | background_long_running_only | convexModel.openrouter_free_auto | yes | route needs N>=5 p95 ladder evidence before interactive promotion |

## Promotion Rule

A route may be used for benchmark-shaped Convex work only through `agentJobs` and `convexModel`. Interactive write promotion still requires live N>=5/p95 ladder evidence for that route. `/free` and other demo-only free routes remain background/long-running until they clear that bar.

Official benchmark promotion remains separate: BankerToolBench still requires the official Harbor/MCP/Gandalf verifier path before any official score claim.

