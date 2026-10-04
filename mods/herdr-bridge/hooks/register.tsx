import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { Mode, SessionTotals } from '../types'
import { EMPTY_LOADED, candidatePaths, expandHome, fill, parseConfig } from './config'
import type { AgentConfig, Config, ExecAgent, HerdrAgent, HttpAgent, Loaded, Route } from './config'
import { add, draft, ledgerFile, parseLedger, short, summarize, weigh, zero } from './ledger'
import type { Delegation, TurnDraft, TurnRecord } from './ledger'
import {
  PROCESS_LIMIT_MS,
  chatRequest,
  execArgv,
  herdrPromptArgs,
  herdrSplitArgs,
  herdrStartArgs,
  listsAgent,
  paneIdOf,
  parseChat,
  textOf,
} from './transports'
import type { Answer } from './transports'

const PLUGIN = 'herdr-bridge'

const modeState = atom({ plugin: 'herdr-bridge', key: 'mode' } as const, 'on' as Mode)
const tagState = atom({ plugin: 'herdr-bridge', key: 'tag' } as const, '')
const totalsState = atom({ plugin: 'herdr-bridge', key: 'totals' } as const, emptyTotals())

function emptyTotals(): SessionTotals {
  return { turns: 0, usage: zero(), weighted: 0, delegations: {} }
}

const USAGE = `/bridge                 show mode, routes and this session's totals
/bridge on | off        route tools to other agents, or run everything natively
/bridge tag <name>      label the turns that follow, to compare runs (/bridge tag clears it)
/bridge stats [tag]     compare recorded turns by tag and mode
/bridge reload          read the config file again`

// A reload runs this module afresh, so these start over with the options it is given.
let configPath = ''
let configuredDataDir = ''
let defaultMode: Mode = 'on'
let showBand = true
let loading: Promise<Loaded> | undefined
let dataDir: Promise<string> | undefined
let turn: TurnDraft = draft()
let hasWarnedNoHerdr = false
let hasOutDir = false

// One start per agent name per load, shared by concurrent calls.
const starting = new Map<string, Promise<void>>()

function config($: EngineInterface): Promise<Loaded> {
  loading ??= loadConfig($).then(loaded => {
    for (const error of loaded.errors) $.ui.log(`${PLUGIN}: ${error}`)
    return loaded
  })
  return loading
}

async function homeDir($: EngineInterface): Promise<string> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '.'
}

function data($: EngineInterface): Promise<string> {
  dataDir ??= homeDir($).then(dir =>
    configuredDataDir ? expandHome(configuredDataDir, dir) : `${dir}/.claude/herdr-bridge`,
  )
  return dataDir
}

async function loadConfig($: EngineInterface): Promise<Loaded> {
  for (const path of candidatePaths(configPath, await $.session.cwd(), await homeDir($))) {
    if (await $.fs.exists(path)) return parseConfig(path, await $.fs.read(path))
  }
  return EMPTY_LOADED
}

// A file in the hand-off folder for an agent to write its answer to. Agents write it
// themselves, so the folder must exist first.
async function outFile($: EngineInterface, name: string): Promise<string> {
  const dir = `${await data($)}/out`
  if (!hasOutDir) {
    await $.fs.write(`${dir}/.keep`, '')
    hasOutDir = true
  }
  return `${dir}/${name}.md`
}

// One ledger file per session, so two sessions never write the same file.
async function appendLedger($: EngineInterface, file: string, record: TurnRecord): Promise<void> {
  const before = (await $.fs.exists(file)) ? await $.fs.read(file) : ''
  await $.fs.write(file, before + JSON.stringify(record) + '\n')
}

async function readLedger($: EngineInterface, dir: string): Promise<TurnRecord[]> {
  const ledgerDir = `${dir}/ledger`
  if (!(await $.fs.exists(ledgerDir))) return []
  const records: TurnRecord[] = []
  for (const entry of await $.fs.list(ledgerDir)) {
    if (entry.kind === 'file' && entry.name.endsWith('.jsonl')) {
      records.push(...parseLedger(await $.fs.read(`${ledgerDir}/${entry.name}`)))
    }
  }
  return records
}

type Ask = { name: string; agent: AgentConfig; prompt: string; out: string; timeoutMs: number }

async function ask($: EngineInterface, request: Ask): Promise<Answer> {
  switch (request.agent.transport) {
    case 'herdr':
      return askHerdr($, request, request.agent)
    case 'exec':
      return askExec($, request, request.agent)
    case 'http':
      return askHttp($, request, request.agent)
  }
}

async function herdrAvailable($: EngineInterface): Promise<boolean> {
  return (await $.env.get('HERDR_PANE_ID')) !== undefined
}

