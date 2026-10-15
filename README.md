# sharp-compact

Claude Code's `/compact` and auto-compact keep the gist and lose the details you need to pick the work back up: exact figures, thresholds, timestamps, file paths, how to reach the data, and what is still unverified.

The usual workaround is to ask the session "give me the /compact command" and paste the answer back. It works because the session knows what matters. sharp-compact does exactly that on every compaction, manual or automatic, without you asking.

## What it does

Before each compaction (`/compact`, auto-compact, or one started by a plugin):

1. It asks your session for a handoff brief. The brief is written by the session's own model over its own transcript, using `$.model.fork`, so the cached prefix is reused.
2. It gives that brief to the summarizer as instructions. Your own `/compact <text>` stays first, as your priority.
3. It adds the brief word for word to the compacted conversation as a hidden note (the model reads it, your transcript doesn't show it), so exact details survive even if the summary paraphrases them.

Short conversations (under ~5k tokens of messages) compact normally: the summary alone keeps everything. The brief's length follows the work done, and it leaves out what reloads anyway (CLAUDE.md, memory, skills).

A toast tells you what happened: `brief kept (N words)`, `short conversation, normal compaction`, or, if anything goes wrong (no conversation to fork yet, an API error, an empty reply, a timeout), `brief skipped (<reason>)`, in which case the compaction runs as it normally would.

### Before / after

A plain `/compact` on a database migration might keep:

> Worked on the orders table migration; backfill mostly done.

With sharp-compact, the brief carries:

> Backfill batches of 5,000 rows, throttled to 200 ms. Rows before id 1,284,330 are done; resume with `scripts/backfill.sql --from 1284331`. `legacy_status` is only reliable since 2026-03-02 09:00 UTC. Dry run on staging: 3 rows failed the `NOT NULL` check, IDs in `tmp/failed_ids.txt`. Rollback plan written but **not tested**.

## Install

In a Claude Code session:

```
/plugin install sharp-compact --marketplace RemyLespagnol/sharp-compact
```

Answer `y` to add the marketplace, then pick the user scope.

Requires **Claude Code 2.1.301 or newer**. sharp-compact is a mod built on Claude Code's function-hook API, which is in **early access** and may change between releases. Where an organization manages Claude Code, compaction hooks only run for plugins the organization allows.

## Cost

Each compaction adds one fork of your session plus the brief's output. That's a few hundred tokens of output and roughly 2–20 s. The fork is served from the prompt cache, so on a warm cache it costs about what asking "give me the /compact command" yourself would. On a live session in testing, the fork read 49.5k tokens from cache and wrote 44.

If you compact after the cache has expired, the fork pays for the full context once, like any other request would.

## Options

Set in `/plugin` → sharp-compact → configure, or under `pluginConfigs.sharp-compact` in settings:

| Option | Default | Meaning |
|---|---|---|
| `timeoutSeconds` | `90` | How long to wait for the brief before compacting normally (10–600). |
| `briefPrompt` | empty | Replaces the default prompt that asks for the brief. Empty uses the default in `hooks/brief.ts`. |

## Not in v1

- A context gauge or "turns until auto-compact" warning.
- Fallback shell hooks for Claude Code builds without mod support.
- When auto-compact fires after a "prompt too long" API error, the fork hits the same limit and compaction runs normally.
- Subagent compactions run normally: the fork only sees the main conversation.
- If the brief times out, the fork is not cancelled and its tokens are still billed.

## Development

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT

## Releasing

Bump `version` in `.claude-plugin/plugin.json` in the PR. When it merges to `main`, the `release` workflow tags `vX.Y.Z` and publishes a GitHub release with notes generated from the merged PRs.
