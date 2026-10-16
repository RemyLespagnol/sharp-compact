import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { buildInstructions } from '../hooks/brief'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const HOUR_LESS_5 = 55 * 60_000
const slash = { command: 'sharp-compact', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const turnEnd = { reason: 'answer' as const, answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' }

function engine(on: On, tokens = 50_000) {
  const notes: string[] = []
  const compactions: (string | undefined)[] = []
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.notify', ($, e) => {
    notes.push(e.text)
    return { value: { isSent: true, channel: 'terminal_bell' as const } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('session.compact', ($, e) => {
    compactions.push(e.instructions)
    return { messages: [{ role: 'assistant', text: 'SUMMARY', toolUses: [] }] }
  })
  return { notes, compactions, clock: mock.clock(on) }
}

test('warns once the session sits idle', async ($, on) => {
  const { notes, clock } = engine(on)
  await $.turn.complete(turnEnd)
  await clock.advance(HOUR_LESS_5 - 1)
  expect(notes).toEqual([])
  await clock.advance(1)
  await clock.settle()
  expect(notes).toEqual(['Prompt cache expires soon: /compact now to resume this session cheaply.'])
})

test('a new turn restarts the wait', async ($, on) => {
  const { notes, clock } = engine(on)
  await $.turn.complete(turnEnd)
  await clock.advance(30 * 60_000)
  await $.turn.start({ text: 'next', turnId: 't2' })
  await clock.advance(30 * 60_000)
  await clock.settle()
  expect(notes).toEqual([])
})

test('stays quiet on a small context', async ($, on) => {
  const { notes, clock } = engine(on, 1_000)
  await $.turn.complete(turnEnd)
  await clock.advance(HOUR_LESS_5)
  await clock.settle()
  expect(notes).toEqual([])
})

test('ignores a subagent turn', async ($, on) => {
  const { notes, clock } = engine(on)
  await $.turn.complete({ ...turnEnd, agentId: 'sub-1' })
  await clock.advance(HOUR_LESS_5)
  await clock.settle()
  expect(notes).toEqual([])
})

test('compacts when idleCompact is on', { options: { idleCompact: true } }, async ($, on) => {
  on('model.fork', () => ({ value: { isAnswered: true, text: 'BRIEF', usage } }))
  const { notes, compactions, clock } = engine(on)
  await $.turn.complete(turnEnd)
  await clock.advance(HOUR_LESS_5)
  await clock.settle()
  expect(notes).toEqual([])
  expect(compactions).toEqual([buildInstructions(undefined, 'BRIEF')])
  expect((await $.command.run(slash)).text).toBe('BRIEF')
})

test('/sharp-compact says when no brief was written', async ($, on) => {
  engine(on)
  expect((await $.command.run(slash)).text).toBe('sharp-compact: no handoff brief written in this session yet.')
})

test('idleMinutes 0 turns it off', { options: { idleMinutes: 0 } }, async ($, on) => {
  const { notes, clock } = engine(on)
  await $.turn.complete(turnEnd)
  await clock.advance(10 * HOUR_LESS_5)
  await clock.settle()
  expect(notes).toEqual([])
})
