---
name: paperclip-dev
required: false
description: >
  Develop and operate a local Paperclip instance — start and stop servers,
  pull updates from master, run builds and tests, manage worktrees, back up
  databases, and diagnose problems. Use whenever you need to work on the
  Paperclip codebase itself or keep a running instance healthy.
---

# Paperclip Dev

This skill covers the day-to-day workflows for developing and operating a local Paperclip instance. It assumes you are working inside the Paperclip repo checkout with `origin` pointing to `git@github.com:paperclipai/paperclip.git`.

> **MANDATORY:** Before running any CLI command, building, testing, or managing worktrees, you MUST read `doc/DEVELOPING.md` in the Paperclip repo. It is the canonical reference for all `paperclipai` CLI commands, their options, build/test workflows, database operations, worktree management, and diagnostics. Do NOT guess at flags or options — read the doc first.

## Quick Command Reference

These are the most common commands. For full option tables and details, see `doc/DEVELOPING.md`.

| Task | Command |
|------|---------|
| Start server (first time or normal) | `npx paperclipai run` |
| Dev mode with hot reload | `pnpm dev` |
| Stop dev server | `pnpm dev:stop` |
| Build | `pnpm build` |
| Type-check | `pnpm typecheck` |
| Run tests | `pnpm test` |
| Run migrations | `pnpm db:migrate` |
| Regenerate Drizzle client | `pnpm db:generate` |
| Back up database | `npx paperclipai db:backup` |
| Health check | `npx paperclipai doctor --repair` |
| Print env vars | `npx paperclipai env` |
| Trigger agent heartbeat | `npx paperclipai heartbeat run --agent-id <id>` |
| Install agent skills locally | `npx paperclipai agent local-cli <agent> --company-id <id>` |

## Pulling from Master

```bash
git fetch origin && git pull origin master
pnpm install && pnpm build
```

If schema changes landed, also run `pnpm db:generate && pnpm db:migrate`.

## Worktrees

Paperclip worktrees combine git worktrees with isolated Paperclip instances — each gets its own database, server port, and environment seeded from the primary instance.

> **MANDATORY:** Before creating or managing worktrees, you MUST read the "Worktree-local Instances" and "Worktree CLI Reference" sections in `doc/DEVELOPING.md`. That is the canonical reference for all worktree commands, their options, seed modes, and environment variables.

### When to Use Worktrees

- Starting a feature branch that needs its own Paperclip environment
- Running parallel agent work without cross-contaminating the primary instance
- Testing Paperclip changes in isolation before merging

### Command Overview

The CLI has two tiers (see `doc/DEVELOPING.md` for full option tables):

| Command | Purpose |
|---------|---------|
| `worktree:make <name>` | Create worktree + isolated instance in one step |
| `worktree:list` | List worktrees and their Paperclip status |
| `worktree:merge-history` | Preview/import issue history between worktrees |
| `worktree:cleanup <name>` | Remove worktree, branch, and instance data |
| `worktree init` | Bootstrap instance inside existing worktree |
| `worktree env` | Print shell exports for worktree instance |
| `worktree reseed` | Refresh worktree DB from another instance |
| `worktree repair` | Fix broken/missing worktree instance metadata |

### Typical Workflow

```bash
# 1. Create a worktree for a feature
npx paperclipai worktree:make my-feature --start-point origin/main

# 2. Move into the worktree (path printed by worktree:make) and source the environment
cd <worktree-path>
eval "$(npx paperclipai worktree env)"

# 3. Start the isolated Paperclip server
npx paperclipai run

# 4. Do your work

# 5. When done, merge history back if needed
npx paperclipai worktree:merge-history --from paperclip-my-feature --to current --apply

# 6. Clean up
npx paperclipai worktree:cleanup my-feature
```

## Pull Requests

> **MANDATORY PRE-FLIGHT:** Before creating ANY pull request, you MUST read the canonical source files listed below. Do NOT run `gh pr create` until you have read these files and verified your PR body matches every required section.

### Step 1 — Read the canonical files

