import { ConversionError } from './conversion-error';
import {
  assertStructureLimits,
  createRecordBudget,
  isPlainObject,
  StructureBudget,
  StructureLimits,
} from './structure';

const throwsLimit = (fn: () => void): boolean => {
  try {
    fn();

    return false;
  } catch (error) {
    expect(error).toBeInstanceOf(ConversionError);
    expect((error as ConversionError).code).toBe('LIMIT_EXCEEDED');

    return true;
  }
};

describe('isPlainObject', () => {
  it.each([
    [{}, true],
    [{ a: 1 }, true],
    [[], false],
    [null, false],
    ['x', false],
    [1, false],
    [undefined, false],
  ])('%j -> %s', (value, expected) => {
    expect(isPlainObject(value)).toBe(expected);
  });
});

describe('assertStructureLimits', () => {
  it('accepts a document within limits', () => {
    expect(() =>
      assertStructureLimits(
        { a: [1, 2, { b: null }] },
        { maxDepth: 3, maxNodes: 6 },
      ),
    ).not.toThrow();
  });

  it('rejects a document with too many nodes', () => {
    expect(() =>
      assertStructureLimits([1, 2, 3], { maxDepth: 5, maxNodes: 3 }),
    ).toThrow(
      expect.objectContaining({
        code: 'LIMIT_EXCEEDED',
        message: 'Document exceeds the limit of 3 nodes',
      }) as Error,
    );
  });

  it('rejects a document nested too deeply', () => {
    expect(() =>
      assertStructureLimits(
        { a: { b: { c: 1 } } },
        { maxDepth: 2, maxNodes: 99 },
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'LIMIT_EXCEEDED',
        message: 'Document exceeds the maximum nesting depth of 2',
      }) as Error,
    );
  });

  it('does not count scalars against the depth limit', () => {
    expect(() =>
      assertStructureLimits({ a: 1 }, { maxDepth: 1, maxNodes: 99 }),
    ).not.toThrow();
  });

  it('handles very deep documents without recursion', () => {
    let deep: unknown = 'leaf';

    for (let i = 0; i < 50_000; i++) deep = [deep];

    expect(
      throwsLimit(() =>
        assertStructureLimits(deep, { maxDepth: 64, maxNodes: 1e9 }),
      ),
    ).toBe(true);
  });
});

describe('createRecordBudget', () => {
  const record = { a: 1, b: 2 }; // 3 nodes, depth 1 inside the collection

  it('counts nodes across records, not per record', () => {
    const limits = { maxDepth: 5, maxNodes: 10 };
    const budget = createRecordBudget(limits);

    // Each record alone is well within the limit.
    expect(() => createRecordBudget(limits).consume(record)).not.toThrow();

    // root (1) + 3 records x 3 nodes = 10.
    budget.consume(record);
    budget.consume(record);
    budget.consume(record);

    expect(() => budget.consume(record)).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }) as Error,
    );
  });

  it('counts the enclosing collection as a node at depth 0', () => {
    const budget = createRecordBudget({ maxDepth: 5, maxNodes: 1 });

    expect(() => budget.consume('x')).toThrow(
      expect.objectContaining({ code: 'LIMIT_EXCEEDED' }) as Error,
    );
  });

  it('measures record depth relative to the collection', () => {
    // [ {a: {}} ]: collection 0, record 1, nested object 2.
    expect(
      throwsLimit(() =>
        createRecordBudget({ maxDepth: 2, maxNodes: 99 }).consume({ a: {} }),
      ),
    ).toBe(true);
    expect(
      throwsLimit(() =>
        createRecordBudget({ maxDepth: 3, maxNodes: 99 }).consume({ a: {} }),
      ),
    ).toBe(false);
  });

  // Divergence (edge case): the collection node is counted but its own depth is
  // not checked, so maxDepth 0 accepts an empty streamed collection while
  // assertStructureLimits([]) rejects it.
  it('does not check the depth of the collection itself', () => {
    expect(
      throwsLimit(() => createRecordBudget({ maxDepth: 0, maxNodes: 99 })),
    ).toBe(false);
    expect(
      throwsLimit(() =>
        assertStructureLimits([], { maxDepth: 0, maxNodes: 99 }),
      ),
    ).toBe(true);
  });

  it('agrees with assertStructureLimits on the whole collection for every limit', () => {
    const records: unknown[] = [
      { id: 1, tags: ['a', 'b'] },
      'scalar',
      [1, [2, [3]]],
      { nested: { deeper: { deepest: null } } },
      null,
    ];

    for (let maxDepth = 0; maxDepth <= 6; maxDepth++) {
      for (let maxNodes = 1; maxNodes <= 22; maxNodes++) {
        const limits: StructureLimits = { maxDepth, maxNodes };
        const whole = throwsLimit(() => assertStructureLimits(records, limits));
        const streamed = throwsLimit(() => {
          const budget = createRecordBudget(limits);

          for (const item of records) budget.consume(item);
        });

        expect({ maxDepth, maxNodes, streamed }).toEqual({
          maxDepth,
          maxNodes,
          streamed: whole,
        });
      }
    }
  });

  it('is a StructureBudget', () => {
    expect(createRecordBudget({ maxDepth: 1, maxNodes: 1 })).toBeInstanceOf(
      StructureBudget,
    );
  });
});
