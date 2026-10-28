import { loadEnvConfig } from "@next/env";

async function main() {
  loadEnvConfig(process.cwd());

  const { createFullBackup, pruneOldBackups } = await import(
    "../src/lib/backup/backup-service"
  );

  if (process.argv.includes("--prune")) {
    const pruned = await pruneOldBackups();
    console.log(JSON.stringify({ event: "backup.prune", ...pruned }, null, 2));
    return;
  }

  const result = await createFullBackup();
  console.log(JSON.stringify({ event: "backup.create", ...result }, null, 2));

  if (result.status !== "COMPLETED") {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "Erro no backup:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