async function herdr($: EngineInterface, args: string[], timeoutMs = 30_000): Promise<string> {
  const ran = await $.process.run(['herdr', ...args], { timeoutMs: Math.min(timeoutMs, PROCESS_LIMIT_MS) })
  if (ran.exitCode !== 0) {
    throw new Error(`herdr ${args.slice(0, 2).join(' ')} exited ${ran.exitCode}: ${ran.stderr.trim() || ran.stdout.trim()}`)
  }
  return ran.stdout
}

function ensureHerdrAgent($: EngineInterface, name: string, agent: HerdrAgent): Promise<void> {
  let ready = starting.get(name)
  if (!ready) {
    ready = startHerdrAgent($, name, agent).catch(err => {
      starting.delete(name)
      throw err
    })
    starting.set(name, ready)
  }
  return ready
}

async function startHerdrAgent($: EngineInterface, name: string, agent: HerdrAgent): Promise<void> {
  if (listsAgent(await herdr($, ['agent', 'list']), name)) return
  const pane = paneIdOf(await herdr($, herdrSplitArgs(agent)))
  await herdr($, herdrStartArgs(name, agent, pane), 120_000)
}

async function askHerdr($: EngineInterface, request: Ask, agent: HerdrAgent): Promise<Answer> {
  if (!(await herdrAvailable($))) throw new Error('not inside a herdr pane (HERDR_PANE_ID is unset)')
  await ensureHerdrAgent($, request.name, agent)
  await herdr($, herdrPromptArgs(request.name, request.prompt, request.timeoutMs), request.timeoutMs + 10_000)
  if (await $.fs.exists(request.out)) return { text: await $.fs.read(request.out) }
  // The agent did not write the file: fall back to what its pane shows.
  const shown = await herdr($, ['agent', 'read', request.name, '--source', 'recent-unwrapped', '--lines', '200'])
  return { text: textOf(shown) }
}

async function askExec($: EngineInterface, request: Ask, agent: ExecAgent): Promise<Answer> {
  const { argv, stdin } = execArgv(agent, request.prompt)
  const ran = await $.process.run(argv, {
    timeoutMs: Math.min(request.timeoutMs, PROCESS_LIMIT_MS),
    ...(stdin === undefined ? {} : { stdin }),
  })
  if (ran.exitCode !== 0) throw new Error(`${argv[0]} exited ${ran.exitCode}: ${ran.stderr.trim()}`)
  if (await $.fs.exists(request.out)) return { text: await $.fs.read(request.out) }
  return { text: ran.stdout }
}

async function askHttp($: EngineInterface, request: Ask, agent: HttpAgent): Promise<Answer> {
  const apiKey = agent.useApiKey ? await $.env.get('HERDR_BRIDGE_API_KEY') : undefined
  const { url, init } = chatRequest(agent, request.prompt, apiKey)
  const response = await $.http.fetch(url, init)
  return parseChat(agent, response.status, response.ok, response.text)
}

