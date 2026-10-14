import { realpathSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

/** Where `bridge:build` writes `payload.jsx` + `loader.jsx`. */
const DEFAULT_BRIDGE_SOURCES = join(here, '..', '..', 'packages', 'bridge', 'dist');

const ENTRIES = [
  { entry: 'main.ts', outfile: 'main.js', platform: 'node', external: ['electron'] },
  { entry: 'preload.ts', outfile: 'preload.js', platform: 'node', external: ['electron'] },
  { entry: 'renderer.ts', outfile: 'renderer.js', platform: 'browser', external: [] },
] as const;

/** The bridge sources the app installs, copied next to the bundle so
`main.ts` reads them from the packaged `dist/`. */
const BRIDGE_SOURCES = ['payload.jsx', 'loader.jsx'] as const;

/**
 * Bundles the Electron main, preload and renderer into self-contained JS in
 * `outDir` (esbuild inlines `@ae-mcp/core`, whose package exports TypeScript
 * source), then copies the built bridge payload and loader alongside them.
 */
export async function bundleInstaller(
  outDir: string,
  sources: string = DEFAULT_BRIDGE_SOURCES,
): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    ...ENTRIES.map(({ entry, outfile, platform, external }) =>
      build({
        entryPoints: [join(here, 'src', entry)],
        outfile: join(outDir, outfile),
        bundle: true,
        platform,
        format: 'esm',
        target: platform === 'browser' ? 'es2022' : 'node22',
        external: [...external],
      }),
    ),
    ...BRIDGE_SOURCES.map((name) => copyFile(join(sources, name), join(outDir, name))),
  ]);
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await bundleInstaller(join(here, 'dist'));
  process.stdout.write('bundled installer to dist/\n');
}
