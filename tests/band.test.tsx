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
    on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 45_230, window: 200_000, percent: 23 }, rateLimits: [{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 55.5 }], cost: { usd: 1.5 } } as unknown as SessionUsage }))
    on('clock.now', () => ({ value: 3_725_000 }))

    const seeded: Record<string, unknown> = { lastUsd: 0.042, lastPct: 1.2, sessionPct: 8.5, workMs: 125_000, running: null }
    on('state.get', (_$, e) => ({ value: { value: seeded[e.key], version: 1 } }))

    const ui = await $.ui.mount({ plugin: 'cost-band', surface, component: 'AbovePrompt', props })
    const texts = await ui.findAll({ type: 'Text' })
    const colorOf = (text: string) => texts.find(t => t.text === text)?.props.color

    expect(texts.map(t => t.text).join('')).toBe('$0.042 / $1.50 (1.2%/8.5%) 45.2k tokens · 2m05s | 1h02m05s (70% | 44.5%)')

    // Le % du contexte est un bouton ; le rond est un SVG, ou un caractère dans le terminal
    const button = await ui.find({ type: 'Button' })
    const rings = await ui.findAll({ type: 'Svg' })
    if (surface === 'terminal') {
      expect(button?.props.label).toBe('◔ 23%')
      expect(rings).toHaveLength(0)
    } else {
      expect(button?.props.label).toBe('23%')
      expect(rings[0]?.props.alt).toBe('Contexte 23 %')
    }
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

test('un clic sur le % du contexte ouvre le panneau Contexte', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 45_230, window: 200_000, percent: 23 }, rateLimits: [], cost: { usd: 1 } } as unknown as SessionUsage }))
  on('clock.now', () => ({ value: 0 }))
  const seeded: Record<string, unknown> = { lastUsd: null, lastPct: null, sessionPct: 0, workMs: 0, running: null }
  on('state.get', (_$, e) => ({ value: { value: seeded[e.key], version: 1 } }))
  const opened: string[] = []
  on('ui.open', (_$, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })

  const ui = await $.ui.mount({ plugin: 'cost-band', surface: 'desktop', component: 'AbovePrompt', props })
  await ui.press({ key: 'contexte' })

  expect(opened).toEqual(['cost-band-contexte'])
})

test('le panneau Contexte liste les catégories, sans les outils chargés à la demande', async ($, on) => {
  const breakdown = {
    categories: [
      { name: 'System prompt', tokens: 12_300, kind: 'used', isDeferred: false, color: 'promptBorder' },
      { name: 'Messages', tokens: 150_000, kind: 'used', isDeferred: false, color: 'permission' },
      { name: 'MCP tools', tokens: 5_000, kind: 'deferred', isDeferred: true, color: 'inactive' },
      { name: 'Free space', tokens: 837_700, kind: 'free', isDeferred: false, color: 'inactive' },
    ],
    totalTokens: 162_300,
    rawMaxTokens: 1_000_000,
    percentage: 16,
  }
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 162_300, window: 1_000_000, percent: 16, breakdown }, rateLimits: [] } as unknown as SessionUsage }))

  const pane = { title: 'Contexte', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const
  const ui = await $.ui.mount({ plugin: 'cost-band', surface: 'desktop', component: 'Pane', requestId: 'cost-band-contexte', props: pane })
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)

  expect(texts).toEqual(['162.3k / 1M tokens (16%)', 'System prompt', '12.3k', 'Messages', '150k', 'Free space', '837.7k'])
})
