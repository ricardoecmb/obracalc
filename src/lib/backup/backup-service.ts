import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import {
  getEnvironment,
  isS3Configured,
  type AppEnv,
} from "@/lib/config/env";
import { buildBackupObjectKey, getStorage, type StorageDriverName } from "@/lib/storage";
import { s3DeleteObject, s3GetObject, s3PutObject, type S3Config } from "./s3";

/**
 * Backup lógico externo (pg_dump custom format) + upload para S3 ou Supabase
 * Storage, com checksum, manifesto de contagens e restauração verificável.
 *
 * Executado por scripts/CI — não pelo runtime serverless da Vercel, onde o
 * binário do PostgreSQL não está disponível.
 */

export interface DatabaseConnection {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslmode?: string;
}

export interface BackupManifest {
  database: { host: string; database: string };
  tableCounts: Record<string, number>;
  migrationsApplied: number;
  createdAt: string;
}

export interface BackupResult {
  id: string;
  status: "COMPLETED" | "FAILED";
  storageKey: string | null;
  storageDriver: string | null;
  checksum: string | null;
  fileSizeBytes: number | null;
  manifest: BackupManifest | null;
  durationMs: number;
  error?: string;
}

export interface RestoreVerificationResult {
  backupId: string;
  verified: boolean;
  restoreTarget: string;
  expected: Record<string, number>;
  actual: Record<string, number>;
  migrationsApplied: number;
  durationMs: number;
  error?: string;
}

const TRACKED_TABLES = [
  "users",
  "projects",
  "budgets",
  "budget_revisions",
  "budget_items",
  "resources",
  "compositions",
  "revision_snapshots",
  "audit_entries",
  "import_jobs",
] as const;

export function parseDatabaseUrl(raw: string): DatabaseConnection {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL/DIRECT_URL inválida.");
  }

  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("A URL do banco deve ser PostgreSQL.");
  }

  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (!database) {
    throw new Error("A URL do banco não contém o nome do database.");
  }

  return {
    host: url.hostname,
    port: url.port || "5432",
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    sslmode: url.searchParams.get("sslmode") ?? undefined,
  };
}

export function maskDatabase(connection: DatabaseConnection): {
  host: string;
  database: string;
} {
  return { host: connection.host, database: connection.database };
}

export function resolveDatabaseUrl(env: AppEnv = getEnvironment()): string {
  return env.DIRECT_URL || env.DATABASE_URL;
}

export async function resolvePostgresBinary(
  binary: "pg_dump" | "pg_restore" | "psql"
): Promise<string> {
  const executable = process.platform === "win32" ? `${binary}.exe` : binary;
  const candidates: string[] = [];

  if (process.env.PG_BIN) {
    candidates.push(path.join(process.env.PG_BIN, executable));
  }

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory) candidates.push(path.join(directory, executable));
  }

  if (process.platform === "win32") {
    for (const version of ["17", "16", "15", "14"]) {
      candidates.push(`C:\\Program Files\\PostgreSQL\\${version}\\bin\\${executable}`);
    }
  } else {
    candidates.push(`/usr/bin/${executable}`, `/usr/local/bin/${executable}`);
    candidates.push(`/opt/homebrew/bin/${executable}`);
  }

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continua
    }
  }

  throw new Error(
    `Binário ${binary} não encontrado. Defina PG_BIN ou instale o cliente PostgreSQL.`
  );
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommand(
  binary: string,
  args: string[],
  options: { password: string; sslmode?: string }
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: {
        ...process.env,
        PGPASSWORD: options.password,
        PGCONNECT_TIMEOUT: process.env.PGCONNECT_TIMEOUT ?? "15",
        ...(options.sslmode ? { PGSSLMODE: options.sslmode } : {}),
      },
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `Comando ${path.basename(binary)} falhou (código ${code}): ${stderr
              .trim()
              .slice(-1500)}`
          )
        );
      }
    });
  });
}

function sanitizeError(error: unknown, connection: DatabaseConnection): string {
  const message = error instanceof Error ? error.message : String(error);
  return connection.password
    ? message.split(connection.password).join("***")
    : message;
}

