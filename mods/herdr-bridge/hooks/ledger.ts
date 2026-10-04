import type { ModelUsage } from 'claude-code'

import type { Mode, Usage } from '../types'
import type { Weights } from './config'

export type Delegation = {
  route: string
  agent: string
  transport: string
  ms: number
  chars: number
  ok: boolean
  error?: string
  delegateTokens?: { input: number; output: number }
}

export type ToolTally = { calls: number; chars: number }

export type TurnRecord = {
  v: 1
  ts: string
  sessionId: string
  turnId: string
  mode: Mode
  tag: string
  reason: string
  durationMs: number
  steps: number
  usage: Usage
  weighted: number
  subagents: { steps: number; usage: Usage; weighted: number }
  tools: Record<string, ToolTally>
  delegations: Delegation[]
}

export const zero = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export function add(into: Usage, usage: ModelUsage): void {
  into.input += usage.input_tokens
  into.output += usage.output_tokens
  into.cacheRead += usage.cache_read_input_tokens
  into.cacheWrite += usage.cache_creation_input_tokens
}

export function weigh(usage: Usage, weights: Weights): number {
  return Math.round(
    usage.input * weights.input +
      usage.output * weights.output +
      usage.cacheRead * weights.cacheRead +
      usage.cacheWrite * weights.cacheWrite,
  )
}

// What one turn gathers until turn.complete writes it.
export type TurnDraft = {
  steps: number
  usage: Usage
  subSteps: number
  subUsage: Usage
  tools: Record<string, ToolTally>
  delegations: Delegation[]
}

export const draft = (): TurnDraft => ({
  steps: 0,
  usage: zero(),
  subSteps: 0,
  subUsage: zero(),
  tools: {},
  delegations: [],
})

export function ledgerFile(dataDir: string, sessionId: string): string {
  return `${dataDir}/ledger/${sessionId}.jsonl`
}

export function parseLedger(text: string): TurnRecord[] {
  const records: TurnRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      records.push(JSON.parse(line) as TurnRecord)
    } catch {
      // A line cut short by a crash: skip it.
    }
  }
  return records
}

type Group = {
  turns: number
  weighted: number[]
  output: number
  durationMs: number
  delegations: number
  delegateTokens: number
}

// One row per tag and mode: what a turn cost Claude on average, and how many delegations it took.
export function summarize(records: TurnRecord[], tag?: string): string {
  const groups = new Map<string, Group>()
  for (const record of records) {
    if (tag !== undefined && record.tag !== tag) continue
    const key = `${record.tag || '(none)'}\t${record.mode}`
    const group = groups.get(key) ?? { turns: 0, weighted: [], output: 0, durationMs: 0, delegations: 0, delegateTokens: 0 }
    group.turns += 1
    group.weighted.push(record.weighted + record.subagents.weighted)
    group.output += record.usage.output + record.subagents.usage.output
    group.durationMs += record.durationMs
    group.delegations += record.delegations.length
    for (const delegation of record.delegations) {
      group.delegateTokens += (delegation.delegateTokens?.input ?? 0) + (delegation.delegateTokens?.output ?? 0)
    }
    groups.set(key, group)
  }
  if (groups.size === 0) return tag === undefined ? 'No turns recorded yet.' : `No turns recorded under tag "${tag}".`
  const rows = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  const lines = [
    '| tag | mode | turns | weighted / turn (mean) | weighted / turn (median) | output / turn | seconds / turn | delegations | delegate tokens |',
    '|---|---|--:|--:|--:|--:|--:|--:|--:|',
  ]
  for (const [key, group] of rows) {
    const [groupTag, mode] = key.split('\t')
    const total = group.weighted.reduce((sum, value) => sum + value, 0)
    lines.push(
      `| ${groupTag} | ${mode} | ${group.turns} | ${short(total / group.turns)} | ${short(median(group.weighted))} | ` +
        `${short(group.output / group.turns)} | ${(group.durationMs / group.turns / 1000).toFixed(1)} | ` +
        `${group.delegations} | ${short(group.delegateTokens)} |`,
    )
  }
  return lines.join('\n')
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

export function short(value: number): string {
  if (value >= 1_000_000) return (value / 1_000_000).toFixed(2) + 'M'
  if (value >= 1_000) return (value / 1_000).toFixed(1) + 'k'
  return String(Math.round(value))
}
