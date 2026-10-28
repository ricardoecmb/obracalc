/**
 * Normalização de nomes de arquivo e chaves de armazenamento.
 * Impede path traversal e caracteres de controle em chaves de objeto.
 */

const MAX_FILE_NAME = 140;

export function sanitizeFileName(input: string): string {
  const base = (input || "arquivo.csv")
    .replace(/\\/g, "/")
    .split("/")
    .pop()!
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, MAX_FILE_NAME);

  return base || "arquivo.csv";
}

export function isSafeStorageKey(key: string): boolean {
  if (!key || key.length > 1024) return false;
  if (key.startsWith("/") || key.includes("\\")) return false;
  if (key.split("/").some((part) => part === ".." || part === ".")) return false;
  return /^[a-zA-Z0-9._/-]+$/.test(key);
}

/** Monta uma chave canônica, validando cada segmento. */
export function buildObjectKey(...parts: string[]): string {
  const normalized = parts
    .flatMap((part) => String(part).split("/"))
    .map((part) => part.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw new Error("Chave de armazenamento vazia.");
  }

  for (const part of normalized) {
    if (part === "." || part === ".." || part.includes("\\")) {
      throw new Error("Chave de armazenamento inválida.");
    }
  }

  const key = normalized
    .map((part) => part.replace(/[^a-zA-Z0-9._-]+/g, "-"))
    .join("/");

  if (!isSafeStorageKey(key)) {
    throw new Error("Chave de armazenamento inválida.");
  }

  return key;
}
