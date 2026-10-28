import { z } from "zod";

/**
 * Validação centralizada de variáveis de ambiente.
 *
 * Nenhuma mensagem de erro inclui valores, apenas nomes de variáveis. Isso
 * permite exibir o resultado em logs e no endpoint de saúde sem vazar segredos.
 */

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const optionalSecret = z.preprocess(
  emptyToUndefined,
  z.string().min(16, "deve ter pelo menos 16 caracteres").optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  DATABASE_URL: z.string().min(1, "é obrigatória"),
  DIRECT_URL: optionalUrl,

  AUTH_SECRET: optionalString,
  AUTH_URL: optionalUrl,
  NEXTAUTH_URL: optionalUrl,

  NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("obracalc")
  ),

  STORAGE_DRIVER: z.preprocess(
    emptyToUndefined,
    z.enum(["local", "supabase"]).optional()
  ),
  STORAGE_LOCAL_DIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default(".storage")
  ),

  IMPORT_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024)
    .default(25 * 1024 * 1024),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(100_000),
  IMPORT_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().max(10).default(3),
  IMPORT_JOB_STALE_MINUTES: z.coerce.number().int().positive().default(15),
  IMPORT_CRON_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(5),

  CRON_SECRET: optionalSecret,

  BACKUP_S3_BUCKET: optionalString,
  BACKUP_S3_REGION: optionalString,
  BACKUP_S3_ACCESS_KEY: optionalString,
  BACKUP_S3_SECRET_KEY: optionalString,
  BACKUP_PREFIX: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default("backups")
  ),
  BACKUP_RETENTION_DAYS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().default(30)
  ),

  AI_ENCRYPTION_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, "deve ter 64 caracteres hexadecimais")
      .optional()
  ),
  OPENAI_API_KEY: optionalString,
  GEMINI_API_KEY: optionalString,
  OPENROUTER_API_KEY: optionalString,
});

export type AppEnv = z.infer<typeof envSchema>;

export interface EnvironmentValidation {
  ok: boolean;
  production: boolean;
  errors: string[];
  warnings: string[];
  /** Nomes das variáveis obrigatórias que estão ausentes. */
  missing: string[];
  storageDriver: "local" | "supabase" | "s3";
}

export interface ParsedEnvironment {
  success: boolean;
  data?: AppEnv;
  errors: string[];
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".") || "ambiente";
    return `${path}: ${issue.message}`;
  });
}

export function parseEnvironment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): ParsedEnvironment {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    return { success: false, errors: formatIssues(result.error) };
  }
  return { success: true, data: result.data, errors: [] };
}

let cachedEnv: AppEnv | undefined;

/** Carrega e valida o ambiente, lançando erro descritivo (sem valores). */
export function loadEnvironment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): AppEnv {
  const parsed = parseEnvironment(source);
  if (!parsed.success || !parsed.data) {
    throw new Error(
      `Configuração de ambiente inválida: ${parsed.errors.join("; ")}`
    );
  }
  return parsed.data;
}

/** Versão memoizada para uso em runtime. */
export function getEnvironment(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = loadEnvironment();
  }
  return cachedEnv;
}

/** Usado em testes que alteram variáveis de ambiente. */
export function resetEnvironmentCache(): void {
  cachedEnv = undefined;
}

export function resolveStorageDriver(
  env: Pick<
    AppEnv,
    "STORAGE_DRIVER" | "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"
  > = getEnvironment()
): "local" | "supabase" {
  if (env.STORAGE_DRIVER) return env.STORAGE_DRIVER;
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return "supabase";
  }
  return "local";
}

export function isS3Configured(
  env: Pick<
    AppEnv,
    "BACKUP_S3_BUCKET" | "BACKUP_S3_REGION" | "BACKUP_S3_ACCESS_KEY" | "BACKUP_S3_SECRET_KEY"
  > = getEnvironment()
): boolean {
  return Boolean(
    env.BACKUP_S3_BUCKET &&
      env.BACKUP_S3_REGION &&
      env.BACKUP_S3_ACCESS_KEY &&
      env.BACKUP_S3_SECRET_KEY
  );
}

/**
 * Validação orientada a produção. Retorna erros bloqueantes e avisos.
 * `source` permite testar a configuração sem alterar process.env.
 */
export function validateEnvironment(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options?: { production?: boolean }
): EnvironmentValidation {
  const parsed = parseEnvironment(source);
  const errors = [...parsed.errors];
  const warnings: string[] = [];
  const missing: string[] = [];
  const production =
    options?.production ?? String(source.NODE_ENV ?? "").toLowerCase() === "production";

  if (!parsed.success || !parsed.data) {
    return {
      ok: false,
      production,
      errors,
      warnings,
      missing,
      storageDriver: "local",
    };
  }

  const env = parsed.data;

  if (!env.DATABASE_URL.startsWith("postgres")) {
    errors.push("DATABASE_URL: deve ser uma URL PostgreSQL.");
  }

  if (production) {
    if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) {
      missing.push("AUTH_SECRET");
      errors.push("AUTH_SECRET: obrigatória em produção (mínimo 32 caracteres).");
    }
    if (!env.AUTH_URL && !env.NEXTAUTH_URL) {
      missing.push("AUTH_URL");
      errors.push("AUTH_URL: obrigatória em produção para cookies e callbacks.");
    }
    if (!env.CRON_SECRET) {
      missing.push("CRON_SECRET");
      errors.push("CRON_SECRET: obrigatória em produção para proteger o cron de importações.");
    }
  }

  const driver = resolveStorageDriver(env);
  if (driver === "supabase") {
    if (!env.NEXT_PUBLIC_SUPABASE_URL) {
      missing.push("NEXT_PUBLIC_SUPABASE_URL");
      errors.push("NEXT_PUBLIC_SUPABASE_URL: obrigatória quando o storage é Supabase.");
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      missing.push("SUPABASE_SERVICE_ROLE_KEY");
      errors.push("SUPABASE_SERVICE_ROLE_KEY: obrigatória quando o storage é Supabase.");
    }
  } else if (production) {
    errors.push(
      "STORAGE_DRIVER: em produção use 'supabase'; o disco local é efêmero na Vercel."
    );
  }

  if (production && !env.DIRECT_URL) {
    warnings.push(
      "DIRECT_URL: recomenda-se configurar a conexão direta para migrações (DATABASE_URL pode ser pooled)."
    );
  }
  if (production && !isS3Configured(env) && driver === "supabase") {
    warnings.push(
      "BACKUP_S3_*: não configurado; os backups usarão o bucket Supabase como destino externo."
    );
  }
  if (!env.AI_ENCRYPTION_KEY) {
    warnings.push(
      "AI_ENCRYPTION_KEY: não configurada; as chaves de IA serão derivadas de AUTH_SECRET."
    );
  }

  return {
    ok: errors.length === 0,
    production,
    errors,
    warnings,
    missing,
    storageDriver: driver,
  };
}
