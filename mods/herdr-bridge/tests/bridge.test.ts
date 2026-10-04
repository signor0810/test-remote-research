import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/me'
const CWD = '/work/chip'

const CONFIG = {
  agents: {
    agy: { transport: 'herdr', kind: 'antigravity' },
    qwen: { transport: 'http', baseUrl: 'http://localhost:1234/v1', model: 'qwen3.8-27b' },
    pi: { transport: 'exec', argv: ['pi', '-p', '{prompt}'] },
  },
  routes: [
    { name: 'web', tool: 'WebSearch', agent: 'qwen', prompt: 'Search the web: {query}' },
    {
      name: 'youtube',
      tool: 'WebFetch',
      agent: 'agy',
      urlPattern: '^https?://(www\\.)?(youtube\\.com|youtu\\.be)/',
      prompt: 'Watch {url} and answer: {question}. Write the answer to {out}.',
    },
    { name: 'report', tool: 'Read', agent: 'pi', pathPattern: '\\.rpt$', minBytes: 1000, prompt: 'Summarize {path}' },
  ],
}

type World = {
  files: Map<string, string>
  commands: string[][]
  requests: { url: string; body: string }[]
}

// Everything beneath the plugin, in memory: files, the session, herdr, the local model's API.
function world(on: On, options: { herdr?: boolean; httpStatus?: number } = {}): World {
  const files = new Map<string, string>([[`${CWD}/.claude/herdr-bridge.json`, JSON.stringify(CONFIG)]])
  const commands: string[][] = []
  const requests: { url: string; body: string }[] = []
  mock.env(on, options.herdr ? { HOME, HERDR_PANE_ID: 'p1' } : { HOME })
  mock.store(on)
  mock.clock(on)
  on('ui.status', async () => ({ value: undefined }))
  on('ui.log', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: CWD }))
  on('session.id', async () => ({ value: 'session-1' }))
  on('fs.exists', async ($, e) => ({ value: files.has(e.path) || [...files.keys()].some(k => k.startsWith(e.path + '/')) }))
  on('fs.read', async ($, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', async ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.stat', async ($, e) => ({
    value: { kind: 'file', size: files.get(e.path)?.length ?? 0, mtimeMs: 0, isLink: false },
  }))
  on('fs.list', async ($, e) => ({
    value: [...files.keys()]
      .filter(k => k.startsWith(`${e.path}/`))
      .map(k => ({ name: k.slice(String(e.path).length + 1), kind: 'file' as const, size: 0, mtimeMs: 0, isLink: false })),
  }))
  on('http.fetch', async ($, e) => {
    requests.push({ url: e.url, body: e.init?.body ?? '' })
    const status = options.httpStatus ?? 200
    return {
      value: {
        status,
        ok: status === 200,
        headers: {},
        text: JSON.stringify({
          choices: [{ message: { content: 'Qwen says: three results.' } }],
          usage: { prompt_tokens: 900, completion_tokens: 120 },
        }),
      },
    }
  })
  on('process.run', async ($, e) => {
    commands.push([...e.argv])
    const [bin, noun, verb] = e.argv
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (bin === 'herdr' && noun === 'agent' && verb === 'list') return ok('{"result":{"agents":[]}}')
    if (bin === 'herdr' && noun === 'pane' && verb === 'split') return ok('{"result":{"pane":{"pane_id":"p2"}}}')
    if (bin === 'herdr' && noun === 'agent' && verb === 'prompt') {
      // The agent follows the prompt and writes its answer to the file named in it.
      const out = /Write the answer to (\S+?)\.?$/.exec(String(e.argv[4]))?.[1]
      if (out) files.set(out, 'The video shows a timing closure flow (02:10).')
      return ok('{}')
    }
    if (bin === 'pi') return ok('Worst slack -0.12ns on clk_core; 3 violating paths.')
    return ok('{}')
  })
  return { files, commands, requests }
}

// A slash command as the person types it.
const typed = (command: string, args: string) => ({
  command,
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: true, columns: 120 },
})

// What the tool returns when it runs natively.
function native(on: On): string[] {
  const ran: string[] = []
  on('tool.call', async ($, e) => {
    ran.push(e.tool)
    return { result: 'native ' + e.tool } as never
  })
  return ran
}

