/** URI of the full animation principles, served as an MCP resource (see `createServer` `guide`). */
export const ANIMATION_GUIDE_URI = 'ae-mcp://animation-principles';

/**
 * Short core sent as the MCP `instructions` on every session. Every rule of
 * docs/agents/animation-principles.md appears here in short form; the full text
 * with the reasoning is served at ANIMATION_GUIDE_URI.
 */
export const SERVER_INSTRUCTIONS = [
  `Full rules: resource ${ANIMATION_GUIDE_URI}.`,
  'Keyframes for explicit motion; expressions only when procedural or data-driven.',
  'Keep existing keys and expressions unless understood; never overwrite silently.',
  'Inspect first; modify, do not rebuild; reuse controllers.',
  'Respect layer order, parenting, masks, effects; check child keys before reparenting.',
  'Descriptive names (no Null 12); keep project naming.',
  'Easy Ease for landings, hold for jumps, roving keys for paths. Avoid extra keys.',
  'Expressions: named layers, no magic numbers, named loop; tunables on a Slider.',
  'Uniform Scale; check comp motion blur before per-layer blur.',
  'Read an expression or key set before replacing; state the trade-off.',
  'Validate first; ask before broad or destructive changes.',
  'Ties: simplest maintainable solution.',
].join('\n');
