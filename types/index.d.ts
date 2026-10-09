export type Turn = { startedAt: number; baseUsd: number; basePct: number | null }

declare module 'claude-code' {
  interface PluginState {
    'cost-band': {
      // Coût (USD) du dernier tour terminé, null avant le premier
      lastUsd: number | null
      // Part de la limite 5 h consommée par le dernier tour (%), null si inconnue
      lastPct: number | null
      // Part de la limite 5 h consommée par la session depuis l'activation du mod (%)
      sessionPct: number
      // Temps de travail cumulé de Claude sur les tours terminés (ms)
      workMs: number
      // Tour en cours : son début et le coût de la session à ce moment
      running: Turn | null
    }
  }
}