export async function collectTableCounts(): Promise<{
  tableCounts: Record<string, number>;
  migrationsApplied: number;
}> {
  const tableCounts: Record<string, number> = {};
  tableCounts.users = await prisma.user.count();
  tableCounts.projects = await prisma.project.count();
  tableCounts.budgets = await prisma.budget.count();
  tableCounts.budget_revisions = await prisma.budgetRevision.count();
  tableCounts.budget_items = await prisma.budgetItem.count();
  tableCounts.resources = await prisma.resource.count();
  tableCounts.compositions = await prisma.composition.count();
  tableCounts.revision_snapshots = await prisma.revisionSnapshot.count();
  tableCounts.audit_entries = await prisma.auditEntry.count();
  tableCounts.import_jobs = await prisma.importJob.count();

  const migrations = await prisma.$queryRaw<Array<{ count: number | bigint }>>`
    SELECT count(*)::int AS count
    FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;

  return {
    tableCounts,
    migrationsApplied: Number(migrations[0]?.count ?? 0),
  };
}

function s3ConfigFromEnv(env: AppEnv): S3Config {
  return {
    bucket: env.BACKUP_S3_BUCKET!,
    region: env.BACKUP_S3_REGION!,
    accessKeyId: env.BACKUP_S3_ACCESS_KEY!,
    secretAccessKey: env.BACKUP_S3_SECRET_KEY!,
  };
}

async function putExternalObject(
  env: AppEnv,
  key: string,
  data: Buffer
): Promise<{ driver: string; fileUrl: string | null }> {
  if (isS3Configured(env)) {
    await s3PutObject(s3ConfigFromEnv(env), key, data, "application/octet-stream");
    return { driver: "s3", fileUrl: `s3://${env.BACKUP_S3_BUCKET}/${key}` };
  }

  const storage = getStorage();
  await storage.put(key, data, { contentType: "application/octet-stream" });
  return { driver: storage.name, fileUrl: null };
}

async function getExternalObject(
  env: AppEnv,
  driver: string | null,
  key: string
): Promise<Buffer> {
  if (driver === "s3") {
    if (!isS3Configured(env)) {
      throw new Error("Backup em S3, mas as variáveis BACKUP_S3_* não estão configuradas.");
    }
    return s3GetObject(s3ConfigFromEnv(env), key);
  }

  const storage = getStorage((driver as StorageDriverName) || undefined);
  return storage.get(key);
}

