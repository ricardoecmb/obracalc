import { loadEnvConfig } from "@next/env";

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  const prefixed = process.argv.find((arg) => arg.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1);
}

async function main() {
  loadEnvConfig(process.cwd());

  const { restoreAndVerifyBackup } = await import(
    "../src/lib/backup/backup-service"
  );

  const backupId = readOption("--backup-id");
  const keepDatabase = process.argv.includes("--keep-database");

  const result = await restoreAndVerifyBackup({ backupId, keepDatabase });
  console.log(
    JSON.stringify({ event: "backup.restore-verify", ...result }, null, 2)
  );

  if (!result.verified) process.exit(1);
}

main().catch((error) => {
  console.error(
    "Falha na verificação de restauração:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
