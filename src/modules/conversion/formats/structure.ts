import { ConversionError } from './conversion-error';
import { ParseLimits } from './format.types';

export type PlainObject = Record<string, unknown>;

export const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const assertStructureLimits = (
  data: unknown,
  { maxDepth, maxNodes }: Pick<ParseLimits, 'maxDepth' | 'maxNodes'>,
): void => {
  const stack: Array<[unknown, number]> = [[data, 0]];
  let nodes = 0;

  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;

    if (++nodes > maxNodes) {
      throw new ConversionError(
        'LIMIT_EXCEEDED',
        `Document exceeds the limit of ${maxNodes} nodes`,
      );
    }

    if (typeof value !== 'object' || value === null) {
      continue;
    }

    if (depth >= maxDepth) {
      throw new ConversionError(
        'LIMIT_EXCEEDED',
        `Document exceeds the maximum nesting depth of ${maxDepth}`,
      );
    }

    const children = Array.isArray(value) ? value : Object.values(value);

    for (const child of children) {
      stack.push([child, depth + 1]);
    }
  }
};
