import { describe, expect, it } from "vitest";
import {
  parseEnvironment,
  validateEnvironment,
} from "@/lib/config/env";
import { isAuthorizedCron } from "@/lib/security/cron";
import {
  buildObjectKey,
  isSafeStorageKey,
  sanitizeFileName,
} from "@/lib/security/paths";
import {
  scanContent,
  scanRepository,
  SECRET_PATTERNS,
} from "@/lib/security/secret-scan";

const productionEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://app:password@db.example.com:5432/obracalc",
  DIRECT_URL: "postgresql://app:password@db.example.com:5432/obracalc",
  AUTH_SECRET: "a".repeat(48),
  AUTH_URL: "https://obracalc.example.com",
  STORAGE_DRIVER: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  CRON_SECRET: "c".repeat(32),
};

describe("Etapa 12 — validação de ambiente", () => {
  it("aceita uma configuração de produção completa", () => {
    const result = validateEnvironment(productionEnv, { production: true });
    expect(result.ok).toBe(true);
    expect(result.storageDriver).toBe("supabase");
    expect(result.missing).toEqual([]);
  });

  it("bloqueia produção sem segredos e sem storage persistente", () => {
    const result = validateEnvironment(
      {
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://app:password@db.example.com:5432/obracalc",
      },
      { production: true }
    );

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("AUTH_SECRET");
    expect(result.errors.join(" ")).toContain("AUTH_URL");
    expect(result.errors.join(" ")).toContain("CRON_SECRET");
    expect(result.errors.join(" ")).toContain("STORAGE_DRIVER");
  });

  it("rejeita chave de IA malformada sem exibir o valor", () => {
    const parsed = parseEnvironment({
      DATABASE_URL: "postgresql://app:password@db.example.com:5432/obracalc",
      AI_ENCRYPTION_KEY: "not-a-hex-key",
    });
    expect(parsed.success).toBe(false);
    expect(parsed.errors.join(" ")).toContain("AI_ENCRYPTION_KEY");
    expect(parsed.errors.join(" ")).not.toContain("not-a-hex-key");
  });

  it("permite storage local em desenvolvimento", () => {
    const result = validateEnvironment({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://app:password@db.example.com:5432/obracalc",
    });
    expect(result.ok).toBe(true);
    expect(result.storageDriver).toBe("local");
  });
});

describe("Etapa 12 — autenticação do cron", () => {
  const secret = "super-secret-cron-value";

  it("aceita exatamente o Bearer token configurado", () => {
    expect(isAuthorizedCron(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejeita token ausente, incorreto ou de tamanho diferente", () => {
    expect(isAuthorizedCron(null, secret)).toBe(false);
    expect(isAuthorizedCron("Bearer outro-valor", secret)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCron(`Bearer ${secret}`, "")).toBe(false);
  });
});

describe("Etapa 12 — caminhos e nomes de arquivo", () => {
  it("remove traversal e caracteres perigosos", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\temp\\relatório SINAPI.csv")).toBe(
      "relatorio-SINAPI.csv"
    );
    expect(sanitizeFileName("   ")).toBe("arquivo.csv");
  });

  it("valida chaves de armazenamento", () => {
    expect(isSafeStorageKey("imports/user/2026/01/job/file.csv")).toBe(true);
    expect(isSafeStorageKey("../outside.csv")).toBe(false);
    expect(isSafeStorageKey("/absolute.csv")).toBe(false);
    expect(isSafeStorageKey("a\\b.csv")).toBe(false);
    expect(() => buildObjectKey("imports", "..", "file.csv")).toThrow();
  });
});

describe("Etapa 12 — nenhum segredo versionado", () => {
  it("detecta padrões de alto risco", () => {
    const fakeAws = `AKIA${"A".repeat(16)}`;
    const fakePrivate = `-----BEGIN ${"RSA "}PRIVATE KEY-----`;
    const findings = scanContent(
      "config.ts",
      `const key = "${fakeAws}";\n${fakePrivate}\n`
    );
    expect(findings.map((finding) => finding.pattern)).toEqual(
      expect.arrayContaining(["aws-access-key", "private-key-block"])
    );
  });

  it("não encontra segredos nos arquivos do repositório", () => {
    const findings = scanRepository(process.cwd());
    expect(findings).toEqual([]);
  });

  it("mantém uma lista de padrões cobrindo chaves privadas e tokens", () => {
    const names = SECRET_PATTERNS.map((pattern) => pattern.name);
    expect(names).toContain("private-key-block");
    expect(names).toContain("openai-key");
    expect(names).toContain("supabase-service-role-jwt");
  });
});
