import type { EngineInterface as Engine, Register, SessionCompactResult, Timer } from 'claude-code'
import { DEFAULT_BRIEF_PROMPT, briefNote, buildInstructions, conversationChars, isHandled, resolveBrief } from './brief'

// ~5k tokens: below that the summary alone keeps everything
const MIN_CHARS = 20_000
const MIN_TOKENS = 5_000

type Settings = { prompt: string; timeoutMs: number; remember: (brief: string) => void; busy: boolean }

async function briefedCompact<R>(
  $: Engine,
  s: Settings,
  instructions: string | undefined,
  compact: (instructions: string | undefined) => Promise<R>,
  isCompacted: (r: R) => boolean,
): Promise<R> {
  $.ui.toast('sharp-compact: writing handoff brief…')
  const brief = await resolveBrief(() => $.model.fork({ prompt: s.prompt }), ms => $.clock.sleep(ms), s.timeoutMs)
  if (!brief.ok) {
    $.ui.toast(`sharp-compact: brief skipped (${brief.reason}), normal compaction`)
    return compact(instructions)
  }
  const r = await compact(buildInstructions(instructions, brief.text))
  if (!isCompacted(r)) return r
  s.remember(brief.text)
  // appended once the compacted transcript is installed, as a row the model reads and the person doesn't see
  void $.clock.sleep(0).then(async () => {
    const kept = await $.session.append({ message: briefNote(brief.text) })
    const words = brief.text.split(/\s+/).length
    $.ui.toast('deny' in kept ? `sharp-compact: brief not kept (${kept.deny})` : `sharp-compact: brief kept (${words} ${words === 1 ? 'word' : 'words'})`)
  })
  return r
}

const hasMessages = (r: SessionCompactResult) => r.messages !== undefined

async function exclusive<R>(s: Settings, run: () => Promise<R>): Promise<R> {
  s.busy = true
  try {
    return await run()
  } finally {
    s.busy = false
  }
}

// $.session.compact skips this plugin's own session.compact hook, so the brief is written here
function compactNow($: Engine, s: Settings): Promise<SessionCompactResult> {
  return exclusive(s, () => briefedCompact($, s, undefined, instructions => $.session.compact({ instructions }), hasMessages))
}

async function bigEnough($: Engine): Promise<boolean> {
  const { context } = await $.session.usage()
  return (context.tokens ?? 0) >= MIN_TOKENS
}

async function onIdle($: Engine, s: Settings, autoCompact: boolean): Promise<void> {
  if (s.busy || !(await bigEnough($))) return
  if (autoCompact) await compactNow($, s)
  else await $.ui.notify('Prompt cache expires soon: /compact now to resume this session cheaply.')
}

export const register: Register = (on, options) => {
  const idleMs = Number(options.idleMinutes ?? 55) * 60_000
  const autoCompact = options.idleCompact === true
  const compactAt = Number(options.compactAtPercent ?? 0)
  // shortcut: lost when the plugin reloads, move it to $.state if that matters
  let lastBrief: string | undefined
  let idle: Timer | undefined
  const s: Settings = {
    prompt: String(options.briefPrompt ?? '').trim() || DEFAULT_BRIEF_PROMPT,
    timeoutMs: Number(options.timeoutSeconds ?? 90) * 1000,
    remember: brief => { lastBrief = brief },
    busy: false,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sharp-compact', description: 'Show the last handoff brief sharp-compact wrote' })
    return next(e)
  })

  on('command.run', { command: 'sharp-compact' }, async () => ({
    text: lastBrief ?? 'sharp-compact: no handoff brief written in this session yet.',
  }))

  // sec-default (Team/Enterprise) skips user session.compact hooks but not command.run, so the brief rides in /compact's args
  on('command.run', { command: 'compact' }, async ($, e, next) => {
    if (s.busy || !(await bigEnough($))) return next(e)
    idle?.cancel()
    return exclusive(s, () => briefedCompact($, s, e.args, args => next({ ...e, args: args ?? '' }), () => true))
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) idle?.cancel()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    if (compactAt > 0 && !s.busy && ((await $.session.usage()).context.percent ?? 0) >= compactAt) {
      void compactNow($, s).catch(() => {})
      return r
    }
    if (idleMs <= 0) return r
    idle?.cancel()
    idle = $.clock.after(idleMs, () => void onIdle($, s, autoCompact).catch(() => {}))
    return r
  })

  on('session.compact', async ($, e, next) => {
    // $.model.fork only forks the main thread, so a subagent's brief would be the parent's
    if (!isHandled(e.trigger) || e.agentId || s.busy) return next(e)
    idle?.cancel()
    if (conversationChars(e.messages) < MIN_CHARS) {
      $.ui.toast('sharp-compact: short conversation, normal compaction')
      return next(e)
    }
    return briefedCompact($, s, e.instructions, instructions => next({ ...e, instructions }), hasMessages)
  }).catch(($, e, next) => next(e))
}
