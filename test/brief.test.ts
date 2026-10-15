import { test, expect } from 'claude-code/testing'
import { DEFAULT_BRIEF_PROMPT, briefNote, buildInstructions, conversationChars, resolveBrief } from '../hooks/brief'

const never = () => new Promise<never>(() => {})
const now = () => Promise.resolve()

test('buildInstructions puts user text first', () => {
  const s = buildInstructions('focus auth', 'B')
  expect(s.startsWith("User's priority:\nfocus auth")).toBe(true)
  expect(s.indexOf('Handoff brief written by this session before compaction')).toBeGreaterThan(0)
  expect(s.endsWith('B')).toBe(true)
})

test('buildInstructions without user text', () => {
  expect(buildInstructions(undefined, 'B').includes("User's priority")).toBe(false)
})

test('briefNote labels the brief', () => {
  expect(briefNote('B')).toEqual({
    type: 'user',
    content: [{ type: 'text', text: '[sharp-compact] Handoff brief written by this session just before compaction. Use it as the reference for exact figures, paths and caveats.\n\nB' }],
  })
})

test('conversationChars counts text, tool inputs and results', () => {
  expect(conversationChars([
    { role: 'user', text: 'abc', toolUses: [] },
    { role: 'assistant', text: 'de', toolUses: [{ tool_use_id: '1', tool: 'Read', input: { file_path: 'x' }, text: 'fghij' }] },
    { role: 'user', text: '', toolUses: [], toolResults: [{ tool_use_id: '1', text: 'klm', isError: false }] },
  ])).toBe(3 + 2 + JSON.stringify({ file_path: 'x' }).length + 5 + 3)
})

test('resolveBrief returns text', async () => {
  expect(await resolveBrief(async () => ({ isAnswered: true, text: ' brief ' }), never, 1000)).toEqual({ ok: true, text: 'brief' })
})

test('resolveBrief rejects blank text', async () => {
  expect(await resolveBrief(async () => ({ isAnswered: true, text: '  \n' }), never, 1000)).toEqual({ ok: false, reason: 'empty-reply' })
})

test('resolveBrief passes reason', async () => {
  expect(await resolveBrief(async () => ({ isAnswered: false, reason: 'nothing-to-fork' }), never, 1000)).toEqual({ ok: false, reason: 'nothing-to-fork' })
})

test('resolveBrief times out', async () => {
  expect(await resolveBrief(never, now, 1000)).toEqual({ ok: false, reason: 'timeout' })
})

test('DEFAULT_BRIEF_PROMPT covers the spec', () => {
  for (const s of ["conversation's language", 'verbatim', 'unverified', 'next step', 'by reference', 'redact', 'proportional', 'CLAUDE.md'])
    expect(DEFAULT_BRIEF_PROMPT.includes(s)).toBe(true)
})
