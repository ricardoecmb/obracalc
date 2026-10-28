export type StorageDriverName = "local" | "supabase";

export interface PutObjectOptions {
  contentType?: string;
  /** Quando false (padrão), falha se o objeto já existir. */
  upsert?: boolean;
}

export interface StoredObject {
  key: string;
  size: number;
  driver: StorageDriverName;
}

export interface StorageDriver {
  readonly name: StorageDriverName;
  put(key: string, data: Buffer, options?: PutObjectOptions): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(key: string) {
    super(`Objeto de armazenamento não encontrado: ${key}`);
    this.name = "StorageObjectNotFoundError";
  }
}
