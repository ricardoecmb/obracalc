import { PrismaClient } from "@prisma/client";

/**
 * Global singleton pattern for PrismaClient.
 * Prevents instantiating multiple PrismaClient instances in development
 * due to Next.js hot module reloading (HMR).
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
