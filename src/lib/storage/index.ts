import { createHash } from "node:crypto";
import path from "node:path";
import { getEnvironment, resolveStorageDriver } from "@/lib/config/env";
import { LocalStorageDriver } from "./local-storage";
import { SupabaseStorageDriver } from "./supabase-storage";
import type { StorageDriver, StorageDriverName } from "./types";

let localDriver: LocalStorageDriver | undefined;
let supabaseDriver: SupabaseStorageDriver | undefined;

export function createStorage(
  driver?: StorageDriverName,
  env = getEnvironment()
): StorageDriver {
  const selected = driver ?? resolveStorageDriver(env);

  if (selected === "supabase") {
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "Storage Supabase selecionado, mas NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não estão configuradas."
      );
    }
    return new SupabaseStorageDriver({
      url: env.NEXT_PUBLIC_SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_STORAGE_BUCKET,
    });
  }

  return new LocalStorageDriver(
    path.isAbsolute(env.STORAGE_LOCAL_DIR)
      ? env.STORAGE_LOCAL_DIR
      : path.join(/*turbopackIgnore: true*/ process.cwd(), env.STORAGE_LOCAL_DIR)
  );
}

/** Drivers memoizados para uso em runtime. */
export function getStorage(driver?: StorageDriverName): StorageDriver {
  const env = getEnvironment();
  const selected = driver ?? resolveStorageDriver(env);

  if (selected === "supabase") {
    if (!supabaseDriver) {
      supabaseDriver = createStorage("supabase", env) as SupabaseStorageDriver;
    }
    return supabaseDriver;
  }

  if (!localDriver) {
    localDriver = createStorage("local", env) as LocalStorageDriver;
  }
  return localDriver;
}

/** Usado em testes que alteram STORAGE_LOCAL_DIR / credenciais. */
export function resetStorageCache(): void {
  localDriver = undefined;
  supabaseDriver = undefined;
}

export function computeSha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function buildImportObjectKey(params: {
  userId: string;
  jobId: string;
  fileName: string;
  date?: Date;
}): string {
  const date = params.date ?? new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const safeUser = params.userId.replace(/[^a-zA-Z0-9_-]+/g, "-");
  const safeName = params.fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return ["imports", safeUser, year, month, params.jobId, safeName].join("/");
}

export function buildBackupObjectKey(params: {
  prefix: string;
  databaseName: string;
  date?: Date;
  id: string;
}): string {
  const date = params.date ?? new Date();
  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const timestamp = date.toISOString().replace(/[:.]/g, "-");
  const safeDb = params.databaseName.replace(/[^a-zA-Z0-9_-]+/g, "-");
  return [
    params.prefix.replace(/^\/+|\/+$/g, ""),
    year,
    month,
    day,
    `${timestamp}-${safeDb}-${params.id}.dump`,
  ].join("/");
}

export * from "./types";
