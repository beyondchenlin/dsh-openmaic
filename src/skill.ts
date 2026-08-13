/**
 * Bundled skill provider for dsh-openmaic: the two authoring contracts the
 * model loads before its first `openmaic_render` / `openmaic_widget` call.
 * Mirrors the official `dsh-skill-badge` provider shape: bundled candidates
 * whose bodies ship in this package's `assets/`.
 *
 * @module @openmaic/dsh-openmaic/skill
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'dsh-openmaic'
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

const CANDIDATES: SkillCandidate[] = [
  {
    name: 'openmaic-render',
    description:
      'Authoring contract for the openmaic_render tool, which renders interactive ' +
      'teaching cards inline in the conversation: concept cards, self-grading ' +
      'quizzes, step-by-step walkthroughs, and slides. Load before the first ' +
      'openmaic_render call in a session.',
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: BUNDLED_SKILL_RANK,
    locator: new URL('../assets/openmaic-render.md', import.meta.url),
  },
  {
    name: 'openmaic-widget',
    description:
      'Authoring contract for the openmaic_widget tool, which renders OpenMAIC ' +
      'interactive widgets inline: simulations, games, and code challenges. ' +
      'Load before the first openmaic_widget call in a session; it defines the ' +
      'widget structure, the embedded widget-config, and the postMessage listener.',
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: BUNDLED_SKILL_RANK,
    locator: new URL('../assets/openmaic-widget.md', import.meta.url),
  },
  {
    name: 'openmaic-slide',
    description:
      'Authoring contract for the openmaic_slide tool, which renders one ' +
      'OpenMAIC slide (PPTist-style Slide JSON) inline. Load before the first ' +
      'openmaic_slide call in a session; it defines the slide shape, element ' +
      'kinds, and geometry the tool validates.',
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: BUNDLED_SKILL_RANK,
    locator: new URL('../assets/openmaic-slide.md', import.meta.url),
  },
  {
    name: 'openmaic-teach',
    description:
      'Turn the current session into a Socratic OpenMAIC teaching session: ' +
      'teach by guided questioning and dynamically render slides, widgets, and ' +
      'concept cards as aids. Load it when the user wants to learn a topic.',
    invocation: INVOCATION,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: RESOURCE_BASE,
    rank: BUNDLED_SKILL_RANK,
    locator: new URL('../assets/openmaic-teach.md', import.meta.url),
  },
]

/** The bundled provider registered on `ctx.skills`. */
export const openmaicSkillProvider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve(CANDIDATES),
  async get(candidate): Promise<SkillDefinition> {
    const match = CANDIDATES.find(c => c.name === candidate.name) ?? CANDIDATES[0]!
    return {
      name: match.name,
      description: match.description,
      invocation: match.invocation,
      provider: match.provider,
      source: match.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(match.locator as URL, 'utf8'),
    }
  },
}
