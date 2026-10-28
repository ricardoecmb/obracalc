import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Verificação de que nenhum segredo foi versionado.
 * Inspeciona apenas arquivos rastreados pelo Git (ou uma lista fornecida).
 */

export interface SecretFinding {
  file: string;
  pattern: string;
  line: number;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: "private-key-block",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  },
  { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "openai-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  {
    name: "supabase-service-role-jwt",
    regex: /\beyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: "postgres-url-with-secret",
    regex: /postgres(?:ql)?:\/\/[^\s"'<>]+:[^\s"'<>@]+@(?!localhost|127\.0\.0\.1|db\.example)[^\s"'<>/]+/i,
  },
];

const IGNORED_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".dump",
  ".xlsx",
]);

const IGNORED_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "tsconfig.tsbuildinfo",
]);

function isEnvFile(file: string): boolean {
  const name = path.basename(file);
  return name === ".env" || name.startsWith(".env.") || name === ".env.local";
}

function isExampleEnv(file: string): boolean {
  const name = path.basename(file);
  return name === ".env.example" || name.endsWith(".env.example");
}

export function listTrackedFiles(root: string): string[] {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    return output.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Arquivos versionados + novos arquivos não ignorados. É a lista usada pelo
 * check de segredos antes do commit, quando os arquivos ainda estão untracked.
 */
export function listCandidateFiles(root: string): string[] {
  try {
    const output = execFileSync(
      "git",
      ["ls-files", "-co", "--exclude-standard", "-z"],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    return output.split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

export function scanContent(file: string, content: string): SecretFinding[] {
  const findings: SecretFinding[] = [];

  if (isEnvFile(file) && !isExampleEnv(file)) {
    findings.push({ file, pattern: "env-file-tracked", line: 1 });
  }

  if (isExampleEnv(file) || IGNORED_FILES.has(path.basename(file))) {
    return findings;
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    for (const pattern of SECRET_PATTERNS) {
      if (
        pattern.name === "openai-key" &&
        /sk-(?:super-secret|provider-secret|test|fake|dummy|example)/i.test(line)
      ) {
        continue;
      }
      if (pattern.regex.test(line)) {
        findings.push({ file, pattern: pattern.name, line: index + 1 });
      }
    }
  }

  return findings;
}

export function scanRepository(
  root: string,
  files: string[] = listCandidateFiles(root)
): SecretFinding[] {
  const findings: SecretFinding[] = [];

  for (const relative of files) {
    if (relative.startsWith("node_modules/") || relative.startsWith(".next/")) {
      continue;
    }
    if (IGNORED_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      continue;
    }

    const absolute = path.join(root, relative);
    try {
      if (!statSync(absolute).isFile()) continue;
      if (statSync(absolute).size > 2 * 1024 * 1024) continue;
      findings.push(...scanContent(relative, readFileSync(absolute, "utf8")));
    } catch {
      // Arquivo removido ou ilegível: ignorado.
    }
  }

  return findings;
}

export { SECRET_PATTERNS, isEnvFile, isExampleEnv };
