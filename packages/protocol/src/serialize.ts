import { z } from 'zod';

export const itemTypeSchema = z.enum(['Composition', 'Folder', 'Footage']);

export const itemSummarySchema = z.object({
  id: z.number(),
  name: z.string(),
  type: itemTypeSchema,
  parentFolderId: z.number(),
  parentFolderName: z.string(),
  label: z.number(),
  comment: z.string(),
});

export const compItemSchema = itemSummarySchema.extend({
  type: z.literal('Composition'),
  width: z.number(),
  height: z.number(),
  pixelAspect: z.number(),
  frameRate: z.number(),
  duration: z.number(),
  bgColor: z.array(z.number()).length(3),
  numLayers: z.number(),
  workAreaStart: z.number(),
  workAreaDuration: z.number(),
  motionBlur: z.boolean(),
});

export const projectInfoSchema = z.object({
  file: z.string().nullable(),
  numItems: z.number(),
  bitsPerChannel: z.number(),
  activeItem: itemSummarySchema.nullable(),
  items: z.array(itemSummarySchema),
});

export type ItemType = z.infer<typeof itemTypeSchema>;
export type ItemSummary = z.infer<typeof itemSummarySchema>;
export type CompItemInfo = z.infer<typeof compItemSchema>;
export type ProjectInfo = z.infer<typeof projectInfoSchema>;