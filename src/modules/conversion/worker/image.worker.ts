import { readFile } from 'fs/promises';
import sharp from 'sharp';
import { ImageConversionError } from '../images/image-conversion-error';
import { createImageFormatRegistry } from '../images/image-format-registry';
import { ImageTask, ImageTaskResult } from './image.task';

// Parallelism comes from the Piscina pool; keep libvips to one thread each.
sharp.concurrency(1);
sharp.cache(false);

const registry = createImageFormatRegistry();

const PIXEL_LIMIT_ERROR = /pixel limit/i;

export default async function convertImage(
  task: ImageTask,
): Promise<ImageTaskResult> {
  try {
    const source = registry.get(task.sourceFormat);
    const target = registry.resolveTarget(
      source,
      registry.get(task.targetFormat),
    );

    const input = await readFile(task.inputPath);
    const pipeline = await source.load(input, task.options, task.limits);
    const info = await target
      .encode(pipeline, task.options)
      .toFile(task.outputPath);

    return {
      ok: true,
      outputSize: info.size,
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof ImageConversionError) {
      return { ok: false, code: error.code, message: error.message };
    }

    // System errors (I/O) are ours; anything else is the decoder rejecting input.
    if (!(error instanceof Error) || 'code' in error) {
      return {
        ok: false,
        code: 'INTERNAL',
        message: error instanceof Error ? error.name : 'Unknown error',
      };
    }

    if (PIXEL_LIMIT_ERROR.test(error.message)) {
      return {
        ok: false,
        code: 'EXCEEDED_MAX_PIXELS',
        message: 'Image exceeds the pixel limit',
      };
    }

    return {
      ok: false,
      code: 'INVALID_IMAGE',
      message: 'Image data is invalid or corrupted',
    };
  }
}
