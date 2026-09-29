export interface RecordWriter {
  readonly needsScan?: boolean;
  scan?(record: unknown): void;
  write(record: unknown): string;
  end(): string;
}
