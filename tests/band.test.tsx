import type { SessionUsage } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const props = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`affiche coût et durées (${surface})`, async ($, on) => {
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 45_230, window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 55.5 }], cost: { usd: 1.5 } } as unknown as SessionUsage }))
    on('clock.now', () => ({ value: 3_725_000 }))

    const seeded: Record<string, unknown> = { lastUsd: 0.042, lastPct: 1.2, sessionPct: 8.5, workMs: 125_000, running: null }
    on('state.get', (_$, e) => ({ value: { value: seeded[e.key], version: 1 } }))

    const ui = await $.ui.mount({ plugin: 'cost-band', surface, component: 'AbovePrompt', props })
    const texts = await ui.findAll({ type: 'Text' })
    const colorOf = (text: string) => texts.find(t => t.text === text)?.props.color

    expect(texts.map(t => t.text).join('')).toBe('$0.042 / $1.50 (1.2%/8.5%) 45.2k tokens2m05s | 1h02m05s (70% | 44.5%)')
    expect(colorOf('70%')).toBe('success')
    expect(colorOf('44.5%')).toBe('warning')
    // $1.50 et 2m05s restent neutres, 1h02m05s d'ouverture aussi (seuil à 2 h)
    expect(colorOf('$0.042')).toBe('text')
    expect(colorOf('$1.50')).toBe('subtle')
    expect(colorOf('2m05s')).toBe('text')
    expect(colorOf('1h02m05s')).toBe('subtle')
  })
}

test('passe au rouge quand le coût et le temps dépassent les seuils', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], cost: { usd: 12 } } as unknown as SessionUsage }))
  on('clock.now', () => ({ value: 5 * 3600_000 }))
  const seeded: Record<string, unknown> = { lastUsd: 0.6, lastPct: null, sessionPct: 0, workMs: 45 * 60_000, running: null }
  on('state.get', (_$, e) => ({ value: { value: seeded[e.key], version: 1 } }))

  const ui = await $.ui.mount({ plugin: 'cost-band', surface: 'desktop', component: 'AbovePrompt', props })
  const texts = await ui.findAll({ type: 'Text' })
  const colorOf = (text: string) => texts.find(t => t.text === text)?.props.color

  expect(colorOf('$0.600')).toBe('warning')
  expect(colorOf('$12.00')).toBe('error')
  expect(colorOf('45m00s')).toBe('warning')
  expect(colorOf('5h00m00s')).toBe('error')
})
