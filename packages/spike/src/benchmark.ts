import { send, waitForResult } from './inbox.js';
import { createOsaScriptDispatcher } from './osascript.js';
import { summarize, type Stats } from './stats.js';

const COUNT = Number(process.env.COUNT ?? 100);
const COMMAND = 'bench';
const RESULT_TIMEOUT_MS = 10_000;

async function runTransportA(): Promise<Stats> {
  const latencies: number[] = [];
  let failures = 0;
  for (let i = 0; i < COUNT; i++) {
    const started = Date.now();
    const id = send(COMMAND);
    try {
      const result = await waitForResult(id, RESULT_TIMEOUT_MS);
      if (result !== COMMAND) {
        failures += 1;
      } else {
        latencies.push(Date.now() - started);
      }
    } catch {
      failures += 1;
    }
  }
  return summarize(latencies, failures);
}

async function runTransportB(): Promise<Stats> {
  const dispatch = createOsaScriptDispatcher();
  const latencies: number[] = [];
  let failures = 0;
  for (let i = 0; i < COUNT; i++) {
    const started = Date.now();
    try {
      const result = await dispatch.evalScript('app.exitCode = 0;');
      if (result !== '0') {
        failures += 1;
      } else {
        latencies.push(Date.now() - started);
      }
    } catch {
      failures += 1;
    }
  }
  return summarize(latencies, failures);
}

function format(name: string, stats: Stats): string {
  return [
    `${name}: count=${stats.count} ok=${stats.ok} failed=${stats.failed}`,
    `  mean=${stats.meanMs.toFixed(1)}ms p50=${stats.p50Ms.toFixed(1)}ms p95=${stats.p95Ms.toFixed(1)}ms max=${stats.maxMs.toFixed(1)}ms`,
  ].join('\n');
}

async function main(): Promise<void> {
  const a = await runTransportA();
  const b = await runTransportB();
  console.log(`100 round trips (COUNT=${COUNT})`);
  console.log(format('A startup-loader', a));
  console.log(format('B osascript     ', b));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});