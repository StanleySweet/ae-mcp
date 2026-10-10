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

export const keyframeSchema = z.object({
  time: z.number(),
  value: z.unknown(),
});

export const propertySchema = z.object({
  name: z.string(),
  matchName: z.string(),
  value: z.unknown().optional(),
  expression: z.string().optional(),
  keyframes: z.array(keyframeSchema).optional(),
});

export interface PropertyGroupNode {
  name: string;
  matchName: string;
  properties: z.infer<typeof propertySchema>[];
  groups: PropertyGroupNode[];
}

export const propertyGroupSchema: z.ZodType<PropertyGroupNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    matchName: z.string(),
    properties: z.array(propertySchema),
    groups: z.array(propertyGroupSchema),
  }),
);

export const effectSchema = z.object({
  name: z.string(),
  matchName: z.string(),
  enabled: z.boolean(),
  properties: z.array(propertySchema),
});

export const textSchema = z.object({
  text: z.string(),
  fontSize: z.number(),
  font: z.string(),
  fillColor: z.array(z.number()).length(3),
});

export const layerSchema = z.object({
  index: z.number(),
  id: z.number().nullable(),
  name: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  solo: z.boolean(),
  shy: z.boolean(),
  locked: z.boolean(),
  inPoint: z.number(),
  outPoint: z.number(),
  startTime: z.number(),
  stretch: z.number(),
  parentIndex: z.number().nullable(),
  label: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  hasVideo: z.boolean().optional(),
  hasAudio: z.boolean().optional(),
  threeDLayer: z.boolean().optional(),
  sourceId: z.number().nullable().optional(),
  sourceName: z.string().nullable().optional(),
  transform: propertyGroupSchema.optional(),
  effects: z.array(effectSchema).optional(),
  masks: z.array(propertyGroupSchema).optional(),
  text: textSchema.optional(),
});

export const compInfoResultSchema = z.object({
  comps: z.array(compItemSchema),
  missing: z.array(z.union([z.string(), z.number()])),
  truncated: z.boolean(),
});

export const layerInfoResultSchema = z.object({
  comp: z.string().nullable(),
  layers: z.array(layerSchema),
  missing: z.array(z.number()),
  truncated: z.boolean(),
});

export const versionInfoSchema = z.object({
  aeVersion: z.string(),
  bridgeVersion: z.string(),
  capabilities: z.array(z.string()),
});

export const selectionSchema = z.object({
  comp: z.string().nullable(),
  layers: z.array(layerSchema),
  items: z.array(itemSummarySchema),
});

export type Keyframe = z.infer<typeof keyframeSchema>;
export type PropertyNode = z.infer<typeof propertySchema>;
export type EffectNode = z.infer<typeof effectSchema>;
export type TextNode = z.infer<typeof textSchema>;
export type LayerNode = z.infer<typeof layerSchema>;
export type CompInfoResult = z.infer<typeof compInfoResultSchema>;
export type LayerInfoResult = z.infer<typeof layerInfoResultSchema>;
export type VersionInfo = z.infer<typeof versionInfoSchema>;
export type Selection = z.infer<typeof selectionSchema>;