import { z } from 'zod';

export const operationCategories = [
  'project',
  'comp',
  'layer',
  'property',
  'keyframe',
  'expression',
  'effect',
  'preset',
  'marker',
  'mask',
  'shape',
  'text',
  'audio',
  'render',
  'font',
  'command',
  'batch',
  'eval',
] as const;

export const operationCategorySchema = z.enum(operationCategories);

export const operationDefinitionSchema = z.object({
  name: z.string(),
  category: operationCategorySchema,
  description: z.string(),
  readOnly: z.boolean(),
  schema: z.record(z.string(), z.unknown()),
});

export type OperationCategory = z.infer<typeof operationCategorySchema>;
export type OperationDefinition = z.infer<typeof operationDefinitionSchema>;
