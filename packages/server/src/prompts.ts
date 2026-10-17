import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// MCP prompts (#232): ready-made starting points for common jobs, shown as slash
// commands. Each prompt's text is built from the recipe sections of the ae skill
// (skills/ae/SKILL.md), so the skill stays the single source of the steps.

/** The body of one `## heading` section of the skill, without the heading line. */
export function recipeSection(skill: string, heading: string): string {
  const lines = skill.split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start < 0) {
    throw new Error(`ae skill has no section '## ${heading}'`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i]!.startsWith('## ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join('\n').trim();
}

interface PromptRecipe {
  name: string;
  description: string;
  args: Record<string, z.ZodString | z.ZodOptional<z.ZodString>>;
  /** Skill sections, in order, whose text the prompt carries. */
  sections: string[];
  /** The job, stated for the model, given the argument values. */
  task: (args: Record<string, string | undefined>) => string;
}

const optional = (description: string): z.ZodOptional<z.ZodString> => z.string().describe(description).optional();

export const PROMPT_RECIPES: PromptRecipe[] = [
  {
    name: 'build-lower-third',
    description: 'Add a lower-third title to a composition.',
    args: {
      title: z.string().describe('The main line of the lower third.'),
      subtitle: optional('The second line, optional.'),
      comp: optional('Composition name; the active comp when omitted.'),
    },
    sections: ['Lower third, title card and transitions'],
    task: (args) =>
      `Add a lower third reading "${args.title}"${args.subtitle ? ` with subtitle "${args.subtitle}"` : ''}` +
      `${args.comp ? ` to the composition "${args.comp}"` : ' to the active composition'}. ` +
      'Inspect the comp first, then build it with the template and restyle only what the user asked for.',
  },
  {
    name: 'audit-project',
    description: 'Check the open project and a composition for problems, then report.',
    args: {
      comp: optional('Composition name to audit; the active comp when omitted.'),
    },
    sections: ['Before you start', 'Check your work'],
    task: (args) =>
      `Audit ${args.comp ? `the composition "${args.comp}"` : 'the active composition'} and the open project. ` +
      'Report what is wrong (missing sources, expression-driven properties, unnamed layers, unsaved project) ' +
      'and change nothing until the user agrees.',
  },
  {
    name: 'seamless-loop',
    description: 'Make a layer loop without a visible seam.',
    args: {
      comp: optional('Composition name; the active comp when omitted.'),
      index: z.string().describe('Layer index to loop, as a number.'),
    },
    sections: ['Parallax loop', 'Keyframes or expressions'],
    task: (args) =>
      `Make layer ${args.index} in ${args.comp ? `the composition "${args.comp}"` : 'the active composition'} loop seamlessly. ` +
      'Read the layer and its existing keyframes or expressions first, then choose the loop method the recipe describes.',
  },
  {
    name: 'title-sequence',
    description: 'Build a short title sequence: a layered title card with transitions.',
    args: {
      title: z.string().describe('The title text.'),
      comp: optional('Composition name; the active comp when omitted.'),
    },
    sections: ['Build a layered scene', 'Lower third, title card and transitions', 'Polish'],
    task: (args) =>
      `Build a title sequence reading "${args.title}" in ${args.comp ? `the composition "${args.comp}"` : 'the active composition'}. ` +
      'Build the layers by name, add the title card, then add one transition and a look only where the sequence needs them.',
  },
];

/** Registers every prompt recipe. `skill` is the text of skills/ae/SKILL.md. */
export function registerPrompts(server: McpServer, options: { skill: string }): void {
  for (const recipe of PROMPT_RECIPES) {
    server.registerPrompt(
      recipe.name,
      { description: recipe.description, argsSchema: recipe.args },
      (args) => {
        const values = args as Record<string, string | undefined>;
        const steps = recipe.sections.map((heading) => recipeSection(options.skill, heading)).join('\n\n');
        const text = `${recipe.task(values)}\n\nFollow the ae skill recipes below. Use match names and the ae-mcp tools; read before you write.\n\n${steps}`;
        return { messages: [{ role: 'user', content: { type: 'text', text } }] };
      },
    );
  }
}
