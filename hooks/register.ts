import type { Register } from 'claude-code'
import { DEFAULT_BRIEF_PROMPT, briefNote, buildInstructions, conversationChars, isHandled, resolveBrief } from './brief'

// ~5k tokens: below that the summary alone keeps everything
const MIN_CHARS = 20_000

export const register: Register = (on, options) => {
  const prompt = String(options.briefPrompt ?? '').trim() || DEFAULT_BRIEF_PROMPT
  const timeoutMs = Number(options.timeoutSeconds ?? 90) * 1000

  on('session.compact', async ($, e, next) => {
    // $.model.fork only forks the main thread, so a subagent's brief would be the parent's
    if (!isHandled(e.trigger) || e.agentId) return next(e)
    if (conversationChars(e.messages) < MIN_CHARS) {
      $.ui.toast('sharp-compact: short conversation, normal compaction')
      return next(e)
    }
    $.ui.toast('sharp-compact: writing handoff brief…')
    const brief = await resolveBrief(() => $.model.fork({ prompt }), ms => $.clock.sleep(ms), timeoutMs)
    if (!brief.ok) {
      $.ui.toast(`sharp-compact: brief skipped (${brief.reason}), normal compaction`)
      return next(e)
    }
    const r = await next({ ...e, instructions: buildInstructions(e.instructions, brief.text) })
    // appended once the compacted transcript is installed, as a row the model reads and the person doesn't see
    if (r.messages) void $.clock.sleep(0).then(async () => {
      const kept = await $.session.append({ message: briefNote(brief.text) })
      const words = brief.text.split(/\s+/).length
      $.ui.toast('deny' in kept ? `sharp-compact: brief not kept (${kept.deny})` : `sharp-compact: brief kept (${words} ${words === 1 ? 'word' : 'words'})`)
    })
    return r
  }).catch(($, e, next) => next(e))
}