You MUST read all three of these files before creating a PR:

1. **`.github/PULL_REQUEST_TEMPLATE.md`** — the required PR body structure
2. **`CONTRIBUTING.md`** — contribution conventions, PR requirements, and thinking-path examples
3. **`.github/workflows/pr.yml`** — CI checks that gate merge

### Step 2 — Validate your PR body against this checklist

After reading the template, verify your `--body` includes every one of these sections (names must match exactly):

- [ ] `## Thinking Path` — blockquote style, 5-8 reasoning steps
- [ ] `## What Changed` — bullet list of concrete changes
- [ ] `## Verification` — how a reviewer confirms this works
- [ ] `## Risks` — what could go wrong
- [ ] `## Model Used` — provider, model ID, version, capabilities
- [ ] `## Checklist` — copied from the template, items checked off

If any section is missing or empty, do NOT submit the PR. Go back and fill it in.

### Step 3 — Create the PR

Only after completing Steps 1 and 2, run `gh pr create`. Use the template contents as the structure for `--body` — do not write a freeform summary.

## Hard Rules — Do NOT Bypass

These rules exist because agents have caused real damage by improvising around CLI failures. Follow them exactly.

1. **CLI is the only interface to worktrees and databases.** All worktree and database operations MUST go through `npx paperclipai` / `pnpm paperclipai` commands. You MUST NOT:
   - Run `pg_dump`, `pg_restore`, `psql`, `createdb`, `dropdb`, or any raw postgres commands
   - Manually set `DATABASE_URL` to point a worktree server at another instance's database
   - Run `rm -rf` on any `.paperclip/`, `.paperclip-worktrees/`, or `db/` directory
   - Directly manipulate embedded postgres data directories
   - Kill postgres processes by PID

2. **If a CLI command fails, stop and report.** Do NOT attempt workarounds. If `worktree:make`, `worktree reseed`, `worktree init`, `worktree:cleanup`, or any other `paperclipai` command fails:
   - Report the exact error message in your task comment
   - Set the task to `blocked`
   - Suggest running `npx paperclipai doctor --repair` or recreating the worktree from scratch
   - Do NOT try to manually replicate what the CLI does

3. **Never share databases between instances.** Each worktree instance gets its own isolated database. Never override `DATABASE_URL` to point one instance at another's database. This destroys isolation and can corrupt production data.

4. **Starting a dev server in a worktree requires setup first.** The correct sequence is:
   ```bash
   # If the worktree already exists but has no running instance:
   cd <worktree-path>
   eval "$(npx paperclipai worktree env)"
   pnpm install && pnpm build
   npx paperclipai run          # or pnpm dev

   # If the worktree needs a fresh database:
   npx paperclipai worktree reseed --seed-mode full

   # If the worktree is broken beyond repair:
   npx paperclipai worktree:cleanup <name>
   npx paperclipai worktree:make <name> --seed-mode full
   ```
   If any step fails, follow rule 2 — stop and report.

5. **Seeding is a CLI operation.** When asked to seed a worktree database from the main instance, use `worktree reseed` or recreate with `worktree:make --seed-mode full`. Read `doc/DEVELOPING.md` for the full option tables. Never attempt manual database copying.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Server won't start | Run `npx paperclipai doctor --repair` to diagnose and auto-fix |
| Forgetting to source worktree env | Run `eval "$(npx paperclipai worktree env)"` after cd-ing into the worktree |
| Stale dependencies after pull | Run `pnpm install && pnpm build` after pulling |
| Schema out of date after pull | Run `pnpm db:generate && pnpm db:migrate` |
| Reseeding while target DB is running | Stop the target server first, or use `--allow-live-target` |
| Cleaning up with unmerged commits | Merge or push first, or use `--force` if intentionally discarding |
| Running agents against wrong instance | Verify `PAPERCLIP_API_URL` points to the correct port |
| CLI command fails | Do NOT work around it — report the error and block (see Hard Rules above) |
| Agent tries manual postgres operations | NEVER do this — all DB ops go through the CLI (see Hard Rules above) |
