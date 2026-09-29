import { createReadStream, createWriteStream } from 'fs';
import { open, readFile, writeFile } from 'fs/promises';
import { pipeline } from 'stream/promises';
import { CONVERSION_SNIFF_BYTES } from '../conversion.constants';
import { ConversionError } from '../formats/conversion-error';
import {
  isStreamingSource,
  isStreamingTarget,
  StreamingSourceHandler,
  StreamingTargetHandler,
  TextFormatHandler,
} from '../formats/format-handler';
import { createFormatRegistry } from '../formats/format-registry';
import { ParseLimits } from '../formats/format.types';
import {
  assertStructureLimits,
  createRecordBudget,
} from '../formats/structure';
import {
  decodeHead,
  decodeText,
  decodeTextStream,
} from '../formats/text-codec';
import { ConversionTask, ConversionTaskResult } from './conversion.task';

const registry = createFormatRegistry();

const readHead = async (path: string, bytes: number): Promise<Buffer> => {
  const handle = await open(path, 'r');

  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
};

const readRecords = (
  source: StreamingSourceHandler,
  inputPath: string,
  limits: ParseLimits,
): AsyncIterable<unknown> =>
  source.readRecords(decodeTextStream(createReadStream(inputPath)), limits);

const isStreamable = async (
  task: ConversionTask,
  source: StreamingSourceHandler,
): Promise<boolean> => {
  if (task.inputSize < task.streamThresholdBytes) return false;

  const head = await readHead(task.inputPath, CONVERSION_SNIFF_BYTES);

  return source.canStream(decodeHead(head));
};

const convertStreaming = async (
  task: ConversionTask,
  source: StreamingSourceHandler,
  target: StreamingTargetHandler,
): Promise<number> => {
  const writer = target.createWriter();
  const records = (): AsyncIterable<unknown> =>
    readRecords(source, task.inputPath, task.limits);

  if (writer.needsScan) {
    const budget = createRecordBudget(task.limits);

    for await (const record of records()) {
      budget.consume(record);
      writer.scan?.(record);
    }
  }

  let outputSize = 0;

  const chunks = async function* (): AsyncGenerator<string> {
    const budget = createRecordBudget(task.limits);

    for await (const record of records()) {
      budget.consume(record);

      const chunk = writer.write(record);

      outputSize += Buffer.byteLength(chunk);

      if (chunk !== '') yield chunk;
    }

    const tail = writer.end();

    outputSize += Buffer.byteLength(tail);

    if (tail !== '') yield tail;
  };

  await pipeline(
    chunks,
    createWriteStream(task.outputPath, { flags: 'wx', encoding: 'utf8' }),
  );

  return outputSize;
};

const convertInMemory = async (
  task: ConversionTask,
  source: TextFormatHandler,
  target: TextFormatHandler,
): Promise<number> => {
  const text = decodeText(await readFile(task.inputPath));
  const data = source.parse(text, task.limits);

  assertStructureLimits(data, task.limits);

  const output = Buffer.from(target.serialize(data), 'utf8');

  await writeFile(task.outputPath, output, { flag: 'wx' });

  return output.length;
};

export default async function convert(
  task: ConversionTask,
): Promise<ConversionTaskResult> {
  try {
    const source = registry.get(task.sourceFormat);
    const target = registry.get(task.targetFormat);

    const outputSize =
      isStreamingSource(source) &&
      isStreamingTarget(target) &&
      (await isStreamable(task, source))
        ? await convertStreaming(task, source, target)
        : await convertInMemory(task, source, target);

    return { ok: true, outputSize };
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
