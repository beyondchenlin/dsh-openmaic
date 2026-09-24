/**
 * dsh-openmaic: OpenMAIC for DeepSeek Harness. Registers two tools and a
 * bundled skill:
 * - `openmaic_generate`: turns a teaching requirement into a playable
 *   classroom link via open.maic.chat's async generation API.
 * - `openmaic_render`: renders an inline HTML teaching fragment as a sandboxed
 *   card in the conversation (the browser half draws it).
 * - `openmaic-render` skill: the fragment-authoring contract.
 * @module dsh-openmaic
 */

import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type SkillService from '@deepseek-ai/dsh-skill'
import type ToolRegistry from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { generateClassroom, type ClassroomRole, type VoiceBinding } from './client.js'
import { openmaicRenderTool } from './tool.js'
import { openmaicSkillProvider } from './skill.js'
import { openmaicWidgetTool } from './widget.js'
import { openmaicSlideTool } from './slide.js'

type Context = CordisContext & {
  tools: ToolRegistry
  systemPrompt: SystemPrompt
  skills: SkillService
}

export const name = 'dsh-openmaic'
export const inject = ['tools', 'systemPrompt', 'skills']

export interface Config {
  baseUrl?: string
  accessCode?: string
  pollIntervalMs?: number
  maxWaitMs?: number
}

const DEFAULT_BASE_URL = 'https://open.maic.chat'

export function taskIdForHarnessCall(callId: unknown): string {
  const value = String(callId).trim()
  const taskId = `dsh-${value}`
  if (value === '' || taskId.length > 128 || /[\u0000-\u001f\u007f]/u.test(taskId)) {
    throw new Error('openmaic_generate: invalid DeepSeek Harness callId for task binding')
  }
  return taskId
}

function voiceBindingParameter(description: string) {
  return {
    type: 'object' as const,
    additionalProperties: false,
    description,
    properties: {
      providerId: { type: 'string' as const, required: true, description: 'OpenMAIC TTS provider id.' },
      voiceId: { type: 'string' as const, required: true, description: 'Saved OpenMAIC voice/profile id.' },
      modelId: { type: 'string' as const, description: 'Optional model id when the saved voice is model-bound.' },
    },
  } as const
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL)
    .description('OpenMAIC API base URL. Point it at http://localhost:3000 to develop against a local OpenMAIC instance.'),
  accessCode: z.string().role('secret').default('')
    .description('Invite code for open.maic.chat. Access codes are not enforced online yet, so leave it empty; fill it in once they are enabled.'),
  pollIntervalMs: z.number().step(1).min(1_000).default(5_000)
    .description('Polling interval in milliseconds. Classroom generation is slow, so 60000 is friendlier than the default.'),
  maxWaitMs: z.number().step(1).min(1_000).default(1_800_000)
    .description('How long to poll one job before giving up, in milliseconds (default 30 minutes).'),
})

const GENERATE_PROMPT_TEXT = `## Generate OpenMAIC classroom (openmaic_generate)
Use openmaic_generate when the user asks you to create or prepare a lesson, course, or classroom (for example "帮我做一节 XX 课" or "make a lesson about X"). Put the teaching requirement in \`requirement\`. The tool submits an async job to open.maic.chat, waits for it, and returns a playable classroom URL. Only pass the optional flags (language, teacherVoice, roleVoiceOverrides, enableWebSearch, enableImageGeneration, enableVideoGeneration, enableTTS, agentMode) when the user actually asked for them. Never invent providerId, voiceId, or modelId; pass voice bindings only when they came from the user or trusted tool/context data. On success, show the returned Classroom URL to the user as a bare link they can open.`

const RENDER_PROMPT_TEXT = `## Render OpenMAIC teaching card (openmaic_render)
Use openmaic_render when a visual helps more than text: explaining a concept, giving a quiz, walking through an algorithm or a multi-step process, or showing a slide. Write the card as an inline HTML fragment (markup + style + optional script, no <!doctype>/<html>/<head>/<body>) and pass it in \`fragment\` with a short \`title\`. Load the openmaic-render skill for the fragment contract before the first call.`

const WIDGET_PROMPT_TEXT = `## Render OpenMAIC interactive widget (openmaic_widget)
Use openmaic_widget when the user wants an interactive teaching widget: a simulation, a quiz or puzzle game, or a runnable code challenge. Load the openmaic-widget skill, pick a \`widgetType\` (simulation, game, or code), write the complete HTML document per the template, then call openmaic_widget with it in \`html\`. The code streams as you write it; the tool renders the finished document inline. Prefer it over openmaic_render for anything that should be genuinely interactive.`

const SLIDE_PROMPT_TEXT = `## Render OpenMAIC slide (openmaic_slide)
Use openmaic_slide when the user wants a structured slide (a single PPT-style page) rendered inline. Load the openmaic-slide skill, write the slide JSON (PPTist-style Slide: viewportSize, viewportRatio, and an elements array of text/image/shape/chart/code/latex/table elements), then call openmaic_slide with it in \`slide\` and a short \`title\`. The tool renders it with OpenMAIC's official renderer, so charts, formulas, and code all render.`

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: String(value) }],
}

