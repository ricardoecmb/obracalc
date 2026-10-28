"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth-utils";
import { verifySnapshotIntegrity } from "@/lib/services/snapshot";
import {
  compareRevisions,
  type RevisionComparison,
} from "@/lib/services/revision-compare";
import { createNewRevision } from "./budgets";

export async function compareRevisionsAction(params: {
  fromRevisionId: string;
  toRevisionId: string;
}): Promise<{ success: boolean; comparison?: RevisionComparison; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  if (params.fromRevisionId === params.toRevisionId) {
    return { success: false, error: "Selecione duas revisões diferentes para comparar." };
  }

  try {
    const comparison = await compareRevisions({
      userId: user.id,
      fromRevisionId: params.fromRevisionId,
      toRevisionId: params.toRevisionId,
    });
    return { success: true, comparison };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Erro ao comparar revisões.",
    };
  }
}

/**
 * Cria uma nova revisão (rascunho) a partir de uma revisão finalizada.
 * O snapshot e o histórico da revisão de origem permanecem intactos.
 */
export async function createRevisionFromFinalizedAction(params: {
  revisionId: string;
  notes?: string;
}): Promise<{
  success: boolean;
  revisionId?: string;
  revisionNumber?: number;
  budgetId?: string;
  checksumVerified?: boolean;
  error?: string;
}> {
  const user = await getCurrentUser();
  if (!user) return { success: false, error: "Não autorizado" };

  try {
    const revision = await prisma.budgetRevision.findFirst({
      where: { id: params.revisionId, budget: { userId: user.id } },
      include: {
        snapshot: true,
        budget: {
          select: {
            id: true,
            revisions: {
              orderBy: { revisionNumber: "desc" },
              take: 1,
              select: { id: true, revisionNumber: true },
            },
          },
        },
      },
    });

    if (!revision) {
      return { success: false, error: "Revisão não encontrada." };
    }

    if (revision.status !== "FINALIZED" || !revision.snapshot) {
      return {
        success: false,
        error:
          "Somente revisões finalizadas com snapshot podem originar uma nova revisão por este fluxo.",
      };
    }

    const latest = revision.budget.revisions[0];
    if (latest && latest.id !== revision.id) {
      return {
        success: false,
        error: `A revisão ${revision.revisionNumber} não é a mais recente. Crie a nova revisão a partir da revisão ${latest.revisionNumber}.`,
      };
    }

    const integrity = await verifySnapshotIntegrity(revision.snapshot.id);
    if (!integrity.isValid) {
      return {
        success: false,
        error:
          "O snapshot da revisão finalizada está corrompido. A nova revisão não foi criada.",
      };
    }

    const created = await createNewRevision(
      revision.budgetId,
      params.notes?.trim() ||
        `Revisão criada a partir da revisão finalizada ${revision.revisionNumber} (snapshot ${revision.snapshot.checksum.slice(0, 12)}…)`
    );

    if (!created.success || !created.revisionId) {
      return { success: false, error: created.error || "Erro ao criar nova revisão." };
    }

    const newRevision = await prisma.budgetRevision.findUnique({
      where: { id: created.revisionId },
      select: { revisionNumber: true },
    });

    try {
      revalidatePath("/budgets");
      revalidatePath(`/budgets/${revision.budgetId}`);
    } catch {
      // Ignora fora do contexto HTTP.
    }

    return {
      success: true,
      revisionId: created.revisionId,
      revisionNumber: newRevision?.revisionNumber,
      budgetId: revision.budgetId,
      checksumVerified: true,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error ? error.message : "Erro ao criar revisão a partir da finalizada.",
    };
  }
}
