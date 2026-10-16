import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { resolveAeAppName } from '../../packages/server/src/osascript-transport.js';
import { createServer } from '../../packages/server/src/server.js';
import { DEFAULT_SETTINGS } from '../../packages/server/src/settings.js';
import { createState, scenario, type DriveState, type Step, type ToolResult } from './scenario.js';
import { queueRoot } from '@ae-mcp/protocol';

/**
 * Live test drive (#200): runs every step of `scenario.ts` through the real
 * MCP server against the After Effects that is open on this Mac. Manual gate,
 * never run in CI. `--keep` leaves the scratch items in the project.
 */

const execFileAsync = promisify(execFile);
const STEP_TIMEOUT_MS = 60_000;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../.tmp/test-drive');

type Status = 'pass' | 'fail' | 'skip';

interface StepRecord {
  step: Step;
  status: Status;
  ms: number;
  error?: string;
  note?: string;
  images: string[];
}

const useColor = process.stdout.isTTY === true || process.env.FORCE_COLOR !== undefined;
const paint = (code: number, value: string): string => (useColor ? `\u001B[${code}m${value}\u001B[0m` : value);
const green = (v: string): string => paint(32, v);
const red = (v: string): string => paint(31, v);
const grey = (v: string): string => paint(90, v);
const bold = (v: string): string => paint(1, v);

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');
  await mkdir(outDir, { recursive: true });
  const state = createState();
  state.vars.outputDir = outDir;
  const appName = await resolveAeAppName();

  const runJsx = async (code: string): Promise<string> => {
    // DoScriptFile does not return the script value, so the wrapper writes it to a file.
    const file = join(outDir, 'harness.jsx');
    const resultFile = join(outDir, 'harness.out');
    await writeFile(resultFile, '');
    await writeFile(
      file,
      `var __out = new File(${JSON.stringify(resultFile)});
__out.encoding = 'UTF-8'; __out.open('w');
try { __out.write(String(eval(${JSON.stringify(code)}))); } catch (e) { __out.write('ERROR: ' + e); }
__out.close();`,
    );
    await execFileAsync('osascript', ['-e', `tell application "${appName}" to DoScriptFile "${file}"`], {
      encoding: 'utf8',
      timeout: STEP_TIMEOUT_MS,
    });
    const value = (await readFile(resultFile, 'utf8')).trim();
    if (value.startsWith('ERROR: ')) {
      throw new Error(`harness script failed: ${value}`);
    }
    return value;
  };

  const server = createServer({
    root: queueRoot(),
    settings: { ...DEFAULT_SETTINGS, incrementBeforeDestructive: false, evalEnabled: false },
    instructions: '',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'ae-mcp-test-drive', version: '0.0.0' });
  await client.connect(clientTransport);

  const call = async (name: string, args: unknown): Promise<ToolResult> => {
    const raw = (await client.callTool({ name, arguments: args as { [k: string]: unknown } })) as {
      isError?: boolean;
      content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    };
    const content = raw.content ?? [];
    const text = content.find((block) => block.type === 'text')?.text ?? '';
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    const images = content
      .filter((block) => block.type === 'image' && typeof block.data === 'string')
      .map((block) => ({ data: block.data!, mimeType: block.mimeType ?? 'image/png' }));
    return { isError: raw.isError === true, text, json, images };
  };

  const execute = async (step: Step): Promise<ToolResult> => {
    const args = step.args(state);
    if (step.kind === 'tool') {
      return call(step.name, args);
    }
    if (step.kind === 'op') {
      return call('ae_do', { op: step.name, args });
    }
    const planned = await call('ae_plan', { op: step.name, args });
    if (planned.isError || step.apply === false) {
      return planned;
    }
    const planId = (planned.json as { planId?: string } | null)?.planId;
    if (typeof planId !== 'string') {
      throw new Error(`ae_plan returned no planId: ${planned.text.slice(0, 200)}`);
    }
    state.planId = planId;
    return call('ae_apply', { planId });
  };

  const existingIds = await runJsx(
    "var ids = []; for (var i = 1; i <= app.project.numItems; i++) { ids.push(app.project.item(i).id); } ids.join(',');",
  );
  const records: StepRecord[] = [];
  console.log(bold(`ae-mcp test drive: ${state.prefix} (${appName})`));

  for (const step of scenario) {
    const started = Date.now();
    const skipReason = step.skip ?? step.skipIf?.(state);
    let record: StepRecord;
    if (skipReason !== undefined) {
      record = { step, status: 'skip', ms: 0, note: skipReason, images: [] };
    } else {
      record = { step, status: 'pass', ms: 0, images: [] };
      try {
        await withTimeout(
          (async () => {
            if (step.before) {
              await runJsx(step.before(state));
            }
            const result = await execute(step);
            record.images = result.images.map((image) => `data:${image.mimeType};base64,${image.data}`);
            if (step.expectError) {
              if (!result.isError) {
                throw new Error('expected an error but the call succeeded');
              }
              record.note = `failed as expected: ${result.text.slice(0, 160)}`;
            } else if (result.isError) {
              throw new Error(result.text.slice(0, 600) || 'tool returned isError with no text');
            }
            step.after?.(result, state);
          })(),
          STEP_TIMEOUT_MS,
          step.id,
        );
      } catch (error) {
        record.status = 'fail';
        record.error = error instanceof Error ? error.message : String(error);
      }
      record.ms = Date.now() - started;
    }
    records.push(record);
    const mark = record.status === 'pass' ? green('✓') : record.status === 'fail' ? red('✗') : grey('–');
    const label = record.status === 'skip' ? grey(step.id) : record.status === 'fail' ? red(step.id) : step.id;
    const time = record.status === 'skip' ? '' : grey(` ${record.ms} ms`);
    console.log(`  ${mark} ${label}${time}`);
    if (record.status === 'fail') {
      console.log(`      ${red(record.error ?? '')}`);
    }
  }

  if (keep) {
    console.log(grey(`--keep: leaving "${state.prefix}*" items in the project`));
  } else {
    try {
      const removed = await runJsx(cleanupJsx(state.prefix, existingIds));
      console.log(grey(`cleanup: ${removed || 'done'}`));
    } catch (error) {
      console.log(red(`cleanup failed: ${String(error)}`));
    }
  }

  await client.close();
  const report = renderReport(records, state, keep);
  const reportPath = join(outDir, 'report.html');
  await writeFile(reportPath, report);

  const count = (status: Status): number => records.filter((r) => r.status === status).length;
  console.log(
    `\n${green(`${count('pass')} passed`)}, ${count('fail') > 0 ? red(`${count('fail')} failed`) : '0 failed'}, ${grey(`${count('skip')} skipped`)}`,
  );
  console.log(`report: ${reportPath}`);
  process.exit(count('fail') > 0 ? 1 : 0);
}

