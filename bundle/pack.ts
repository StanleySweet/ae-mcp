import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

/**
 * Assemble the `.mcpb`: a runnable server (esbuild inlines every dependency),
 * the manifest and the icon, zipped at the archive root.
 */
export async function packBundle(outDir: string): Promise<string> {
  const staging = join(outDir, 'staging');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  await build({
    entryPoints: [join(root, 'packages/server/src/index.ts')],
    outfile: join(staging, 'server/index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    loader: { '.md': 'text' },
  });

  cpSync(join(here, 'manifest.json'), join(staging, 'manifest.json'));
  cpSync(join(here, 'icon.png'), join(staging, 'icon.png'));

  const artifact = join(outDir, 'ae-mcp.mcpb');
  rmSync(artifact, { force: true });
  execFileSync('zip', ['-r', '-q', artifact, '.'], { cwd: staging });
  return artifact;
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const artifact = await packBundle(join(root, 'dist'));
  process.stdout.write(`packed ${artifact}\n`);
}
