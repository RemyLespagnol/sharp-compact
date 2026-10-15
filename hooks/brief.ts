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

Point to existing artifacts (PRs, files, URLs) by reference instead of copying their content. Always redact secrets, tokens and personal data. At most 600 words. No tools.`

export type ForkOutcome = { ok: true; text: string } | { ok: false; reason: string }

type ForkReply = { isAnswered: boolean; text?: string; reason?: string }

export function buildInstructions(userText: string | undefined, brief: string): string {
  const head = userText?.trim() ? `User's priority:\n${userText.trim()}\n\n` : ''
  return `${head}Handoff brief written by this session before compaction. Keep its exact details in the summary:\n\n${brief}`
}

export function briefMessage(brief: string): { role: 'user'; text: string; toolUses: [] } {
  return {
    role: 'user',
    text: `[sharp-compact] Handoff brief written by this session just before compaction. Treat its exact figures, paths and caveats as authoritative.\n\n${brief}`,
    toolUses: [],
  }
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
