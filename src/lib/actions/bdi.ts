"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { prisma } from "@/lib/db/prisma";
import { createAuditEntry } from "@/lib/db/audit";
import { calculateBdi } from "@/lib/engine/bdi";
import Decimal from "decimal.js";

const bdiSchema = z.object({
  name: z.string().min(2, "Nome da configuração de BDI é obrigatório"),
  description: z.string().optional().nullable(),
  isDefault: z.boolean().default(false),
  // Taxas informadas em percentual (ex: 3.50 para 3.50%)
  ac: z.number().finite().min(0, "Administração Central deve ser >= 0"),
  cf: z.number().finite().min(0, "Custo Financeiro deve ser >= 0"),
  s: z.number().finite().min(0, "Seguros deve ser >= 0"),
  g: z.number().finite().min(0, "Garantias deve ser >= 0"),
  mi: z.number().finite().min(0, "Margem de Incerteza / Risco deve ser >= 0"),
  tm: z.number().finite().min(0, "Tributos Municipais (ISS) deve ser >= 0"),
  te: z.number().finite().min(0, "Tributos Estaduais (ICMS) deve ser >= 0"),
  tf: z.number().finite().min(0, "Tributos Federais (PIS/COFINS/CPRB) deve ser >= 0"),
  l: z.number().finite().min(0, "Lucro / Remuneração deve ser >= 0"),
});

export type BdiFormData = z.infer<typeof bdiSchema>;

export async function createBdiConfig(data: BdiFormData) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const parsed = bdiSchema.safeParse(data);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message || "Dados inválidos" };
  }

  // Realizar cálculo oficial TCU Acórdão 2622/2013 via motor determinístico
  const bdiCalc = calculateBdi({
    ac: parsed.data.ac,
    cf: parsed.data.cf,
    s: parsed.data.s,
    g: parsed.data.g,
    mi: parsed.data.mi,
    tm: parsed.data.tm,
    te: parsed.data.te,
    tf: parsed.data.tf,
    l: parsed.data.l,
  });

  if (!bdiCalc.isValid) {
    return { success: false, error: bdiCalc.validationErrors.join("; ") };
  }

  try {
    // No banco, taxas de componentes são armazenadas como fração unitária (ex: 5% = 0.05)
    // enquanto bdiRate é armazenado em percentual (ex: 22.5000)
    const bdi = await prisma.$transaction(async (tx) => {
      if (parsed.data.isDefault) {
        await tx.bdiConfig.updateMany({
          where: { userId: user.id, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.bdiConfig.create({
        data: {
          userId: user.id,
          name: parsed.data.name.trim(),
          description: parsed.data.description?.trim() || null,
          isDefault: parsed.data.isDefault,
          ac: new Decimal(parsed.data.ac).dividedBy(100),
          cf: new Decimal(parsed.data.cf).dividedBy(100),
          s: new Decimal(parsed.data.s).dividedBy(100),
          g: new Decimal(parsed.data.g).dividedBy(100),
          mi: new Decimal(parsed.data.mi).dividedBy(100),
          tm: new Decimal(parsed.data.tm).dividedBy(100),
          te: new Decimal(parsed.data.te).dividedBy(100),
          tf: new Decimal(parsed.data.tf).dividedBy(100),
          l: new Decimal(parsed.data.l).dividedBy(100),
          bdiRate: bdiCalc.rate,
        },
      });

      if (parsed.data.isDefault) {
        await tx.userPreferences.upsert({
          where: { userId: user.id },
          update: { defaultBdiConfigId: created.id },
          create: {
            userId: user.id,
            defaultBdiConfigId: created.id,
          },
        });
      }

      return created;
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "BdiConfig",
      entityId: bdi.id,
      action: "CREATE",
      changes: {
        ...bdi,
        calculationMemory: bdiCalc.memory,
      },
    });

    revalidatePath("/bdi");
    return { success: true, bdi, calculation: bdiCalc };
  } catch (error) {
    console.error("Erro ao criar configuração BDI:", error);
    return { success: false, error: "Erro interno ao cadastrar configuração BDI" };
  }
}

export async function setDefaultBdiConfig(id: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.bdiConfig.findFirst({
    where: { id, userId: user.id },
    select: { id: true, active: true },
  });

  if (!existing) {
    return { success: false, error: "Configuração de BDI não encontrada" };
  }

  if (!existing.active) {
    return { success: false, error: "Uma configuração de BDI inativa não pode ser definida como padrão" };
  }

  try {
    await prisma.$transaction([
      prisma.bdiConfig.updateMany({
        where: { userId: user.id, isDefault: true },
        data: { isDefault: false },
      }),
      prisma.bdiConfig.update({
        where: { id: existing.id },
        data: { isDefault: true },
      }),
      prisma.userPreferences.upsert({
        where: { userId: user.id },
        update: { defaultBdiConfigId: existing.id },
        create: {
          userId: user.id,
          defaultBdiConfigId: existing.id,
        },
      }),
    ]);

    await createAuditEntry({
      userId: user.id,
      entityType: "BdiConfig",
      entityId: id,
      action: "SET_DEFAULT",
    });

    revalidatePath("/bdi");
    return { success: true };
  } catch (error) {
    console.error("Erro ao definir BDI padrão:", error);
    return { success: false, error: "Erro interno ao atualizar BDI padrão" };
  }
}

export async function deleteBdiConfig(id: string) {
  const user = await getCurrentUser();
  if (!user) {
    return { success: false, error: "Não autorizado" };
  }

  const existing = await prisma.bdiConfig.findFirst({
    where: { id, userId: user.id },
    include: {
      _count: {
        select: { budgetRevisions: true, budgetItemOverrides: true },
      },
    },
  });

  if (!existing) {
    return { success: false, error: "Configuração não encontrada" };
  }

  if (existing._count.budgetRevisions > 0 || existing._count.budgetItemOverrides > 0) {
    return {
      success: false,
      error: "Esta configuração de BDI está em uso em orçamentos existentes e não pode ser excluída.",
    };
  }

  try {
    await prisma.bdiConfig.delete({
      where: { id },
    });

    await createAuditEntry({
      userId: user.id,
      entityType: "BdiConfig",
      entityId: id,
      action: "DELETE",
      changes: existing,
    });

    revalidatePath("/bdi");
    return { success: true };
  } catch (error) {
    console.error("Erro ao excluir configuração BDI:", error);
    return { success: false, error: "Erro interno ao excluir configuração BDI" };
  }
}
