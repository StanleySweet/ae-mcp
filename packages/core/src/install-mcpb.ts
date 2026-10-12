import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { ClaudeDesktopInstall } from './claude-discovery.js';
import type { InstallerCheck } from './install-payload.js';

const execFileAsync = promisify(execFile);

/** Opens `path` with Claude Desktop. Returns whether it succeeded. */
export type OpenWithClaude = (path: string) => Promise<boolean>;

/** Arguments for `open` that hand a bundle to Claude Desktop (macOS). */
export function claudeOpenArgs(path: string): string[] {
  return ['-a', 'Claude', path];
}

export const openWithClaude: OpenWithClaude = async (path) => {
  try {
    await execFileAsync('open', claudeOpenArgs(path));
    return true;
  } catch {
    return false;
  }
};

export interface HandMcpbOptions {
  mcpbPath: string;
  claude: ClaudeDesktopInstall | null;
  openFile?: OpenWithClaude;
}

export interface HandMcpbResult extends InstallerCheck {
  handed: boolean;
  path: string;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Hands the bundled `.mcpb` to Claude Desktop so it shows its install prompt.
 * Returns a `{check, status, fix}` row; idempotent in the sense that installing
 * the same bundle again just reopens the prompt.
 */
export async function handMcpbToClaude(
  options: HandMcpbOptions,
): Promise<HandMcpbResult> {
  if (options.claude === null) {
    return {
      check: 'claude_extension',
      status: 'fail',
      handed: false,
      path: options.mcpbPath,
      fix: 'Install Claude Desktop from https://claude.ai/download and sign in.',
    };
  }
  if (!(await fileExists(options.mcpbPath))) {
    return {
      check: 'claude_extension',
      status: 'fail',
      handed: false,
      path: options.mcpbPath,
      fix: `The ae-mcp bundle is missing at ${options.mcpbPath}; rebuild it with npm run bundle:pack.`,
    };
  }
  const open = options.openFile ?? openWithClaude;
  if (!(await open(options.mcpbPath))) {
    return {
      check: 'claude_extension',
      status: 'fail',
      handed: false,
      path: options.mcpbPath,
      fix: 'Open Claude Desktop, then Settings > Extensions > Advanced > Install extension and pick ae-mcp.mcpb.',
    };
  }
  return { check: 'claude_extension', status: 'ok', handed: true, path: options.mcpbPath };
}
