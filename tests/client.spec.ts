/** Unit tests for the OpenMAIC classroom-generation client (fetch injected as a seam). */

import { describe, expect, it } from 'vitest'
import { extractAccessCookie, generateClassroom } from '../src/client.ts'

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), { status, headers })
}

function baseOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    baseUrl: 'https://open.maic.chat',
    accessCode: '',
    pollIntervalMs: 5,
    maxWaitMs: 60_000,
    requirement: 'quantum physics for beginners',
    ...overrides,
  }
}

describe('extractAccessCookie', () => {
  it('pulls the openmaic_access value out of a Set-Cookie header', () => {
    expect(extractAccessCookie('openmaic_access=abc123; Path=/; HttpOnly')).toBe('abc123')
    expect(extractAccessCookie('other=1, openmaic_access=xyz')).toBe('xyz')
    expect(extractAccessCookie(null)).toBeUndefined()
    expect(extractAccessCookie('foo=bar')).toBeUndefined()
  })
})

describe('generateClassroom', () => {
  it('submits, polls, and returns a classroom URL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      calls.push({ url: u, init: init! })
      if (u.endsWith('/api/generate-classroom')) {
        return jsonResponse({ jobId: 'job-1', status: 'processing', pollUrl: 'https://open.maic.chat/api/jobs/job-1' }, 202)
      }
      return jsonResponse({ status: 'succeeded', result: { courseId: 'course-1', classroomId: 'class-1', url: 'https://open.maic.chat/classroom/class-1' } })
    }) as typeof fetch

    const outcome = await generateClassroom({ ...baseOptions(), fetch: fakeFetch })
    expect(outcome).toEqual({ status: 'succeeded', courseId: 'course-1', classroomId: 'class-1', url: 'https://open.maic.chat/classroom/class-1' })
    expect(calls.map(c => c.url)).toEqual([
      'https://open.maic.chat/api/generate-classroom',
      'https://open.maic.chat/api/jobs/job-1',
    ])
    const submitBody = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>
    expect(submitBody).toEqual({ requirement: 'quantum physics for beginners' })
  })

  it('includes only the optional flags the caller provided', async () => {
    let submitBody: Record<string, unknown> | undefined
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/api/generate-classroom')) {
        submitBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        return jsonResponse({ jobId: 'job-1', pollUrl: 'https://open.maic.chat/api/jobs/job-1' }, 202)
      }
      return jsonResponse({ status: 'succeeded', result: { classroomId: 'c', url: 'https://open.maic.chat/classroom/c' } })
    }) as typeof fetch

    await generateClassroom({
      ...baseOptions(),
      taskId: 'dsh-call-stable',
      language: 'zh-CN',
      teacherVoice: { providerId: 'qwen-vc', voiceId: 'teacher-voice', modelId: 'voice-model' },
      roleVoiceOverrides: {
        assistant: { providerId: 'qwen-vc', voiceId: 'assistant-voice' },
      },
      enableWebSearch: true,
      enableTTS: false,
      agentMode: 'generate',
      fetch: fakeFetch,
    })
    expect(submitBody).toEqual({
      requirement: 'quantum physics for beginners',
      taskId: 'dsh-call-stable',
      language: 'zh-CN',
      teacherVoice: { providerId: 'qwen-vc', voiceId: 'teacher-voice', modelId: 'voice-model' },
      roleVoiceOverrides: {
        assistant: { providerId: 'qwen-vc', voiceId: 'assistant-voice' },
      },
      enableWebSearch: true,
      enableTTS: false,
      agentMode: 'generate',
    })
  })

  it('verifies the access code and replays the openmaic_access cookie', async () => {
    const headers: Array<Record<string, string>> = []
    const fakeFetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url)
      headers.push((init?.headers as Record<string, string>) ?? {})
      if (u.endsWith('/api/access-code/verify')) {
        return jsonResponse({ ok: true }, 200, { 'set-cookie': 'openmaic_access=token-42; Path=/' })
      }
      if (u.endsWith('/api/generate-classroom')) {
        return jsonResponse({ jobId: 'job-1', pollUrl: 'https://open.maic.chat/api/jobs/job-1' }, 202)
      }
      return jsonResponse({ status: 'succeeded', result: { classroomId: 'c', url: 'https://open.maic.chat/classroom/c' } })
    }) as typeof fetch

    await generateClassroom({ ...baseOptions(), accessCode: 'invite-1', fetch: fakeFetch })

    expect(headers[0]!.cookie).toBeUndefined()
    expect(headers[1]!.cookie).toBe('openmaic_access=token-42')
    expect(headers[2]!.cookie).toBe('openmaic_access=token-42')
  })

  it('returns a clear error with jobId when the job fails', async () => {
    const fakeFetch = (async (url: unknown) => {
      if (String(url).endsWith('/api/generate-classroom')) {
        return jsonResponse({ jobId: 'job-9', pollUrl: 'https://open.maic.chat/api/jobs/job-9' }, 202)
      }
      return jsonResponse({ status: 'failed', message: 'LLM provider quota exhausted' })
    }) as typeof fetch

    const outcome = await generateClassroom({ ...baseOptions(), fetch: fakeFetch })
    expect(outcome).toEqual({
      status: 'failed',
      jobId: 'job-9',
      error: 'openmaic_generate: classroom generation failed (jobId: job-9): LLM provider quota exhausted',
    })
  })

  it('reports a still-generating timeout with jobId when the budget runs out', async () => {
    const fakeFetch = (async (url: unknown) => {
      if (String(url).endsWith('/api/generate-classroom')) {
        return jsonResponse({ jobId: 'job-2', pollUrl: 'https://open.maic.chat/api/jobs/job-2' }, 202)
      }
      return jsonResponse({ status: 'processing' })
    }) as typeof fetch

    const outcome = await generateClassroom({ ...baseOptions({ maxWaitMs: 20, pollIntervalMs: 5 }), fetch: fakeFetch })
    expect(outcome.status).toBe('timeout')
    expect(outcome).toMatchObject({ jobId: 'job-2' })
    expect(outcome.status === 'timeout' ? outcome.error : '').toMatch(/still generating in the background/)
  })

  it('surfaces server errors from the submit step', async () => {
    const fakeFetch = (async () => jsonResponse({ error: 'bad request' }, 400)) as typeof fetch
    await expect(generateClassroom({ ...baseOptions(), fetch: fakeFetch }))
      .rejects.toThrow(/generate-classroom failed \(400\)/)
  })

  it('rejects a submit response without pollUrl', async () => {
    const fakeFetch = (async () => jsonResponse({ jobId: 'job-1' }, 202)) as typeof fetch
    await expect(generateClassroom({ ...baseOptions(), fetch: fakeFetch }))
      .rejects.toThrow(/missing pollUrl/)
  })

  it('builds the classroom URL from classroomId when result.url is absent', async () => {
    const fakeFetch = (async (url: unknown) => {
      if (String(url).endsWith('/api/generate-classroom')) {
        return jsonResponse({ jobId: 'job-1', pollUrl: 'https://open.maic.chat/api/jobs/job-1' }, 202)
      }
      return jsonResponse({ status: 'succeeded', result: { classroomId: 'class-7' } })
    }) as typeof fetch

    const outcome = await generateClassroom({ ...baseOptions(), fetch: fakeFetch })
    expect(outcome).toEqual({ status: 'succeeded', courseId: 'class-7', classroomId: 'class-7', url: 'https://open.maic.chat/classroom/class-7' })
  })
})
