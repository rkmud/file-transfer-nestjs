import {
  ConversionDirections,
  ConversionRequest,
  ConversionResult,
} from '../conversion.types';

export abstract class ConversionService {
  abstract getSupportedFormats(): ConversionDirections[];
  abstract convert(request: ConversionRequest): Promise<ConversionResult>;
}
