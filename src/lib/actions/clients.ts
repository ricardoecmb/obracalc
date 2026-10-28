"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";

const clientSchema = z.object({
  name: z.string().min(2, "Nome é obrigatório (mínimo 2 caracteres)"),
  document: z.string().optional().nullable(),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")).nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type ClientFormData = z.infer<typeof clientSchema>;

export async function createClient(data: ClientFormData) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const parsed = clientSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Dados inválidos" };
  }

  try {
    const client = await prisma.client.create({
      data: {
        userId: user.id,
        name: parsed.data.name.trim(),
        document: parsed.data.document?.trim() || null,
        email: parsed.data.email?.trim() || null,
        phone: parsed.data.phone?.trim() || null,
        address: parsed.data.address?.trim() || null,
        notes: parsed.data.notes?.trim() || null,
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Client",
      entityId: client.id,
      action: "CREATE",
      changes: client,
    });

    revalidatePath("/clients");
    revalidatePath("/projects");
    return { success: true, client };
  } catch (error) {
    console.error("Erro ao criar cliente:", error);
    return { success: false, error: "Erro interno ao cadastrar cliente" };
  }
}

export async function updateClient(id: string, data: Partial<ClientFormData>) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.client.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return { success: false, error: "Cliente não encontrado" };
  }

  try {
    const updated = await prisma.client.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name.trim() } : {}),
        ...(data.document !== undefined ? { document: data.document?.trim() || null } : {}),
        ...(data.email !== undefined ? { email: data.email?.trim() || null } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.address !== undefined ? { address: data.address?.trim() || null } : {}),
        ...(data.notes !== undefined ? { notes: data.notes?.trim() || null } : {}),
      },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Client",
      entityId: id,
      action: "UPDATE",
      changes: { before: existing, after: updated },
    });

    revalidatePath("/clients");
    revalidatePath("/projects");
    return { success: true, client: updated };
  } catch (error) {
    console.error("Erro ao atualizar cliente:", error);
    return { success: false, error: "Erro interno ao atualizar cliente" };
  }
}

export async function toggleClientStatus(id: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.client.findFirst({
    where: { id, userId: user.id },
  });

  if (!existing) {
    return { success: false, error: "Cliente não encontrado" };
  }

  try {
    const updated = await prisma.client.update({
      where: { id },
      data: { active: !existing.active },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "Client",
      entityId: id,
      action: updated.active ? "ACTIVATE" : "DEACTIVATE",
    });

    revalidatePath("/clients");
    return { success: true, active: updated.active };
  } catch (error) {
    console.error("Erro ao alterar status do cliente:", error);
    return { success: false, error: "Erro interno ao atualizar status" };
  }
}
