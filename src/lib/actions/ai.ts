"use server";

/**
 * Server actions do assistente e dos provedores de IA — ObraCalc
 *
 * Nenhuma action devolve chaves de API. O assistente só lê dados; não existe
 * caminho de escrita para preços, coeficientes ou quantidades.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  activateAIProvider,
  deleteAIProvider,
  isAIProvider,
  listAIProviders,
  recordProviderTest,
  upsertAIProvider,
  verifyStoredKey,
  AI_PROVIDERS,
  type AIProviderStatus,
} from "@/lib/ai/config";
import {
  answerAssistantQuestion,
  assistedSearch,
  suggestForRevision,
  type AssistantAnswer,
  type AssistantSearchHit,
  type AssistantSuggestion,
} from "@/lib/ai/assistant";

export interface AIActionResult {
  success: boolean;
  error?: string;
}

const providerSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().max(120).optional().nullable(),
  apiKey: z.string().trim().min(8, "A chave de API deve ter ao menos 8 caracteres.").max(500),
  isActive: z.boolean().optional(),
});

const providerRefSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
});

const askSchema = z.object({
  query: z.string().trim().max(2000).default(""),
  revisionId: z.string().trim().min(1).max(64).optional().nullable(),
});

const searchSchema = z.object({
  query: z.string().trim().min(1, "Informe um termo de busca.").max(300),
  limit: z.number().int().min(1).max(25).optional(),
});

const revisionSchema = z.object({
  revisionId: z.string().trim().min(1).max(64),
});

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Dados inválidos.";
}

export interface GetAIStatusActionResult {
  success: boolean;
  status?: AIProviderStatus;
  error?: string;
}

export async function getAIStatusAction(): Promise<GetAIStatusActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  try {
    const status = await listAIProviders(user.id);
    return { success: true, status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao carregar provedores.",
    };
  }
}

export interface SaveAIProviderActionResult extends AIActionResult {
  status?: AIProviderStatus;
}

export async function saveAIProviderAction(
  input: unknown
): Promise<SaveAIProviderActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  const parsed = providerSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  if (!isAIProvider(parsed.data.provider)) {
    return { success: false, error: "Provedor inválido." };
  }

  try {
    await upsertAIProvider({
      userId: user.id,
      provider: parsed.data.provider,
      model: parsed.data.model ?? null,
      apiKey: parsed.data.apiKey,
      isActive: parsed.data.isActive,
    });

    try {
      revalidatePath("/assistant");
    } catch {
      // Ignora fora do contexto HTTP.
    }

    const status = await listAIProviders(user.id);
    return { success: true, status };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Erro ao salvar provedor de IA.",
    };
  }
}

export async function activateAIProviderAction(
  input: unknown
): Promise<SaveAIProviderActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  const parsed = providerRefSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    const status = await activateAIProvider({
      userId: user.id,
      provider: parsed.data.provider,
    });
    revalidatePathSafe();
    return { success: true, status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao ativar provedor.",
    };
  }
}

export async function deleteAIProviderAction(
  input: unknown
): Promise<SaveAIProviderActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  const parsed = providerRefSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    const status = await deleteAIProvider({
      userId: user.id,
      provider: parsed.data.provider,
    });
    revalidatePathSafe();
    return { success: true, status };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao remover provedor.",
    };
  }
}

export interface TestAIProviderActionResult extends AIActionResult {
  tested: boolean;
}

export async function testAIProviderAction(
  input: unknown
): Promise<TestAIProviderActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado", tested: false };

  const parsed = providerRefSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: firstIssue(parsed.error), tested: false };
  }

  try {
    const valid = await verifyStoredKey({
      userId: user.id,
      provider: parsed.data.provider,
    });

    await recordProviderTest({
      userId: user.id,
      provider: parsed.data.provider,
      result: valid ? "SUCCESS" : "FAILED",
    });

    revalidatePathSafe();

    return valid
      ? {
          success: true,
          tested: true,
          error: undefined,
        }
      : {
          success: false,
          tested: false,
          error:
            "A chave armazenada não pôde ser validada. Salve novamente a chave de API.",
        };
  } catch (error) {
    return {
      success: false,
      tested: false,
      error: error instanceof Error ? error.message : "Erro ao testar provedor.",
    };
  }
}

export interface AskAssistantActionResult extends AIActionResult {
  answer?: AssistantAnswer;
}

export async function askAssistantAction(
  input: unknown
): Promise<AskAssistantActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  const parsed = askSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  if (!parsed.data.query && !parsed.data.revisionId) {
    return {
      success: false,
      error: "Informe uma pergunta ou selecione uma revisão para análise.",
    };
  }

  try {
    const answer = await answerAssistantQuestion({
      userId: user.id,
      query: parsed.data.query ?? "",
      revisionId: parsed.data.revisionId ?? null,
    });
    return { success: true, answer };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Erro ao consultar o assistente.",
    };
  }
}

export interface SearchAssistantActionResult extends AIActionResult {
  hits?: AssistantSearchHit[];
}

export async function searchAssistantAction(
  input: unknown
): Promise<SearchAssistantActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  const parsed = searchSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    const hits = await assistedSearch({
      userId: user.id,
      query: parsed.data.query,
      limit: parsed.data.limit,
    });
    return { success: true, hits };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro na busca assistida.",
    };
  }
}

export interface SuggestRevisionActionResult extends AIActionResult {
  suggestions?: AssistantSuggestion[];
  budgetTitle?: string;
  revisionNumber?: number;
}

export async function suggestRevisionAction(
  input: unknown
): Promise<SuggestRevisionActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  const parsed = revisionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: firstIssue(parsed.error) };

  try {
    const outcome = await suggestForRevision({
      userId: user.id,
      revisionId: parsed.data.revisionId,
    });
    return {
      success: true,
      suggestions: outcome.suggestions,
      budgetTitle: outcome.budgetTitle,
      revisionNumber: outcome.revisionNumber,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Erro ao gerar sugestões.",
    };
  }
}

function revalidatePathSafe() {
  try {
    revalidatePath("/assistant");
  } catch {
    // Ignora fora do contexto HTTP (testes).
  }
}
