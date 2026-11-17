// Framework source: .kiro/tools/aidlc-lib.ts (ACTIVE_SPACE_POINTER, DEFAULT_SPACE)
// The framework resolves the space as: explicit > aidlc/active-space > 'default'.
export const DEFAULT_SPACE = 'default';

/**
 * The space Studio reads today.
 *
 * Studio reads the `default` space everywhere, so this returns it. New readers
 * call this helper instead of hard-coding the name: the day Studio follows
 * `aidlc/active-space`, this is the one place that changes.
 */
export function studioSpace(): string {
  return DEFAULT_SPACE;
}
