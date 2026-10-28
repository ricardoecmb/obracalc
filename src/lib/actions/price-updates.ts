"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import {
  applyPriceUpdates,
  previewPriceUpdates,
  listResourcePriceHistory,
  type ApplyPriceUpdatesResult,
  type PriceUpdateInput,
  type PriceUpdatePreview,
} from "@/lib/services/price-update";

export interface PreviewPriceUpdatesActionResult {
  success: boolean;
  preview?: PriceUpdatePreview;
  error?: string;
}

export async function previewPriceUpdatesAction(
  updates: PriceUpdateInput[]
): Promise<PreviewPriceUpdatesActionResult> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  try {
    const preview = await previewPriceUpdates({ userId: user.id, updates });
    return { success: true, preview };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Erro ao simular atualização de preços.",
    };
  }
}

export interface ApplyPriceUpdatesActionResult extends ApplyPriceUpdatesResult {
  success: boolean;
}

export async function applyPriceUpdatesAction(params: {
  updates: PriceUpdateInput[];
  reason?: string;
}): Promise<ApplyPriceUpdatesActionResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      success: false,
      updatedResources: 0,
      historyEntries: 0,
      impacts: [],
      error: "Não autorizado",
    };
  }

  try {
    const result = await applyPriceUpdates({
      userId: user.id,
      updates: params.updates,
      reason: params.reason,
    });

    if (result.success) {
      revalidatePath("/resources");
      revalidatePath("/budgets");
      revalidatePath("/dashboard");
    }

    return result;
  } catch (error) {
    return {
      success: false,
      updatedResources: 0,
      historyEntries: 0,
      impacts: [],
      error:
        error instanceof Error ? error.message : "Erro ao aplicar atualização de preços.",
    };
  }
}

export interface PriceHistoryEntryDto {
  id: string;
  price: string;
  source: string | null;
  reason: string | null;
  author: string | null;
  effectiveDate: string;
  createdAt: string;
}

export async function listResourcePriceHistoryAction(
  resourceId: string
): Promise<{ success: boolean; entries?: PriceHistoryEntryDto[]; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  try {
    const entries = await listResourcePriceHistory({
      userId: user.id,
      resourceId,
    });

    return {
      success: true,
      entries: entries.map((entry) => ({
        id: entry.id,
        price: entry.price.toString(),
        source: entry.source,
        reason: entry.reason,
        author: entry.author,
        effectiveDate: entry.effectiveDate.toISOString(),
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Erro ao consultar histórico de preços.",
    };
  }
}