export function apply(ctx: Context, config: Config): void {
  const resolved = {
    baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
    accessCode: config.accessCode ?? '',
    pollIntervalMs: config.pollIntervalMs ?? 5_000,
    maxWaitMs: config.maxWaitMs ?? 1_800_000,
  }

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'openmaic_generate',
    description: 'Generate an OpenMAIC classroom (an interactive AI lesson) from a teaching requirement and return a playable classroom URL. Submit the requirement, wait for the async generation job, and hand back the link.',
    parameters: {
      requirement: {
        type: 'string',
        required: true,
        description: 'What the lesson should teach, in natural language, e.g. "quantum physics for beginners" or "帮我做一节量子物理入门课".',
      },
      language: {
        type: 'string',
        enum: ['zh-CN', 'en-US'],
        description: 'Language of the generated classroom. zh-CN (Chinese) or en-US (English).',
      },
      teacherVoice: voiceBindingParameter('Optional fixed teacher/narrator voice. Only use a real saved OpenMAIC voice binding; never invent ids.'),
      roleVoiceOverrides: {
        type: 'object',
        additionalProperties: false,
        description: 'Optional fixed voices by classroom role. Only pass roles with real saved OpenMAIC voice bindings.',
        properties: {
          teacher: voiceBindingParameter('Fixed voice for all teacher-role agents.'),
          assistant: voiceBindingParameter('Fixed voice for all assistant-role agents.'),
          student: voiceBindingParameter('Fixed voice for all student-role agents.'),
        },
      },
      enableWebSearch: {
        type: 'boolean',
        description: 'Let the generation pipeline search the web for up-to-date material.',
      },
      enableImageGeneration: {
        type: 'boolean',
        description: 'Generate images for the lesson slides.',
      },
      enableVideoGeneration: {
        type: 'boolean',
        description: 'Generate video for the lesson.',
      },
      enableTTS: {
        type: 'boolean',
        description: 'Enable text-to-speech narration for the classroom agents.',
      },
      agentMode: {
        type: 'string',
        enum: ['default', 'generate'],
        description: 'Generation mode. default or generate.',
      },
    },
    output: TEXT_OUTPUT,
    timeoutMs: resolved.maxWaitMs,
    isConcurrencySafe: () => true,
    execute: async (args, execution) => {
      const input = args as {
        requirement?: unknown
        language?: unknown
        teacherVoice?: unknown
        roleVoiceOverrides?: unknown
        enableWebSearch?: unknown
        enableImageGeneration?: unknown
        enableVideoGeneration?: unknown
        enableTTS?: unknown
        agentMode?: unknown
      }
      const requirement = typeof input.requirement === 'string' ? input.requirement : ''
      if (requirement === '') throw new Error('openmaic_generate: requirement is required')
      const taskId = taskIdForHarnessCall(execution.callId)
      const outcome = await generateClassroom({
        baseUrl: resolved.baseUrl,
        accessCode: resolved.accessCode,
        pollIntervalMs: resolved.pollIntervalMs,
        maxWaitMs: resolved.maxWaitMs,
        requirement,
        taskId,
        language: typeof input.language === 'string' ? input.language : undefined,
        teacherVoice: input.teacherVoice as VoiceBinding | undefined,
        roleVoiceOverrides: input.roleVoiceOverrides as Partial<Record<ClassroomRole, VoiceBinding>> | undefined,
        enableWebSearch: typeof input.enableWebSearch === 'boolean' ? input.enableWebSearch : undefined,
        enableImageGeneration: typeof input.enableImageGeneration === 'boolean' ? input.enableImageGeneration : undefined,
        enableVideoGeneration: typeof input.enableVideoGeneration === 'boolean' ? input.enableVideoGeneration : undefined,
        enableTTS: typeof input.enableTTS === 'boolean' ? input.enableTTS : undefined,
        agentMode: typeof input.agentMode === 'string' ? input.agentMode : undefined,
      })
      if (outcome.status === 'succeeded') {
        return `Task ID: ${taskId}\nCourse ID: ${outcome.courseId}\nClassroom ID: ${outcome.classroomId}\nClassroom URL:\n${outcome.url}`
      }
      throw new Error(outcome.error)
    },
  })), 'dsh-openmaic.generate')

  ctx.effect(() => ctx.tools.register(openmaicRenderTool()), 'dsh-openmaic.render')

  ctx.effect(() => ctx.tools.register(openmaicWidgetTool()), 'dsh-openmaic.widget')

  ctx.effect(() => ctx.tools.register(openmaicSlideTool()), 'dsh-openmaic.slide')

  ctx.effect(() => ctx.skills.registerProvider(() => openmaicSkillProvider), 'dsh-openmaic.skill')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tool:dsh-openmaic',
    order: 117,
    text: GENERATE_PROMPT_TEXT,
  }), 'dsh-openmaic.generate-prompt')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tool:dsh-openmaic-render',
    order: 118,
    text: RENDER_PROMPT_TEXT,
  }), 'dsh-openmaic.render-prompt')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tool:dsh-openmaic-widget',
    order: 119,
    text: WIDGET_PROMPT_TEXT,
  }), 'dsh-openmaic.widget-prompt')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'tool:dsh-openmaic-slide',
    order: 120,
    text: SLIDE_PROMPT_TEXT,
  }), 'dsh-openmaic.slide-prompt')
}
