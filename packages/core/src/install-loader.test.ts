import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import type { AEInstall } from './ae-discovery.js';
import { elevatedCopyCommand, installLoader, loaderStartupDir } from './install-loader.js';

async function fakeInstall(withScripts = false): Promise<{ install: AEInstall; folder: string }> {
  const folder = await mkdtemp(join(tmpdir(), 'ae-mcp-ae-'));
  const appName = 'Adobe After Effects 2026';
  const appPath = join(folder, `${appName}.app`);
  await mkdir(appPath, { recursive: true });
  if (withScripts) {
    await mkdir(join(folder, 'Scripts'), { recursive: true });
  }
  return { install: { appName, year: 2026, path: appPath }, folder };
}

const LOADER = 'var AEMCP_LOADER = true;';

describe('loaderStartupDir', () => {
  it('is the Scripts/Startup folder next to the app bundle', async () => {
    const { install, folder } = await fakeInstall();
    expect(loaderStartupDir(install)).toBe(join(folder, 'Scripts', 'Startup'));
  });
});

describe('elevatedCopyCommand', () => {
  it('quotes the source and destination and creates the folder', () => {
    expect(elevatedCopyCommand('/tmp/a file.jsx', "/Applications/It's/Scripts/Startup/l.jsx")).toBe(
      "mkdir -p '/Applications/It'\\''s/Scripts/Startup' && cp '/tmp/a file.jsx' '/Applications/It'\\''s/Scripts/Startup/l.jsx'",
    );
  });
});

describe('installLoader', () => {
  it('writes the loader into Scripts/Startup', async () => {
    const { install, folder } = await fakeInstall();

    const result = await installLoader({ install, loader: LOADER });

    expect(result).toMatchObject({
      check: 'bridge_loader',
      status: 'ok',
      changed: true,
      path: join(folder, 'Scripts', 'Startup', 'ae-mcp-loader.jsx'),
    });
    expect(await readFile(join(folder, 'Scripts', 'Startup', 'ae-mcp-loader.jsx'), 'utf8')).toBe(
      LOADER,
    );
  });

  it('is idempotent: a second run with the same loader changes nothing', async () => {
    const { install } = await fakeInstall();

    await installLoader({ install, loader: LOADER });
    const second = await installLoader({ install, loader: LOADER });

    expect(second).toMatchObject({ status: 'ok', changed: false });
  });

  it('rewrites when the loader changes', async () => {
    const { install, folder } = await fakeInstall();

    await installLoader({ install, loader: LOADER });
    const second = await installLoader({ install, loader: `${LOADER}\n// v2` });

    expect(second.changed).toBe(true);
    expect(await readFile(join(folder, 'Scripts', 'Startup', 'ae-mcp-loader.jsx'), 'utf8')).toContain(
      '// v2',
    );
  });

  it('takes an override file name', async () => {
    const { install, folder } = await fakeInstall();

    await installLoader({ install, loader: LOADER, fileName: 'custom.jsx' });

    expect(await readFile(join(folder, 'Scripts', 'Startup', 'custom.jsx'), 'utf8')).toBe(LOADER);
  });

  it('falls back to manual text when the folder cannot be created', async () => {
    const { install, folder } = await fakeInstall();
    await writeFile(join(folder, 'Scripts'), 'a file blocks the folder');
    const elevatedWrite = vi.fn(async () => true);

    const result = await installLoader({ install, loader: LOADER, elevatedWrite });

    expect(result.status).toBe('fail');
    expect(result.fix).toBeTruthy();
    expect(result.manual).toBeTruthy();
    expect(elevatedWrite).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform === 'win32')(
    'uses admin elevation when the folder is not writable',
    async () => {
      const { install, folder } = await fakeInstall(true);
      const scriptsDir = join(folder, 'Scripts');
      await chmod(scriptsDir, 0o555);
      const elevatedWrite = vi.fn(async () => true);
      try {
        const result = await installLoader({ install, loader: LOADER, elevatedWrite });

        expect(result).toMatchObject({ status: 'ok', changed: true });
        expect(elevatedWrite).toHaveBeenCalledWith(
          join(scriptsDir, 'Startup', 'ae-mcp-loader.jsx'),
          LOADER,
        );
      } finally {
        await chmod(scriptsDir, 0o755);
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'reports failure with manual text when elevation is declined',
    async () => {
      const { install, folder } = await fakeInstall(true);
      const scriptsDir = join(folder, 'Scripts');
      await chmod(scriptsDir, 0o555);
      const elevatedWrite = vi.fn(async () => false);
      try {
        const result = await installLoader({ install, loader: LOADER, elevatedWrite });

        expect(result.status).toBe('fail');
        expect(result.fix).toBeTruthy();
        expect(result.manual).toBeTruthy();
        expect(elevatedWrite).toHaveBeenCalledOnce();
      } finally {
        await chmod(scriptsDir, 0o755);
      }
    },
  );
});
