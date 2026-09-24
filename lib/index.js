import { defineTool } from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { BUNDLED_SKILL_RANK } from "@deepseek-ai/dsh-skill";
import { postProcessInteractiveHtml } from "@openmaic/generation";
//#region src/client.ts
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Pull the openmaic_access value out of a Set-Cookie header. */
function extractAccessCookie(setCookie) {
	if (!setCookie) return void 0;
	return /(?:^|[;,\s])openmaic_access=([^;,\s]+)/.exec(setCookie)?.[1];
}
async function readJson(res, step) {
	const text = await res.text();
	if (!res.ok) throw new Error(`openmaic_generate: ${step} failed (${res.status}): ${text.slice(0, 300)}`);
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`openmaic_generate: ${step} returned non-JSON: ${text.slice(0, 200)}`);
	}
}
async function generateClassroom(options) {
	const doFetch = options.fetch ?? fetch;
	const baseUrl = options.baseUrl.replace(/\/+$/, "");
	let cookie = "";
	if (options.accessCode !== "") {
		const verifyRes = await doFetch(`${baseUrl}/api/access-code/verify`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code: options.accessCode })
		});
		if (!verifyRes.ok) {
			const body = await verifyRes.text();
			throw new Error(`openmaic_generate: access-code verify failed (${verifyRes.status}): ${body.slice(0, 300)}`);
		}
		const value = extractAccessCookie(verifyRes.headers.get("set-cookie"));
		if (value !== void 0) cookie = `openmaic_access=${value}`;
	}
	const cookieHeader = cookie === "" ? {} : { cookie };
	const body = { requirement: options.requirement };
	if (options.taskId !== void 0) body.taskId = options.taskId;
	if (options.language !== void 0) body.language = options.language;
	if (options.teacherVoice !== void 0) body.teacherVoice = options.teacherVoice;
	if (options.roleVoiceOverrides !== void 0) body.roleVoiceOverrides = options.roleVoiceOverrides;
	if (options.enableWebSearch !== void 0) body.enableWebSearch = options.enableWebSearch;
	if (options.enableImageGeneration !== void 0) body.enableImageGeneration = options.enableImageGeneration;
	if (options.enableVideoGeneration !== void 0) body.enableVideoGeneration = options.enableVideoGeneration;
	if (options.enableTTS !== void 0) body.enableTTS = options.enableTTS;
	if (options.agentMode !== void 0) body.agentMode = options.agentMode;
	const submit = await readJson(await doFetch(`${baseUrl}/api/generate-classroom`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...cookieHeader
		},
		body: JSON.stringify(body)
	}), "generate-classroom");
	const jobId = typeof submit.jobId === "string" ? submit.jobId : void 0;
	const pollUrl = typeof submit.pollUrl === "string" && submit.pollUrl !== "" ? submit.pollUrl : void 0;
	if (pollUrl === void 0) throw new Error("openmaic_generate: generate-classroom response is missing pollUrl");
	const deadline = Date.now() + options.maxWaitMs;
	for (;;) {
		const poll = await readJson(await doFetch(pollUrl, { headers: cookieHeader }), "poll");
		const status = typeof poll.status === "string" ? poll.status : "";
		if (status === "succeeded") {
			const courseId = typeof poll.result?.courseId === "string" && poll.result.courseId !== "" ? poll.result.courseId : typeof poll.result?.classroomId === "string" ? poll.result.classroomId : "";
			const classroomId = typeof poll.result?.classroomId === "string" && poll.result.classroomId !== "" ? poll.result.classroomId : courseId;
			if (courseId === "" || classroomId === "") throw new Error("openmaic_generate: job succeeded but the result has no courseId/classroomId");
			return {
				status: "succeeded",
				courseId,
				classroomId,
				url: typeof poll.result?.url === "string" && poll.result.url !== "" ? poll.result.url : `${baseUrl}/classroom/${classroomId}`
			};
		}
		if (status === "failed") {
			const message = typeof poll.message === "string" && poll.message !== "" ? poll.message : "generation failed";
			return {
				status: "failed",
				jobId,
				error: `openmaic_generate: classroom generation failed${jobId === void 0 ? "" : ` (jobId: ${jobId})`}: ${message}`
			};
		}
		if (Date.now() >= deadline) return {
			status: "timeout",
			jobId,
			error: `openmaic_generate: classroom is still generating in the background${jobId === void 0 ? "" : ` (jobId: ${jobId})`}. Check back later.`
		};
		await sleep(options.pollIntervalMs);
	}
}
//#endregion
//#region src/fragment.ts
/**
* Pure shared contract for the `openmaic_render` tool: fragment validation and
* the `tool/result` meta descriptor. No I/O and no DOM, so the node half, the
* browser half, and vitest all load it unchanged.
*
* A fragment is the model-authored inline-HTML body of one teaching card:
* literal markup without a document skeleton. The card owns the skeleton (it
* wraps the fragment in a sandboxed iframe document with its own CSP), so a
* fragment that ships its own `<!doctype>`/`<html>`/`<head>`/`<body>` would
* nest documents and is rejected loudly instead of rendered broken.
*
* @module @openmaic/dsh-openmaic/fragment
*/
/** Wire name of the tool, the keyed toolview, and the streaming-preview match. */
const OPENMAIC_RENDER_TOOL_NAME = "openmaic_render";
/** Document-skeleton tags a fragment must not contain (case-insensitive). */
const SKELETON_TAG = /<!doctype\b|<\s*(?:html|head|body)\b/iu;
/** UTF-8 byte length of a string. */
function byteLength(text) {
	return new TextEncoder().encode(text).length;
}
/**
* Validate one fragment against the inline contract.
* @param fragment - the markup the model wrote.
* @param maxBytes - deployment size ceiling for one fragment.
* @returns the fragment's UTF-8 size in bytes.
* @throws Error naming the violated rule; the tool surfaces it as `isError`.
*/
function validateFragment(fragment, maxBytes) {
	if (fragment.trim().length === 0) throw new Error("invalid openmaic fragment: the fragment is empty");
	const sizeBytes = byteLength(fragment);
	if (sizeBytes > maxBytes) throw new Error(`invalid openmaic fragment: fragment is ${sizeBytes} bytes, over the ${maxBytes}-byte limit; shrink the inline data first`);
	const skeleton = SKELETON_TAG.exec(fragment);
	if (skeleton) throw new Error(`invalid openmaic fragment: fragment contains a document-skeleton tag (${JSON.stringify(skeleton[0])}); write only the inline body`);
	return sizeBytes;
}
/**
* Narrow an opaque `tool/result` meta into a well-formed {@link OpenmaicMeta}.
* @param meta - the persisted meta value.
* @returns the narrowed descriptor, or `undefined` on any mismatch.
*/
function openmaicMetaFrom(meta) {
	if (typeof meta !== "object" || meta === null) return void 0;
	const m = meta;
	if (m.kind !== "openmaic-render") return void 0;
	if (typeof m.fragment !== "string" || typeof m.title !== "string") return void 0;
	return {
		kind: "openmaic-render",
		fragment: m.fragment,
		title: m.title
	};
}
//#endregion
//#region src/tool.ts
/**
* The model-facing `openmaic_render` tool: take one inline-HTML teaching
* fragment as a direct argument, validate it against the inline contract, and
* project it into the persisted `tool/result` meta so the browser half renders
* it as a sandboxed card and replay reproduces the same card byte for byte.
*
* Passing the markup as an argument (rather than a file path) keeps the node
* half free of any filesystem dependency; the model-facing result stays a
* one-line confirmation so the fragment (already in the model's own output)
* is not re-echoed into context.
*
* @module @openmaic/dsh-openmaic/tool
*/
/** Size ceiling for one fragment; teaching cards should stay well under it. */
const MAX_FRAGMENT_BYTES = 256 * 1024;
const DESCRIPTION$2 = "Show the user an interactive OpenMAIC teaching card (a concept card, quiz, step-by-step walkthrough, or slide) rendered inline in the conversation. Pass the markup in `fragment`: literal inline HTML only, no document skeleton. Load the `openmaic-render` skill for the authoring contract first.";
/**
* Build the `openmaic_render` tool definition.
* @returns the tool definition to register on `ctx.tools`.
*/
function openmaicRenderTool() {
	return defineTool({
		name: OPENMAIC_RENDER_TOOL_NAME,
		description: DESCRIPTION$2,
		parameters: {
			fragment: {
				type: "string",
				required: true,
				description: "The inline HTML fragment to render (markup, style, and script; no <!doctype>, <html>, <head>, or <body>)."
			},
			title: {
				type: "string",
				description: "Concise card title. Defaults to \"OpenMAIC 课堂\"."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					title: {
						type: "string",
						required: true
					},
					sizeBytes: {
						type: "integer",
						required: true
					},
					fragment: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Rendered "${value.title}" inline (${value.sizeBytes} bytes). The user sees the interactive card in the conversation.`
			}],
			presentationMeta: (_args, value) => ({
				kind: "openmaic-render",
				fragment: value.fragment,
				title: value.title
			})
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			const sizeBytes = validateFragment(args.fragment, MAX_FRAGMENT_BYTES);
			return {
				title: args.title?.trim() || "OpenMAIC 课堂",
				sizeBytes,
				fragment: args.fragment
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "OpenMAIC",
			kind: "other"
		}),
		presentResult(_args, result) {
			if (result.isError) return void 0;
			const meta = openmaicMetaFrom(result.meta);
			if (meta === void 0) return void 0;
			return {
				card: "generic",
				title: `OpenMAIC · ${meta.title}`
			};
		}
	});
}
//#endregion
//#region src/skill.ts
/**
* Bundled skill provider for dsh-openmaic: the two authoring contracts the
* model loads before its first `openmaic_render` / `openmaic_widget` call.
* Mirrors the official `dsh-skill-badge` provider shape: bundled candidates
* whose bodies ship in this package's `assets/`.
*
* @module @openmaic/dsh-openmaic/skill
*/
const PROVIDER_NAME = "dsh-openmaic";
const RESOURCE_BASE = {
	kind: "directory",
	path: fileURLToPath(new URL("../assets/", import.meta.url))
};
const INVOCATION = {
	modelInvocable: true,
	userInvocable: true
};
const CANDIDATES = [
	{
		name: "openmaic-render",
		description: "Authoring contract for the openmaic_render tool, which renders interactive teaching cards inline in the conversation: concept cards, self-grading quizzes, step-by-step walkthroughs, and slides. Load before the first openmaic_render call in a session.",
		invocation: INVOCATION,
		provider: PROVIDER_NAME,
		source: "bundled",
		resourceBase: RESOURCE_BASE,
		rank: BUNDLED_SKILL_RANK,
		locator: new URL("../assets/openmaic-render.md", import.meta.url)
	},
	{
		name: "openmaic-widget",
		description: "Authoring contract for the openmaic_widget tool, which renders OpenMAIC interactive widgets inline: simulations, games, and code challenges. Load before the first openmaic_widget call in a session; it defines the widget structure, the embedded widget-config, and the postMessage listener.",
		invocation: INVOCATION,
		provider: PROVIDER_NAME,
		source: "bundled",
		resourceBase: RESOURCE_BASE,
		rank: BUNDLED_SKILL_RANK,
		locator: new URL("../assets/openmaic-widget.md", import.meta.url)
	},
	{
		name: "openmaic-slide",
		description: "Authoring contract for the openmaic_slide tool, which renders one OpenMAIC slide (PPTist-style Slide JSON) inline. Load before the first openmaic_slide call in a session; it defines the slide shape, element kinds, and geometry the tool validates.",
		invocation: INVOCATION,
		provider: PROVIDER_NAME,
		source: "bundled",
		resourceBase: RESOURCE_BASE,
		rank: BUNDLED_SKILL_RANK,
		locator: new URL("../assets/openmaic-slide.md", import.meta.url)
	},
	{
		name: "openmaic-teach",
		description: "Turn the current session into a Socratic OpenMAIC teaching session: teach by guided questioning and dynamically render slides, widgets, and concept cards as aids. Load it when the user wants to learn a topic.",
		invocation: INVOCATION,
		provider: PROVIDER_NAME,
		source: "bundled",
		resourceBase: RESOURCE_BASE,
		rank: BUNDLED_SKILL_RANK,
		locator: new URL("../assets/openmaic-teach.md", import.meta.url)
	}
];
/** The bundled provider registered on `ctx.skills`. */
const openmaicSkillProvider = {
	name: PROVIDER_NAME,
	list: () => Promise.resolve(CANDIDATES),
	async get(candidate) {
		const match = CANDIDATES.find((c) => c.name === candidate.name) ?? CANDIDATES[0];
		return {
			name: match.name,
			description: match.description,
			invocation: match.invocation,
			provider: match.provider,
			source: match.source,
			resourceBase: RESOURCE_BASE,
			content: await readFile(match.locator, "utf8")
		};
	}
};
//#endregion
//#region src/widget-meta.ts
/** Wire name of the tool and of the keyed toolview. */
const OPENMAIC_WIDGET_TOOL_NAME = "openmaic_widget";
/** The widget types v0.3 wires up first. */
const SUPPORTED_WIDGET_TYPES = [
	"simulation",
	"game",
	"code"
];
/**
* Narrow an opaque `tool/result` meta into a well-formed {@link WidgetMeta}.
* @param meta - the persisted meta value.
* @returns the narrowed descriptor, or `undefined` on any mismatch.
*/
function widgetMetaFrom(meta) {
	if (typeof meta !== "object" || meta === null) return void 0;
	const m = meta;
	if (m.kind !== "openmaic-widget") return void 0;
	if (typeof m.html !== "string" || typeof m.title !== "string") return void 0;
	if (m.widgetType !== "simulation" && m.widgetType !== "game" && m.widgetType !== "code") return void 0;
	return {
		kind: "openmaic-widget",
		html: m.html,
		title: m.title,
		widgetType: m.widgetType
	};
}
//#endregion
//#region src/widget.ts
/**
* `openmaic_widget` tool: render a complete OpenMAIC widget document the model
* wrote (following the bundled `openmaic-widget` skill) as a sandboxed card.
* The model streams the HTML in its own output, so there is no tool-side LLM
* call and no timeout; the tool just post-processes (LaTeX to KaTeX) and
* projects the document into persisted meta for the browser half to render.
*
* @module @openmaic/dsh-openmaic/widget
*/
const DESCRIPTION$1 = "Render a complete OpenMAIC widget HTML document inline. Write the full document (with <!doctype>/<html>/<head>/<body>, an embedded widget-config JSON, and the postMessage listener) by following the openmaic-widget skill, then pass it in `html` with the `widgetType` and a short `title`.";
/**
* Build the `openmaic_widget` tool definition.
* @returns the tool definition to register on `ctx.tools`.
*/
function openmaicWidgetTool() {
	return defineTool({
		name: OPENMAIC_WIDGET_TOOL_NAME,
		description: DESCRIPTION$1,
		parameters: {
			html: {
				type: "string",
				required: true,
				description: "The complete widget HTML document (simulation, game, or code), written per the openmaic-widget skill contract."
			},
			widgetType: {
				type: "string",
				enum: [...SUPPORTED_WIDGET_TYPES],
				description: "Widget kind: simulation, game, or code. Defaults to simulation."
			},
			title: {
				type: "string",
				description: "Concise widget title. Defaults to \"OpenMAIC 课堂\"."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					html: {
						type: "string",
						required: true
					},
					title: {
						type: "string",
						required: true
					},
					widgetType: {
						type: "string",
						required: true,
						enum: [...SUPPORTED_WIDGET_TYPES]
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Rendered the ${value.widgetType} widget "${value.title}" inline.`
			}],
			presentationMeta: (_args, value) => ({
				kind: "openmaic-widget",
				html: value.html,
				title: value.title,
				widgetType: value.widgetType
			})
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			const html = typeof args.html === "string" ? args.html.trim() : "";
			if (html === "") throw new Error("openmaic_widget: html is required");
			const title = typeof args.title === "string" && args.title.trim() !== "" ? args.title.trim() : "OpenMAIC 课堂";
			const widgetType = args.widgetType ?? "simulation";
			return {
				html: postProcessInteractiveHtml(html),
				title,
				widgetType
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "OpenMAIC widget",
			kind: "other"
		}),
		presentResult(_args, result) {
			if (result.isError) return void 0;
			const meta = widgetMetaFrom(result.meta);
			if (meta === void 0) return void 0;
			return {
				card: "generic",
				title: `OpenMAIC · ${meta.title}`
			};
		}
	});
}
//#endregion
//#region src/slide-meta.ts
/**
* Pure shared contract for the `openmaic_slide` tool: the wire name and the
* `tool/result` meta descriptor carrying one OpenMAIC slide (the
* `@openmaic/dsl` Slide object). No I/O and no host-package value import, so
* the node half, the browser half, and vitest all load it unchanged.
*
* @module @openmaic/dsh-openmaic/slide-meta
*/
/** Wire name of the tool and of the keyed toolview. */
const OPENMAIC_SLIDE_TOOL_NAME = "openmaic_slide";
/**
* Narrow an opaque `tool/result` meta into a well-formed {@link SlideMeta}.
* @param meta - the persisted meta value.
* @returns the narrowed descriptor, or `undefined` on any mismatch.
*/
function slideMetaFrom(meta) {
	if (typeof meta !== "object" || meta === null) return void 0;
	const m = meta;
	if (m.kind !== "openmaic-slide") return void 0;
	if (typeof m.title !== "string") return void 0;
	if (typeof m.slide !== "object" || m.slide === null || Array.isArray(m.slide)) return void 0;
	return {
		kind: "openmaic-slide",
		slide: m.slide,
		title: m.title
	};
}
//#endregion
//#region src/slide.ts
/**
* `openmaic_slide` tool: render one OpenMAIC slide inline. The model writes
* the slide JSON per the bundled `openmaic-slide` skill (which follows the
* @openmaic/generation slide-content contract, outputting `{background,
* elements}`). The tool normalizes it into a full PPTist Slide — it owns the
* canvas size and ratio (1280 × 720, i.e. viewportRatio 9/16) so the model
* cannot get the geometry wrong — and the browser half renders it with
* `@openmaic/renderer`'s SlideCanvas.
*
* @module @openmaic/dsh-openmaic/slide
*/
const CANVAS_WIDTH = 1280;
/** 9/16: the PPTist/renderer convention is height = width * viewportRatio. */
const CANVAS_RATIO = .5625;
const DEFAULT_THEME = {
	backgroundColor: "#ffffff",
	themeColors: [
		"#5b9bd5",
		"#ed7d31",
		"#a5a5a5",
		"#ffc000",
		"#4472c4",
		"#70ad47"
	],
	fontColor: "#333333",
	fontName: "Arial"
};
const DESCRIPTION = "Render one OpenMAIC slide inline. Write the slide JSON as an object with an `elements` array (and optional `background`) per the openmaic-slide skill, then pass it in `slide` with a short `title`.";
/** Normalize a model-authored slide into a full PPTist Slide. */
function normalizeSlide(input) {
	const elements = Array.isArray(input.elements) ? input.elements : [];
	return {
		id: typeof input.id === "string" && input.id !== "" ? input.id : crypto.randomUUID(),
		viewportSize: typeof input.viewportSize === "number" ? input.viewportSize : CANVAS_WIDTH,
		viewportRatio: typeof input.viewportRatio === "number" ? input.viewportRatio : CANVAS_RATIO,
		theme: input.theme && typeof input.theme === "object" ? input.theme : DEFAULT_THEME,
		...input.background && typeof input.background === "object" ? { background: input.background } : {},
		elements
	};
}
/**
* Build the `openmaic_slide` tool definition.
* @returns the tool definition to register on `ctx.tools`.
*/
function openmaicSlideTool() {
	return defineTool({
		name: OPENMAIC_SLIDE_TOOL_NAME,
		description: DESCRIPTION,
		parameters: {
			slide: {
				type: "object",
				required: true,
				additionalProperties: true,
				description: "The slide JSON: an object with an `elements` array (and optional `background`), per the openmaic-slide skill."
			},
			title: {
				type: "string",
				description: "Concise slide title. Defaults to \"OpenMAIC 幻灯片\"."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					slide: {
						type: "object",
						required: true,
						additionalProperties: true
					},
					title: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Rendered the slide "${value.title}" inline.`
			}],
			presentationMeta: (_args, value) => ({
				kind: "openmaic-slide",
				slide: value.slide,
				title: value.title
			})
		},
		isConcurrencySafe: () => true,
		async execute(args) {
			const raw = args.slide;
			if (!Array.isArray(raw.elements) || raw.elements.length === 0) throw new Error("openmaic_slide: slide must have a non-empty `elements` array");
			const title = typeof args.title === "string" && args.title.trim() !== "" ? args.title.trim() : "OpenMAIC 幻灯片";
			return {
				slide: normalizeSlide(raw),
				title
			};
		},
		presentCall: () => ({
			card: "generic",
			title: "OpenMAIC slide",
			kind: "other"
		}),
		presentResult(_args, result) {
			if (result.isError) return void 0;
			const meta = slideMetaFrom(result.meta);
			if (meta === void 0) return void 0;
			return {
				card: "generic",
				title: `OpenMAIC · ${meta.title}`
			};
		}
	});
}
//#endregion
//#region src/index.ts
const name = "dsh-openmaic";
const inject = [
	"tools",
	"systemPrompt",
	"skills"
];
const DEFAULT_BASE_URL = "https://open.maic.chat";
function taskIdForHarnessCall(callId) {
	const value = String(callId).trim();
	const taskId = `dsh-${value}`;
	if (value === "" || taskId.length > 128 || /[\u0000-\u001f\u007f]/u.test(taskId)) throw new Error("openmaic_generate: invalid DeepSeek Harness callId for task binding");
	return taskId;
}
function voiceBindingParameter(description) {
	return {
		type: "object",
		additionalProperties: false,
		description,
		properties: {
			providerId: {
				type: "string",
				required: true,
				description: "OpenMAIC TTS provider id."
			},
			voiceId: {
				type: "string",
				required: true,
				description: "Saved OpenMAIC voice/profile id."
			},
			modelId: {
				type: "string",
				description: "Optional model id when the saved voice is model-bound."
			}
		}
	};
}
const Config = z.object({
	baseUrl: z.string().default(DEFAULT_BASE_URL).description("OpenMAIC API base URL. Point it at http://localhost:3000 to develop against a local OpenMAIC instance."),
	accessCode: z.string().role("secret").default("").description("Invite code for open.maic.chat. Access codes are not enforced online yet, so leave it empty; fill it in once they are enabled."),
	pollIntervalMs: z.number().step(1).min(1e3).default(5e3).description("Polling interval in milliseconds. Classroom generation is slow, so 60000 is friendlier than the default."),
	maxWaitMs: z.number().step(1).min(1e3).default(18e5).description("How long to poll one job before giving up, in milliseconds (default 30 minutes).")
});
const GENERATE_PROMPT_TEXT = `## Generate OpenMAIC classroom (openmaic_generate)
Use openmaic_generate when the user asks you to create or prepare a lesson, course, or classroom (for example "帮我做一节 XX 课" or "make a lesson about X"). Put the teaching requirement in \`requirement\`. The tool submits an async job to open.maic.chat, waits for it, and returns a playable classroom URL. Only pass the optional flags (language, teacherVoice, roleVoiceOverrides, enableWebSearch, enableImageGeneration, enableVideoGeneration, enableTTS, agentMode) when the user actually asked for them. Never invent providerId, voiceId, or modelId; pass voice bindings only when they came from the user or trusted tool/context data. On success, show the returned Classroom URL to the user as a bare link they can open.`;
const RENDER_PROMPT_TEXT = `## Render OpenMAIC teaching card (openmaic_render)
Use openmaic_render when a visual helps more than text: explaining a concept, giving a quiz, walking through an algorithm or a multi-step process, or showing a slide. Write the card as an inline HTML fragment (markup + style + optional script, no <!doctype>/<html>/<head>/<body>) and pass it in \`fragment\` with a short \`title\`. Load the openmaic-render skill for the fragment contract before the first call.`;
const WIDGET_PROMPT_TEXT = `## Render OpenMAIC interactive widget (openmaic_widget)
Use openmaic_widget when the user wants an interactive teaching widget: a simulation, a quiz or puzzle game, or a runnable code challenge. Load the openmaic-widget skill, pick a \`widgetType\` (simulation, game, or code), write the complete HTML document per the template, then call openmaic_widget with it in \`html\`. The code streams as you write it; the tool renders the finished document inline. Prefer it over openmaic_render for anything that should be genuinely interactive.`;
const SLIDE_PROMPT_TEXT = `## Render OpenMAIC slide (openmaic_slide)
Use openmaic_slide when the user wants a structured slide (a single PPT-style page) rendered inline. Load the openmaic-slide skill, write the slide JSON (PPTist-style Slide: viewportSize, viewportRatio, and an elements array of text/image/shape/chart/code/latex/table elements), then call openmaic_slide with it in \`slide\` and a short \`title\`. The tool renders it with OpenMAIC's official renderer, so charts, formulas, and code all render.`;
const TEXT_OUTPUT = {
	schema: { type: "string" },
	render: (_args, value) => [{
		type: "text",
		text: String(value)
	}]
};
function apply(ctx, config) {
	const resolved = {
		baseUrl: config.baseUrl ?? DEFAULT_BASE_URL,
		accessCode: config.accessCode ?? "",
		pollIntervalMs: config.pollIntervalMs ?? 5e3,
		maxWaitMs: config.maxWaitMs ?? 18e5
	};
	ctx.effect(() => ctx.tools.register(defineTool({
		name: "openmaic_generate",
		description: "Generate an OpenMAIC classroom (an interactive AI lesson) from a teaching requirement and return a playable classroom URL. Submit the requirement, wait for the async generation job, and hand back the link.",
		parameters: {
			requirement: {
				type: "string",
				required: true,
				description: "What the lesson should teach, in natural language, e.g. \"quantum physics for beginners\" or \"帮我做一节量子物理入门课\"."
			},
			language: {
				type: "string",
				enum: ["zh-CN", "en-US"],
				description: "Language of the generated classroom. zh-CN (Chinese) or en-US (English)."
			},
			teacherVoice: voiceBindingParameter("Optional fixed teacher/narrator voice. Only use a real saved OpenMAIC voice binding; never invent ids."),
			roleVoiceOverrides: {
				type: "object",
				additionalProperties: false,
				description: "Optional fixed voices by classroom role. Only pass roles with real saved OpenMAIC voice bindings.",
				properties: {
					teacher: voiceBindingParameter("Fixed voice for all teacher-role agents."),
					assistant: voiceBindingParameter("Fixed voice for all assistant-role agents."),
					student: voiceBindingParameter("Fixed voice for all student-role agents.")
				}
			},
			enableWebSearch: {
				type: "boolean",
				description: "Let the generation pipeline search the web for up-to-date material."
			},
			enableImageGeneration: {
				type: "boolean",
				description: "Generate images for the lesson slides."
			},
			enableVideoGeneration: {
				type: "boolean",
				description: "Generate video for the lesson."
			},
			enableTTS: {
				type: "boolean",
				description: "Enable text-to-speech narration for the classroom agents."
			},
			agentMode: {
				type: "string",
				enum: ["default", "generate"],
				description: "Generation mode. default or generate."
			}
		},
		output: TEXT_OUTPUT,
		timeoutMs: resolved.maxWaitMs,
		isConcurrencySafe: () => true,
		execute: async (args, execution) => {
			const input = args;
			const requirement = typeof input.requirement === "string" ? input.requirement : "";
			if (requirement === "") throw new Error("openmaic_generate: requirement is required");
			const outcome = await generateClassroom({
				baseUrl: resolved.baseUrl,
				accessCode: resolved.accessCode,
				pollIntervalMs: resolved.pollIntervalMs,
				maxWaitMs: resolved.maxWaitMs,
				requirement,
				taskId: taskIdForHarnessCall(execution.callId),
				language: typeof input.language === "string" ? input.language : void 0,
				teacherVoice: input.teacherVoice,
				roleVoiceOverrides: input.roleVoiceOverrides,
				enableWebSearch: typeof input.enableWebSearch === "boolean" ? input.enableWebSearch : void 0,
				enableImageGeneration: typeof input.enableImageGeneration === "boolean" ? input.enableImageGeneration : void 0,
				enableVideoGeneration: typeof input.enableVideoGeneration === "boolean" ? input.enableVideoGeneration : void 0,
				enableTTS: typeof input.enableTTS === "boolean" ? input.enableTTS : void 0,
				agentMode: typeof input.agentMode === "string" ? input.agentMode : void 0
			});
			if (outcome.status === "succeeded") return `Course ID: ${outcome.courseId}\nClassroom ID: ${outcome.classroomId}\nClassroom URL:\n${outcome.url}`;
			throw new Error(outcome.error);
		}
	})), "dsh-openmaic.generate");
	ctx.effect(() => ctx.tools.register(openmaicRenderTool()), "dsh-openmaic.render");
	ctx.effect(() => ctx.tools.register(openmaicWidgetTool()), "dsh-openmaic.widget");
	ctx.effect(() => ctx.tools.register(openmaicSlideTool()), "dsh-openmaic.slide");
	ctx.effect(() => ctx.skills.registerProvider(() => openmaicSkillProvider), "dsh-openmaic.skill");
	ctx.effect(() => ctx.systemPrompt.section({
		name: "tool:dsh-openmaic",
		order: 117,
		text: GENERATE_PROMPT_TEXT
	}), "dsh-openmaic.generate-prompt");
	ctx.effect(() => ctx.systemPrompt.section({
		name: "tool:dsh-openmaic-render",
		order: 118,
		text: RENDER_PROMPT_TEXT
	}), "dsh-openmaic.render-prompt");
	ctx.effect(() => ctx.systemPrompt.section({
		name: "tool:dsh-openmaic-widget",
		order: 119,
		text: WIDGET_PROMPT_TEXT
	}), "dsh-openmaic.widget-prompt");
	ctx.effect(() => ctx.systemPrompt.section({
		name: "tool:dsh-openmaic-slide",
		order: 120,
		text: SLIDE_PROMPT_TEXT
	}), "dsh-openmaic.slide-prompt");
}
//#endregion
export { Config, apply, inject, name, taskIdForHarnessCall };
