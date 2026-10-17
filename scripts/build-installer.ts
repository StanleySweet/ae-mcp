import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the native Setup app: stages the built bridge payload/loader and the
 * `.mcpb` next to the Avalonia project, publishes a self-contained trimmed
 * macOS bundle, then wraps it into a `.app` and a `.dmg`.
 *
 * Assumes `bridge:build` and `bundle:pack` have already produced their outputs
 * (the `installer:build` npm script chains them before this).
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const appDir = join(root, 'apps/installer');
const project = join(appDir, 'AeMcpSetup/AeMcpSetup.csproj');
const resources = join(appDir, 'AeMcpSetup/Resources');
const outDir = join(appDir, 'dist');

const arch = process.env.AE_MCP_ARCH ?? 'arm64';
const rid = `osx-${arch}`;
const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

// 1. Stage payload/loader + mcpb where the app expects them at runtime.
mkdirSync(resources, { recursive: true });
cpSync(join(root, 'packages/bridge/dist/payload.jsx'), join(resources, 'payload.jsx'));
cpSync(join(root, 'packages/bridge/dist/loader.jsx'), join(resources, 'loader.jsx'));
cpSync(join(root, 'packages/bridge/dist/ae-mcp-panel.jsx'), join(resources, 'ae-mcp-panel.jsx'));
cpSync(join(root, 'dist/ae-mcp.mcpb'), join(resources, 'ae-mcp.mcpb'));

// 2. Publish a self-contained, trimmed macOS app.
const publishDir = join(outDir, 'publish', rid);
rmSync(publishDir, { recursive: true, force: true });
execFileSync(
  'dotnet',
  [
    'publish',
    project,
    '-c',
    'Release',
    '-r',
    rid,
    '--self-contained',
    'true',
    '-p:PublishTrimmed=true',
    `-p:Version=${version}`,
    '-o',
    publishDir,
  ],
  { stdio: 'inherit' },
);

// 3. Wrap into a .app and a .dmg.
execFileSync('bash', [join(appDir, 'build/app-bundle.sh'), publishDir, outDir, arch, version], {
  stdio: 'inherit',
});

process.stdout.write(`built ${outDir}/AE-MCP Setup-${version}-${arch}.dmg\n`);
