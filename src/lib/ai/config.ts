/**
 * Configuração de provedores de IA — ObraCalc
 *
 * A IA é opcional. Nenhuma funcionalidade do sistema depende dela: quando não
 * há provedor ativo, o assistente opera apenas com busca determinística local.
 *
 * As chaves de API são criptografadas com AES-256-GCM e nunca retornadas ao
 * cliente — as listagens exibem apenas máscaras.
 */

import { prisma } from "@/lib/db/prisma";
import {
  decryptSecret,
  encryptSecret,
  isEncryptionConfigured,
  maskEncryptedSecret,
} from "@/lib/ai/crypto";

export const AI_PROVIDERS = ["openai", "gemini", "openrouter"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  openai: "OpenAI",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
};

export const AI_PROVIDER_DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
  openrouter: "openai/gpt-4o-mini",
};

export interface AIProviderDto {
  id: string;
  provider: AIProvider;
  providerLabel: string;
  model: string;
  keyMask: string;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  updatedAt: string;
}

export interface AIProviderStatus {
  encryptionConfigured: boolean;
  providerCount: number;
  activeProvider: AIProviderDto | null;
  providers: AIProviderDto[];
  availableProviders: Array<{
    id: AIProvider;
    label: string;
    defaultModel: string;
    configured: boolean;
    active: boolean;
  }>;
}

export function isAIProvider(value: string): value is AIProvider {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

function toDto(row: {
  id: string;
  provider: string;
  model: string | null;
  apiKeyEncrypted: string;
  isActive: boolean;
  lastTestedAt: Date | null;
  lastTestResult: string | null;
  updatedAt: Date;
}): AIProviderDto {
  const provider = isAIProvider(row.provider) ? row.provider : "openai";
  return {
    id: row.id,
    provider,
    providerLabel: AI_PROVIDER_LABELS[provider],
    model: row.model || AI_PROVIDER_DEFAULT_MODELS[provider],
    keyMask: maskEncryptedSecret(row.apiKeyEncrypted),
    isActive: row.isActive,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestResult: row.lastTestResult,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Lista os provedores do usuário e o status geral do assistente.
 * Nunca decripta nem retorna a chave.
 */
export async function listAIProviders(userId: string): Promise<AIProviderStatus> {
  const rows = await prisma.aiProviderConfig.findMany({
    where: { userId },
    orderBy: [{ isActive: "desc" }, { provider: "asc" }],
  });

  const providers = rows.map(toDto);
  const activeProvider =
    providers.find((provider) => provider.isActive) ?? null;
  const configured = new Set(providers.map((provider) => provider.provider));

  return {
    encryptionConfigured: isEncryptionConfigured(),
    providerCount: providers.length,
    activeProvider,
    providers,
    availableProviders: AI_PROVIDERS.map((provider) => ({
      id: provider,
      label: AI_PROVIDER_LABELS[provider],
      defaultModel: AI_PROVIDER_DEFAULT_MODELS[provider],
      configured: configured.has(provider),
      active: activeProvider?.provider === provider,
    })),
  };
}

/**
 * Cria ou atualiza a configuração de um provedor. A operação é idempotente por
 * (userId, provider) e sempre substitui a chave quando uma nova é informada.
 */
export async function upsertAIProvider(params: {
  userId: string;
  provider: AIProvider;
  model?: string | null;
  apiKey: string;
  isActive?: boolean;
}): Promise<AIProviderDto> {
  const secret = encryptSecret(params.apiKey);
  const model =
    params.model?.trim() || AI_PROVIDER_DEFAULT_MODELS[params.provider];

  const row = await prisma.$transaction(async (tx) => {
    if (params.isActive !== false) {
      await tx.aiProviderConfig.updateMany({
        where: { userId: params.userId },
        data: { isActive: false },
      });
    }

    return tx.aiProviderConfig.upsert({
      where: {
        userId_provider: {
          userId: params.userId,
          provider: params.provider,
        },
      },
      create: {
        userId: params.userId,
        provider: params.provider,
        model,
        apiKeyEncrypted: secret.encrypted,
        apiKeyIv: secret.iv,
        isActive: params.isActive !== false,
      },
      update: {
        model,
        apiKeyEncrypted: secret.encrypted,
        apiKeyIv: secret.iv,
        isActive: params.isActive !== false,
        lastTestedAt: null,
        lastTestResult: null,
      },
    });
  });

  return toDto(row);
}

/** Ativa um provedor já configurado, desativando os demais. */
export async function activateAIProvider(params: {
  userId: string;
  provider: AIProvider;
}): Promise<AIProviderStatus> {
  const existing = await prisma.aiProviderConfig.findUnique({
    where: {
      userId_provider: { userId: params.userId, provider: params.provider },
    },
  });

  if (!existing) {
    throw new Error("Provedor não configurado.");
  }

  await prisma.$transaction([
    prisma.aiProviderConfig.updateMany({
      where: { userId: params.userId },
      data: { isActive: false },
    }),
    prisma.aiProviderConfig.update({
      where: { id: existing.id },
      data: { isActive: true },
    }),
  ]);

  return listAIProviders(params.userId);
}

/** Remove a configuração de um provedor. */
export async function deleteAIProvider(params: {
  userId: string;
  provider: AIProvider;
}): Promise<AIProviderStatus> {
  await prisma.aiProviderConfig.deleteMany({
    where: { userId: params.userId, provider: params.provider },
  });

  return listAIProviders(params.userId);
}

/**
 * Testa a configuração registrando o resultado. Não faz chamada de rede por
 * padrão: valida a presença e a decriptação da chave, que é o suficiente para
 * garantir que o segredo foi armazenado corretamente. O teste de rede é feito
 * opcionalmente por `invokeProvider`.
 */
export async function recordProviderTest(params: {
  userId: string;
  provider: AIProvider;
  result: "SUCCESS" | "FAILED";
}): Promise<AIProviderDto> {
  const row = await prisma.aiProviderConfig.findUnique({
    where: {
      userId_provider: { userId: params.userId, provider: params.provider },
    },
  });

  if (!row) {
    throw new Error("Provedor não configurado.");
  }

  const updated = await prisma.aiProviderConfig.update({
    where: { id: row.id },
    data: {
      lastTestedAt: new Date(),
      lastTestResult: params.result,
    },
  });

  return toDto(updated);
}

/** Valida que a chave armazenada pode ser decriptada sem expô-la. */
export async function verifyStoredKey(params: {
  userId: string;
  provider: AIProvider;
}): Promise<boolean> {
  const row = await prisma.aiProviderConfig.findUnique({
    where: {
      userId_provider: { userId: params.userId, provider: params.provider },
    },
  });
  if (!row) return false;

  try {
    const value = decryptSecret(row.apiKeyEncrypted, row.apiKeyIv);
    return value.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Uso interno do servidor: devolve a configuração ativa com a chave
 * decriptada. Jamais deve ser exposta em server actions ou respostas HTTP.
 */
export async function getActiveProviderCredentials(userId: string): Promise<{
  provider: AIProvider;
  model: string;
  apiKey: string;
} | null> {
  const row = await prisma.aiProviderConfig.findFirst({
    where: { userId, isActive: true },
  });
  if (!row) return null;

  const provider = isAIProvider(row.provider) ? row.provider : "openai";

  try {
    return {
      provider,
      model: row.model || AI_PROVIDER_DEFAULT_MODELS[provider],
      apiKey: decryptSecret(row.apiKeyEncrypted, row.apiKeyIv),
    };
  } catch {
    return null;
  }
}
