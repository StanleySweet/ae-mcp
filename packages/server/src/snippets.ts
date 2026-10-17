import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OperationRegistry, validateOperationArgs } from './operations.js';
import { NOT_REPLAYABLE } from './replay.js';

/**
 * User snippets and templates: JSON files in `<root>/snippets/` (default ~/.ae-mcp/snippets).
 *
 *   expression: {"kind": "expression", "name": "my_wobble", "description": "...", "expression": "..."}
 *   template:   {"kind": "template", "name": "my_title", "description": "...",
 *                "ops": [{"op": "layer.rename", "args": {"index": 1, "name": "{{title}}"}}]}
 *
 * A `{{key}}` string in a template is filled from the `args` of `template.user`.
 */
export const SNIPPET_DIR = 'snippets';
export const TEMPLATE_OP = 'template.user';

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const TEMPLATE_BLOCKED = ['batch.run', TEMPLATE_OP, ...NOT_REPLAYABLE];
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

export interface UserExpression {
  name: string;
  description: string;
  expression: string;
}

export interface UserTemplateOp {
  op: string;
  args: Record<string, unknown>;
}

export interface UserTemplate {
  name: string;
  description: string;
  ops: UserTemplateOp[];
}

export interface SnippetProblem {
  file: string;
  reason: string;
}

export interface UserSnippets {
  expressions: UserExpression[];
  templates: UserTemplate[];
  problems: SnippetProblem[];
}

function builtinExpressionNames(operations: OperationRegistry): string[] {
  const schema = operations.get('expression.snippet')?.schema as
    | { snippet?: { enum?: unknown } }
    | undefined;
  return Array.isArray(schema?.snippet?.enum) ? (schema.snippet.enum as string[]) : [];
}

/** Checks each argument against the operation schema; `{{placeholder}}` strings skip the type check. */
function checkArgs(
  definition: { schema: Record<string, unknown>; required?: string[] },
  args: Record<string, unknown>,
): string | null {
  for (const name of definition.required ?? []) {
    if (args[name] === undefined) {
      return `missing required argument '${name}'`;
    }
  }
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.includes('{{')) {
      if (!(key in definition.schema)) {
        return `unknown argument '${key}'`;
      }
      continue;
    }
    const checked = validateOperationArgs(definition.schema, { [key]: value });
    if (!checked.ok) {
      return checked.message;
    }
  }
  return null;
}

function validateFile(
  parsed: unknown,
  operations: OperationRegistry,
  taken: Set<string>,
): { ok: true; item: UserExpression | UserTemplate; kind: 'expression' | 'template' } | { ok: false; reason: string } {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'the file must hold one JSON object' };
  }
  const record = parsed as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    return { ok: false, reason: 'name must be lowercase letters, digits and underscores, starting with a letter' };
  }
  if (taken.has(name)) {
    return { ok: false, reason: `name '${name}' is already used by a built-in or another file` };
  }
  const description = record.description;
  if (typeof description !== 'string' || description.trim() === '') {
    return { ok: false, reason: 'description must be a non-empty string' };
  }
  if (record.kind === 'expression') {
    if (typeof record.expression !== 'string' || record.expression.trim() === '') {
      return { ok: false, reason: 'expression must be a non-empty string' };
    }
    return { ok: true, kind: 'expression', item: { name, description, expression: record.expression } };
  }
  if (record.kind === 'template') {
    if (!Array.isArray(record.ops) || record.ops.length === 0) {
      return { ok: false, reason: 'ops must be a non-empty array' };
    }
    const ops: UserTemplateOp[] = [];
    for (let i = 0; i < record.ops.length; i += 1) {
      const step = record.ops[i] as Record<string, unknown> | null;
      if (typeof step !== 'object' || step === null || typeof step.op !== 'string') {
        return { ok: false, reason: `ops[${i}] must be an object with an op name` };
      }
      if (TEMPLATE_BLOCKED.includes(step.op)) {
        return { ok: false, reason: `ops[${i}] (${step.op}) cannot run inside a template` };
      }
      const definition = operations.get(step.op);
      if (definition === undefined) {
        return { ok: false, reason: `ops[${i}] names an unknown operation '${step.op}'` };
      }
      const args = step.args === undefined ? {} : step.args;
      if (typeof args !== 'object' || args === null || Array.isArray(args)) {
        return { ok: false, reason: `ops[${i}].args must be an object` };
      }
      const problem = checkArgs(definition, args as Record<string, unknown>);
      if (problem !== null) {
        return { ok: false, reason: `ops[${i}] (${step.op}): ${problem}` };
      }
      ops.push({ op: step.op, args: args as Record<string, unknown> });
    }
    return { ok: true, kind: 'template', item: { name, description, ops } };
  }
  return { ok: false, reason: "kind must be 'expression' or 'template'" };
}

