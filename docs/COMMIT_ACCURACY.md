# Commit Accuracy

Commit messages are part of the audit trail. For NodeRoom, a good commit message
must be accurate enough that an interviewer or maintainer can reconstruct the
change without opening every diff first.

## Required Shape

Use a normal one-line subject, then include these sections in the body whenever
the commit changes more than one file or touches generated evidence:

```text
Change list:
- M path/to/file.ts — what changed and why
- A path/to/new-file.md — what changed and why

Verification:
- command that passed
- command that passed

Known limits:
- any live-only, flaky, skipped, or intentionally unproven claim
```

Every changed file path should appear verbatim in the message body. If that
feels too verbose, split the commit.

## Generate The File List

Before committing:

```bash
npm run commit:summary
```

This prints a staged-diff-backed message scaffold. Use it as the source of truth
for the `Change list` section instead of writing from memory.

After committing:

```bash
npm run commit:check
```

This verifies that the latest commit message mentions every changed file path.
It does not judge prose quality; it catches the easy drift where a commit body
describes the intent but omits a file that actually shipped.

Before pushing several commits:

```bash
npm run commit:check:range -- origin/main..HEAD
```

CI runs the same range check against the pushed or pull-request commit range,
skipping merge commits because GitHub-generated merge messages are not authored
as release notes.

## Rules

- Do not rewrite a pushed public commit just to improve wording unless the user
  explicitly asks for a force-push.
- For generated artifacts, list the source generator and the generated files.
- For live evidence, include whether it was live, deterministic, skipped, or
  local-only.
- For production claims, point to the proving test, smoke, trace, or readiness
  row.
