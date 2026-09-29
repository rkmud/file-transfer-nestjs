import { ConversionError } from './conversion-error';
import { ParseLimits } from './format.types';

export type PlainObject = Record<string, unknown>;

export type StructureLimits = Pick<ParseLimits, 'maxDepth' | 'maxNodes'>;

export const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export class StructureBudget {
  private nodes = 0;

  constructor(
    private readonly limits: StructureLimits,
    private readonly baseDepth = 0,
  ) {}

  consume(data: unknown): void {
    const { maxDepth, maxNodes } = this.limits;
    const stack: Array<[unknown, number]> = [[data, this.baseDepth]];

    while (stack.length > 0) {
      const [value, depth] = stack.pop()!;

      if (++this.nodes > maxNodes) {
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
  }
}

export const assertStructureLimits = (
  data: unknown,
  limits: StructureLimits,
): void => new StructureBudget(limits).consume(data);

export const createRecordBudget = (
  limits: StructureLimits,
): StructureBudget => {
  const budget = new StructureBudget(limits, 1);

  budget.consume(null);

  return budget;
};
