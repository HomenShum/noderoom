# Citation ledger — external references fact-check

Adversarial web-verification of all 28 external references cited in the June 2026 design notes
(UI shell / intake-scheduler / Univer / eval-stack corpus). Each reference was checked against a
live source (arXiv abstract API, GitHub API, or official docs). Verdict scale:
`verified` · `wrong-details` (source real, ID or stat off) · `unverifiable` · `likely-fabricated`.

**Result: 26 verified, 2 wrong-details, 0 fabricated.** The corpus is overwhelmingly sound — but
two items must be corrected before they appear in any external pitch, README, or benchmark doc.

---

## ⚠️ Corrections required before external use

### 1. "WorkstreamBench" does not exist — the paper is **MBABench**
- **Claimed:** `WorkstreamBench` — arXiv 2605.22664 — Accuracy/Formula/Format taxonomy for end-to-end finance spreadsheet tasks.
- **Reality:** arXiv 2605.22664 is a **real** paper (HTTP 200, 2026-05-21) but its title is
  **"MBABench: Evaluating LLM Agents on End-to-End Spreadsheet Tasks in Finance"** (Yen, Poeltl, Gear et al.).
  There is no paper named "WorkstreamBench" at that ID.
- **Action:** Cite it as **MBABench (arXiv 2605.22664)**, or drop the name. The Accuracy/Formula/Format
  framing is real — just attributed to the wrong title. Using "WorkstreamBench" in a public doc is a
  credibility landmine (a reviewer who clicks the link sees a different name).

### 2. SheetAgent stat is off by one band
- **Claimed:** SheetAgent/SheetRM — arXiv 2403.03636 — "20–30% pass-rate improvement."
- **Reality:** ID is **correct** (real paper: "SheetAgent: Towards a Generalist Agent for Spreadsheet
  Reasoning and Manipulation via LLMs", ACM Web Conf 2025). The reported improvement is **20–40%**, not 20–30%.
- **Action:** Change "20–30%" → "20–40%".

---

## ✅ Verified (26)

All confirmed against a live source at high confidence. Cited stats matched the source abstract unless noted.

| Reference | ID / source | Note |
|---|---|---|
| BankerToolBench | arXiv 2604.11304 | Title + every cited claim confirmed (502 bankers, 100+ rubric, ~half failed, 0% client-ready). |
| BlueFin | arXiv 2605.30907 | "Benchmarking LLM Agents on Financial Spreadsheets"; 131 tasks / 3,225 rubric, <50% avg confirmed. |
| Finch | arXiv 2512.13168 | a.k.a. FinWorkBench; Enron-sourced; GPT-5.1 Pro 38.4% / Sonnet 4.5 25.0% confirmed. |
| APEX-Agents | arXiv 2601.14242 | "AI Productivity Index for Agents"; long-horizon cross-app; best 24.0%; Archipelago infra. |
| SpreadsheetBench | arXiv 2406.14991 | NeurIPS D&B 2024 spotlight; 912 real Excel-forum questions confirmed. |
| SpreadsheetAgent | arXiv 2604.12282 | Two-stage multi-agent spreadsheet understanding; structural sketch + verification. |
| WildClawBench | arXiv 2605.10912 | Native-runtime CLI agents, 60 tasks; "harness shifts score up to 18 points" verbatim. |
| Claw-SWE-Bench | arXiv 2606.12344 | 19.1% → 73.4% Pass@1 (GLM 5.1), 27.4pp harness swing — confirmed verbatim. |
| Harness-Bench | arXiv 2605.27922 | Report capability at model-harness config level; records artifacts/traces/usage/validators. |
| ADK Arena | arXiv 2606.05548 | 51 Python ADK frameworks, LLM-as-developer; no single framework dominates. |
| AI Agents That Matter | arXiv 2407.01502 | Kapoor/Stroebl/Narayanan; accuracy+cost joint optimization — every claim matched. |
| AgentLens | arXiv 2605.12925 | "Revealing the Lucky Pass Problem in SWE-Agent Evaluation" — confirmed. |
| HAL (Holistic Agent Leaderboard) | arXiv 2510.11977 | Princeton consortium; models×scaffolds×benchmarks; agents-search-for-benchmark logs. |
| Agentic Harness Engineering (AHE) | arXiv 2604.25850 | Observability-driven harness evolution; tools/middleware/memory > prompt prose. |
| Search-Time Data Contamination | arXiv 2508.13180 | NeurIPS 2025; search agents retrieve test answers; blocking sources drops accuracy. |
| SWE-Bench+ | arXiv 2410.06992 | **32.67%** solution leakage, **31.08%** weak tests (exact numbers, stronger than the notes implied). |
| ImpossibleBench | arXiv 2510.20270 | Zhong/Raghunathan/Carlini; test-exploitation propensity; repo safety-research/impossiblebench. |
| OpenHands | github.com/All-Hands-AI/OpenHands | Real (formerly OpenDevin); SDK/CLI/GUI/cloud/multi-user/RBAC. Release-version "1.8.0 / Jun 10 2026" not independently pinned — treat as approximate. |
| OpenHands Benchmarks | github.com/OpenHands/benchmarks | Real (created 2025-09-02); standardized eval pipelines; SWE-Bench/GAIA/etc. |
| LangGraph / Deep Agents | docs.langchain.com | "low-level orchestration framework and runtime for long-running, stateful agents" — matches. |
| AutoGen | microsoft.github.io/autogen | v0.4 layered Core/AgentChat/Extensions; event-driven multi-agent runtime — matches. |
| CrewAI | docs.crewai.com | agents/crews/flows/guardrails/memory/knowledge/observability — matches. |
| FinanceBench | github.com/patronus-ai/financebench | Real (arXiv 2311.11944); 10,231 total Q, open sample n=150 with gold/evidence/pages. |
| TAT-QA / TAT-DQA | nextplusplus.github.io | TAT-QA arXiv 2105.07624 (ACL 2021), 16,552 Q / 2,757 hybrid contexts; TAT-DQA = visually-rich PDFs. |
| SEC datasets | sec.gov | Financial Statement Data Sets (quarterly XBRL face data) + data.sec.gov EDGAR APIs (no key) — confirmed. |
| Univer | github.com/dream-num/univer | Full-stack isomorphic office SDK; Canvas render; command/mutation/operation; Pro-locks collab/import-export/charts/history — confirmed. |

---

## Honesty caveat

Verdicts come from automated web-verification by a subagent. The cluster of brand-new
**May–June 2026 arXiv IDs** (Claw-SWE-Bench, ADK Arena, WildClawBench, Harness-Bench, BlueFin,
SpreadsheetAgent, AgentLens, AHE) were each returned as HTTP-200 with matching title/authors/date —
but live-verifying a paper that is days old is inherently thin. **Before any of these appears in a
published external artifact, a 30-second manual arXiv click is cheap insurance.** The two corrections
above are the only items that are *known* wrong today.
