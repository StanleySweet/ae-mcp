// Checks ae_render omTemplate/rsTemplate against the templates the user's After Effects
// has (E16-2). Names are localised, so the list comes from the bridge, never from English.
import { makeError, type ResultMessage } from '@ae-mcp/protocol';
import { closeNames } from './operations.js';

/** What the `render.templates` bridge op returns. */
export interface RenderTemplates {
  outputModule: string[];
  renderSettings: string[];
}

/** The template arguments of ae_render that this check reads. */
export interface TemplateArgs {
  comp?: string | number;
  omTemplate?: string;
  rsTemplate?: string;
}

/**
 * Returns an INVALID_ARGS error body when a template name is not in the list, with the
 * close names. Returns null when every name is known, or when no template was given. When
 * the bridge cannot list the templates, the check is skipped so a lookup failure never
 * blocks a render; aerender then reports the name itself.
 */
export async function checkRenderTemplates(
  args: TemplateArgs,
  read: (comp: string | number | undefined) => Promise<ResultMessage>,
): Promise<ReturnType<typeof makeError> | null> {
  if (args.omTemplate === undefined && args.rsTemplate === undefined) {
    return null;
  }
  const listed = await read(args.comp);
  if (!listed.ok) {
    return null;
  }
  const templates = listed.result as RenderTemplates;
  const checks: [string, string | undefined, string[]][] = [
    ['omTemplate', args.omTemplate, templates.outputModule ?? []],
    ['rsTemplate', args.rsTemplate, templates.renderSettings ?? []],
  ];
  for (const [field, value, known] of checks) {
    if (value !== undefined && !known.includes(value)) {
      const closest = closeNames(known, value);
      const hint = closest.length > 0 ? ` (did you mean ${closest.map((name) => `"${name}"`).join(', ')}?)` : '';
      return makeError('INVALID_ARGS', `unknown ${field} "${value}"${hint}`, {
        field,
        closest,
        available: known,
      });
    }
  }
  return null;
}
