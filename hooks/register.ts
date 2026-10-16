import type { EngineInterface as Engine, Register, SessionCompactResult, Timer } from 'claude-code'
import { DEFAULT_BRIEF_PROMPT, briefNote, buildInstructions, conversationChars, isHandled, resolveBrief } from './brief'

// ~5k tokens: below that the summary alone keeps everything
const MIN_CHARS = 20_000
const MIN_TOKENS = 5_000

type Settings = { prompt: string; timeoutMs: number; remember: (brief: string) => void }
type Compact = (instructions: string | undefined) => Promise<SessionCompactResult>

async function briefedCompact($: Engine, s: Settings, instructions: string | undefined, compact: Compact): Promise<SessionCompactResult> {
  $.ui.toast('sharp-compact: writing handoff brief…')
  const brief = await resolveBrief(() => $.model.fork({ prompt: s.prompt }), ms => $.clock.sleep(ms), s.timeoutMs)
  if (!brief.ok) {
    $.ui.toast(`sharp-compact: brief skipped (${brief.reason}), normal compaction`)
    return compact(instructions)
  }
  const r = await compact(buildInstructions(instructions, brief.text))
  if (!r.messages) return r
  s.remember(brief.text)
  // appended once the compacted transcript is installed, as a row the model reads and the person doesn't see
  void $.clock.sleep(0).then(async () => {
    const kept = await $.session.append({ message: briefNote(brief.text) })
    const words = brief.text.split(/\s+/).length
    $.ui.toast('deny' in kept ? `sharp-compact: brief not kept (${kept.deny})` : `sharp-compact: brief kept (${words} ${words === 1 ? 'word' : 'words'})`)
  })
  return r
}

async function onIdle($: Engine, s: Settings, autoCompact: boolean): Promise<void> {
  const { context } = await $.session.usage()
  if ((context.tokens ?? 0) < MIN_TOKENS) return
  // $.session.compact skips this plugin's own session.compact hook, so the brief is written here
  if (autoCompact) await briefedCompact($, s, undefined, instructions => $.session.compact({ instructions }))
  else await $.ui.notify('Prompt cache expires soon: /compact now to resume this session cheaply.')
}

export const register: Register = (on, options) => {
  const idleMs = Number(options.idleMinutes ?? 55) * 60_000
  const autoCompact = options.idleCompact === true
  // shortcut: lost when the plugin reloads, move it to $.state if that matters
  let lastBrief: string | undefined
  let idle: Timer | undefined
  const s: Settings = {
    prompt: String(options.briefPrompt ?? '').trim() || DEFAULT_BRIEF_PROMPT,
    timeoutMs: Number(options.timeoutSeconds ?? 90) * 1000,
    remember: brief => { lastBrief = brief },
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'sharp-compact', description: 'Show the last handoff brief sharp-compact wrote' })
    return next(e)
  })

  on('command.run', { command: 'sharp-compact' }, async () => ({
    text: lastBrief ?? 'sharp-compact: no handoff brief written in this session yet.',
  }))

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) idle?.cancel()
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId || idleMs <= 0) return r
    idle?.cancel()
    idle = $.clock.after(idleMs, () => void onIdle($, s, autoCompact).catch(() => {}))
    return r
  })

  on('session.compact', async ($, e, next) => {
    // $.model.fork only forks the main thread, so a subagent's brief would be the parent's
    if (!isHandled(e.trigger) || e.agentId) return next(e)
    idle?.cancel()
    if (conversationChars(e.messages) < MIN_CHARS) {
      $.ui.toast('sharp-compact: short conversation, normal compaction')
      return next(e)
    }
    return briefedCompact($, s, e.instructions, instructions => next({ ...e, instructions }))
  }).catch(($, e, next) => next(e))
}
