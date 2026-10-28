import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

/**
 * Migração de produção. Usa DIRECT_URL quando disponível para evitar o
 * pooler de conexões (PgBouncer) durante o DDL, mantendo DATABASE_URL pooled
 * para o runtime da aplicação.
 */
async function main() {
  loadEnvConfig(process.cwd());

  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DIRECT_URL/DATABASE_URL não configurada. Defina a conexão do PostgreSQL antes de migrar."
    );
    process.exit(1);
  }

  const prismaCli = path.join(
    process.cwd(),
    "node_modules",
    "prisma",
    "build",
    "index.js"
  );

  let command = process.execPath;
  let args = [prismaCli, "migrate", "deploy"];

  try {
    await access(prismaCli);
  } catch {
    command = process.platform === "win32" ? "npx.cmd" : "npx";
    args = ["prisma", "migrate", "deploy"];
  }

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
    shell: process.platform === "win32" && command === "npx.cmd",
    windowsHide: true,
  });

  child.on("close", (code) => {
    if (code === 0) {
      console.log("Migrações aplicadas com sucesso.");
      process.exit(0);
    }
    console.error(`Falha ao aplicar migrações (código ${code}).`);
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error("Erro ao executar migrações:", error instanceof Error ? error.message : error);
  process.exit(1);
});
