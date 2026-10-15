# sharp-compact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code mod that, before every compaction, has the session write its own handoff brief. The brief steers the summarizer and survives compaction verbatim.

**Architecture:** One hooks module (`hooks/register.ts`) wires two hooks:
- `session.compact` runs the compaction path;
- `session.measure` prepares the brief early, as the context nears the auto-compact threshold.

The decision logic lives in a pure module (`hooks/brief.ts`) so it can be tested without the engine. The brief comes from `$.model.fork`, which is served from the prompt cache.

**Tech Stack:** TypeScript, Claude Code mod API (≥ 2.1.301), `claude plugin validate` / `claude plugin test` (`claude-code/testing`).

**Spec:** `docs/superpowers/specs/2026-10-15-sharp-compact-design.md`

**API reference (local, this build):** the `plugin-authoring` skill's `types/claude-code.d.ts`, `reference.md` and `examples/`. That path is session-scoped. If it is gone, load the `plugin-authoring` skill again: it writes a fresh copy and names the new path. Grep it for exact shapes. Do not read the whole file.

## Global Constraints

- Code, docs, prompts and user-facing strings are in English. The brief itself is written in the conversation's language.
- The minimum Claude Code version is 2.1.301. State it in the README.
- Never return `{ skip }` from `session.compact`. Every failure path calls `next(e)` unchanged, so normal compaction happens.
- The user's own `/compact <text>` (`e.instructions`) always reaches the summarizer, first, labelled as the user's priority.
- No dependencies beyond the engine. No Node APIs: everything goes through `$`.
- Code comments: none by default. At most one line, and only for a non-obvious why.

## Review Focus

1. **The fork can't run** (`nothing-to-fork`: first compaction of a fresh session, right after `/clear`). Normal compaction runs, one toast says why, and `e.instructions` passes through untouched. Pinned in Task 2, test `falls back when fork is not answered`.
2. **The fork hangs.** After `timeoutSeconds` the compaction proceeds normally. Pinned in Task 1 (`resolveBrief times out`) and Task 2.
3. **Auto-compact is off** (`autoCompactThreshold` absent). No early fork ever runs. Pinned in Task 3, `shouldPrefork returns false without threshold`.
4. **Empty or whitespace brief.** Treated as a failure: no empty instructions, no empty verbatim message. Pinned in Task 1, `resolveBrief rejects blank text`.
5. **`/compact <text>` with a failed brief.** The user's text still reaches the summarizer unchanged. Pinned in Task 2, `falls back when fork is not answered`.

---

## File structure

```
sharp-compact/
├── .claude-plugin/plugin.json        manifest + userConfig (Task 1)
├── .claude-plugin/marketplace.json   one-line install (Task 4)
├── hooks/hooks.json                  { "modules": ["./register.ts"] } (Task 2)
├── hooks/brief.ts                    pure logic: prompt, instructions, message, decisions (Tasks 1, 3)
├── hooks/register.ts                 engine wiring (Tasks 2, 3)
├── test/brief.test.ts                unit tests for brief.ts
├── test/register.test.ts             engine-kit tests for register.ts
├── README.md                         (Task 4)
└── spike/                            git-ignored, throwaway (Task 0)
```

---

### Task 0: Gated spike (throwaway, not committed except findings)

Its purpose is to answer the spec's four open questions with real runs before any production code depends on them.

**Files:**
- Create: `spike/mod/.claude-plugin/plugin.json`, `spike/mod/hooks/hooks.json`, `spike/mod/hooks/register.ts`. These are git-ignored.
- Modify: `docs/superpowers/specs/2026-10-15-sharp-compact-design.md` (append a `## Spike findings` section).

- [ ] **Step 1: Write a logging mod.**
  - On `session.compact` (every trigger), call `$.model.fork({ prompt: "Reply with the single word FORK-OK." })`.
  - Time it with `$.clock.now()`.
  - Log `{ trigger, isAnswered, reason, usage, ms, messagesCount: e.messages.length }` via `$.ui.log`.
  - Return `next(e)`, then log the resulting message count and the roles of the first three messages.
  - On `session.measure`, log `e.context.tokens` and `(await $.session.usage()).context`. If the threshold fields live elsewhere, grep `autoCompactThreshold` to find where they are exposed.
