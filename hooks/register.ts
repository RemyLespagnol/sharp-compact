import type { Register } from 'claude-code'
import { DEFAULT_BRIEF_PROMPT, briefMessage, buildInstructions, isHandled, resolveBrief } from './brief'

export const register: Register = (on, options) => {
  const prompt = String(options.briefPrompt ?? '').trim() || DEFAULT_BRIEF_PROMPT
  const timeoutMs = Number(options.timeoutSeconds ?? 90) * 1000

  on('session.compact', async ($, e, next) => {
    // $.model.fork only forks the main thread, so a subagent's brief would be the parent's
    if (!isHandled(e.trigger) || e.agentId) return next(e)
    $.ui.toast('sharp-compact: writing handoff brief…')
    const brief = await resolveBrief(() => $.model.fork({ prompt }), ms => $.clock.sleep(ms), timeoutMs)
    if (!brief.ok) {
      $.ui.toast(`sharp-compact: brief skipped (${brief.reason}), normal compaction`)
      return next(e)
    }
    const r = await next({ ...e, instructions: buildInstructions(e.instructions, brief.text) })
    return r.messages ? { ...r, messages: [...r.messages, briefMessage(brief.text)] } : r
  }).catch(($, e, next) => next(e))
}
