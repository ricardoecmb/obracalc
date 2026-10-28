import { expect, test } from "@playwright/test";

test.describe("Fluxo autenticado", () => {
  test("login pt-BR e navegação até a importação", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Entrar na plataforma" })).toBeVisible();

    await page.getByLabel("E-mail profissional").fill("demo@obracalc.com.br");
    await page.getByLabel("Senha", { exact: true }).fill("demo123456");
    await page.getByRole("button", { name: /entrar/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
    await expect(page.getByText(/dashboard|visão geral|obras/i).first()).toBeVisible();

    await page.goto("/import");
    await expect(
      page.getByRole("heading", { name: /Importação de Tabelas e Preços/i })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Histórico de importações/i })
    ).toBeVisible();
  });
});
