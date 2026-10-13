import { realpathSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

const ENTRIES = [
  { entry: 'main.ts', outfile: 'main.js', platform: 'node', external: ['electron'] },
  { entry: 'preload.ts', outfile: 'preload.js', platform: 'node', external: ['electron'] },
  { entry: 'renderer.ts', outfile: 'renderer.js', platform: 'browser', external: [] },
] as const;

/** Bundles the Electron main, preload and renderer into self-contained JS in `outDir`
(esbuild inlines `@ae-mcp/core`, whose package exports TypeScript source). */
export async function bundleInstaller(outDir: string): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all(
    ENTRIES.map(({ entry, outfile, platform, external }) =>
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
  );
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await bundleInstaller(join(here, 'dist'));
  process.stdout.write('bundled installer to dist/\n');
}
