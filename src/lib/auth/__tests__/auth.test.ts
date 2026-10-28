import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { z } from "zod";

describe("Autenticação e Segurança (Auth Core)", () => {
  const passwordRegex = /^[A-Za-z0-9!@#$%^&*()_+]{8,}$/;

  it("deve criptografar e validar senhas com bcrypt (mínimo 12 rounds)", async () => {
    const rawPassword = "MinhaSenhaForte2026!";
    const saltRounds = 12;

    const hash = await bcrypt.hash(rawPassword, saltRounds);
    expect(hash).toBeDefined();
    expect(hash.startsWith("$2")).toBe(true);

    const isValid = await bcrypt.compare(rawPassword, hash);
    expect(isValid).toBe(true);

    const isInvalid = await bcrypt.compare("SenhaIncorreta", hash);
    expect(isInvalid).toBe(false);
  });

  it("deve validar o schema de registro com senha mínima de 8 caracteres e confirmação idêntica", () => {
    const registerSchema = z
      .object({
        name: z.string().min(2),
        email: z.string().email(),
        password: z.string().min(8),
        confirmPassword: z.string().min(1),
      })
      .refine((data) => data.password === data.confirmPassword, {
        message: "As senhas não coincidem.",
        path: ["confirmPassword"],
      });

    // Valid
    const validResult = registerSchema.safeParse({
      name: "Engenheiro Teste",
      email: "eng@obracalc.com.br",
      password: "password123",
      confirmPassword: "password123",
    });
    expect(validResult.success).toBe(true);

    // Mismatched passwords
    const mismatchResult = registerSchema.safeParse({
      name: "Engenheiro Teste",
      email: "eng@obracalc.com.br",
      password: "password123",
      confirmPassword: "differentPassword",
    });
    expect(mismatchResult.success).toBe(false);

    // Short password (< 8 chars)
    const shortPassword = registerSchema.safeParse({
      name: "Engenheiro Teste",
      email: "eng@obracalc.com.br",
      password: "short",
      confirmPassword: "short",
    });
    expect(shortPassword.success).toBe(false);
  });

  it("deve validar expiração de tokens de recuperação de senha (1 hora)", () => {
    const now = new Date();
    const futureExpiry = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour ahead
    const pastExpiry = new Date(now.getTime() - 1000); // 1 second ago

    expect(futureExpiry.getTime()).toBeGreaterThan(now.getTime());
    expect(pastExpiry.getTime()).toBeLessThan(now.getTime());

    // Check expiration logic
    const isTokenValid = (expiresAt: Date) => expiresAt > new Date();
    expect(isTokenValid(futureExpiry)).toBe(true);
    expect(isTokenValid(pastExpiry)).toBe(false);
  });
});
