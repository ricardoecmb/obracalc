import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";

export interface CreateAuditEntryParams {
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  changes?: Prisma.InputJsonValue | Record<string, unknown> | null;
  metadata?: Prisma.InputJsonValue | Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Creates an AuditEntry record in the database.
 * Used to maintain an immutable log of critical modifications,
 * deletions, finalizations, and calculations across the system.
 *
 * @param params - Audit parameters including entity identification, action, diffs, and context
 * @returns The created AuditEntry database record
 */
export async function createAuditEntry(params: CreateAuditEntryParams) {
  const { userId, entityType, entityId, action, changes, metadata, ipAddress } =
    params;

  return await prisma.auditEntry.create({
    data: {
      userId,
      entityType,
      entityId,
      action,
      ...(changes !== undefined && changes !== null
        ? { changes: changes as Prisma.InputJsonValue }
        : {}),
      ...(metadata !== undefined && metadata !== null
        ? { metadata: metadata as Prisma.InputJsonValue }
        : {}),
      ipAddress: ipAddress ?? null,
    },
  });
}

export interface GetAuditEntriesParams {
  entityType?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

/**
 * Retrieves audit entries with optional filters for entity, user, or action.
 *
 * @param params - Query parameters for filtering and pagination
 * @returns List of audit entries sorted by creation date descending
 */
export async function getAuditEntries(params: GetAuditEntriesParams = {}) {
  const {
    entityType,
    entityId,
    userId,
    action,
    limit = 50,
    offset = 0,
  } = params;

  return await prisma.auditEntry.findMany({
    where: {
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...(userId ? { userId } : {}),
      ...(action ? { action } : {}),
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
    skip: offset,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });
}
