import { timingSafeEqual } from "node:crypto";

/**
 * Comparação em tempo constante do header `Authorization` do cron.
 * Retorna `false` quando o segredo não está configurado — nunca libera por
 * ausência de configuração.
 */
export function isAuthorizedCron(
  authorization: string | null | undefined,
  secret: string | null | undefined
): boolean {
  if (!secret || !authorization) return false;

  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  const received = Buffer.from(authorization, "utf8");

  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
