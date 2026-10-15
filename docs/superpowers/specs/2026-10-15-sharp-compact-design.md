# sharp-compact — design

Status: draft · 2026-10-15 · working name, may change before publishing.

## Intent

Claude Code's built-in compaction (`/compact` and auto-compact) loses the details that matter most to resume work: exact figures, thresholds, timestamps, file paths, how to reach data, caveats ("only reliable since 09:00 UTC"), and what is still unverified. One bad auto-compact can wreck a session.

The workaround people use today is manual: before compacting, ask the session "give me the /compact command", then paste its answer as `/compact <instructions>`. It works because the session itself knows what matters. The answer is cheap while the prompt cache is warm, because the whole context is a cache read and only a few hundred output tokens are new. But it is repetitive, it is easy to forget, and it never happens for auto-compact.

sharp-compact automates exactly that workaround, for every compaction, manual or automatic.

Typical use: a developer compacts before a break, so the next prompt doesn't pay for a large context after the cache expired. Auto-compact stays on as a safety net, and now produces a usable summary too.

## Goals

- Every compaction (`manual`, `auto`, `plugin`) is preceded by a handoff brief that the session writes itself, with its full context.
- That brief steers the summarizer and survives compaction verbatim, so exact details don't get rounded away.
- The cost is about what the manual workaround costs: a fork of the session served from the prompt cache, plus the brief's output tokens.
- One-line install for anyone. Public repo on the author's personal GitHub.
- Language-agnostic. The code, the docs and the prompt sent to the model are in English. The brief is written in the conversation's language.

## Non-goals (v1)

- A context gauge or "turns until auto-compact" warning band. That is planned for v2.
- Fallback shell hooks (PreCompact/SessionStart) for Claude Code builds without mod support.
- Summarizing with a cheaper model (Haiku). That was considered and rejected. A separate model would read the transcript uncached, losing the cache advantage, and it doesn't know what mattered.
- Replacing Claude Code's summarizer. sharp-compact steers and supplements it.
- Any storage outside what is needed for one pending brief.

## Anti-goals (failure even if it "works")

- A compaction that fails or is blocked because of sharp-compact. Any error falls back to the normal compaction.
- Noticeably higher cost than the manual workaround. For example, a fork that misses the cache on a large context and pays the full prefix every time.
- A brief that copies large content (diffs, file bodies) instead of pointing to it.
- Leaking secrets into the brief.
- Making compaction noticeably slower when the user is waiting on it with no feedback.

## Constraints

- Built on Claude Code's mod API, which is early access and may change between releases. The minimum version is pinned in the README and the manifest; it is the build tested on, currently 2.1.301.
- The mod environment has no Node and no DOM. Everything goes through `$`.
- It must work for organization-managed setups where allowed, and fail silently where mods are disabled.

## How it works (decided)

Mechanism, all taken from the mod API types in 2.1.301:

1. **Hook `session.compact`** on triggers `manual`, `auto`, `plugin` and `precompute`.
2. **Ask the session for the brief:** `$.model.fork({ prompt: BRIEF_PROMPT })`. This reruns the main thread's last request (same model, system prompt, tools, messages) with one extra user message and no tools, so the API serves the prefix from the prompt cache.
3. **Steer the summarizer.** Call `next({ ...e, instructions })` where `instructions` is the brief, plus the user's own `/compact <text>` if any (`e.instructions`), which keeps priority.
4. **Keep the brief verbatim.** On the way up, add the brief to the resulting `messages` as a user-role text message, labelled as the session's pre-compaction handoff. Exact details then survive even if the summarizer paraphrases.
5. **Proactive brief for auto-compact (user decision).** Mid-turn auto-compact may not be able to fork. So at the end of a turn, once the context reaches a set share of the auto-compact threshold (default 85%, configurable), the mod forks the brief once and keeps it. If auto-compact then fires mid-turn, it uses that brief. The brief is refreshed at most once per further threshold step, never every turn. If `precompute` turns out to cover this case natively, the builder may rely on it instead, as long as the behaviour is the same.
6. **Failure handling.** If the fork returns `isAnswered: false` (`nothing-to-fork`, `api-error`, `empty-reply`, `aborted`), call `next(e)` unchanged and show one toast saying the brief was skipped and why. Never `skip`.

### Default brief prompt (English, user-editable)

The prompt asks the session to:

- write a handoff brief that lets it resume this exact work after compaction, in the conversation's language;
- keep verbatim: figures, thresholds, timestamps, IDs, file paths, commands, and how to access data or systems;
- keep constraints and caveats on data, decisions with their reasons, dead ends, what is unverified, the user's last request and whether it was answered, and the next step;
- point to existing artifacts (PRs, files, URLs) by reference instead of copying them;
- redact secrets, tokens and personal data;
- stay concise, with an output length cap.

Sources of inspiration: the author's real manual briefs, and mattpocock-skills' `handoff` skill (references over copies, redaction).

## Open questions to verify first (spike, before the plan)

