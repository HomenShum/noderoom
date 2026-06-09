# Over-Engineering Audit

This repo is being built with heavy AI assistance, so every new subsystem needs a simplification check before it becomes “real code.”

The rule is: if a developer cannot explain why a layer exists and where it is used, the layer is either removed, documented as roadmap, or reduced to the smallest working contract.

## What We Keep

- `rooms`, `artifacts`, `elements`, `locks`, `drafts`, `proposals`, `messages`, and `traces` stay as the product core.
- `agentJobs`, `agentRuns`, `agentJobAttempts`, and `agentSteps` stay because long-running jobs, resumability, provenance, and evals need durable state.
- `Workflow/Workpool` stays for any agent job that outgrows its first action slice because it directly solves Convex action limits and durable continuation.
- Cell CAS, locks, proposals, and drafts stay because they are the no-clobber collaboration safety contract.
- Parser/provider file ids stay as cache metadata; Convex artifact ids remain the durable record.

## Recently Reduced

- The notebook graph landed as one `convex/notebookGraph.ts` module, not separate services for nodes, relations, relation types, and notebooks.
- The embedding lane landed as queue + CRUD + one runner, not a full retrieval redesign.
- Mutation receipts are written only for committed agent mutations first, not every query/tool event.
- Job details are read-only and compact in chat, not a database explorer UI.
- `/ask` and `/free` both use `agentJobs`; `/ask` auto-hands off to Workflow when it exhausts budget, while `/free` only forces the free-auto model policy.

## Watch List

| Area | Risk | Current Decision |
| --- | --- | --- |
| Graph/wiki substrate | Broad schema can outpace UI usage. | Keep only safe graph mutations with CAS and receipts; no delete/move workflow until needed. |
| Operation ledger | Can become process theater if not consumed. | Keep coarse operation events plus real mutation receipts; charts/UI use counts. |
| Agent leases | Can duplicate existing cell locks. | Use as cross-surface job metadata; cell safety remains locks + CAS. |
| Source-string tests | Can reward table accretion. | Keep source invariants for contracts, but prioritize live smoke/eval where feasible. |
| Benchmark tooling | Can sprawl into hard-to-own scripts. | Deterministic health checks are default; live/provider/UI loops are explicit. |
| UI telemetry | Can expose implementation internals to users. | Show status/counters/attempts; keep advanced trace under Details. |
| AI-generated abstractions | Can become code nobody owns. | Add only narrow modules with direct product hooks, tests, and docs. |
| Research-generated evals | Can measure the wrong behavior and then reward the wrong code. | Validate the workflow rubric from sources, mark contested opinions, check existing architecture fit, and only then add evals or code. |

## Simplification Bar

Before adding a new layer, it must answer all four questions:

1. What user workflow breaks without this?
2. What existing module would become worse if we kept it there?
3. What test or live eval proves this layer works?
4. What will we delete or avoid adding because this layer exists?

Research-driven workflow expansion must also answer:

5. What sources define the workflow rubric, and where do credible sources disagree?
6. Can existing Convex queries/actions/mutations, agent tools, prompts, or harnesses already handle the case?
7. If not, what is the smallest missing piece: query, mutation, action, tool schema, validator, prompt, or eval fixture?

If the answer is unclear, keep it as documentation or a single helper, not a subsystem.

## Ownership Gate

`docs/architecture-budget.json` is the owner manifest for architecture-sensitive
work. `npm run architecture:budget -- --strict` checks changed files against it
and rejects unowned or duplicate-owned scope.

Every new layer or expanded surface needs:

- exactly one owner surface;
- a product workflow hook;
- a budget impact: schema, UI, graph/wiki/embedding, safety gate, or none;
- behavior evidence from `tests/*`, `evals/*`, or `docs/eval/*`;
- a deletion or avoidance note explaining what this keeps out of the codebase.

Source scans are allowed for negative invariants, such as "no production
`client_action` executor" or Convex query/action/mutation boundary checks.
They are not feature proof. A table name existing in source is weaker evidence
than a runtime job producing the expected operation event, lease, receipt, or
CAS conflict.