export const register: Register = (on, options) => {
  configPath = String(options.configPath ?? '')
  configuredDataDir = String(options.dataDir ?? '')
  defaultMode = options.mode === 'off' ? 'off' : 'on'
  showBand = options.showBand !== false

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'bridge',
      description: 'herdr-bridge: routing mode, A/B tags and token statistics',
      argumentHint: 'on|off|tag <name>|stats [tag]|reload',
    })
    await $.command.register({
      name: 'ask',
      description: 'herdr-bridge: send a prompt to one of the configured agents',
      argumentHint: '<agent> <prompt>',
    })
    const stored = await $.store.get('mode')
    const mode: Mode = stored === 'on' || stored === 'off' ? stored : defaultMode
    const tag = await $.store.get('tag')
    await update($, modeState, () => mode)
    await update($, tagState, () => (typeof tag === 'string' ? tag : ''))
    await config($)
    return next(e)
  })

  // Token tracking: one draft per main-loop turn, written to the ledger when it completes.
  on('turn.start', async ($, e, next) => {
    turn = draft()
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (result.usage) {
      if (e.agentId === undefined) {
        turn.steps += 1
        add(turn.usage, result.usage)
      } else {
        turn.subSteps += 1
        add(turn.subUsage, result.usage)
      }
    }
    return result
  })

  // Registered before the routing hook, so it is the outer one and counts what reaches
  // Claude whether a route answered the call or the tool ran.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const tally = (turn.tools[e.tool] ??= { calls: 0, chars: 0 })
    tally.calls += 1
    tally.chars += charsOf(result)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const finished = turn
    turn = draft()
    if (finished.steps === 0 && e.usage) {
      finished.steps = 1
      add(finished.usage, e.usage)
    }
    const { config: { weights } } = await config($)
    const mode = await read($, modeState)
    const tag = await read($, tagState)
    const weighted = weigh(finished.usage, weights)
    const subWeighted = weigh(finished.subUsage, weights)
    try {
      await appendLedger($, ledgerFile(await data($), await $.session.id()), {
        v: 1,
        ts: new Date(await $.clock.now()).toISOString(),
        sessionId: await $.session.id(),
        turnId: e.turnId,
        mode,
        tag,
        reason: e.reason,
        durationMs: e.durationMs,
        steps: finished.steps,
        usage: finished.usage,
        weighted,
        subagents: { steps: finished.subSteps, usage: finished.subUsage, weighted: subWeighted },
        tools: finished.tools,
        delegations: finished.delegations,
      })
    } catch (err) {
      $.ui.log(`${PLUGIN}: could not write the token ledger: ${String(err)}`)
    }
    await update($, totalsState, totals => {
      const usage = { ...totals.usage }
      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) {
        usage[key] += finished.usage[key] + finished.subUsage[key]
      }
      const delegations = { ...totals.delegations }
      for (const delegation of finished.delegations) {
        if (delegation.ok) delegations[delegation.agent] = (delegations[delegation.agent] ?? 0) + 1
      }
      return { turns: totals.turns + 1, usage, weighted: totals.weighted + weighted + subWeighted, delegations }
    })
    return next(e)
  })

  // Routing: WebSearch, WebFetch and Read calls a route matches go to its agent.
  on('tool.call', { tool: ['WebSearch', 'WebFetch', 'Read'] }, async ($, e, next) => {
    if ((await read($, modeState)) !== 'on') return next(e)
    const { config: loaded } = await config($)
    const route = await pick($, loaded, e)
    if (!route) return next(e)
    const agent = loaded.agents[route.agent]
    if (!agent) return next(e)
    if (agent.transport === 'herdr' && !(await herdrAvailable($))) {
      if (!hasWarnedNoHerdr) {
        hasWarnedNoHerdr = true
        $.ui.log(`${PLUGIN}: not inside herdr, so herdr routes are skipped and tools run natively`)
      }
      return next(e)
    }

    const started = await $.clock.now()
    const delegation: Delegation = { route: route.name, agent: route.agent, transport: agent.transport, ms: 0, chars: 0, ok: false }
    turn.delegations.push(delegation)
    $.ui.status(`${route.agent}: ${route.name}…`)
    try {
      const out = await outFile($, `${route.name}-${started}`)
      const values: Record<string, string> = { out }
      if (e.tool === 'WebSearch') values.query = e.query
      if (e.tool === 'WebFetch') {
        values.url = e.url
        values.question = e.prompt
      }
      if (e.tool === 'Read') {
        values.path = e.file_path
        if (route.prompt.includes('{content}')) {
          values.content = clip(await $.fs.read(e.file_path), loaded.maxInputChars)
        }
      }
      const answer = await ask($, {
        name: route.agent,
        agent,
        prompt: fill(route.prompt, values),
        out,
        timeoutMs: loaded.timeoutMs,
      })
      const text = clip(answer.text.trim(), loaded.maxResultChars)
      if (!text) throw new Error('the agent answered with nothing')
      const ms = (await $.clock.now()) - started
      Object.assign(delegation, { ms, chars: text.length, ok: true }, answer.delegateTokens ? { delegateTokens: answer.delegateTokens } : {})

      if (e.tool === 'WebSearch') {
        return { result: { query: e.query, results: [text], durationSeconds: ms / 1000 } }
      }
      if (e.tool === 'WebFetch') {
        return { result: { bytes: text.length, code: 200, codeText: 'OK', result: text, durationMs: ms, url: e.url } }
      }
      const content =
        `[${PLUGIN}] This is ${route.agent}'s summary of ${e.file_path}, not the file itself. ` +
        `To see the original lines, Read it again with offset and limit.\n\n${text}`
      const numLines = content.split('\n').length
      return {
        result: { type: 'text', file: { filePath: e.file_path, content, numLines, startLine: 1, totalLines: numLines } },
      }
    } catch (err) {
      Object.assign(delegation, { ms: (await $.clock.now()) - started, error: String(err) })
      $.ui.log(`${PLUGIN}: ${route.name} via ${route.agent} failed, so ${e.tool} runs natively: ${String(err)}`)
      return next(e)
    } finally {
      $.ui.status(undefined)
    }
  })

  on('command.run', { command: 'ask' }, async ($, e) => {
    const [name = '', ...words] = e.args.trim().split(/\s+/)
    const prompt = words.join(' ')
    const { config: loaded } = await config($)
    const agent = loaded.agents[name]
    if (!agent || !prompt) {
      return { text: `Usage: /ask <agent> <prompt>. Agents: ${Object.keys(loaded.agents).join(', ') || '(none configured)'}` }
    }
    const started = await $.clock.now()
    $.ui.status(`${name}: answering…`)
    try {
      const out = await outFile($, `ask-${started}`)
      const answer = await ask($, {
        name,
        agent,
        prompt: `${prompt}\n\nWrite your answer as Markdown to ${out}.`,
        out,
        timeoutMs: loaded.timeoutMs,
      })
      return { text: `**${name}** (${(((await $.clock.now()) - started) / 1000).toFixed(1)}s)\n\n${answer.text.trim()}` }
    } catch (err) {
      return { text: `${name} failed: ${String(err)}`, exitCode: 1 }
    } finally {
      $.ui.status(undefined)
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!showBand || e.props.hasSurvey) return next(e)
    const totals = await read($, totalsState)
    if (totals.turns === 0) return next(e)
    const mode = await read($, modeState)
    const tag = await read($, tagState)
    const { Box, Button, Text } = $.ui.resolve(e)
    const delegated = Object.entries(totals.delegations)
      .map(([agent, count]) => `${agent} ${count}`)
      .join(', ')
    return (
      <Box>
        <Text dimColor>
          bridge {mode.toUpperCase()}
          {tag ? ` [${tag}]` : ''} · {totals.turns} turns · Claude ≈ {short(totals.weighted)} weighted (in{' '}
          {short(totals.usage.input)} · cache {short(totals.usage.cacheRead)} · out {short(totals.usage.output)})
          {delegated ? ` · delegated: ${delegated}` : ''}{' '}
        </Text>
        <Button
          key="toggle"
          label={mode === 'on' ? 'Turn off' : 'Turn on'}
          onPress={() => setMode($, mode === 'on' ? 'off' : 'on')}
        />
      </Box>
    )
  })

  on('command.run', { command: 'bridge' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const argument = rest.join(' ')
    switch (verb) {
      case '':
      case 'status':
        return { text: await status($) }
      case 'on':
      case 'off':
        await setMode($, verb)
        return { text: `herdr-bridge routing is ${verb}.` }
      case 'tag':
        await $.store.set('tag', argument)
        await update($, tagState, () => argument)
        return { text: argument ? `Turns from now on are tagged "${argument}".` : 'Tag cleared.' }
      case 'stats':
        return { text: summarize(await readLedger($, await data($)), argument || undefined) }
      case 'reload':
        loading = undefined
        return { text: await status($) }
      default:
        return { text: USAGE, exitCode: 1 }
    }
  })
}