/**
 * Reads and validates every `.json` file in the snippets folder. A missing folder is
 * not an error. A file that fails validation is skipped and reported with its reason.
 */
export function loadUserSnippets(root: string, operations: OperationRegistry): UserSnippets {
  const result: UserSnippets = { expressions: [], templates: [], problems: [] };
  let files: string[];
  try {
    files = readdirSync(join(root, SNIPPET_DIR)).filter((file) => file.endsWith('.json')).sort();
  } catch {
    return result;
  }
  const taken = new Set<string>(builtinExpressionNames(operations));
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(root, SNIPPET_DIR, file), 'utf8'));
    } catch (error) {
      result.problems.push({
        file,
        reason: `not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }
    const outcome = validateFile(parsed, operations, taken);
    if (!outcome.ok) {
      result.problems.push({ file, reason: outcome.reason });
      continue;
    }
    taken.add(outcome.item.name);
    if (outcome.kind === 'expression') {
      result.expressions.push(outcome.item as UserExpression);
    } else {
      result.templates.push(outcome.item as UserTemplate);
    }
  }
  return result;
}

/** Fills `{{key}}` placeholders from `values`; a string that is only one placeholder keeps the value's type. */
export function expandTemplate(
  template: UserTemplate,
  values: Record<string, unknown>,
): { ok: true; ops: UserTemplateOp[] } | { ok: false; message: string } {
  let missing: string | null = null;
  const fill = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const whole = /^\{\{(\w+)\}\}$/.exec(value);
      if (whole) {
        const key = whole[1]!;
        if (!(key in values)) {
          missing ??= key;
          return value;
        }
        return values[key];
      }
      return value.replace(PLACEHOLDER, (_, key: string) => {
        if (!(key in values)) {
          missing ??= key;
          return '';
        }
        return String(values[key]);
      });
    }
    if (Array.isArray(value)) {
      return value.map(fill);
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, fill(inner)]));
    }
    return value;
  };
  const ops = template.ops.map((step) => ({ op: step.op, args: fill(step.args) as Record<string, unknown> }));
  if (missing !== null) {
    return { ok: false, message: `template '${template.name}' needs the argument '${missing}'` };
  }
  return { ok: true, ops };
}

/**
 * Rewrites an ae_do call that names a user item: `template.user` becomes `batch.run` with
 * the expanded steps, and `expression.snippet` with a user name becomes `expression.set`.
 */
export function resolveUserCall(
  op: string,
  args: Record<string, unknown> | undefined,
  snippets: UserSnippets,
): { ok: true; op: string; args: Record<string, unknown> | undefined } | { ok: false; message: string } {
  if (op === TEMPLATE_OP) {
    const name = args?.name;
    const template = snippets.templates.find((item) => item.name === name);
    if (template === undefined) {
      return { ok: false, message: `no user template named '${String(name)}'` };
    }
    const values = (args?.args ?? {}) as Record<string, unknown>;
    const expanded = expandTemplate(template, values);
    if (!expanded.ok) {
      return { ok: false, message: expanded.message };
    }
    return { ok: true, op: 'batch.run', args: { ops: expanded.ops } };
  }
  if (op === 'expression.snippet' && typeof args?.snippet === 'string') {
    const snippet = args.snippet;
    const expression = snippets.expressions.find((item) => item.name === snippet);
    if (expression !== undefined) {
      return {
        ok: true,
        op: 'expression.set',
        args: { comp: args.comp, index: args.index ?? 1, property: args.property, value: expression.expression },
      };
    }
  }
  return { ok: true, op, args };
}

/** Adds the user snippet names to `expression.snippet` and registers `template.user`, when any exist. */
export function registerUserSnippets(operations: OperationRegistry, snippets: UserSnippets): void {
  if (snippets.expressions.length > 0) {
    const snippet = operations.get('expression.snippet');
    if (snippet !== undefined) {
      const schema = snippet.schema as Record<string, { enum?: string[]; type?: string }>;
      const names = snippets.expressions.map((item) => item.name);
      const list = names.join(', ');
      operations.register({
        ...snippet,
        description: `${snippet.description} User snippets (from ~/.ae-mcp/snippets): ${list}.`,
        schema: {
          ...snippet.schema,
          snippet: { ...schema.snippet, enum: [...(schema.snippet?.enum ?? []), ...names] },
        },
      });
    }
  }
  if (snippets.templates.length > 0) {
    const names = snippets.templates.map((item) => item.name);
    operations.register({
      name: TEMPLATE_OP,
      category: 'template',
      description: `Run a user template from ~/.ae-mcp/snippets: ${snippets.templates
        .map((item) => `${item.name} (${item.description})`)
        .join('; ')}. args fills its {{placeholders}}.`,
      readOnly: false,
      destructive: false,
      schema: { name: { type: 'string', enum: names }, args: { type: 'object' } },
      required: ['name'],
    });
  }
}
