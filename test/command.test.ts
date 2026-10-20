import { test, expect, mock } from 'claude-code/testing'
import type { On } from 'claude-code'
import { briefNote, buildInstructions } from '../hooks/brief'

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const presentation = { isFullscreen: false, columns: 80 }
const slashCompact = { command: 'compact', args: 'focus auth', origin: { kind: 'composer' as const }, presentation }
const turnEnd = { reason: 'answer' as const, answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1' }

function engine(on: On, { tokens = 50_000, percent = 10 } = {}) {
  const ran: string[] = []
  const compactions: (string | undefined)[] = []
  let forks = 0
  on('model.fork', () => {
    forks++
    return { value: { isAnswered: true, text: 'BRIEF', usage } }
  })
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens, percent, window: 1_000_000 }, rateLimits: [] } }))
  on('ui.toast', () => ({ value: undefined }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('session.compact', ($, e) => {
    compactions.push(e.instructions)
    return { messages: [{ role: 'assistant', text: 'SUMMARY', toolUses: [] }] }
  })
  on('command.run', ($, e) => {
    ran.push(e.args)
    return { text: 'Compacted' }
  })
  return { ran, compactions, forks: () => forks, clock: mock.clock(on), session: mock.session(on) }
}

test('/compact carries the brief in its arguments', async ($, on) => {
  const { ran, forks, clock, session } = engine(on)
  await $.command.run(slashCompact)
  await clock.settle()
  expect(ran).toEqual([buildInstructions('focus auth', 'BRIEF')])
  expect(forks()).toBe(1)
  expect(session.appended().map(a => a.message)).toEqual([expect.objectContaining(briefNote('BRIEF'))])
})

test('/compact on a small context runs untouched', async ($, on) => {
  const { ran, forks } = engine(on, { tokens: 1_000 })
  await $.command.run(slashCompact)
  expect(ran).toEqual(['focus auth'])
  expect(forks()).toBe(0)
})

test('compacts ahead of auto-compact past compactAtPercent', { options: { compactAtPercent: 80 } }, async ($, on) => {
  const { compactions, clock } = engine(on, { percent: 85 })
  await $.turn.complete(turnEnd)
  await clock.settle()
  expect(compactions).toEqual([buildInstructions(undefined, 'BRIEF')])
})

test('leaves the context alone below compactAtPercent', { options: { compactAtPercent: 80 } }, async ($, on) => {
  const { compactions, clock } = engine(on, { percent: 60 })
  await $.turn.complete(turnEnd)
  await clock.settle()
  expect(compactions).toEqual([])
})