/** Removes only items whose name starts with the drive prefix, plus our queue items. */
function cleanupJsx(prefix: string, existingIds: string): string {
  return `
var prefix = ${JSON.stringify(prefix)};
var slug = prefix.replace(/ /g, '_');
var existing = {};
var ids = ${JSON.stringify(existingIds)}.split(',');
for (var e = 0; e < ids.length; e++) { existing[ids[e]] = true; }
var removed = 0;
var q = app.project.renderQueue;
for (var r = q.numItems; r >= 1; r--) {
  var rq = q.item(r);
  if (rq.comp && rq.comp.name.indexOf(prefix) === 0 && rq.status === RQItemStatus.QUEUED) { rq.remove(); removed++; }
}
var again = true;
while (again) {
  again = false;
  for (var i = app.project.numItems; i >= 1; i--) {
    var it = app.project.item(i);
    if (it.name.indexOf(prefix) === 0 || it.name.indexOf(slug) === 0) { it.remove(); removed++; again = true; break; }
  }
}
// Solid and null layers leave unnamed solid footage (and a Solids folder) behind.
var sweep = true;
while (sweep) {
  sweep = false;
  for (var s = app.project.numItems; s >= 1; s--) {
    var sit = app.project.item(s);
    if (existing[sit.id]) { continue; }
    var isSolid = sit instanceof FootageItem && sit.mainSource instanceof SolidSource;
    var isEmptyFolder = sit instanceof FolderItem && sit.numItems === 0;
    if (isSolid || isEmptyFolder) { sit.remove(); removed++; sweep = true; break; }
  }
}
var left = 0;
for (var j = 1; j <= app.project.numItems; j++) { if (app.project.item(j).name.indexOf(prefix) === 0) { left++; } }
'removed ' + removed + ', ' + left + ' left';`;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function categoryOf(step: Step): string {
  return step.category ?? step.name.split('.')[0]!;
}

function renderReport(records: StepRecord[], state: DriveState, keep: boolean): string {
  const count = (status: Status): number => records.filter((r) => r.status === status).length;
  const groups = new Map<string, StepRecord[]>();
  for (const record of records) {
    const key = categoryOf(record.step);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const rows = [...groups.entries()]
    .map(([category, list]) => {
      const body = list
        .map((r) => {
          const detail = r.error
            ? `<pre class="err">${escapeHtml(r.error)}</pre>`
            : r.note
              ? `<span class="note">${escapeHtml(r.note)}</span>`
              : '';
          return `<tr><td><span class="pill ${r.status}">${r.status}</span></td><td><code>${escapeHtml(r.step.id)}</code><div class="kind">${r.step.kind} · ${escapeHtml(r.step.name)}</div>${detail}</td><td class="ms">${r.status === 'skip' ? '' : `${r.ms} ms`}</td></tr>`;
        })
        .join('');
      return `<section><h2>${escapeHtml(category)} <small>${list.length}</small></h2><table>${body}</table></section>`;
    })
    .join('\n');
  const frames = records
    .filter((r) => r.images.length > 0)
    .map(
      (r) =>
        `<figure><img alt="${escapeHtml(r.step.id)}" src="${r.images[0]}"><figcaption>${escapeHtml(r.step.id)}</figcaption></figure>`,
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ae-mcp test drive</title>
<style>
:root{--bg:#fafafa;--fg:#1b1b1f;--muted:#6b6b76;--card:#fff;--line:#e4e4ea;--pass:#1a7f4b;--passbg:#dff5e9;--fail:#b3261e;--failbg:#fde4e1;--skip:#6b6b76;--skipbg:#ececf1}
@media(prefers-color-scheme:dark){:root{--bg:#141416;--fg:#ececf1;--muted:#9a9aa6;--card:#1d1d21;--line:#2f2f36;--pass:#5fd08f;--passbg:#173325;--fail:#ff8a80;--failbg:#3b1c1a;--skip:#9a9aa6;--skipbg:#2a2a30}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:980px;margin:0 auto;padding:48px 24px 96px}
h1{font-size:28px;margin:0 0 4px}
.sub{color:var(--muted);margin:0 0 32px}
.summary{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:40px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 24px;min-width:140px}
.stat b{display:block;font-size:30px}
.stat.pass b{color:var(--pass)}.stat.fail b{color:var(--fail)}.stat.skip b{color:var(--skip)}
section{margin-bottom:32px}
h2{font-size:17px;margin:0 0 8px}h2 small{color:var(--muted);font-weight:400;margin-left:6px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
td{padding:12px 16px;border-top:1px solid var(--line);vertical-align:top}
tr:first-child td{border-top:0}
td:first-child{width:64px}td.ms{width:90px;text-align:right;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.pill.pass{background:var(--passbg);color:var(--pass)}.pill.fail{background:var(--failbg);color:var(--fail)}.pill.skip{background:var(--skipbg);color:var(--skip)}
.kind{color:var(--muted);font-size:12px}
.note{color:var(--muted);font-size:13px}
pre.err{margin:8px 0 0;padding:10px 12px;background:var(--failbg);color:var(--fail);border-radius:8px;white-space:pre-wrap;word-break:break-word;font-size:12px}
code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.frames{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
figure img{width:100%;border-radius:6px;display:block}
figcaption{color:var(--muted);font-size:12px;margin-top:8px}
</style></head><body><main>
<h1>ae-mcp test drive</h1>
<p class="sub">${escapeHtml(state.prefix)} · ${new Date().toLocaleString()} · ${keep ? 'scratch items kept' : 'scratch items removed'}</p>
<div class="summary"><div class="stat pass"><b>${count('pass')}</b>passed</div><div class="stat fail"><b>${count('fail')}</b>failed</div><div class="stat skip"><b>${count('skip')}</b>skipped</div></div>
${frames ? `<section><h2>Rendered frames</h2><div class="frames">${frames}</div></section>` : ''}
${rows}
</main></body></html>`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
