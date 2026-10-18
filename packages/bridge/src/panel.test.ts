import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, it, expect } from 'vitest';
import { build, PANEL_FILE } from './build.js';
import { MockAE, MockCompItem, MockFile, MockLayer, runInMockAE } from './mock-ae.js';

async function bridgeFiles(): Promise<{ home: string; panel: string; payload: string }> {
  const home = await mkdtemp(join(tmpdir(), 'ae-mcp-panel-'));
  const outDir = join(home, 'built');
  await build({ outDir });
  return {
    home,
    panel: readFileSync(join(outDir, PANEL_FILE), 'utf8'),
    payload: readFileSync(join(outDir, 'payload.jsx'), 'utf8'),
  };
}

function panelIn(ae: MockAE, source: string): vm.Context {
  return runInMockAE(source, ae);
}

function call(ctx: vm.Context, expression: string): unknown {
  return vm.runInContext(expression, ctx);
}

describe('Claude for After Effects.jsx build', () => {
  it('is written next to the payload and loads without a payload', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    // The panel must not need the bridge payload: a bare context with only the panel loads.
    expect(() => panelIn(ae, panel)).not.toThrow();
    expect(panel).toContain('function aemcpPanelContextText');
  });
});

describe('aemcpPanelContextText', () => {
  it('reports the project, the active comp and the selected layers with index, name and type', async () => {
    const { home, payload, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const setup = runInMockAE(payload, ae);
    call(setup, 'AEMCP.invoke("comp.create", {name: "Main", width: 800, height: 600, fps: 24, duration: 5}, null)');
    call(setup, 'AEMCP.invoke("layer.add_text", {comp: "Main", text: "Hi"}, null)');
    call(setup, 'AEMCP.invoke("layer.add_solid", {comp: "Main", name: "Back"}, null)');
    const comp = ae.project.item(1) as MockCompItem;
    ae.project.activeItem = comp;
    comp.selectedLayers = [comp.layer(1) as MockLayer, comp.layer(2) as MockLayer];
    ae.project.file = new MockFile(ae, join(home, 'Shot.aep'));

    const text = call(panelIn(ae, panel), 'aemcpPanelContextText()') as string;

    expect(text.split('\n')[0]).toBe('Project: Shot.aep');
    expect(text).toContain('Active composition: Main (800x600, 5 s, 24 fps)');
    expect(text).toContain('  1. ' + (comp.layer(1) as MockLayer).name + ' (text)');
    expect(text).toContain('  2. Back (av)');
  });

  it('says so when no composition is active and never throws', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const text = call(panelIn(ae, panel), 'aemcpPanelContextText()') as string;
    expect(text).toContain('Active composition: none');
  });
});

describe('aemcpPanelCopyCommand', () => {
  it('quotes the text so the shell prints it back unchanged', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const ctx = panelIn(ae, panel);
    const text = "Project: it's $HOME `date`\n  1. \"quoted\" \\ back";
    const command = call(ctx, `aemcpPanelCopyCommand(${JSON.stringify(text)})`) as string;

    expect(command.endsWith(' | pbcopy')).toBe(true);
    // Run the printf half in a shell and compare: the quoting is what the clipboard receives.
    const printed = execFileSync('/bin/sh', ['-c', command.replace(' | pbcopy', '')], { encoding: 'utf8' });
    expect(printed).toBe(text);
  });
});

describe('aemcpPanelHistoryEntries', () => {
  it('returns the last 20 steps newest first and skips a torn line', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const lines: string[] = [];
    for (let i = 1; i <= 25; i += 1) {
      lines.push(JSON.stringify({ seq: i, op: 'op.' + i, time: '2026-10-17T00:00:' + i, ok: i % 2 === 0 }));
    }
    lines.splice(10, 0, '{"seq": 99, "op": "torn');
    ae.fs.set(join(home, '.ae-mcp', 'history.jsonl'), lines.join('\n') + '\n');

    const entries = call(panelIn(ae, panel), 'aemcpPanelHistoryEntries()') as { op: string; ok: boolean }[];

    expect(entries.length).toBe(20);
    expect(entries[0].op).toBe('op.25');
    expect(entries[19].op).toBe('op.6');
    expect(entries[0].ok).toBe(false);
  });

  it('is empty when there is no history yet', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    expect(call(panelIn(ae, panel), 'aemcpPanelHistoryEntries().length')).toBe(0);
  });
});

