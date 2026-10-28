/**
 * Criptografia de chaves de API — ObraCalc
 *
 * AES-256-GCM com IV aleatório por registro. O schema guarda apenas dois
 * campos: `apiKeyEncrypted` e `apiKeyIv`. Como o GCM exige o auth tag para
 * decriptar, o tag é prefixado ao ciphertext no formato `tag.ciphertext`
 * (ambos em Base64). O IV fica no campo dedicado.
 *
 * A chave mestra nunca é persistida no banco. Ela vem de
 * `AI_ENCRYPTION_KEY` (64 hex ou Base64 de 32 bytes) ou é derivada de
 * `AUTH_SECRET` via SHA-256 com um salt fixo de domínio.
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_DOMAIN_SALT = "obracalc:ai-provider-key:v1";

export interface EncryptedSecret {
  encrypted: string;
  iv: string;
}

function decodeKeyMaterial(raw: string): Buffer | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const base64 = Buffer.from(trimmed, "base64");
    if (base64.length === 32) return base64;
  } catch {
    // ignora e tenta a derivação por hash
  }

  return null;
}

/**
 * Deriva a chave mestra de 32 bytes. Lança erro apenas quando não há nenhuma
 * fonte de segredo configurada — o restante do sistema continua funcional.
 */
export function getEncryptionKey(): Buffer {
  const explicit = process.env.AI_ENCRYPTION_KEY;
  if (explicit) {
    const decoded = decodeKeyMaterial(explicit);
    if (decoded) return decoded;
  }

  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "Chave de criptografia de IA não configurada. Defina AI_ENCRYPTION_KEY ou AUTH_SECRET."
    );
  }

  return crypto.createHash("sha256").update(`${KEY_DOMAIN_SALT}:${secret}`).digest();
}

/** Criptografa um segredo e devolve os dois campos persistíveis. */
export function encryptSecret(plainText: string): EncryptedSecret {
  const value = plainText.trim();
  if (value.length === 0) {
    throw new Error("A chave de API não pode ser vazia.");
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: `${authTag.toString("base64")}.${ciphertext.toString("base64")}`,
    iv: iv.toString("base64"),
  };
}

/** Decripta um segredo armazenado. Nunca deve ser exposto ao cliente. */
export function decryptSecret(encrypted: string, iv: string): string {
  const [tagPart, dataPart] = encrypted.split(".");
  if (!tagPart || !dataPart) {
    throw new Error("Formato de segredo criptografado inválido.");
  }

  const key = getEncryptionKey();
  const authTag = Buffer.from(tagPart, "base64");
  const ciphertext = Buffer.from(dataPart, "base64");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(authTag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * Mascara uma chave para exibição. Nunca retorna o valor completo; chaves
 * muito curtas são totalmente ocultas.
 */
export function maskSecret(plainText: string | null | undefined): string {
  if (!plainText) return "";
  const value = plainText.trim();
  if (value.length <= 8) return "••••••••";
  return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

/**
 * Mascara um segredo já criptografado sem decriptá-lo. Usado nas listagens
 * para evitar qualquer operação de decriptação desnecessária.
 */
export function maskEncryptedSecret(encrypted: string | null | undefined): string {
  if (!encrypted) return "";
  return "••••••••";
}

/** Verifica se há material de chave disponível no ambiente. */
export function isEncryptionConfigured(): boolean {
  return Boolean(
    process.env.AI_ENCRYPTION_KEY ||
      process.env.AUTH_SECRET ||
      process.env.NEXTAUTH_SECRET
  );
}
