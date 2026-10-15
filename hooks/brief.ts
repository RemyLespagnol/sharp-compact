import type { SessionMessage } from 'claude-code'

export const DEFAULT_BRIEF_PROMPT = `The conversation is about to be compacted. Write a handoff brief that lets you resume this exact work afterwards, as if a colleague had to pick it up cold.

Write it in the conversation's language. Keep verbatim, never rounded or paraphrased: figures, thresholds, timestamps, IDs, file paths, commands, queries, and how to access data or systems.

Cover, skipping what does not apply:
- the goal and current state of the work;
- constraints and caveats on data or environment;
- decisions taken, each with its reason;
- dead ends already tried;
- what is unverified or assumed;
- the user's last request and whether it was answered;
- the next step.

Point to existing artifacts (PRs, files, URLs) by reference instead of copying their content. Leave out what reloads on its own after compaction: CLAUDE.md, memory files, skills, the system prompt and the user's standing preferences. Always redact secrets, tokens and personal data.

Keep the length proportional to the work actually done: a few lines when little happened, at most 600 words. No tools.`

export type ForkOutcome = { ok: true; text: string } | { ok: false; reason: string }

type ForkReply = { isAnswered: boolean; text?: string; reason?: string }

export function buildInstructions(userText: string | undefined, brief: string): string {
  const head = userText?.trim() ? `User's priority:\n${userText.trim()}\n\n` : ''
  return `${head}Handoff brief written by this session before compaction. Keep its exact details in the summary:\n\n${brief}`
}

export function briefNote(brief: string): { type: 'user'; content: [{ type: 'text'; text: string }] } {
  return {
    type: 'user',
    content: [{
      type: 'text',
      text: `[sharp-compact] Handoff brief written by this session just before compaction. Use it as the reference for exact figures, paths and caveats.\n\n${brief}`,
    }],
  }
}

export function conversationChars(messages: readonly SessionMessage[]): number {
  let n = 0
  for (const m of messages) {
    n += m.text.length
    for (const u of m.toolUses) n += JSON.stringify(u.input).length + (u.text?.length ?? 0)
    for (const r of m.toolResults ?? []) n += r.text.length
  }
  return n
}

export async function resolveBrief(
  fork: () => Promise<ForkReply>,
  sleep: (ms: number) => Promise<void>,
  timeoutMs: number,
): Promise<ForkOutcome> {
  const timeout = sleep(timeoutMs).then((): ForkReply => ({ isAnswered: false, reason: 'timeout' }))
  const r = await Promise.race([fork(), timeout])
  if (!r.isAnswered) return { ok: false, reason: r.reason ?? 'unknown' }
  const text = r.text?.trim() ?? ''
  return text ? { ok: true, text } : { ok: false, reason: 'empty-reply' }
}

export function isHandled(trigger: string): boolean {
  return trigger !== 'precompute'
}
