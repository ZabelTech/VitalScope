---
name: notes-to-pr
description: Use this when the user gives a batch of unstructured notes/observations/feedback and wants them turned into shipped code. End-to-end pipeline — clarify ambiguous notes, file a GitHub issue per note, spawn one parallel implementation agent per issue in an isolated worktree, push each branch, then merge them all into a single integration branch and open a PR. Triggers on phrases like "create issues from these notes", "implement all of these in parallel", "ship this batch".
---

# Notes → issues → parallel branches → integration PR

A repeatable pipeline for taking a stream-of-consciousness list of notes and shipping them as a single PR composed of independent, individually-reviewable feature branches.

## When to use

Trigger when the user pastes a list of bullets/observations and signals batch intent — "create issues from these", "implement all of these in parallel on separate branches", "ship this batch". Don't use for single-task requests.

## Phases

### 1. Clarify before filing

For each note, decide if it's filable as-is or needs clarification:

- **Filable**: scope is clear, you know which files/area, you can write a useful issue body without guessing.
- **Needs clarification**: vague terms ("auto explain anomalies"), missing context ("night briefing got sleep wrong on 27th" — *what* night briefing?), conflicting interpretations ("1/m default" — minute/month/midnight?), or references to features that don't exist in the codebase.

Group questions and ask in **one message**. Don't file speculative issues. The user said "ask for clarification if not enough info" — take them at their word.

### 2. File issues

One issue per note (after clarification). Use `mcp__github__issue_write` with `method=create`. Each issue body must be detailed enough that a fresh agent can implement without re-reading the conversation:

- **Problem** — observable behaviour and why it matters
- **Proposal** — what to change, including any schema/endpoint shape decisions
- **Files** — point to the likely entry points (saves the agent a search)
- **Out of scope** — explicit fences so the agent doesn't expand scope
- **Acceptance / validation** — what "done" looks like

Use parallel `mcp__github__issue_write` calls in one message — they're independent.

### 3. Implement in parallel

One `general-purpose` agent per issue, all dispatched in **one message** with multiple Agent tool calls. **Always use `isolation: "worktree"`** — without it, parallel agents will trample each other's writes in the shared checkout. (Even with worktrees, an agent that misbehaves and writes to the main checkout can corrupt other work — a previous run of this skill caught one agent doing exactly that and reverting itself.)

Each agent prompt must be self-contained — the agent doesn't see the conversation. Include:

