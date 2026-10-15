import { test, expect, mock } from 'claude-code/testing'
import type { On, SessionCompactResult } from 'claude-code'
import { briefMessage, buildInstructions, isHandled } from '../hooks/brief'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const compaction = { trigger: 'manual' as const, instructions: 'focus auth', messages: [{ role: 'user' as const, text: 'hi', toolUses: [] }] }

function core(on: On) {
  const seen: (string | undefined)[] = []
  on('ui.toast', () => ({ value: undefined }))
  on('session.compact', ($, e) => {
    seen.push(e.instructions)
    return { messages: [{ role: 'assistant', text: 'SUMMARY', toolUses: [] }] }
  })
  return { seen, clock: mock.clock(on) }
}

function texts(r: SessionCompactResult): string[] {
  return r.messages?.map(m => m.text) ?? []
}

test('steers summarizer with brief', async ($, on) => {
  on('model.fork', () => ({ value: { isAnswered: true, text: 'BRIEF', usage } }))
  const { seen } = core(on)
  const r = await $.session.compact(compaction)
  expect(seen).toEqual([buildInstructions('focus auth', 'BRIEF')])
  expect(texts(r)).toEqual(['SUMMARY', briefMessage('BRIEF').text])
})

test('falls back when fork is not answered', async ($, on) => {
  on('model.fork', () => ({ value: { isAnswered: false, reason: 'nothing-to-fork', usage } }))
  const { seen } = core(on)
  const r = await $.session.compact(compaction)
  expect(seen).toEqual(['focus auth'])
  expect(texts(r)).toEqual(['SUMMARY'])
})

test('falls back on timeout', async ($, on) => {
  on('model.fork', () => new Promise(() => {}))
  const { seen, clock } = core(on)
  const pending = $.session.compact(compaction)
  await clock.advance(90_000)
  const r = await pending
  expect(seen).toEqual(['focus auth'])
  expect(texts(r)).toEqual(['SUMMARY'])
})

test('ignores precompute', () => {
  expect(isHandled('precompute')).toBe(false)
  for (const t of ['manual', 'auto', 'plugin']) expect(isHandled(t)).toBe(true)
})

test("leaves a subagent's compaction alone", async ($, on) => {
  let forked = false
  on('model.fork', () => {
    forked = true
    return { value: { isAnswered: true, text: 'BRIEF', usage } }
  })
  const { seen } = core(on)
  const r = await $.session.compact({ ...compaction, agentId: 'sub-1' })
  expect(forked).toBe(false)
  expect(seen).toEqual(['focus auth'])
  expect(texts(r)).toEqual(['SUMMARY'])
})
