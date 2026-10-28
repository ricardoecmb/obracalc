import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isSafeStorageKey } from "@/lib/security/paths";
import {
  StorageObjectNotFoundError,
  type PutObjectOptions,
  type StorageDriver,
  type StoredObject,
} from "./types";

/**
 * Driver de armazenamento local usado em desenvolvimento e testes.
 * Em produção na Vercel use Supabase: o disco é efêmero.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly name = "local" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    if (!isSafeStorageKey(key)) {
      throw new Error("Chave de armazenamento inválida.");
    }
    const absolute = path.resolve(this.root, key);
    if (absolute !== this.root && !absolute.startsWith(this.root + path.sep)) {
      throw new Error("Chave de armazenamento fora do diretório permitido.");
    }
    return absolute;
  }

  async put(
    key: string,
    data: Buffer,
    options?: PutObjectOptions
  ): Promise<StoredObject> {
    const absolute = this.resolve(key);
    await mkdir(path.dirname(absolute), { recursive: true });

    try {
      await writeFile(absolute, data, { flag: options?.upsert ? "w" : "wx" });
    } catch (error) {
      if (
        !options?.upsert &&
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "EEXIST"
      ) {
        throw new Error(`Objeto já existe: ${key}`);
      }
      throw error;
    }

    return { key, size: data.byteLength, driver: this.name };
  }

  async get(key: string): Promise<Buffer> {
    const absolute = this.resolve(key);
    try {
      return await readFile(absolute);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix = ""): Promise<string[]> {
    const keys: string[] = [];
    const base = prefix ? this.resolve(prefix.replace(/\/+$/, "")) : this.root;

    const walk = async (directory: string, relative: string) => {
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(path.join(directory, entry.name), childRelative);
        } else if (entry.isFile()) {
          keys.push(childRelative);
        }
      }
    };

    try {
      const info = await stat(base);
      if (info.isFile()) return [prefix];
    } catch {
      return [];
    }

    await walk(base, prefix ? prefix.replace(/\/+$/, "") : "");
    return keys.sort();
  }
}