- [ ] **Step 2: Run the manual case.** Start `claude --plugin-dir spike/mod --model sonnet` in tmux. Have two turns, then `/compact`. Record the log lines (`claude --debug` if `$.ui.log` is not visible).
- [ ] **Step 3: Run the auto mid-turn case.** In a new session, run `/autocompact 100k`. Ask Claude to read large files in one turn until auto-compact fires mid-turn. Record:
  - the trigger seen;
  - whether any `precompute` fired beforehand;
  - the fork's `isAnswered` and `reason` on `auto`.
- [ ] **Step 4: Measure cost and latency on a large context.** At over 200k tokens, record `usage.cache_read_input_tokens` and `cache_creation_input_tokens`, and the time `ms`. Expected: creation stays under 5% of read.
- [ ] **Step 5: Test verbatim placement.** Variant: append `{ role: 'user', text: 'MARKER-42 …' }` to `next(e)`'s `messages`. After compaction, ask "what is the marker?" without tools. Record whether it is answered and where the message shows in the transcript.
- [ ] **Step 6: Write the findings** into the spec's `## Spike findings` section. One line per question: answer, evidence, and the consequence for Tasks 2–3.
  - If `precompute` reliably fires between turns before `auto` and the fork succeeds there, note it, but keep Task 3 as specified. The spec allows relying on it only if the behaviour is identical.
  - If appending a message after the summary is dropped or ignored, switch Task 2's placement to prepend, and record that.
- [ ] **Step 7: Commit the findings only.**

```bash
git add docs/superpowers/specs/2026-10-15-sharp-compact-design.md
git commit -m "docs: sharp-compact spike findings"
```

**Gate:** if Step 2 shows that `$.model.fork` cannot run inside `session.compact` even for `manual`, stop and report to the user. The design needs revisiting.

---

