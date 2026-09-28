import { ConversionErrorCode } from './format.types';

export class ConversionError extends Error {
  constructor(
    readonly code: ConversionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = ConversionError.name;
  }
}
