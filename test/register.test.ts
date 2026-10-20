import { test, expect, mock } from 'claude-code/testing'
import type { On, SessionCompactResult } from 'claude-code'
import { briefNote, buildInstructions, isHandled } from '../hooks/brief'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const long = 'x'.repeat(20_000)
const compaction = { trigger: 'manual' as const, instructions: 'focus auth', messages: [{ role: 'user' as const, text: long, toolUses: [] }] }

function core(on: On) {
  const seen: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.compact', ($, e) => {
    seen.push(e.instructions)
    return { messages: [{ role: 'assistant', text: 'SUMMARY', toolUses: [] }] }
  })
  return { seen, toasts, clock: mock.clock(on), session: mock.session(on) }
}

function texts(r: SessionCompactResult): string[] {
  return r.messages?.map(m => m.text) ?? []
}

test('steers summarizer with brief', async ($, on) => {
  on('model.fork', () => ({ value: { isAnswered: true, text: 'BRIEF', usage } }))
  const { seen, toasts, clock, session } = core(on)
  const r = await $.session.compact(compaction)
  await clock.settle()
  // the compacted rows are not installed yet when the hook returns
  expect(session.appended()).toEqual([])
  await $.turn.start({ text: 'next', turnId: 't2' })
  expect(toasts[toasts.length - 1]).toBe('sharp-compact: brief kept (1 word)')
  expect(seen).toEqual([buildInstructions('focus auth', 'BRIEF')])
  expect(texts(r)).toEqual(['SUMMARY'])
  expect(session.appended().map(a => a.message)).toEqual([expect.objectContaining(briefNote('BRIEF'))])
})

test('skips a short conversation without forking', async ($, on) => {
  let forked = false
  on('model.fork', () => {
    forked = true
    return { value: { isAnswered: true, text: 'BRIEF', usage } }
  })
  const { seen, toasts } = core(on)
  await $.session.compact({ ...compaction, messages: [{ role: 'user', text: 'hi', toolUses: [] }] })
  expect(forked).toBe(false)
  expect(toasts).toEqual(['sharp-compact: short conversation, normal compaction'])
  expect(seen).toEqual(['focus auth'])
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