### Task 1: Manifest and pure brief logic

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/brief.ts`, `test/brief.test.ts`

**Interfaces — Produces (in `hooks/brief.ts`):**
- `export const DEFAULT_BRIEF_PROMPT: string`
- `export function buildInstructions(userText: string | undefined, brief: string): string`
- `export function briefMessage(brief: string): { role: 'user'; text: string }`
- `export type ForkOutcome = { ok: true; text: string } | { ok: false; reason: string }`
- `export async function resolveBrief(fork: () => Promise<{ isAnswered: boolean; text?: string; reason?: string }>, sleep: (ms: number) => Promise<void>, timeoutMs: number): Promise<ForkOutcome>`

**Manifest:** `{ "name": "sharp-compact", "version": "0.1.0", "description": "Every compaction keeps what matters: the session writes its own handoff brief first." }`, plus three `userConfig` fields:
- `preforkPercent`: number, default `85`, range 50–99;
- `timeoutSeconds`: number, default `90`, range 10–600;
- `briefPrompt`: string, default `""` (empty means `DEFAULT_BRIEF_PROMPT`).

Take the field syntax from `reference.md` (search for `userConfig`).

- [ ] **Step 1: Write failing tests** in `test/brief.test.ts` (import `test`, `expect` from `claude-code/testing`):
  - `buildInstructions puts user text first`: `buildInstructions("focus auth", "B")` starts with `"User's priority:\nfocus auth"` and contains `"Handoff brief written by this session before compaction"` followed by `"B"`.
  - `buildInstructions without user text`: `buildInstructions(undefined, "B")` does not contain `"User's priority"`.
  - `briefMessage labels the brief`: `briefMessage("B")` deep-equals `{ role: 'user', text: "[sharp-compact] Handoff brief written by this session just before compaction. Treat its exact figures, paths and caveats as authoritative.\n\nB" }`.
  - `resolveBrief returns text`: fork resolves `{ isAnswered: true, text: " brief " }`, so the result is `{ ok: true, text: "brief" }` (trimmed).
  - `resolveBrief rejects blank text`: `text: "  \n"` gives `{ ok: false, reason: "empty-reply" }`.
  - `resolveBrief passes reason`: `{ isAnswered: false, reason: "nothing-to-fork" }` gives `{ ok: false, reason: "nothing-to-fork" }`.
  - `resolveBrief times out`: the fork never resolves and `sleep` resolves immediately, so the result is `{ ok: false, reason: "timeout" }`.
  - `DEFAULT_BRIEF_PROMPT covers the spec`: it contains `"conversation's language"`, `"verbatim"`, `"unverified"`, `"next step"`, `"by reference"`, `"redact"`.
- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `hooks/brief.ts`.**
  - `resolveBrief` races `fork()` against `sleep(timeoutMs).then(() => timeout)`.
  - `DEFAULT_BRIEF_PROMPT` follows the spec's "Default brief prompt" bullets, in English, and ends with "At most 600 words. No tools."
- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: all pass, no refusals.
- [ ] **Step 5: Commit.**

```bash
git add .claude-plugin/plugin.json hooks/brief.ts test/brief.test.ts
git commit -m "feat: brief prompt, instructions and fork resolution"
```

---

### Task 2: Compaction hook (manual / plugin / auto-with-fresh-fork)

**Files:**
- Create: `hooks/hooks.json`, `hooks/register.ts`, `test/register.test.ts`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces: `export const register: Register` (from `'claude-code'`). Also a module-level `let prepared: string | undefined`, which Task 3 sets.

**Behaviour of `on('session.compact', …)`:**
1. If `e.trigger === 'precompute'`, return `next(e)` untouched.
2. Show `$.ui.toast("sharp-compact: writing handoff brief…")`.
3. Pick the brief. For `auto`, use `prepared` if set. Otherwise (and always for `manual` and `plugin`), call `resolveBrief(() => $.model.fork({ prompt }), $.clock.sleep, timeoutSeconds * 1000)`. `prompt` is `options.briefPrompt || DEFAULT_BRIEF_PROMPT`.
4. On failure, toast `sharp-compact: brief skipped (<reason>), normal compaction` and return `next(e)` unchanged.
5. On success:
   - `const r = await next({ ...e, instructions: buildInstructions(e.instructions, brief) })`;
   - if `r.messages` is set, return `{ ...r, messages: [...r.messages, briefMessage(brief)] }` (or prepend, per the spike finding); otherwise return `r`;
   - then clear `prepared`.

- [ ] **Step 1: Write failing tests** in `test/register.test.ts`. The test's own `on('model.fork', …)` answers the fork. The test's `on('session.compact', …)` stands for core: it records the `instructions` it got and returns `{ messages: [{ role: 'assistant', text: 'SUMMARY' }] }`. Raise compaction with `$.session.compact({ instructions })` (trigger `plugin`).
  - `steers summarizer with brief`: fork answers `"BRIEF"`, and `$.session.compact({ instructions: "focus auth" })` runs. Core received `buildInstructions("focus auth", "BRIEF")`, and the result's last message is `briefMessage("BRIEF")`.
  - `falls back when fork is not answered`: fork answers `{ isAnswered: false, reason: "nothing-to-fork" }`. Core received exactly `"focus auth"`, and the messages hold only `SUMMARY`.
  - `falls back on timeout`: the fork never resolves; `mock.clock` is advanced by 90 000 ms. Same expectations as the previous test.
  - `ignores precompute`: if the kit can raise a `precompute` trigger (check the typings), core receives `e` unchanged and no fork happens. Otherwise, cover step 1 with a unit test on an exported `isHandled(trigger)` helper in `brief.ts`.
- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement** `hooks/hooks.json` and `hooks/register.ts` as described above.
- [ ] **Step 4: Run** `claude plugin test .`, `claude plugin validate .`, and `tsc -p .` (once the types are laid). Expected: all pass.
- [ ] **Step 5: Commit.**

```bash
git add hooks/hooks.json hooks/register.ts test/register.test.ts
git commit -m "feat: steer compaction with a session-written brief"
```

---

### Task 3: Early brief before auto-compact

**Files:**
- Modify: `hooks/brief.ts`, `hooks/register.ts`, `test/brief.test.ts`, `test/register.test.ts`

**Interfaces — Produces (in `hooks/brief.ts`):**
- `export function shouldPrefork(tokens: number | undefined, threshold: number | undefined, percent: number, lastPreforkTokens: number | undefined): boolean`

**Rule:** return true when all of these hold:
- `tokens` and `threshold` are both defined;
- `tokens >= threshold * percent / 100`;
- either `lastPreforkTokens` is undefined, or `tokens - lastPreforkTokens >= threshold * 0.05`.

The 5% gap is the designer's choice for "a further threshold step".

**Wiring:** `on('session.measure', …)`:
- call `next(e)` first;
- read `autoCompactThreshold` (the location was recorded in the Task 0 findings), and skip if `isAutoCompactEnabled` is false;
- if `shouldPrefork(e.context.tokens, threshold, options.preforkPercent, lastPreforkTokens)`, run `resolveBrief` with the fork. On `ok`, set `prepared` and `lastPreforkTokens = tokens`. On failure, do nothing and show no toast;
- never await the fork in a way that blocks the turn's end: start it and let it settle.

A successful compaction resets `lastPreforkTokens` to undefined.

- [ ] **Step 1: Write failing tests.**
  - `shouldPrefork returns false without threshold`: `(900, undefined, 85, undefined)` is false.
  - `shouldPrefork below percent`: `(840, 1000, 85, undefined)` is false.
  - `shouldPrefork at percent`: `(850, 1000, 85, undefined)` is true.
  - `shouldPrefork waits for a step`: `(880, 1000, 85, 850)` is false, and `(900, 1000, 85, 850)` is true.
  - `register: auto uses prepared brief without forking`. Raising a real `session.measure` is not possible in the kit, so set `prepared` through a test-only path. Export `__setPrepared(text: string | undefined): void` from `register.ts` as the test seam. Then raise `auto` (or `plugin`, if the kit can't raise `auto`). Assert that no `model.fork` call was made and that core received `buildInstructions(undefined, "EARLY")`.
- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement** `shouldPrefork` and the `session.measure` hook.
- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: PASS.
- [ ] **Step 5: Commit.**

```bash
git add hooks/ test/
git commit -m "feat: prepare the brief before auto-compact"
```

---

### Task 4: Packaging, README, live check

**Files:**
- Create: `.claude-plugin/marketplace.json`, `README.md`

- [ ] **Step 1: Write `marketplace.json`** with one plugin entry, `sharp-compact`, `"source": "./"`. The shape is in `reference.md`, "Sharing a mod".
- [ ] **Step 2: Write `README.md`.**
  - What it does, with one before/after example: a fictional brief built like the spec's intent.
  - Install: `/plugin install sharp-compact --marketplace <owner>/sharp-compact`.
  - Minimum version 2.1.301, and the mod API's early-access caveat.
  - The cost model: one cached fork per compaction, plus one early fork near the threshold. Cost is higher if you compact after the cache expired.
  - The three `userConfig` options.
  - What v1 does not do: the context gauge comes in v2.
- [ ] **Step 3: Live check — manual.** Run `claude --plugin-dir . --model sonnet` in tmux. Plant three exact facts in turn 1. Run `/compact`. Then, without tools, ask for the three facts. All three must come back exact. Record the fork's usage from the toast or debug log.
- [ ] **Step 4: Live check — auto.** Run `/autocompact 100k`, then grow the context until auto-compact fires. Confirm the early brief was prepared, by its toast or the debug log, and that the facts survive.
- [ ] **Step 5: Commit.**

```bash
git add .claude-plugin/marketplace.json README.md
git commit -m "docs: README and marketplace for one-line install"
```

Publishing the repo to GitHub is not part of this plan. Ask the user first: it is outward-facing.
