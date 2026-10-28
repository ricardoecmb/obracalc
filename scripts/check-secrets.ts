import { execFileSync } from "node:child_process";
import { scanRepository } from "../src/lib/security/secret-scan";

function checkIgnoredEnvFiles(): string[] {
  const errors: string[] = [];
  for (const file of [".env", ".env.local", ".env.production"]) {
    try {
      execFileSync("git", ["check-ignore", "-q", file], {
        cwd: process.cwd(),
        stdio: "ignore",
      });
    } catch {
      errors.push(`${file} não está coberto pelo .gitignore.`);
    }
  }
  return errors;
}

function main() {
  const findings = scanRepository(process.cwd());
  const ignoreErrors = checkIgnoredEnvFiles();

  if (findings.length === 0 && ignoreErrors.length === 0) {
    console.log("Nenhum segredo versionado encontrado.");
    process.exit(0);
  }

  for (const finding of findings) {
    console.error(
      `[segredo] ${finding.file}:${finding.line} (${finding.pattern})`
    );
  }
  for (const error of ignoreErrors) {
    console.error(`[gitignore] ${error}`);
  }
  process.exit(1);
}

main();
