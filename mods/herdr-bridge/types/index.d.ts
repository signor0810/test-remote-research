export type Mode = 'on' | 'off'

export type Usage = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type SessionTotals = {
  turns: number
  usage: Usage
  weighted: number
  delegations: Record<string, number>
}

declare module 'claude-code' {
  interface PluginState {
    'herdr-bridge': { mode: Mode; tag: string; totals: SessionTotals }
  }
}
