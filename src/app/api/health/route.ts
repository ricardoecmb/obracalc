import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { validateEnvironment } from "@/lib/config/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 5000;

async function checkDatabase(): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Healthcheck público e sem segredos: usado pela Vercel e por smoke tests.
 */
export async function GET() {
  const validation = validateEnvironment(process.env);
  const database = await checkDatabase();
  const ok = validation.ok && database;

  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      checks: {
        database,
        environment: validation.ok,
        storage: validation.storageDriver,
      },
      errors: validation.ok ? [] : validation.errors,
      warnings: validation.warnings,
      timestamp: new Date().toISOString(),
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    }
  );
}
