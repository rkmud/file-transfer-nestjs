export const TEXT_FORMATS = ['csv', 'json', 'xml', 'yaml'] as const;

export type TextFormat = (typeof TEXT_FORMATS)[number];

export enum FormatMatch {
  No = 0,
  Possible = 1,
  Likely = 2,
  Certain = 3,
}

export interface ParseLimits {
  maxDepth: number;
  maxNodes: number;
  maxYamlAliases: number;
}

export type ConversionErrorCode =
  | 'INVALID_ENCODING'
  | 'SYNTAX_ERROR'
  | 'LIMIT_EXCEEDED'
  | 'FORBIDDEN_CONSTRUCT'
  | 'UNSUPPORTED_FORMAT'
  | 'INTERNAL';
