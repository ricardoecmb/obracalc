"use server";

import { signIn } from "@/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { z } from "zod";
import crypto from "crypto";

const loginSchema = z.object({
  email: z
    .string()
    .min(1, "O e-mail é obrigatório.")
    .email("Informe um e-mail válido."),
  password: z.string().min(1, "A senha é obrigatória."),
});

export interface AuthActionResult {
  success?: boolean;
  error?: string;
  resetLink?: string;
  message?: string;
}

export async function loginAction(
  prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const email = (formData.get("email") as string)?.trim();
  const password = formData.get("password") as string;

  const validation = loginSchema.safeParse({ email, password });
  if (!validation.success) {
    return {
      error: validation.error.issues[0]?.message || "Credenciais inválidas.",
    };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });
    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return { error: "E-mail ou senha incorretos." };
        default:
          return { error: "Ocorreu um erro ao entrar. Tente novamente." };
      }
    }

    // Rethrow redirect error so Next.js handles the navigation to /dashboard
    throw error;
  }
}

const registerSchema = z
  .object({
    name: z
      .string()
      .min(2, "O nome deve conter pelo menos 2 caracteres.")
      .max(100, "O nome não pode exceder 100 caracteres."),
    email: z
      .string()
      .min(1, "O e-mail é obrigatório.")
      .email("Informe um e-mail válido."),
    password: z
      .string()
      .min(8, "A senha deve ter no mínimo 8 caracteres."),
    confirmPassword: z.string().min(1, "Confirme sua senha."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export async function registerAction(
  prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const name = (formData.get("name") as string)?.trim();
  const email = (formData.get("email") as string)?.trim().toLowerCase();
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  const validation = registerSchema.safeParse({
    name,
    email,
    password,
    confirmPassword,
  });

  if (!validation.success) {
    return {
      error: validation.error.issues[0]?.message || "Dados de cadastro inválidos.",
    };
  }

  try {
    // Single-user restriction: Check if a user already exists in the system
    const userCount = await prisma.user.count();
    if (userCount >= 1) {
      return {
        error:
          "O ObraCalc opera em modo de usuário único e já possui uma conta configurada. Faça login com o usuário existente.",
      };
    }

    // 1. Check if email already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return {
        error: "Este endereço de e-mail já está cadastrado. Faça login ou use outro.",
      };
    }

    // 2. Hash password with bcrypt (12 rounds)
    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    // 3. Create user and default preferences in database
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        preferences: {
          create: {
            locale: "pt-BR",
            currency: "BRL",
            defaultDecimalPlaces: 2,
            defaultRoundingMode: "ROUND_HALF_UP",
            sidebarCollapsed: false,
            theme: "light",
          },
        },
      },
    });

    // 4. Auto-login the newly created user
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });

    return { success: true };
  } catch (error) {
    if (error instanceof AuthError) {
      switch (error.type) {
        case "CredentialsSignin":
          return { error: "Erro na autenticação automática após registro." };
        default:
          return { error: "Ocorreu um erro ao criar a conta. Tente novamente." };
      }
    }

    // Rethrow redirect error so Next.js handles the navigation
    throw error;
  }
}

const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "O e-mail é obrigatório.")
    .email("Informe um e-mail válido."),
});

export async function requestPasswordResetAction(
  prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const email = (formData.get("email") as string)?.trim().toLowerCase();

  const validation = forgotPasswordSchema.safeParse({ email });
  if (!validation.success) {
    return {
      error: validation.error.issues[0]?.message || "E-mail inválido.",
    };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      // Do not reveal user existence, return general message
      return {
        success: true,
        message: "Se o e-mail estiver cadastrado, as instruções foram geradas.",
      };
    }

    // Generate secure random token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Store in password reset tokens table
    await prisma.passwordResetToken.create({
      data: {
        email,
        token,
        expiresAt,
      },
    });

    const resetLink = `/reset-password?token=${token}`;

    return {
      success: true,
      message: "Instruções de redefinição de senha geradas com sucesso.",
      resetLink,
    };
  } catch (error) {
    console.error("Erro ao solicitar recuperação de senha:", error);
    return { error: "Erro interno ao processar recuperação de senha." };
  }
}

const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Token de recuperação ausente."),
    password: z.string().min(8, "A nova senha deve ter no mínimo 8 caracteres."),
    confirmPassword: z.string().min(1, "Confirme sua nova senha."),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  });

export async function resetPasswordAction(
  prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const token = (formData.get("token") as string)?.trim();
  const password = formData.get("password") as string;
  const confirmPassword = formData.get("confirmPassword") as string;

  const validation = resetPasswordSchema.safeParse({
    token,
    password,
    confirmPassword,
  });

  if (!validation.success) {
    return {
      error: validation.error.issues[0]?.message || "Dados de redefinição inválidos.",
    };
  }

  try {
    const record = await prisma.passwordResetToken.findUnique({
      where: { token },
    });

    if (!record || record.expiresAt < new Date()) {
      return {
        error: "Token de redefinição inválido ou expirado. Solicite uma nova recuperação.",
      };
    }

    const saltRounds = 12;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    await prisma.$transaction([
      prisma.user.update({
        where: { email: record.email },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.delete({
        where: { token },
      }),
    ]);

    return {
      success: true,
      message: "Senha atualizada com sucesso! Você já pode entrar com a nova senha.",
    };
  } catch (error) {
    console.error("Erro ao redefinir senha:", error);
    return { error: "Erro interno ao redefinir a senha." };
  }
}
