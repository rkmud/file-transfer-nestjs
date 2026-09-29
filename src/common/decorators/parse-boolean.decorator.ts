import { Transform } from 'class-transformer';

const TRUE_VALUES = new Set(['true', '1']);
const FALSE_VALUES = new Set(['false', '0']);

export const ParseBoolean = () =>
  Transform(({ value }: { value: unknown }): unknown => {
    if (typeof value !== 'string') return value;

    const normalized = value.trim().toLowerCase();

    if (normalized === '') return undefined;
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;

    return value;
  });
