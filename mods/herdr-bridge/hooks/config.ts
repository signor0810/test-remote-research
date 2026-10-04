export type HerdrAgent = {
  transport: 'herdr'
  // The herdr agent kind (`herdr agent start --kind`), such as the one herdr uses for pi or hermes.
  kind: string
  // Native arguments passed to the agent after `--`, such as a model name.
  startArgs?: string[]
  // Where the agent's pane opens beside the current one.
  direction?: 'right' | 'down'
}

export type ExecAgent = {
  transport: 'exec'
  // argv; `{prompt}` is replaced by the prompt. Without it, the prompt goes to stdin.
  argv: string[]
}

export type HttpAgent = {
  transport: 'http'
  // An OpenAI-compatible base URL, such as LM Studio's http://localhost:1234/v1.
  baseUrl: string
  model: string
  // Send HERDR_BRIDGE_API_KEY as a bearer token, for a server that wants one.
  useApiKey?: boolean
  system?: string
  maxTokens?: number
}

export type AgentConfig = HerdrAgent | ExecAgent | HttpAgent

export type RouteTool = 'WebSearch' | 'WebFetch' | 'Read'

export type Route = {
  name: string
  tool: RouteTool
  agent: string
  // Placeholders: {query} {url} {question} {path} {content} {out}
  prompt: string
  // WebFetch: only URLs matching this pattern are routed.
  urlPattern?: string
  // Read: only whole-file reads of paths matching this pattern, at least `minBytes` long, are routed.
  pathPattern?: string
  minBytes?: number
  enabled?: boolean
}

export type Weights = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

export type Config = {
  agents: Record<string, AgentConfig>
  routes: Route[]
  timeoutMs: number
  maxResultChars: number
  maxInputChars: number
  weights: Weights
}

export type Loaded = { config: Config; path: string | undefined; errors: string[] }

// Relative cost of each kind of Claude token, as a multiple of an uncached input token.
// These follow the API's price ratios; change them in the config to fit how you pay.
export const DEFAULT_WEIGHTS: Weights = { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }

const EMPTY: Config = {
  agents: {},
  routes: [],
  timeoutMs: 300_000,
  maxResultChars: 8_000,
  maxInputChars: 200_000,
  weights: DEFAULT_WEIGHTS,
}

export function expandHome(path: string, homeDir: string): string {
  return path.startsWith('~/') ? homeDir + path.slice(1) : path
}

// The project's config wins over the user's; a configured path replaces both.
export function candidatePaths(configPath: string, cwd: string, homeDir: string): string[] {
  return configPath
    ? [expandHome(configPath, homeDir)]
    : [`${cwd}/.claude/herdr-bridge.json`, `${homeDir}/.claude/herdr-bridge.json`]
}

export const EMPTY_LOADED: Loaded = { config: EMPTY, path: undefined, errors: [] }

export function parseConfig(path: string, text: string): Loaded {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { config: EMPTY, path, errors: [`${path} is not valid JSON: ${String(err)}`] }
  }
  const { config, errors } = validate(raw)
  return { config, path, errors: errors.map(error => `${path}: ${error}`) }
}

function validate(raw: unknown): { config: Config; errors: string[] } {
  const errors: string[] = []
  if (typeof raw !== 'object' || raw === null) return { config: EMPTY, errors: ['the config must be a JSON object'] }
  const input = raw as Partial<Config>
  const agents: Record<string, AgentConfig> = {}
  for (const [name, agent] of Object.entries(input.agents ?? {})) {
    const problem = agentProblem(agent)
    if (problem) errors.push(`agent "${name}": ${problem}`)
    else agents[name] = agent
  }
  const routes: Route[] = []
  for (const route of input.routes ?? []) {
    const problem = routeProblem(route, agents)
    if (problem) errors.push(`route "${route?.name ?? '?'}": ${problem}`)
    else routes.push(route)
  }
  return {
    config: {
      agents,
      routes,
      timeoutMs: positive(input.timeoutMs, EMPTY.timeoutMs),
      maxResultChars: positive(input.maxResultChars, EMPTY.maxResultChars),
      maxInputChars: positive(input.maxInputChars, EMPTY.maxInputChars),
      weights: { ...DEFAULT_WEIGHTS, ...(input.weights ?? {}) },
    },
    errors,
  }
}

function agentProblem(agent: AgentConfig): string | undefined {
  if (agent?.transport === 'herdr') return agent.kind ? undefined : 'a herdr agent needs "kind"'
  if (agent?.transport === 'exec') return agent.argv?.length ? undefined : 'an exec agent needs "argv"'
  if (agent?.transport === 'http') return agent.baseUrl && agent.model ? undefined : 'an http agent needs "baseUrl" and "model"'
  return '"transport" must be "herdr", "exec" or "http"'
}

function routeProblem(route: Route, agents: Record<string, AgentConfig>): string | undefined {
  if (!route?.name) return 'needs "name"'
  if (!['WebSearch', 'WebFetch', 'Read'].includes(route.tool)) return '"tool" must be WebSearch, WebFetch or Read'
  if (!agents[route.agent]) return `agent "${route.agent}" is not defined`
  if (!route.prompt) return 'needs "prompt"'
  for (const pattern of [route.urlPattern, route.pathPattern]) {
    if (pattern === undefined) continue
    try {
      new RegExp(pattern)
    } catch {
      return `"${pattern}" is not a valid regular expression`
    }
  }
  return undefined
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && value > 0 ? value : fallback
}

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => values[key] ?? whole)
}
