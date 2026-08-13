import ToolRegistry from "@deepseek-ai/dsh-tools";
import z from "@deepseek-ai/schemastery";
import SkillService from "@deepseek-ai/dsh-skill";
import { Context } from "@deepseek-ai/cordis";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";

//#region src/index.d.ts
type Context$1 = Context & {
  tools: ToolRegistry;
  systemPrompt: SystemPrompt;
  skills: SkillService;
};
declare const name = "dsh-openmaic";
declare const inject: string[];
interface Config {
  baseUrl?: string;
  accessCode?: string;
  pollIntervalMs?: number;
  maxWaitMs?: number;
}
declare const Config: z<Config>;
declare function apply(ctx: Context$1, config: Config): void;
//#endregion
export { Config, apply, inject, name };