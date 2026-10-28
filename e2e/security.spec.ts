import { expect, test } from "@playwright/test";

test.describe("Saúde e segurança básica", () => {
  test("healthcheck responde sem expor segredos", async ({ request }) => {
    const response = await request.get("/api/health");
    expect([200, 503]).toContain(response.status());

    const body = await response.json();
    expect(body.checks.database).toBe(true);
    expect(body.checks.environment).toBe(true);

    // O healthcheck pode citar nomes de variáveis (ex.: AUTH_SECRET), mas nunca
    // seus valores, URLs de conexão ou tokens.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/postgres(ql)?:\/\//i);
    expect(serialized).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{16,}/);
    expect(serialized).not.toMatch(/\bsk-[A-Za-z0-9_-]{20,}\b/);
    expect(serialized).not.toMatch(/\bAKIA[0-9A-Z]{16}\b/);
    expect(serialized).not.toMatch(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./);
    expect(serialized).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
  });

  test("API de importação exige autenticação", async ({ request }) => {
    const response = await request.get("/api/import/jobs");
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error).toBeTruthy();
  });

  test("cron sem segredo não processa a fila", async ({ request }) => {
    const response = await request.get("/api/cron/import-jobs");
    expect(response.status()).not.toBe(200);
  });

  test("rota protegida redireciona para o login", async ({ request }) => {
    const response = await request.get("/dashboard", { maxRedirects: 0 });
    expect([307, 308]).toContain(response.status());
    expect(response.headers()["location"]).toContain("/login");
  });

  test("cabeçalhos de segurança estão presentes", async ({ request }) => {
    const response = await request.get("/login");
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