export async function createFullBackup(options?: {
  env?: AppEnv;
  userId?: string | null;
}): Promise<BackupResult> {
  const env = options?.env ?? getEnvironment();
  const connection = parseDatabaseUrl(resolveDatabaseUrl(env));
  const started = Date.now();
  const log = await prisma.backupLog.create({
    data: {
      userId: options?.userId ?? null,
      type: "FULL",
      status: "STARTED",
      format: "CUSTOM",
      startedAt: new Date(),
    },
  });

  let tempDir: string | undefined;

  try {
    const pgDump = await resolvePostgresBinary("pg_dump");
    tempDir = await mkdtemp(path.join(os.tmpdir(), "obracalc-backup-"));
    const dumpFile = path.join(tempDir, `${connection.database}.dump`);

    await runCommand(
      pgDump,
      [
        "--host",
        connection.host,
        "--port",
        connection.port,
        "--username",
        connection.username,
        "--dbname",
        connection.database,
        "--format=custom",
        "--no-owner",
        "--no-privileges",
        "--file",
        dumpFile,
      ],
      { password: connection.password, sslmode: connection.sslmode }
    );

    const buffer = await readFile(dumpFile);
    const fileStat = await stat(dumpFile);
    const checksum = createHash("sha256").update(buffer).digest("hex");
    const counts = await collectTableCounts();

    const manifest: BackupManifest = {
      database: maskDatabase(connection),
      tableCounts: counts.tableCounts,
      migrationsApplied: counts.migrationsApplied,
      createdAt: new Date().toISOString(),
    };

    const key = buildBackupObjectKey({
      prefix: env.BACKUP_PREFIX,
      databaseName: connection.database,
      id: log.id,
    });
    const external = await putExternalObject(env, key, buffer);

    await prisma.backupLog.update({
      where: { id: log.id },
      data: {
        status: "COMPLETED",
        storageKey: key,
        storageDriver: external.driver,
        fileUrl: external.fileUrl,
        fileSizeBytes: BigInt(fileStat.size),
        checksum,
        metadata: manifest as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
      },
    });

    return {
      id: log.id,
      status: "COMPLETED",
      storageKey: key,
      storageDriver: external.driver,
      checksum,
      fileSizeBytes: fileStat.size,
      manifest,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const message = sanitizeError(error, connection).slice(0, 2000);
    await prisma.backupLog.update({
      where: { id: log.id },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    });

    return {
      id: log.id,
      status: "FAILED",
      storageKey: null,
      storageDriver: null,
      checksum: null,
      fileSizeBytes: null,
      manifest: null,
      durationMs: Date.now() - started,
      error: message,
    };
  } finally {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function psqlScalar(
  connection: DatabaseConnection,
  database: string,
  sql: string
): Promise<string> {
  const psql = await resolvePostgresBinary("psql");
  const result = await runCommand(
    psql,
    [
      "--host",
      connection.host,
      "--port",
      connection.port,
      "--username",
      connection.username,
      "--dbname",
      database,
      "--tuples-only",
      "--no-align",
      "--set=ON_ERROR_STOP=1",
      "--command",
      sql,
    ],
    { password: connection.password, sslmode: connection.sslmode }
  );
  return result.stdout.trim();
}

export async function restoreAndVerifyBackup(options?: {
  backupId?: string;
  env?: AppEnv;
  keepDatabase?: boolean;
}): Promise<RestoreVerificationResult> {
  const env = options?.env ?? getEnvironment();
  const connection = parseDatabaseUrl(resolveDatabaseUrl(env));
  const started = Date.now();

  const backup = options?.backupId
    ? await prisma.backupLog.findUnique({ where: { id: options.backupId } })
    : await prisma.backupLog.findFirst({
        where: { status: "COMPLETED", storageKey: { not: null } },
        orderBy: { createdAt: "desc" },
      });

  if (!backup || !backup.storageKey) {
    throw new Error("Nenhum backup COMPLETED com storageKey foi encontrado.");
  }

  const manifest = (backup.metadata ?? null) as BackupManifest | null;
  const restoreTarget = `obracalc_restore_${Date.now()}`;
  let tempDir: string | undefined;
  let created = false;

  try {
    const buffer = await getExternalObject(
      env,
      backup.storageDriver,
      backup.storageKey
    );

    if (backup.checksum) {
      const checksum = createHash("sha256").update(buffer).digest("hex");
      if (checksum !== backup.checksum) {
        throw new Error("Checksum do backup baixado não confere.");
      }
    }

    const pgRestore = await resolvePostgresBinary("pg_restore");
    tempDir = await mkdtemp(path.join(os.tmpdir(), "obracalc-restore-"));
    const dumpFile = path.join(tempDir, "backup.dump");
    await writeFile(dumpFile, buffer);

    await psqlScalar(
      connection,
      "postgres",
      `CREATE DATABASE ${quoteIdentifier(restoreTarget)}`
    );
    created = true;

    await runCommand(
      pgRestore,
      [
        "--host",
        connection.host,
        "--port",
        connection.port,
        "--username",
        connection.username,
        "--dbname",
        restoreTarget,
        "--no-owner",
        "--no-privileges",
        "--exit-on-error",
        dumpFile,
      ],
      { password: connection.password, sslmode: connection.sslmode }
    );

    const actual: Record<string, number> = {};
    for (const table of TRACKED_TABLES) {
      const value = await psqlScalar(
        connection,
        restoreTarget,
        `SELECT count(*) FROM ${quoteIdentifier(table)}`
      );
      actual[table] = Number(value);
    }

    const migrationsApplied = Number(
      await psqlScalar(
        connection,
        restoreTarget,
        `SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
      )
    );

    const expected = manifest?.tableCounts ?? {};
    const mismatches: Array<[string, string | number]> = Object.entries(
      expected
    ).filter(([table, count]) => actual[table] !== count);
    if (
      manifest?.migrationsApplied !== undefined &&
      migrationsApplied !== manifest.migrationsApplied
    ) {
      mismatches.push(["_prisma_migrations", manifest.migrationsApplied]);
    }

    if (mismatches.length > 0) {
      throw new Error(
        `Contagens divergentes após restauração: ${mismatches
          .map(([table, expectedCount]) => `${table} esperado=${expectedCount} obtido=${actual[table]}`)
          .join(", ")}`
      );
    }

    await prisma.backupLog.update({
      where: { id: backup.id },
      data: {
        restoreVerified: true,
        restoreCheckedAt: new Date(),
        restoreTarget,
      },
    });

    return {
      backupId: backup.id,
      verified: true,
      restoreTarget,
      expected,
      actual,
      migrationsApplied,
      durationMs: Date.now() - started,
    };
  } finally {
    if (created && !options?.keepDatabase) {
      try {
        const psql = await resolvePostgresBinary("psql");
        await runCommand(
          psql,
          [
            "--host",
            connection.host,
            "--port",
            connection.port,
            "--username",
            connection.username,
            "--dbname",
            "postgres",
            "--set=ON_ERROR_STOP=1",
            "--command",
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${restoreTarget}' AND pid <> pg_backend_pid();`,
          ],
          { password: connection.password, sslmode: connection.sslmode }
        );
        await psqlScalar(
          connection,
          "postgres",
          `DROP DATABASE IF EXISTS ${quoteIdentifier(restoreTarget)}`
        );
      } catch {
        // O banco temporário pode ser removido manualmente; não mascara o resultado.
      }
    }
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
}

export async function pruneOldBackups(days?: number): Promise<{
  removed: number;
  kept: number;
}> {
  const env = getEnvironment();
  const retention = days ?? env.BACKUP_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - retention * 24 * 60 * 60 * 1000);

  const candidates = await prisma.backupLog.findMany({
    where: { status: "COMPLETED", createdAt: { lt: cutoff }, storageKey: { not: null } },
    orderBy: { createdAt: "asc" },
  });

  let removed = 0;
  for (const backup of candidates) {
    if (!backup.storageKey) continue;
    try {
      if (backup.storageDriver === "s3" && isS3Configured(env)) {
        await s3DeleteObject(s3ConfigFromEnv(env), backup.storageKey);
      } else {
        const storage = getStorage((backup.storageDriver as StorageDriverName) || undefined);
        await storage.delete(backup.storageKey);
      }
      removed++;
    } catch {
      // Mantém o log para nova tentativa de expurgo.
    }
  }

  return { removed, kept: candidates.length - removed };
}