describe('routing', () => {
  test('WebSearch goes to the local model over http', async ($, on) => {
    const w = world(on)
    const ran = native(on)
    const result = await $.tool.call({ tool: 'WebSearch', query: 'herdr socket api', mode: 'standard' })
    expect(ran).toEqual([])
    expect(result.result).toEqual({ query: 'herdr socket api', results: ['Qwen says: three results.'], durationSeconds: 0 })
    expect(w.requests[0]?.url).toBe('http://localhost:1234/v1/chat/completions')
    expect(w.requests[0]?.body).toContain('Search the web: herdr socket api')
  })

  test('a YouTube WebFetch goes to agy through herdr, starting it once', async ($, on) => {
    const w = world(on, { herdr: true })
    const ran = native(on)
    const result = await $.tool.call({ tool: 'WebFetch', url: 'https://www.youtube.com/watch?v=abc', prompt: 'what flow?' })
    expect(ran).toEqual([])
    expect(result.result).toMatchObject({ code: 200, result: 'The video shows a timing closure flow (02:10).' })
    expect(w.commands.map(c => c.slice(0, 3).join(' '))).toEqual([
      'herdr agent list',
      'herdr pane split',
      'herdr agent start',
      'herdr agent prompt',
    ])
    expect(w.commands[2]).toEqual(['herdr', 'agent', 'start', 'agy', '--kind', 'antigravity', '--pane', 'p2'])
  })

  test('an agent that leaves no answer falls back to the native tool', async ($, on) => {
    const w = world(on, { herdr: true })
    const ran = native(on)
    // A route whose prompt never names {out}: the agent writes no file, and its pane read holds no text.
    w.files.set(
      `${CWD}/.claude/herdr-bridge.json`,
      JSON.stringify({ ...CONFIG, routes: [{ ...CONFIG.routes[1], prompt: 'Watch {url}' }] }),
    )
    await $.tool.call({ tool: 'WebFetch', url: 'https://youtu.be/abc', prompt: 'summary?' })
    expect(ran).toEqual(['WebFetch'])
  })

  test('another WebFetch runs natively', async ($, on) => {
    world(on, { herdr: true })
    const ran = native(on)
    await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'title?' })
    expect(ran).toEqual(['WebFetch'])
  })

  test('herdr routes run natively outside herdr', async ($, on) => {
    world(on)
    const ran = native(on)
    await $.tool.call({ tool: 'WebFetch', url: 'https://youtu.be/abc', prompt: 'summary?' })
    expect(ran).toEqual(['WebFetch'])
  })

  test('a large report Read is summarized by pi; a small one or a ranged Read is not', async ($, on) => {
    const w = world(on)
    w.files.set('/work/chip/timing.rpt', 'x'.repeat(5000))
    w.files.set('/work/chip/small.rpt', 'x')
    const ran = native(on)
    const big = await $.tool.call({ tool: 'Read', file_path: '/work/chip/timing.rpt' })
    expect(ran).toEqual([])
    expect(JSON.stringify(big.result)).toContain('Worst slack -0.12ns')
    expect(JSON.stringify(big.result)).toContain("summary of /work/chip/timing.rpt, not the file itself")
    await $.tool.call({ tool: 'Read', file_path: '/work/chip/small.rpt' })
    await $.tool.call({ tool: 'Read', file_path: '/work/chip/timing.rpt', offset: 10, limit: 20 })
    expect(ran).toEqual(['Read', 'Read'])
  })

  test('a failing agent falls back to the native tool', async ($, on) => {
    world(on, { httpStatus: 500 })
    const ran = native(on)
    const result = await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard' })
    expect(ran).toEqual(['WebSearch'])
    expect(result.result).toBe('native WebSearch')
  })

  test('/bridge off runs everything natively', async ($, on) => {
    world(on)
    const ran = native(on)
    const off = await $.command.run(typed('bridge', 'off'))
    expect(off.text).toContain('routing is off')
    await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard' })
    expect(ran).toEqual(['WebSearch'])
  })
})

// One model request of turn t1, read to its end as the query loop reads it.
async function step($: Engine, index: number): Promise<void> {
  const stream = $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1 + index * 2 })
  for await (const chunk of stream) void chunk
}

describe('token tracking', () => {
  test('a turn is written to the ledger with its usage and delegations, and /bridge stats compares tags', async ($, on) => {
    const w = world(on)
    native(on)
    on('turn.step', async function* ($, e) {
      return {
        turnId: e.turnId,
        index: e.index,
        answer: '',
        toolUses: [],
        stopReason: 'end_turn',
        usage: { model: 'm', input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 200 },
      } as never
    })
    on('turn.start', async ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', async ($, e) => ({ text: e.answer }))

    await $.command.run(typed('bridge', 'tag A'))
    await $.turn.start({ text: 'research', turnId: 't1' })
    await step($, 0)
    await $.tool.call({ tool: 'WebSearch', query: 'q', mode: 'standard' })
    await step($, 1)
    await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 4000, isAborted: false, reason: 'answer' })

    const ledger = w.files.get(`${HOME}/.claude/herdr-bridge/ledger/session-1.jsonl`)
    expect(ledger).toBeDefined()
    const record = JSON.parse(String(ledger).trim())
    expect(record.tag).toBe('A')
    expect(record.mode).toBe('on')
    expect(record.steps).toBe(2)
    expect(record.usage).toEqual({ input: 200, output: 100, cacheRead: 2000, cacheWrite: 400 })
    // 200*1 + 100*5 + 2000*0.1 + 400*1.25
    expect(record.weighted).toBe(1400)
    expect(record.delegations).toMatchObject([{ route: 'web', agent: 'qwen', ok: true, delegateTokens: { input: 900, output: 120 } }])
    expect(record.tools.WebSearch.calls).toBe(1)

    const stats = await $.command.run(typed('bridge', 'stats'))
    expect(stats.text).toContain('| A | on | 1 | 1.4k |')
  })
})

describe('band above the prompt', () => {
  const BAND = {
    plugin: 'herdr-bridge',
    component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 1 }, view: {} },
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`shows the session's totals and turns routing off (${surface})`, async ($, on) => {
      world(on)
      native(on)
      on('turn.start', async ($, e) => ({ turnId: e.turnId }))
      on('turn.complete', async ($, e) => ({ text: e.answer }))
      await $.turn.start({ text: 'hi', turnId: 't1' })
      await $.turn.complete({
        turnId: 't1',
        answer: 'ok',
        durationMs: 1000,
        isAborted: false,
        reason: 'answer',
        usage: { model: 'm', input_tokens: 2000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      })
      const ui = await $.ui.mount({ ...BAND, surface })
      expect(await ui.find({ type: 'Text', text: /bridge ON · 1 turns · Claude ≈ 2\.0k weighted/ })).toBeDefined()
      await ui.press({ key: 'toggle' })
      expect(await ui.find({ type: 'Text', text: /bridge OFF/ })).toBeDefined()
      await ui.unmount()
    })
  }
})
