import type { ExecAgent, HerdrAgent, HttpAgent } from './config'

// Pure pieces of the three transports; the calls on $ that use them are in register.tsx.

export type Answer = {
  text: string
  // Tokens the delegate reported spending, where its transport reports them (http).
  delegateTokens?: { input: number; output: number }
}

export const PROCESS_LIMIT_MS = 600_000

export function herdrStartArgs(name: string, agent: HerdrAgent, pane: string): string[] {
  const native = agent.startArgs?.length ? ['--', ...agent.startArgs] : []
  return ['agent', 'start', name, '--kind', agent.kind, '--pane', pane, ...native]
}

export function herdrSplitArgs(agent: HerdrAgent): string[] {
  return ['pane', 'split', '--current', '--direction', agent.direction ?? 'right', '--no-focus']
}

export function herdrPromptArgs(name: string, prompt: string, timeoutMs: number): string[] {
  return ['agent', 'prompt', name, prompt, '--wait', '--timeout', String(timeoutMs)]
}

export function paneIdOf(splitStdout: string): string {
  const split = JSON.parse(splitStdout) as { result?: { pane?: { pane_id?: string } } }
  const pane = split.result?.pane?.pane_id
  if (!pane) throw new Error('herdr pane split returned no pane_id')
  return pane
}

export function listsAgent(listStdout: string, name: string): boolean {
  return listStdout.includes(`"${name}"`)
}

// herdr's control commands answer JSON; take the text out of it, or nothing when it holds none.
export function textOf(stdout: string): string {
  let parsed: { result?: { text?: string; content?: string; lines?: string[] } }
  try {
    parsed = JSON.parse(stdout)
  } catch {
    return stdout
  }
  const result = parsed.result
  if (typeof result?.text === 'string') return result.text
  if (typeof result?.content === 'string') return result.content
  if (Array.isArray(result?.lines)) return result.lines.join('\n')
  return ''
}

export function execArgv(agent: ExecAgent, prompt: string): { argv: string[]; stdin?: string } {
  const takesPrompt = agent.argv.some(arg => arg.includes('{prompt}'))
  const argv = agent.argv.map(arg => arg.replaceAll('{prompt}', prompt))
  return takesPrompt ? { argv } : { argv, stdin: prompt }
}

export function chatRequest(
  agent: HttpAgent,
  prompt: string,
  apiKey: string | undefined,
): { url: string; init: { method: string; headers: Record<string, string>; body: string } } {
  const messages = [
    ...(agent.system ? [{ role: 'system', content: agent.system }] : []),
    { role: 'user', content: prompt },
  ]
  return {
    url: agent.baseUrl.replace(/\/$/, '') + '/chat/completions',
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: agent.model, messages, max_tokens: agent.maxTokens ?? 2048, stream: false }),
    },
  }
}

export function parseChat(agent: HttpAgent, status: number, ok: boolean, text: string): Answer {
  if (!ok) throw new Error(`${agent.baseUrl} answered HTTP ${status}: ${text.slice(0, 200)}`)
  const body = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const content = body.choices?.[0]?.message?.content
  if (!content) throw new Error(`${agent.baseUrl} returned no message content`)
  return {
    text: content,
    ...(body.usage
      ? { delegateTokens: { input: body.usage.prompt_tokens ?? 0, output: body.usage.completion_tokens ?? 0 } }
      : {}),
  }
}
