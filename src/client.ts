/**
 * OpenMAIC classroom-generation client over global fetch. Pure functions with
 * an injectable fetch for tests: submit an async generation job to
 * open.maic.chat, poll it to completion, and hand back a playable classroom
 * link. Cookie handling (openmaic_access) is manual because Node's fetch does
 * not manage cookies.
 * @module dsh-openmaic/client
 */

export interface GenerateClassroomOptions {
  baseUrl: string
  accessCode: string
  pollIntervalMs: number
  maxWaitMs: number
  requirement: string
  language?: string
  enableWebSearch?: boolean
  enableImageGeneration?: boolean
  enableVideoGeneration?: boolean
  enableTTS?: boolean
  agentMode?: string
  fetch?: typeof fetch
}

export type GenerateOutcome =
  | { status: 'succeeded'; classroomId: string; url: string }
  | { status: 'failed'; jobId: string | undefined; error: string }
  | { status: 'timeout'; jobId: string | undefined; error: string }

interface JobResponse {
  jobId?: unknown
  status?: unknown
  message?: unknown
  pollUrl?: unknown
  result?: { classroomId?: unknown; url?: unknown }
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Pull the openmaic_access value out of a Set-Cookie header. */
export function extractAccessCookie(setCookie: string | null): string | undefined {
  if (!setCookie) return undefined
  const match = /(?:^|[;,\s])openmaic_access=([^;,\s]+)/.exec(setCookie)
  return match?.[1]
}

async function readJson(res: Response, step: string): Promise<JobResponse> {
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`openmaic_generate: ${step} failed (${res.status}): ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text) as JobResponse
  } catch {
    throw new Error(`openmaic_generate: ${step} returned non-JSON: ${text.slice(0, 200)}`)
  }
}

export async function generateClassroom(options: GenerateClassroomOptions): Promise<GenerateOutcome> {
  const doFetch = options.fetch ?? fetch
  const baseUrl = options.baseUrl.replace(/\/+$/, '')

  // 1. Optional access-code verification, which issues the openmaic_access cookie.
  let cookie = ''
  if (options.accessCode !== '') {
    const verifyRes = await doFetch(`${baseUrl}/api/access-code/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: options.accessCode }),
    })
    if (!verifyRes.ok) {
      const body = await verifyRes.text()
      throw new Error(`openmaic_generate: access-code verify failed (${verifyRes.status}): ${body.slice(0, 300)}`)
    }
    const value = extractAccessCookie(verifyRes.headers.get('set-cookie'))
    if (value !== undefined) cookie = `openmaic_access=${value}`
  }

  const cookieHeader: Record<string, string> = cookie === '' ? {} : { cookie }

  // 2. Submit the async generation job. Optional flags are only included when
  //    the caller actually provided them.
  const body: Record<string, unknown> = { requirement: options.requirement }
  if (options.language !== undefined) body.language = options.language
  if (options.enableWebSearch !== undefined) body.enableWebSearch = options.enableWebSearch
  if (options.enableImageGeneration !== undefined) body.enableImageGeneration = options.enableImageGeneration
  if (options.enableVideoGeneration !== undefined) body.enableVideoGeneration = options.enableVideoGeneration
  if (options.enableTTS !== undefined) body.enableTTS = options.enableTTS
  if (options.agentMode !== undefined) body.agentMode = options.agentMode

  const submitRes = await doFetch(`${baseUrl}/api/generate-classroom`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cookieHeader },
    body: JSON.stringify(body),
  })
  const submit = await readJson(submitRes, 'generate-classroom')
  const jobId = typeof submit.jobId === 'string' ? submit.jobId : undefined
  const pollUrl = typeof submit.pollUrl === 'string' && submit.pollUrl !== '' ? submit.pollUrl : undefined
  if (pollUrl === undefined) {
    throw new Error('openmaic_generate: generate-classroom response is missing pollUrl')
  }

  // 3. Poll until the job settles or the wait budget runs out.
  const deadline = Date.now() + options.maxWaitMs
  for (;;) {
    const pollRes = await doFetch(pollUrl, { headers: cookieHeader })
    const poll = await readJson(pollRes, 'poll')
    const status = typeof poll.status === 'string' ? poll.status : ''
    if (status === 'succeeded') {
      const classroomId = typeof poll.result?.classroomId === 'string' ? poll.result.classroomId : ''
      if (classroomId === '') {
        throw new Error('openmaic_generate: job succeeded but the result has no classroomId')
      }
      const url = typeof poll.result?.url === 'string' && poll.result.url !== ''
        ? poll.result.url
        : `${baseUrl}/classroom/${classroomId}`
      return { status: 'succeeded', classroomId, url }
    }
    if (status === 'failed') {
      const message = typeof poll.message === 'string' && poll.message !== '' ? poll.message : 'generation failed'
      const job = jobId === undefined ? '' : ` (jobId: ${jobId})`
      return { status: 'failed', jobId, error: `openmaic_generate: classroom generation failed${job}: ${message}` }
    }
    if (Date.now() >= deadline) {
      const job = jobId === undefined ? '' : ` (jobId: ${jobId})`
      return {
        status: 'timeout',
        jobId,
        error: `openmaic_generate: classroom is still generating in the background${job}. Check back later.`,
      }
    }
    await sleep(options.pollIntervalMs)
  }
}
