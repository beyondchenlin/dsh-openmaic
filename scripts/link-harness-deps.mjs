import { existsSync, lstatSync, mkdirSync, readlinkSync, readdirSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const checkout = resolve(process.argv[2] ?? '');
if (!existsSync(join(checkout, 'packages')) || !existsSync(join(checkout, 'vendor'))) {
  throw new Error('Pass the DeepSeek Harness checkout as the first argument.');
}

const packages = new Map([
  ['@deepseek-ai/cordis', 'vendor/cordis'],
  ['@deepseek-ai/cosmokit', 'vendor/cosmokit'],
  ['@deepseek-ai/schemastery', 'vendor/schemastery'],
  ['@deepseek-ai/dsh-brand', 'packages/util/brand'],
  ['@deepseek-ai/dsh-llm', 'packages/llm/llm'],
  ['@deepseek-ai/dsh-scope', 'packages/core/scope'],
  ['@deepseek-ai/dsh-session', 'packages/core/session'],
  ['@deepseek-ai/dsh-skill', 'packages/skill/skill'],
  ['@deepseek-ai/dsh-system-prompt', 'packages/core/system-prompt'],
  ['@deepseek-ai/dsh-tools', 'packages/core/tools'],
  ['@deepseek-ai/dsh-client-ui-tool', 'packages/client/ui-tool'],
  ['@deepseek-ai/dsh-client-ui-slots', 'packages/client/ui-slots'],
  ['@deepseek-ai/dsh-client-ui-conversation', 'packages/client/ui-conversation'],
  ['@deepseek-ai/dsh-client-ui-chat', 'packages/client/ui-chat'],
  ['@deepseek-ai/dsh-client-ui-renderer', 'packages/client/ui-renderer'],
  ['@deepseek-ai/dsh-client-ui-primitives', 'packages/client/ui-primitives'],
  ['@deepseek-ai/dsh-client-ui-attachment', 'packages/client/ui-attachment'],
]);

const store = join(checkout, 'node_modules', '.pnpm');
const schemaEntry = existsSync(store)
  ? readdirSync(store).find((name) => name.startsWith('@standard-schema+spec@'))
  : undefined;
if (schemaEntry) {
  packages.set('@standard-schema/spec', join('node_modules', '.pnpm', schemaEntry, 'node_modules', '@standard-schema', 'spec'));
}

let backupCount = 0;
for (const [name, relativeTarget] of packages) {
  const target = resolve(checkout, relativeTarget);
  if (!existsSync(target)) continue;
  const destination = resolve(root, 'node_modules', name);
  mkdirSync(dirname(destination), { recursive: true });
  let previous;
  try { previous = lstatSync(destination); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (previous?.isSymbolicLink()) {
    if (resolve(dirname(destination), readlinkSync(destination)) === target) continue;
    unlinkSync(destination);
  } else if (previous) {
    const backup = resolve(root, '.tools', 'host-link-backup', `${name.replaceAll('/', '__')}-${Date.now()}-${backupCount++}`);
    mkdirSync(dirname(backup), { recursive: true });
    renameSync(destination, backup);
    process.stderr.write(`Saved existing ${name} at ${backup}\n`);
  }
  symlinkSync(target, destination, process.platform === 'win32' ? 'junction' : 'dir');
}
