import { Readable } from 'stream';

export interface StoredObject {
  size: number;
}

export abstract class StorageService {
  abstract put(key: string, content: Readable): Promise<StoredObject>;
  abstract stat(key: string): Promise<StoredObject | null>;
  abstract openRead(key: string): Readable;
  abstract delete(key: string): Promise<void>;
}
