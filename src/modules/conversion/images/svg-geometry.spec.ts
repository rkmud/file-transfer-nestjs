import {
  parseSvgLength,
  parseViewBox,
  resolveIntrinsicSize,
  resolveRasterSize,
  SVG_DEFAULT_SIZE,
} from './svg-geometry';

describe('svg-geometry', () => {
  describe('parseSvgLength', () => {
    it.each([
      ['10', 10],
      ['10px', 10],
      [' 12.5 PX ', 12.5],
      ['1in', 96],
      ['2.54cm', 96],
      ['25.4mm', 96],
      ['72pt', 96],
      ['1pc', 16],
      ['.5', 0.5],
      ['+3', 3],
      ['1e2', 100],
    ])('parses %j as %d px', (value, expected) => {
      expect(parseSvgLength(value)).toBeCloseTo(expected, 6);
    });

    it.each([undefined, '50%', '1em', '0', '-5', 'abc', '', '1e999'])(
      'returns null for %j',
      (value) => {
        expect(parseSvgLength(value)).toBeNull();
      },
    );
  });

  describe('parseViewBox', () => {
    it('parses space and comma separated boxes', () => {
      expect(parseViewBox('0 0 100 50')).toEqual({ width: 100, height: 50 });
      expect(parseViewBox(' -10,-10, 30 ,40 ')).toEqual({
        width: 30,
        height: 40,
      });
    });

    it.each([undefined, '0 0 100', '0 0 a b', '0 0 0 10', '0 0 10 -1'])(
      'returns null for %j',
      (value) => {
        expect(parseViewBox(value)).toBeNull();
      },
    );
  });

  describe('resolveIntrinsicSize', () => {
    it('uses width and height when both are given', () => {
      expect(resolveIntrinsicSize('20', '10', '0 0 1 1')).toEqual({
        width: 20,
        height: 10,
      });
    });

    it('derives the missing dimension from the viewBox aspect', () => {
      expect(resolveIntrinsicSize('200', undefined, '0 0 100 50')).toEqual({
        width: 200,
        height: 100,
      });
      expect(resolveIntrinsicSize(undefined, '100', '0 0 100 50')).toEqual({
        width: 200,
        height: 100,
      });
    });

    it('falls back to the viewBox alone (incl. percentage units)', () => {
      expect(resolveIntrinsicSize(undefined, undefined, '0 0 30 40')).toEqual({
        width: 30,
        height: 40,
      });
      expect(resolveIntrinsicSize('100%', '100%', '0 0 30 40')).toEqual({
        width: 30,
        height: 40,
      });
    });

    it('returns null when dimensions are missing or unusable', () => {
      expect(resolveIntrinsicSize(undefined, undefined, undefined)).toBeNull();
      expect(resolveIntrinsicSize('100', undefined, undefined)).toBeNull();
      expect(resolveIntrinsicSize('50%', '50%', undefined)).toBeNull();
    });
  });

  describe('resolveRasterSize', () => {
    const intrinsic = { width: 200, height: 100 };

    it('uses both requested dimensions as-is', () => {
      expect(resolveRasterSize(intrinsic, { width: 7, height: 9 })).toEqual({
        width: 7,
        height: 9,
      });
    });

    it('preserves the aspect ratio when one dimension is requested', () => {
      expect(resolveRasterSize(intrinsic, { width: 50 })).toEqual({
        width: 50,
        height: 25,
      });
      expect(resolveRasterSize(intrinsic, { height: 50 })).toEqual({
        width: 100,
        height: 50,
      });
      expect(resolveRasterSize(null, { width: 30 })).toEqual({
        width: 30,
        height: 30,
      });
    });

    it('never rounds a dimension below one pixel', () => {
      expect(
        resolveRasterSize({ width: 1000, height: 1 }, { width: 10 }),
      ).toEqual({ width: 10, height: 1 });
    });

    it('uses the rounded intrinsic size, else the default', () => {
      expect(resolveRasterSize({ width: 10.4, height: 20.6 }, {})).toEqual({
        width: 10,
        height: 21,
      });
      expect(resolveRasterSize(null, {})).toEqual({
        width: SVG_DEFAULT_SIZE,
        height: SVG_DEFAULT_SIZE,
      });
      expect(SVG_DEFAULT_SIZE).toBe(1024);
    });
  });
});
