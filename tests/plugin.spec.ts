/**
 * dsh-openmaic plugin: real Cordis composition (SessionStore + SystemPrompt +
 * ToolRegistry + the plugin), global fetch stubbed. Asserts the model-visible
 * tool contract through the registry, exactly as dsh would call it.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SkillService from '@deepseek-ai/dsh-skill'
import ToolRegistry, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DshOpenmaic from '../src/index.ts'

const activeContexts: Context[] = []
let calls = 0

afterEach(async () => {
  for (const ctx of activeContexts.splice(0)) await ctx.fiber.dispose()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

async function setup(config: DshOpenmaic.Config = {}): Promise<Context> {
  const ctx = new Context()
  activeContexts.push(ctx)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SkillService)
  await ctx.plugin(ToolRegistry)
  await ctx.plugin(DshOpenmaic, config)
  return ctx
}

async function callTool(ctx: Context, args: unknown): Promise<ToolExecutionResult> {
  const caller = ctx.sessions.create(SessionId(`caller-${++calls}`), { meta: { createdAt: 1, cwd: '/work' } })
  caller.append('turn/start', { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } })
  caller.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const agent = { id: caller.id, session: caller } as never
  return ctx.tools.execute({
    name: 'openmaic_generate',
    arguments: args,
    callId: CallId(`call-${++calls}`),
    signal: new AbortController().signal,
    agent,
  })
}

function text(result: ToolExecutionResult): string {
  return result.content.map(block => block.type === 'text' ? block.text : '').join('\n')
}

async function callRender(ctx: Context, args: unknown): Promise<ToolExecutionResult> {
  const caller = ctx.sessions.create(SessionId(`caller-${++calls}`), { meta: { createdAt: 1, cwd: '/work' } })
  caller.append('turn/start', { turn: 1, trigger: { kind: 'message', source: { kind: 'user' } } })
  caller.append('user/message', createUserMessage({ content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const agent = { id: caller.id, session: caller } as never
  return ctx.tools.execute({
    name: 'openmaic_render',
    arguments: args,
    callId: CallId(`call-${++calls}`),
    signal: new AbortController().signal,
    agent,
  })
}

function stubGenerate(): { bodies: unknown[]; urls: string[] } {
  const captured = { bodies: [] as unknown[], urls: [] as string[] }
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    captured.urls.push(u)
    if (init?.body !== undefined) captured.bodies.push(JSON.parse(String(init.body)))
    if (u.endsWith('/api/generate-classroom')) {
      return new Response(JSON.stringify({ jobId: 'job-1', pollUrl: 'https://open.maic.chat/api/jobs/job-1' }), { status: 202 })
    }
    return new Response(JSON.stringify({ status: 'succeeded', result: { classroomId: 'class-1', url: 'https://open.maic.chat/classroom/class-1' } }), { status: 200 })
  })
  return captured
}

describe('openmaic_generate', () => {
  it('registers and answers through the registry with a bare classroom URL', async () => {
    const captured = stubGenerate()
    const ctx = await setup()

    const result = await callTool(ctx, { requirement: 'quantum physics for beginners' })
    expect(result.isError).toBeFalsy()
    expect(text(result)).toBe(
      'Classroom ID: class-1\nClassroom URL:\nhttps://open.maic.chat/classroom/class-1',
    )
    const body = captured.bodies[0] as Record<string, unknown>
    expect(body).toEqual({ requirement: 'quantum physics for beginners' })
  })

  it('passes optional flags through to the submit body when given', async () => {
    const captured = stubGenerate()
    const ctx = await setup()

    await callTool(ctx, { requirement: 'r', language: 'zh-CN', enableWebSearch: true })
    const body = captured.bodies[0] as Record<string, unknown>
    expect(body).toEqual({ requirement: 'r', language: 'zh-CN', enableWebSearch: true })
  })

  it('polls the returned pollUrl', async () => {
    const captured = stubGenerate()
    const ctx = await setup()

    await callTool(ctx, { requirement: 'r' })
    expect(captured.urls).toEqual([
      'https://open.maic.chat/api/generate-classroom',
      'https://open.maic.chat/api/jobs/job-1',
    ])
  })

  it('surfaces a failed job as an error', async () => {
    vi.stubGlobal('fetch', async (url: unknown) => {
      if (String(url).endsWith('/api/generate-classroom')) {
        return new Response(JSON.stringify({ jobId: 'job-9', pollUrl: 'https://open.maic.chat/api/jobs/job-9' }), { status: 202 })
      }
      return new Response(JSON.stringify({ status: 'failed', message: 'quota exhausted' }), { status: 200 })
    })
    const ctx = await setup()

    const result = await callTool(ctx, { requirement: 'r' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/jobId: job-9/)
    expect(text(result)).toMatch(/quota exhausted/)
  })

  it('contributes a system-prompt section teaching the model when to call it', async () => {
    const ctx = await setup()
    const assembly = await ctx.systemPrompt.assemble({ cwd: '/work' } as never)
    const section = assembly.sections.find(s => s.name === 'tool:dsh-openmaic')
    expect(section).toBeDefined()
    expect(String(section!.text)).toMatch(/openmaic_generate/)
  })
})

describe('openmaic_render', () => {
  it('registers and returns a one-line confirmation for a valid fragment', async () => {
    const ctx = await setup()
    const result = await callRender(ctx, { fragment: '<div class="card">hello</div>', title: 'Demo' })
    expect(result.isError).toBeFalsy()
    expect(text(result)).toMatch(/Demo/)
    expect(text(result)).toMatch(/inline/)
  })

  it('rejects a document-skeleton fragment as an error', async () => {
    const ctx = await setup()
    const result = await callRender(ctx, { fragment: '<!doctype html><p>x</p>' })
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/document-skeleton/)
  })

  it('contributes a system-prompt section teaching the render contract', async () => {
    const ctx = await setup()
    const assembly = await ctx.systemPrompt.assemble({ cwd: '/work' } as never)
    const section = assembly.sections.find(s => s.name === 'tool:dsh-openmaic-render')
    expect(section).toBeDefined()
    expect(String(section!.text)).toMatch(/openmaic_render/)
  })

  it('provides the bundled openmaic-render skill', async () => {
    const ctx = await setup()
    const catalog = await ctx.skills.list()
    const names = catalog.map(s => s.name)
    expect(names).toContain('openmaic-render')
  })
})

describe('openmaic_widget', () => {
  it('registers the widget tool and contributes a system-prompt section', async () => {
    const ctx = await setup()
    const assembly = await ctx.systemPrompt.assemble({ cwd: '/work' } as never)
    const section = assembly.sections.find(s => s.name === 'tool:dsh-openmaic-widget')
    expect(section).toBeDefined()
    expect(String(section!.text)).toMatch(/openmaic_widget/)
    expect(ctx.tools.get('openmaic_widget')).toBeDefined()
  })
})

describe('openmaic_slide', () => {
  it('registers the slide tool and contributes a system-prompt section', async () => {
    const ctx = await setup()
    const assembly = await ctx.systemPrompt.assemble({ cwd: '/work' } as never)
    const section = assembly.sections.find(s => s.name === 'tool:dsh-openmaic-slide')
    expect(section).toBeDefined()
    expect(String(section!.text)).toMatch(/openmaic_slide/)
    expect(ctx.tools.get('openmaic_slide')).toBeDefined()
  })
})