1. **Auto-compact mid-turn.** `$.model.fork` only works between turns ("until a turn has run to its end … nothing to fork"). Auto-compact can fire mid-turn. *Hypothesis (unverified):* the engine dispatches `precompute` between turns ahead of the threshold. sharp-compact forks there, and the precomputed result already carries the steered summary and verbatim brief. If `auto` fires with no usable precompute and the fork fails, it falls back to normal compaction (anti-goal 1 holds). To verify: does `precompute` fire, when, and does the fork succeed there?
2. **Cache hit.** Measure `usage.cache_read_input_tokens` and `cache_creation_input_tokens` of the fork on a real session of over 200k tokens. The expected result is almost all reads. The earlier shell spike, forking from an interactive session, read 49.2k and created 1.5k.
3. **Latency.** How long the fork takes on a large context, and whether the compaction UI shows progress while it runs.
4. **Verbatim message placement.** Whether a user-role message appended after the summary is kept and read correctly, or whether prepending it, or putting it inside the instructions only, is enough.

## Calls made by the designer (not confirmed by the user — check these)

- **Phase 0 is a gated spike** on the four open questions; the plan's later phases depend on its findings.
- **Stale briefs.** For `manual`, always fork fresh. For mid-turn `auto`, the proactive brief may be a few turns old. It is used anyway, because it beats no brief.
- **Re-entrancy:** the builder verifies whether `$.model.fork` touches the transcript or re-dispatches `session.compact`; a guard is added if it does.
- **Latency:** a toast ("writing handoff brief…") while forking, and a timeout (default 90 s, configurable) that falls back to normal compaction.
- **User's `/compact <text>`** goes first in `instructions`, labelled as the user's priority, followed by the brief.

## Left to the builder

- Exact wording and output cap of the brief prompt.
- Wording and placement of the verbatim brief message.
- Whether the brief prompt is configurable through `userConfig`, a file, or both (v1 needs at least one way).
- Tests: at least one `*.test.ts` covering steered instructions, appended brief, and fallback on fork failure. Run with `claude plugin test`.
- README: what it does, the one-line install (`/plugin install sharp-compact --marketplace <owner>/sharp-compact`), the minimum version, the cost model, and the early-access caveat.
- Final name before publishing.

## Prior art reviewed

- **claude-auto-handoff** (mod): has Haiku write a brief from the transcript, then runs `/clear`. It triggers on size and loses the session's judgement.
- **magic-compact**: manual, near-lossless per-turn summaries, then you `/resume` a new session.
- **Claude-Context-Control** (mod): a context gauge plus a mechanical snapshot. It passes compaction through unchanged and is the idea source for v2.
- **compact-plus**, **precompact-hook**, **claude-handoff** and other handoff tools: PreCompact/SessionStart shell hooks or manual commands. None reuses the session's own cached context.
- **Shell spike** (this repo, `spike/`, not published): proved the fork-and-reinject approach works with PreCompact and SessionStart hooks via `claude -p --resume --fork-session`, with cache hits from an interactive session.

## Spike findings (2026-10-15, Claude Code 2.1.301, Sonnet 5.5, interactive tmux sessions)

1. **Auto-compact mid-turn:** `$.model.fork` succeeds inside `session.compact` for `trigger: "auto"` fired mid-turn. It answered in 2.1 s and included the turn's latest tool results (18 messages). No `precompute` dispatch was seen. **Consequence:** the proactive early brief (Task 3) isn't needed for threshold-triggered auto-compact. The only uncovered case is auto-compact after a "prompt too long" API error, where the fork would hit the same limit and fall back.
2. **Cache:**
   - Manual compact on a ~50k session: the fork read 49,538 from cache and created 44.
   - Auto mid-turn: it read 43,737 from cache, created 0, and sent 26,147 uncached. Those uncached tokens are the turn's not-yet-cached tail, which is inherent and also paid by core's summarizer.
   - A session over 200k was not measured. On these numbers the fork costs about the same as core's own summary call (manual: read 48,322; auto: read 43,737 plus 28,125 uncached).
3. **Latency:** the fork takes 1.9–2.8 s for an 8-token reply. A ~600-word brief adds output time, around 10–20 s at Sonnet speed (estimate). The engine shows "Running PreCompact hooks…" while the mod hook runs, so the user gets feedback.
4. **Verbatim placement:**
   - Appending `{ role: "user", text, toolUses: [] }` after `next(e)`'s messages works: after compaction the model recalled `MARKER-42-ZEBRA` exactly.
   - `toolUses` is required. Without it the engine refuses the hook's result ("wrong shape") and keeps its own compaction, so failure is safe.
   - The appended message shows in the UI as a user prompt row.
   - `next(e)` returns `messages` as the summary user message plus the kept recent messages, with `tokensBefore`, `tokensAfter` and the summarizer's `usage`.
5. **Threshold location:** `$.session.usage({ breakdown: "summary" }).context.breakdown.autoCompactThreshold`: 967,000 by default on 1M, and 67,000 with `/autocompact 100k`.
