import { atom, read, update } from 'claude-code'
import type { CoreEngineInterface, Register, SessionUsage } from 'claude-code'

import type { Turn } from '../types'

const lastUsd = atom({ plugin: 'cost-band', key: 'lastUsd' } as const, null)
const lastPct = atom({ plugin: 'cost-band', key: 'lastPct' } as const, null)
const sessionPct = atom({ plugin: 'cost-band', key: 'sessionPct' } as const, 0)
const workMs = atom({ plugin: 'cost-band', key: 'workMs' } as const, 0)
const running = atom({ plugin: 'cost-band', key: 'running' } as const, null)

const formatUsd = (usd: number) => `$${usd.toFixed(usd < 1 ? 3 : 2)}`

const formatPct = (pct: number) => `${Math.round(pct * 10) / 10}%`

// Pourcentage utilisé de la fenêtre de limite glissante de 5 h, s'il est connu
const usedPct = (usage: SessionUsage, kind: string) =>
  usage.rateLimits.find(limit => limit.kind === kind)?.percentUsed ?? null

const fiveHourPct = (usage: SessionUsage) => usedPct(usage, 'five_hour')

// Ce qui reste d'une fenêtre de limite (%), ou « – » si elle est inconnue
const remaining = (usage: SessionUsage, kind: string) => {
  const used = usedPct(usage, kind)
  const pct = used === null ? null : Math.max(0, 100 - used)
  return { text: pct === null ? '–' : formatPct(pct), pct }
}

// Seuils d'alerte [orange, rouge] : en dessous la valeur reste neutre
const THRESHOLDS = {
  lastUsd: [0.5, 1],
  sessionUsd: [5, 10],
  workMs: [30 * 60_000, 60 * 60_000],
  openMs: [2 * 3600_000, 4 * 3600_000],
} as const

// Neutre sous le premier seuil, orange au-delà, rouge au-delà du second
const alertColor = (value: number, [warn, danger]: readonly [number, number], calm: string) => {
  if (value >= danger) return 'error'
  if (value >= warn) return 'warning'
  return calm
}

// Vert tant qu'il reste de la marge, orange sous 50 %, rouge sous 20 %
const levelColor = (pct: number | null) => {
  if (pct === null) return 'inactive'
  if (pct < 20) return 'error'
  if (pct < 50) return 'warning'
  return 'success'
}

// 45200 → « 45.2k », 1250000 → « 1.25M »
const formatTokens = (tokens: number) => {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 10_000) / 100}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 100) / 10}k`
  return String(tokens)
}

const formatDuration = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')

  if (h > 0) return `${h}h${pad(m)}m${pad(s)}s`
  if (m > 0) return `${m}m${pad(s)}s`
  return `${s}s`
}

// Un seul minuteur par chargement du module : il redessine la bande chaque seconde
let ticker: { cancel: () => void } | null = null

const startTicker = ($: Pick<CoreEngineInterface, 'clock' | 'ui'>) => {
  if (ticker !== null) return
  ticker = $.clock.every(1000, () => $.ui.invalidate('ui.render'))
}

export const register: Register = on => {

  on('session.start', ($, e, next) => {
    startTicker($)

    return next(e)
  })

  // Début d'un tour de la boucle principale (les sous-agents n'en lèvent pas)
  on('turn.start', async ($, e, next) => {
    const usage = await $.session.usage()
    const turn: Turn = {
      startedAt: await $.clock.now(),
      baseUsd: usage.cost?.usd ?? 0,
      basePct: fiveHourPct(usage),
    }
    await update($, running, () => turn)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    // On ignore les tours des sous-agents : ils comptent dans le tour principal
    if (e.agentId !== undefined) return result

    const turn = await read($, running)
    const usage = await $.session.usage()
    const usd = usage.cost?.usd ?? 0
    const pct = fiveHourPct(usage)

    await update($, workMs, ms => (ms ?? 0) + e.durationMs)
    if (turn !== null) {
      await update($, lastUsd, () => Math.max(0, usd - turn.baseUsd))

      if (pct !== null && turn.basePct !== null) {
        // Si la fenêtre s'est réinitialisée pendant le tour, tout le % courant vient de lui
        const delta = pct >= turn.basePct ? pct - turn.basePct : pct
        await update($, lastPct, () => delta)
        await update($, sessionPct, total => (total ?? 0) + delta)
      }
    }
    await update($, running, () => null)

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const usage = await $.session.usage()
    // Filet de sécurité : relance le minuteur si session.start ne l'a pas fait
    startTicker($)

    const t = await $.clock.now()
    const turn = await read($, running)
    const last = await read($, lastUsd)
    const total = usage.cost?.usd

    const work = (await read($, workMs)) + (turn !== null ? t - turn.startedAt : 0)
    const open = t - usage.startedAt

    const lastP = await read($, lastPct)
    const hasLimits = usage.rateLimits.length > 0
    // Tokens occupés par la conversation dans la fenêtre de contexte
    const tokens = usage.context?.tokens
    const fiveHour = remaining(usage, 'five_hour')
    const week = remaining(usage, 'seven_day')

    const { Box, Text } = $.ui.resolve(e)

    // Séparateurs et parenthèses en atténué, valeurs en couleurs du thème
    const dim = (text: string) => <Text dimColor>{text}</Text>
    const limit = (left: { text: string; pct: number | null }) => (
      <Text color={levelColor(left.pct)}>{left.text}</Text>
    )

    return (
      <Box flexDirection="row" justifyContent="space-between" width={e.props.bodyColumns}>
        {total === undefined ? (
          <Box flexDirection="row">{dim('coût indisponible')}</Box>
        ) : (
          <Box flexDirection="row">
            <Text color={alertColor(last ?? 0, THRESHOLDS.lastUsd, 'text')}>
              {last === null ? '–' : formatUsd(last)}
            </Text>
            {dim(' / ')}
            <Text color={alertColor(total, THRESHOLDS.sessionUsd, 'subtle')}>{formatUsd(total)}</Text>
            {fiveHourPct(usage) !== null && dim(' (')}
            {fiveHourPct(usage) !== null && (
              <Text color="suggestion">{lastP === null ? '–' : formatPct(lastP)}</Text>
            )}
            {fiveHourPct(usage) !== null && dim('/')}
            {fiveHourPct(usage) !== null && (
              <Text color="subtle">{formatPct(await read($, sessionPct))}</Text>
            )}
            {fiveHourPct(usage) !== null && dim(')')}
            {tokens !== undefined && dim(` ${formatTokens(tokens)} tokens`)}
          </Box>
        )}
        <Box flexDirection="row">
          <Text color={alertColor(work, THRESHOLDS.workMs, 'text')}>{formatDuration(work)}</Text>
          {dim(' | ')}
          <Text color={alertColor(open, THRESHOLDS.openMs, 'subtle')}>{formatDuration(open)}</Text>
          {hasLimits && dim(' (')}
          {hasLimits && limit(fiveHour)}
          {hasLimits && dim(' | ')}
          {hasLimits && limit(week)}
          {hasLimits && dim(')')}
        </Box>
      </Box>
    )
  })
}
