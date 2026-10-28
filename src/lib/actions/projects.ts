"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { ProjectStatus } from "@prisma/client";

const projectSchema = z.object({
  name: z.string().min(2, "Nome da obra é obrigatório (mínimo 2 caracteres)"),
  clientId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().length(2, "UF deve ter 2 caracteres").optional().or(z.literal("")).nullable(),
  status: z.nativeEnum(ProjectStatus).default(ProjectStatus.ACTIVE),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type ProjectFormData = z.infer<typeof projectSchema>;

export async function createProject(data: ProjectFormData) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const parsed = projectSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Dados inválidos" };
  }

  try {
    const project = await prisma.project.create({
      data: {
        userId: user.id,
        name: parsed.data.name.trim(),
        clientId: parsed.data.clientId || null,
        description: parsed.data.description?.trim() || null,
        address: parsed.data.address?.trim() || null,
        city: parsed.data.city?.trim() || null,
        state: parsed.data.state?.toUpperCase().trim() || null,
        status: parsed.data.status,
        startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        notes: parsed.data.notes?.trim() || null,
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Project",
      entityId: project.id,
      action: "CREATE",
      changes: project,
    });

    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return { success: true, project };
  } catch (error) {
    console.error("Erro ao criar obra:", error);
    return { success: false, error: "Erro interno ao cadastrar obra" };
  }
}

export async function updateProject(id: string, data: Partial<ProjectFormData>) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.project.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return { success: false, error: "Obra não encontrada" };
  }

  try {
    const updated = await prisma.project.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.clientId !== undefined ? { clientId: data.clientId || null } : {}),
        ...(data.description !== undefined ? { description: data.description?.trim() || null } : {}),
        ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
        ...(data.city !== undefined ? { city: data.city?.trim() || null } : {}),
        ...(data.state !== undefined ? { state: data.state?.toUpperCase().trim() || null } : {}),
        ...(data.status ? { status: data.status } : {}),
        ...(data.startDate !== undefined ? { startDate: data.startDate ? new Date(data.startDate) : null } : {}),
        ...(data.endDate !== undefined ? { endDate: data.endDate ? new Date(data.endDate) : null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Project",
      entityId: id,
      action: "UPDATE",
      changes: { before: existing, after: updated },
    });

    revalidatePath("/projects");
    revalidatePath(`/projects/${id}`);
    revalidatePath("/dashboard");
    return { success: true, project: updated };
  } catch (error) {
    console.error("Erro ao atualizar obra:", error);
    return { success: false, error: "Erro interno ao atualizar obra" };
  }
}

export async function deleteProject(id: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.project.findFirst({
    where: { id, userId: user.id },
    include: {
      _count: {
        select: { budgets: true },
      },
    },
  });

  if (!existing) {
    return { success: false, error: "Obra não encontrada" };
  }

  if (existing._count.budgets > 0) {
    return {
      success: false,
      error: "Esta obra possui orçamentos associados. Não é permitido excluir diretamente para manter a integridade dos orçamentos.",
    };
  }

  try {
    await prisma.project.delete({
      where: { id },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Project",
      entityId: id,
      action: "DELETE",
      changes: existing,
    });

    revalidatePath("/projects");
    revalidatePath("/dashboard");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir obra:", error);
    return { success: false, error: "Erro interno ao excluir obra" };
  }
}
