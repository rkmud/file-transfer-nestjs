import { readFile, writeFile } from 'fs/promises';
import { ConversionError } from '../formats/conversion-error';
import { createFormatRegistry } from '../formats/format-registry';
import { assertStructureLimits } from '../formats/structure';
import { decodeText } from '../formats/text-codec';
import { ConversionTask, ConversionTaskResult } from './conversion.task';

const registry = createFormatRegistry();

export default async function convert(
  task: ConversionTask,
): Promise<ConversionTaskResult> {
  try {
    const source = registry.get(task.sourceFormat);
    const target = registry.get(task.targetFormat);

    const text = decodeText(await readFile(task.inputPath));
    const data = source.parse(text, task.limits);

    assertStructureLimits(data, task.limits);

    const output = Buffer.from(target.serialize(data), 'utf8');

    await writeFile(task.outputPath, output, { flag: 'wx' });

    return { ok: true, outputSize: output.length };
  } catch (error) {
    if (error instanceof ConversionError) {
      return { ok: false, code: error.code, message: error.message };
    }

    if (error instanceof RangeError) {
      return {
        ok: false,
        code: 'LIMIT_EXCEEDED',
        message: 'Document is too complex to convert',
      };
    }

    return {
      ok: false,
      code: 'INTERNAL',
      message: error instanceof Error ? error.name : 'Unknown error',
    };
  }
}