async function setMode($: EngineInterface, mode: Mode): Promise<void> {
  await $.store.set('mode', mode)
  await update($, modeState, () => mode)
}

async function status($: EngineInterface): Promise<string> {
  const loaded = await config($)
  const mode = await read($, modeState)
  const tag = await read($, tagState)
  const totals = await read($, totalsState)
  const routes = loaded.config.routes.map(route => {
    const agent = loaded.config.agents[route.agent]
    const off = route.enabled === false ? ' (disabled)' : ''
    return `- ${route.name}: ${route.tool} → ${route.agent} (${agent?.transport ?? '?'})${off}`
  })
  return [
    `**herdr-bridge** · mode **${mode}**${tag ? ` · tag **${tag}**` : ''}`,
    `Config: ${loaded.path ?? 'none found (every tool runs natively)'}`,
    ...loaded.errors.map(error => `⚠ ${error}`),
    `herdr: ${(await herdrAvailable($)) ? 'inside a herdr pane' : 'not inside herdr (herdr routes are skipped)'}`,
    routes.length ? `Routes:\n${routes.join('\n')}` : 'Routes: none',
    `This session: ${totals.turns} turns, ≈ ${short(totals.weighted)} weighted Claude tokens`,
    `Ledger: ${ledgerFile(await data($), await $.session.id())}`,
    '',
    USAGE,
  ].join('\n')
}

async function pick($: EngineInterface, loaded: Config, e: { tool: string } & Record<string, unknown>): Promise<Route | undefined> {
  for (const route of loaded.routes) {
    if (route.enabled === false || route.tool !== e.tool) continue
    if (route.tool === 'WebFetch' && route.urlPattern && !new RegExp(route.urlPattern).test(String(e.url))) continue
    if (route.tool === 'Read') {
      if (e.offset !== undefined || e.limit !== undefined || e.pages !== undefined) continue
      const path = String(e.file_path)
      if (route.pathPattern && !new RegExp(route.pathPattern).test(path)) continue
      if (route.minBytes) {
        const size = await $.fs.stat(path).then(
          stat => stat.size,
          () => 0,
        )
        if (size < route.minBytes) continue
      }
    }
    return route
  }
  return undefined
}

function charsOf(result: ToolCallResult): number {
  if (result.deny !== undefined) return result.deny.length
  if (typeof result.text === 'string') return result.text.length
  return JSON.stringify(result.result ?? '').length
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + `\n\n[cut at ${max} characters]`
}
