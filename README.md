# dsh-openmaic

把 OpenMAIC 带进 DeepSeek Harness。Bring OpenMAIC into DeepSeek Harness.

`dsh-openmaic` is a DeepSeek Harness plugin that registers four tools and a
Socratic teaching skill:

- `openmaic_generate`: tell your agent "make me a lesson about X", and the plugin submits the requirement to [open.maic.chat](https://open.maic.chat/), waits for the async generation job, and returns a playable classroom link.
- `openmaic_slide`: the agent writes one OpenMAIC slide (PPTist-style Slide JSON) and the plugin renders it with OpenMAIC's official renderer (text, shapes, images, tables, charts, formulas, code).
- `openmaic_widget`: the agent writes an OpenMAIC-style interactive widget (simulation, game, or code) per the bundled contract; the code streams as it writes, then renders inline as a sandboxed card.
- `openmaic_render`: the agent writes an inline HTML teaching fragment (concept card, quiz, walkthrough) and the plugin renders it as a sandboxed card right in the conversation.
- `openmaic-teach` skill: turns a session into a Socratic OpenMAIC lesson, teaching by guided questioning and pulling in slides, widgets, and cards as aids.

## What it looks like

```
用户: 帮我做一节量子物理入门课
模型 → openmaic_generate(requirement="量子物理入门课", language="zh-CN")
     ← "Classroom ID: class-abc123
        Classroom URL:
        https://open.maic.chat/classroom/class-abc123"
模型: 课堂已经生成好了，点开就能上课：
     https://open.maic.chat/classroom/class-abc123
```

Interactive widget:

```
用户: 做一个抛体运动模拟器
模型 → 按 openmaic-widget 模板写完整 HTML（流式输出）
     → openmaic_widget(html="<!doctype html>…", widgetType="simulation", title="抛体运动")
     ← "Rendered the simulation widget …"
     对话里就地出现一个可交互的 OpenMAIC 模拟器
```

## Install

```sh
dsh plugin --profile web add git+https://github.com/THU-MAIC/dsh-openmaic.git
```

Then restart `dsh web` and refresh. The plugin ships its compiled `lib/`, so a
git install needs no build step.

## Config

```yaml
dsh-openmaic:
  baseUrl: https://open.maic.chat
  accessCode: ""     # invite code; not enforced online yet, leave empty
  pollIntervalMs: 5000
  maxWaitMs: 600000
```

| Key | Default | Notes |
| --- | --- | --- |
| `baseUrl` | `https://open.maic.chat` | API base. Point at `http://localhost:3000` to develop against a local OpenMAIC. |
| `accessCode` | `""` | Invite code for open.maic.chat. Not enforced online yet, leave empty; fill it in once enabled. |
| `pollIntervalMs` | `5000` | Poll interval in ms. Generation is slow, so 60000 is friendlier than the default. |
| `maxWaitMs` | `600000` | Cap for one job, 10 minutes. |

## API flow

1. If `accessCode` is set, `POST /api/access-code/verify` and replay the `openmaic_access` cookie on later requests.
2. `POST /api/generate-classroom` with the requirement, plus only the optional flags you passed. Returns a `jobId` and `pollUrl`.
3. Poll `GET {pollUrl}` until the job is `succeeded` or `failed`, or `maxWaitMs` runs out.
4. On success, return `{baseUrl}/classroom/{classroomId}` (or the server-provided `result.url`).

## Scope

- `openmaic_generate`: generate a classroom and return a playable link.
- `openmaic_slide`: render one OpenMAIC slide with the official renderer.
- `openmaic_widget`: render a simulation / game / code widget the agent writes (a full HTML document). It streams the code while the agent writes it and renders on completion.
- `openmaic_render`: render an inline HTML teaching fragment as a sandboxed card.
- `openmaic-teach`: Socratic teaching session that uses the tools above as aids.

The slide/widget/render tools do no server-side generation; they render content
the agent authors against the OpenMAIC SDK contracts (`@openmaic/dsl`,
`@openmaic/generation`, `@openmaic/renderer`).

## Roadmap

- Wire the remaining widget types (diagram, visualization3d, procedural-skill).
- Action loop back to the model (teaching-agent interactions: highlight/annotate/reveal widget elements).

## Development

```sh
./scripts/build.sh  # links host deps, bundles src/ to lib/ with tsdown
./scripts/test.sh   # links host deps, runs the vitest suite
```

The scripts locate the harness checkout from `dsh` on `PATH`; set `DSH_CHECKOUT` to build against a specific checkout.

## License

MIT
