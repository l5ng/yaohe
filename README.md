# yaohe

`yaohe` is a TypeScript CLI that generates engineering daily reports from **landed Git evidence**, **user prompts from Claude Code / Codex sessions**, and a project **README**.

Git commits are treated as the primary evidence of completed work; uncommitted changes count as work in progress. AI session prompts are only used to understand requests and intent — they are never treated as proof of completion on their own. The tool never reads or sends full Git diffs.

## Architecture

A pnpm workspace of packages built on the [Cordis](https://github.com/cordiverse/cordis) plugin framework (programmatic composition, no loader config file):

| Package | Responsibility |
| --- | --- |
| `packages/cli` (`yaohe`) | argument parsing, config merging, root context assembly, report pipeline, exit codes |
| `packages/core` (`@l5ng/yaohe-core`) | shared model, typed events (`evidence/repo`, `evidence/session`, `generator/select`), `yaoheLog` service, time windows, budgets, template, prompt, process utilities |
| `packages/collector-git` | Git evidence, worktree discovery, README excerpt (`repo` collector) |
| `packages/collector-sessions` | Claude Code / Codex session JSONL scanning (`session` collectors) |
| `packages/generator-codex` / `generator-claude` | invoke the local `codex` / `claude` CLIs to generate reports |

Adding a data source or generator means adding a package and listening to the matching typed event from the CLI entry; the pipeline never knows the concrete implementation.

## Development

Requires Node >= 22.12 (native TS development and vitest need Node >= 23.6; 26 is recommended).

```bash
pnpm install
pnpm build       # tsc builds every package into its dist/
pnpm test        # vitest, runs against source (no build required)
pnpm lint        # oxlint (type-aware)
pnpm lint:knip   # dead-code and dependency check
```

## Install

```bash
pnpm --filter @l5ng/yaohe install -g   # or cd packages/cli && pnpm link --global
```

At least one generator must be installed and signed in locally:

- `codex` (preferred by `--agent auto`)
- `claude`

## Usage

```bash
# Summarize today's activity in the current Git repository; the report goes to stdout
yaohe

# Choose a date, project, and generator
yaohe report --project /path/to/repo --date 2026-07-22 --agent codex

# Aggregate all registered worktrees of the same repository
yaohe --project /path/to/any-worktree --all-worktrees

# Print the final generation prompt without invoking a model
yaohe --dry-run

# Use a template file and atomically write the report
yaohe --template daily-template.md --output reports/2026-07-22.md

# Read the template from stdin
cat daily-template.md | yaohe --template -

# Use the built-in Chinese template for this run
yaohe --template-lang zh
```

Run `yaohe --help` for the full option list.

### Templates and language

Default templates live in `packages/core/templates/`:

- `default.en.md` — English template (default)
- `default.zh.md` — Chinese template

By default the CLI detects the user's language from the system locale
(`LC_ALL` / `LC_MESSAGES` / `LANG`, falling back to the ICU default locale):
Chinese locales use `default.zh.md`, everything else uses `default.en.md`.
Force a language per run with `--template-lang <en|zh|auto>`:

```bash
yaohe --template-lang zh
```

or persistently in the config file with:

```toml
template_lang = "zh"   # "en" | "zh" | "auto" (default)
```

The generation prompt automatically follows the template's language: a template
containing Chinese characters produces a Chinese report, an English template
produces an English report. This applies to custom `--template` files too.

## Data sources and privacy

- Git: commits for the day, staged/unstaged diff stats, and untracked path summaries; full diffs are never read. With `--all-worktrees`, evidence is aggregated per worktree and commits are deduplicated by hash.
- Claude Code: real user text from `CLAUDE_CONFIG_DIR` or `~/.claude/projects/**/*.jsonl` for the current repository.
- Codex: real user text from `CODEX_HOME` or `~/.codex/{sessions,archived_sessions}/**/*.jsonl` for the current repository.
- README: only the `README.md` at the Git root, truncated to the configured budget.
- Only `--dry-run` and `--dump-context` explicitly output sensitive context.
- Claude/Codex run non-interactively in a temporary empty directory with the context passed via stdin.

## Exit codes

- `0`: success.
- `1`: configuration, collection, agent, or output error.
- `2`: no collectable activity — no Git commits, working-tree changes, or valid user prompts for the day.

## Release

Pushing a `v*` tag (e.g. `v0.1.0`) triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml): it verifies the
tag matches the `packages/cli` version, runs build/test/lint/knip, publishes the
`@l5ng/yaohe` package to npm, and creates a GitHub Release with auto-generated notes.

Only `@l5ng/yaohe` is published: the other workspace packages (`@l5ng/*`) are private
and bundled into the `@l5ng/yaohe` dist at build time, so installing the CLI needs no
other registry packages.

Prerequisites:

- An npm token with publish rights stored as the `NPM_TOKEN` repository secret.
- The `packages/cli` version bumped before tagging.

```bash
pnpm -r version --no-git-tag-version   # or edit each packages/*/package.json version
git tag v0.1.0
git push origin v0.1.0
```
