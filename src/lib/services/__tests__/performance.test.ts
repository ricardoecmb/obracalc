import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  importResourcesCsv,
  previewCsvContent,
} from "@/lib/services/import-pipeline";

const EMAIL = "test.etapa12.perf@obracalc.com";
const MONTH = "2098/01";
const SMALL_ROWS = 4000;
const PREVIEW_ROWS = 50_000;

let userId: string;
const prefix = `PERF-${Date.now()}`;

function buildCsv(rows: number, codePrefix: string): string {
  const lines = ["codigo;descricao;unidade;preco"];
  for (let index = 0; index < rows; index++) {
    lines.push(
      `${codePrefix}-${String(index).padStart(6, "0")};` +
        `Insumo de desempenho ${index};` +
        `un;` +
        `${(index % 1000) + 0.5}`.replace(".", ",")
    );
  }
  return lines.join("\r\n");
}

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: {
      email: EMAIL,
      name: "Teste Etapa 12 Performance",
      passwordHash: "hash-perf",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.resource.deleteMany({
    where: { userId, sourceMonth: MONTH },
  });
});

describe("Etapa 12 — desempenho com CSV grande", () => {
  it("faz a prévia de 50 mil linhas em tempo aceitável", () => {
    const content = buildCsv(PREVIEW_ROWS, `${prefix}-PREVIEW`);
    const started = Date.now();
    const preview = previewCsvContent(content, 5);
    const duration = Date.now() - started;

    expect(preview.headers).toEqual([
      "codigo",
      "descricao",
      "unidade",
      "preco",
    ]);
    expect(preview.previewRows).toHaveLength(5);
    expect(duration).toBeLessThan(8000);
  });

  it(
    `importa ${SMALL_ROWS} insumos mantendo determinismo decimal`,
    async () => {
      const content = buildCsv(SMALL_ROWS, `${prefix}-IMPORT`);
      const started = Date.now();

      const report = await importResourcesCsv(
        content,
        {
          code: "codigo",
          description: "descricao",
          unit: "unidade",
          price: "preco",
        },
        {
          userId,
          source: "CUSTOM",
          state: null,
          referenceMonth: MONTH,
          taxRegime: null,
        }
      );

      const duration = Date.now() - started;
      expect(report.totalRows).toBe(SMALL_ROWS);
      expect(report.created).toBe(SMALL_ROWS);
      expect(report.updated).toBe(0);
      expect(report.errors).toHaveLength(0);
      expect(duration).toBeLessThan(180_000);

      const sample = await prisma.resource.findFirst({
        where: {
          userId,
          sourceMonth: MONTH,
          code: `${prefix}-IMPORT-000000`,
        },
      });
      expect(sample?.price.toString()).toBe("0.5");

      console.log(
        `[perf] ${SMALL_ROWS} linhas importadas em ${duration} ms (${(
          (SMALL_ROWS / duration) *
          1000
        ).toFixed(1)} linhas/s)`
      );
    },
    240_000
  );
});
