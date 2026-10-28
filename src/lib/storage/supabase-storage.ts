import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isSafeStorageKey } from "@/lib/security/paths";
import {
  StorageObjectNotFoundError,
  type PutObjectOptions,
  type StorageDriver,
  type StoredObject,
} from "./types";

/**
 * Driver de armazenamento persistente em Supabase Storage.
 * Usa a service role apenas no servidor; nunca é importado por componentes
 * cliente.
 */
export class SupabaseStorageDriver implements StorageDriver {
  readonly name = "supabase" as const;
  private readonly client: SupabaseClient;
  private readonly bucket: string;
  private bucketReady?: Promise<void>;

  constructor(params: { url: string; serviceRoleKey: string; bucket: string }) {
    this.client = createClient(params.url, params.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = params.bucket;
  }

  private async ensureBucket(): Promise<void> {
    if (!this.bucketReady) {
      this.bucketReady = (async () => {
        const { error } = await this.client.storage.getBucket(this.bucket);
        if (!error) return;

        const created = await this.client.storage.createBucket(this.bucket, {
          public: false,
        });
        if (created.error && !/already exists/i.test(created.error.message)) {
          throw new Error(
            `Não foi possível preparar o bucket de armazenamento: ${created.error.message}`
          );
        }
      })();
    }
    return this.bucketReady;
  }

  private assertKey(key: string): void {
    if (!isSafeStorageKey(key)) {
      throw new Error("Chave de armazenamento inválida.");
    }
  }

  async put(
    key: string,
    data: Buffer,
    options?: PutObjectOptions
  ): Promise<StoredObject> {
    this.assertKey(key);
    await this.ensureBucket();

    const { error } = await this.client.storage.from(this.bucket).upload(key, data, {
      contentType: options?.contentType ?? "application/octet-stream",
      upsert: options?.upsert ?? false,
    });

    if (error) {
      throw new Error(`Falha ao enviar objeto para o storage: ${error.message}`);
    }

    return { key, size: data.byteLength, driver: this.name };
  }

  async get(key: string): Promise<Buffer> {
    this.assertKey(key);
    await this.ensureBucket();

    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) {
      throw new StorageObjectNotFoundError(key);
    }

    return Buffer.from(await data.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    this.assertKey(key);
    await this.ensureBucket();
    const { error } = await this.client.storage.from(this.bucket).remove([key]);
    if (error && !/not found/i.test(error.message)) {
      throw new Error(`Falha ao remover objeto do storage: ${error.message}`);
    }
  }

  async exists(key: string): Promise<boolean> {
    this.assertKey(key);
    await this.ensureBucket();

    const slash = key.lastIndexOf("/");
    const prefix = slash >= 0 ? key.slice(0, slash) : "";
    const name = slash >= 0 ? key.slice(slash + 1) : key;
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(prefix, { search: name, limit: 100 });

    if (error) return false;
    return data.some((entry) => entry.name === name && entry.id !== null);
  }

  async list(prefix = ""): Promise<string[]> {
    await this.ensureBucket();
    const keys: string[] = [];
    const cleanPrefix = prefix.replace(/^\/+|\/+$/g, "");

    const walk = async (directory: string, relative: string): Promise<void> => {
      let offset = 0;
      for (;;) {
        const { data, error } = await this.client.storage
          .from(this.bucket)
          .list(directory, { limit: 1000, offset });

        if (error) {
          throw new Error(`Falha ao listar o storage: ${error.message}`);
        }

        for (const entry of data) {
          const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
          if (entry.id === null) {
            await walk(directory ? `${directory}/${entry.name}` : entry.name, childRelative);
          } else {
            keys.push(childRelative);
          }
        }

        if (data.length < 1000) break;
        offset += 1000;
      }
    };

    await walk(cleanPrefix, cleanPrefix);
    return keys.sort();
  }
}
