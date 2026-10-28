import { loadEnvConfig } from "@next/env";
import { validateEnvironment } from "../src/lib/config/env";

async function main() {
  loadEnvConfig(process.cwd());

  const production =
    process.argv.includes("--production") ||
    String(process.env.NODE_ENV ?? "").toLowerCase() === "production";

  const result = validateEnvironment(process.env, { production });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        production: result.production,
        storageDriver: result.storageDriver,
        missing: result.missing,
        errors: result.errors,
        warnings: result.warnings,
      },
      null,
      2
    )
  );

  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(
    "Erro ao validar ambiente:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