- A one-paragraph project context (what the codebase is, single-file backend, conventions)
- Key conventions from `CLAUDE.md`/`AGENTS.md` that apply (no comments, no emojis, single-file backend, etc.)
- The actual cwd if it differs from what the project's docs say (e.g. `/home/user/VitalScope` vs. the documented `/home/robert/vitalscope`)
- Branch setup: `git fetch origin main && git checkout -b <branch> origin/main` — don't branch off whatever the worktree happened to start on
- The full issue text (don't make the agent fetch it)
- Validation steps:
  - Frontend: `cd frontend && npx tsc -b --noEmit` must exit 0 (the `-b` is mandatory — see CLAUDE.md gotcha)
  - Backend: `python3 -c "from backend.app import app; print('ok')"`
  - If you can, smoke-curl the new endpoint in `VITALSCOPE_DEMO=1` mode
- Commit + push instructions, **explicitly say "do NOT create a pull request"**
- A short, structured report-back format (branch, commit, files, what you did, judgment calls)

Naming: `feat/…`, `fix/…`, `chore/…`. Use the issue number in the commit message subject.

Run agents in the **background** (`run_in_background: true`) so the user can keep working — you'll be notified per agent as each completes. Don't poll.

### 4. Integrate

Back in the main checkout (which you'll need to checkout out of any in-flight branch first):

```bash
git fetch origin --prune
git checkout -b integration/<descriptive-name> origin/main
```

Merge each branch with `--no-ff` so the per-feature history survives. **Order matters** — merge in increasing order of conflict surface:

1. Branches that touch unique files (plugin configs, isolated components) — first.
2. Branches that touch shared files but in different sections — middle.
3. Branches with the heaviest overlap (multiple branches touching the same hot file like `backend/app.py` or a shared component) — last.

When you do hit a conflict: read both sides, **combine additions** (don't drop one side's work), and write a merge-commit message that names what was combined. Re-check the resulting file for any cross-branch references (e.g. one branch's new component being imported in another's modified file).

Cherry-pick housekeeping changes (like a `.gitignore` update for `.claude/worktrees/`) onto the integration branch if they aren't already there.

### 5. Validate the integration

Re-run the same validation each agent ran, on the merged tree:

- `cd frontend && npx tsc -b --noEmit`
- `python3 -c "from backend.app import app; print('ok')"`

Static checks aren't enough for the deploy path — if there's a Dockerfile that runs `tsc -b && vite build`, the local `tsc -b --noEmit` covers the type half. The vite half (asset bundling) only runs in the actual Docker build; if there's a docker daemon available, build the image locally as a true dry run before pushing. Don't trust per-branch agent reports of "tsc passed" if their CI uses plain `tsc --noEmit` against a project-references tsconfig — that combo silently no-ops.

### 6. Push and open PR

```bash
git push -u origin integration/<name>
```

Then `mcp__github__create_pull_request` with a body that has:

- **Branches merged** table (issue # | branch | one-line description)
- **Conflicts resolved** — be specific about which file and which symbols from which side
- **Automated checks** — what you ran and the result
- **Verification checklist** — concrete UI clicks the user can do, not abstract test names. For each issue: which page to open, what value to compare, what should persist after a reload, which negative cases to try (duplicate names, empty inputs, stale data).
- **Closing keywords** at the bottom so the issues auto-close on merge:
  ```
  Closes #97
  Closes #98
  Closes #99
  ...
  ```
  GitHub also accepts `Fixes #N` and `Resolves #N`. They only close on merge into the **default branch** (typically `main`).

## Lessons learned (paid for in real PRs — don't relearn)

- **Worktree isolation is non-negotiable for parallel agents.** Without it: corrupt writes, lost work, agents reverting each other.
- **Per-branch agents don't see the conversation.** Their prompt must be standalone. Brief like a smart colleague who just walked into the room.
- **Backend conflicts are inevitable.** When N agents touch a single-file backend, you'll get N-1 merge conflicts. Plan for it; don't try to avoid it by serialising the agents (defeats the parallelism).
- **`tsc --noEmit` against a project-references root tsconfig silently passes.** Always use `tsc -b --noEmit`. The CI workflow's `frontend-typecheck` job had this exact bug — it was a no-op for the entire history of the project until caught here.
- **Locked agent worktrees stay around** in `.claude/worktrees/` even after the agent reports done. They're managed by the harness — don't `git worktree remove --force -f` them. Add `.claude/worktrees/` to `.gitignore`.
- **Don't trust an agent's "I validated" report blindly.** If their validation script is a no-op (see tsc point above) the report is meaningless. Re-validate at integration time with a known-good check.
- **The Dockerfile catches things `tsc -b --noEmit` doesn't** — Vite bundling, asset references, missing COPY paths. If you suspect a deploy issue and you have docker, build locally.
- **PR description verification checklist > "test plan checkbox".** The user has to actually click through the changes; spell out exactly what to click and what to expect, including reload-persistence and negative cases.
- **Closing keywords on the PR matter.** Without `Closes #N`, the issues stay open after merge and someone has to close them by hand.

## Anti-patterns

- Filing issues for vague notes without clarification — produces vague issues, agents make wrong assumptions, you waste a parallel-agent batch.
- Spawning agents without worktree isolation to "save resources" — the resource you save is dwarfed by the cost of recovering from cross-talk.
- Telling agents to "open a PR" — keeps integration messy. Open one PR for the whole batch.
- Merging branches in random order — start with the smallest blast-radius branch and end with the largest-overlap one, so each conflict resolution has the maximum context.
- Squash-merging the integration PR loses the per-feature history. Use a regular merge commit unless the user asks otherwise.
