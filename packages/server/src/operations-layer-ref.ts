// Layer addressing shared by every operation that takes a layer by `index` or `layerIndex` (#285).
// Such an operation also takes `layer`: an index, an exact layer name or {id}, resolved by the
// bridge with aemcpRequireLayer. `index` and `layerIndex` are then no longer required, since
// `layer` can stand in for them. Without either, the bridge aborts with INVALID_ARGS.

export const layerRefSchema = { description: 'layer index, name or {id}' };

export function withLayerRef(
  schema: Record<string, unknown>,
  required: readonly string[],
): { schema: Record<string, unknown>; required: string[] } {
  const takesLayer = schema.comp !== undefined && (schema.index !== undefined || schema.layerIndex !== undefined);
  if (!takesLayer) return { schema, required: [...required] };
  return {
    schema: schema.layer === undefined ? { ...schema, layer: layerRefSchema } : schema,
    required: required.filter((arg) => arg !== 'index' && arg !== 'layerIndex'),
  };
}
