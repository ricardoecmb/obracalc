import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

// Carrega .env para os testes de integração (Prisma também carrega, mas a
// validação centralizada precisa das mesmas variáveis).
loadEnvConfig(process.cwd());

// Isola arquivos enviados pelos testes em um diretório temporário.
process.env.STORAGE_LOCAL_DIR =
  process.env.STORAGE_LOCAL_DIR ??
  path.join(os.tmpdir(), "obracalc-vitest-storage");

if (!process.env.CRON_SECRET) {
  process.env.CRON_SECRET = "test-cron-secret-0123456789";
}
