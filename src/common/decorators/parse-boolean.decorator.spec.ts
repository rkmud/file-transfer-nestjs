import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsOptional, validateSync } from 'class-validator';
import { ParseBoolean } from './parse-boolean.decorator';

/** Mirrors how ConvertFileDto / ConvertImageDto declare the `save` field. */
class SaveDto {
  @ParseBoolean()
  @IsOptional()
  @IsBoolean()
  save?: boolean;
}

const parse = (plain: Record<string, unknown>) => {
  const dto = plainToInstance(SaveDto, plain);

  return { dto, errors: validateSync(dto) };
};

describe('@ParseBoolean()', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    [' True ', true],
    ['1', true],
    ['false', false],
    ['False', false],
    ['0', false],
  ])('multipart value %p -> %p (valid)', (raw, expected) => {
    const { dto, errors } = parse({ save: raw });

    expect(dto.save).toBe(expected);
    expect(errors).toHaveLength(0);
  });

  it.each(['', '   '])(
    'blank value %p -> undefined (treated as absent)',
    (raw) => {
      const { dto, errors } = parse({ save: raw });

      expect(dto.save).toBeUndefined();
      expect(errors).toHaveLength(0);
    },
  );

  it('absent field stays undefined and passes validation', () => {
    const { dto, errors } = parse({});

    expect(dto.save).toBeUndefined();
    expect(errors).toHaveLength(0);
  });

  it.each(['yes', 'on', '2', 'truthy'])(
    'invalid string %p is kept as-is and rejected by @IsBoolean()',
    (raw) => {
      const { dto, errors } = parse({ save: raw });

      expect(dto.save).toBe(raw);
      expect(errors).toHaveLength(1);
      expect(errors[0].property).toBe('save');
      expect(errors[0].constraints).toHaveProperty('isBoolean');
    },
  );

  it.each([true, false])('non-string boolean %p passes through', (value) => {
    const { dto, errors } = parse({ save: value });

    expect(dto.save).toBe(value);
    expect(errors).toHaveLength(0);
  });

  it('non-string non-boolean passes through and fails validation', () => {
    const { dto, errors } = parse({ save: 1 });

    expect(dto.save).toBe(1);
    expect(errors[0].constraints).toHaveProperty('isBoolean');
  });
});