describe('aemcpPanelOpen', () => {
  // A ScriptUI Panels script gets its dock panel as `this`; it must build into it, not a palette.
  it('builds into the dock panel it is given and opens no palette', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const ctx = panelIn(ae, panel);

    const result = call(
      ctx,
      `(function () {
        function Panel() { this.items = []; this.layout = { done: false, layout: function () { this.done = true; } }; }
        Panel.prototype.add = function (type) {
          var control = { type: type, removeAll: function () {}, add: function () {} };
          this.items.push(control);
          return control;
        };
        this.Panel = Panel;
        var palettes = 0;
        this.Window = function () { palettes += 1; };
        var host = new Panel();
        aemcpPanelOpen(host);
        return [host.items.length, host.layout.done, palettes];
      })()`,
    ) as [number, boolean, number];

    expect(result[0]).toBeGreaterThan(0);
    expect(result[1]).toBe(true);
    expect(result[2]).toBe(0);
  });
});

describe('settings helpers', () => {
  it('parses a settings file and keeps unknown keys', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const ctx = panelIn(ae, panel);
    const parsed = call(ctx, 'aemcpPanelSettingsParse(\'{"backupMode":"off","futureKey":{"a":1}}\')') as Record<string, unknown>;
    expect(parsed.backupMode).toBe('off');
    expect(parsed.futureKey).toEqual({ a: 1 });
    expect(call(ctx, 'aemcpPanelSettingsParse(null)')).toEqual({});
    expect(call(ctx, 'aemcpPanelSettingsParse("  \\n")')).toEqual({});
  });

  it('rejects content that is not a JSON object and never runs it', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const ctx = panelIn(ae, panel);
    expect(call(ctx, 'aemcpPanelSettingsParse("[1,2]")')).toBeNull();
    expect(call(ctx, 'aemcpPanelSettingsParse("{\\"backupMode\\": ")')).toBeNull();
    expect(call(ctx, 'aemcpPanelSettingsParse("ae.fs.set(1)")')).toBeNull();
    expect(call(ctx, 'aemcpPanelSettingsParse("{\\"a\\": 1} junk")')).toBeNull();
  });

  it('merges the four panel keys into the file and keeps every other key', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const ctx = panelIn(ae, panel);
    const merged = call(
      ctx,
      'aemcpPanelSettingsMerge({"backupMode":"single","other":"keep","incrementBeforeDestructive":true},' +
        '{"backupMode":"increment","backupKeep":3,"readOnly":true,"evalEnabled":false})',
    ) as Record<string, unknown>;
    expect(merged).toEqual({
      backupMode: 'increment',
      backupKeep: 3,
      readOnly: true,
      evalEnabled: false,
      other: 'keep',
      incrementBeforeDestructive: true,
    });
  });

  it('rejects an unknown backup mode or a keep count below 1', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const ctx = panelIn(ae, panel);
    expect(call(ctx, 'aemcpPanelSettingsError({backupMode: "full", backupKeep: 5, readOnly: false, evalEnabled: false})')).not.toBeNull();
    expect(call(ctx, 'aemcpPanelSettingsError({backupMode: "single", backupKeep: 0, readOnly: false, evalEnabled: false})')).not.toBeNull();
    expect(call(ctx, 'aemcpPanelSettingsError({backupMode: "single", backupKeep: NaN, readOnly: false, evalEnabled: false})')).not.toBeNull();
    expect(call(ctx, 'aemcpPanelSettingsError({backupMode: "increment", backupKeep: 5, readOnly: false, evalEnabled: true})')).toBeNull();
  });

  it('saves to ~/.ae-mcp/settings.json, keeps unknown keys, and leaves an invalid file alone', async () => {
    const { home, panel } = await bridgeFiles();
    const ae = new MockAE();
    ae.env.HOME = home;
    const path = join(home, '.ae-mcp', 'settings.json');
    ae.fs.set(path, '{"keepMe": "yes", "backupMode": "single"}');
    const ctx = panelIn(ae, panel);

    const error = call(ctx, 'aemcpPanelSettingsSave({backupMode: "off", backupKeep: 5, readOnly: true, evalEnabled: true})');
    expect(error).toBeNull();
    const saved = JSON.parse(ae.fs.get(path) as string) as Record<string, unknown>;
    expect(saved).toEqual({ keepMe: 'yes', backupMode: 'off', backupKeep: 5, readOnly: true, evalEnabled: true });

    ae.fs.set(path, '{"backupMode": ');
    const refused = call(ctx, 'aemcpPanelSettingsSave({backupMode: "single", backupKeep: 5, readOnly: false, evalEnabled: false})') as string;
    expect(refused).toContain('not valid JSON');
    expect(ae.fs.get(path)).toBe('{"backupMode": ');
  });
});
