import { CsvFormatHandler } from './csv.format';
import { TextFormatHandler } from './format-handler';
import { TextFormat } from './format.types';
import { JsonFormatHandler } from './json.format';
import { XmlFormatHandler } from './xml.format';
import { YamlFormatHandler } from './yaml.format';

export class FormatRegistry {
  private readonly handlers = new Map<string, TextFormatHandler>();

  constructor(handlers: TextFormatHandler[]) {
    for (const handler of handlers) {
      this.handlers.set(handler.format, handler);
    }
  }

  all(): TextFormatHandler[] {
    return [...this.handlers.values()];
  }

  has(format: string): format is TextFormat {
    return this.handlers.has(format);
  }

  get(format: TextFormat): TextFormatHandler {
    const handler = this.handlers.get(format);

    if (!handler) {
      throw new Error(`No handler registered for format "${format}"`);
    }

    return handler;
  }

  findByExtension(extension: string): TextFormatHandler | undefined {
    return this.all().find((handler) => handler.extensions.includes(extension));
  }
}

export const createFormatRegistry = (): FormatRegistry =>
  new FormatRegistry([
    new CsvFormatHandler(),
    new JsonFormatHandler(),
    new XmlFormatHandler(),
    new YamlFormatHandler(),
  ]);
