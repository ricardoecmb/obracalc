import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  createImportJob,
  getImportJob,
  listImportJobs,
  processImportJob,
} from "@/lib/services/import-jobs";
import { getStorage } from "@/lib/storage";

const EMAIL = "test.etapa12.import@obracalc.com";
const MONTH = "2099/12";
const SOURCE = "SINAPI" as const;
const STATE = "SP";

let userId: string;
let sequence = 0;

function uniqueCode(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function csv(rows: Array<{ code: string; description: string; unit: string; price: string }>) {
  return [
    "codigo;descricao;unidade;preco",
    ...rows.map(
      (row) => `${row.code};${row.description};${row.unit};${row.price}`
    ),
  ].join("\r\n");
}

function context() {
  return {
    source: SOURCE,
    state: STATE,
    referenceMonth: MONTH,
    taxRegime: "DESONERADO" as const,
  };
}

const mapping = {
  code: "codigo",
  description: "descricao",
  unit: "unidade",
  price: "preco",
};

beforeAll(async () => {
  const user = await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: {
      email: EMAIL,
      name: "Teste Etapa 12 Import",
      passwordHash: "hash-etapa12",
    },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.importJob.deleteMany({ where: { userId } });
  await prisma.resource.deleteMany({
    where: { userId, sourceMonth: MONTH },
  });
  const storage = getStorage("local");
  const keys = await storage.list(`imports/${userId}`);
  await Promise.all(keys.map((key) => storage.delete(key).catch(() => undefined)));
});

describe("Etapa 12 — jobs de importação persistentes", () => {
  it("persiste o arquivo, processa e registra relatório idempotente", async () => {
    const code = uniqueCode("JOB");
    const content = Buffer.from(
      csv([
        { code, description: "Areia média", unit: "m3", price: "120,50" },
        { code: `${code}-2`, description: "Brita 1", unit: "m3", price: "98,75" },
      ])
    );
    const idempotencyKey = `job-${code}`;

    const created = await createImportJob({
      userId,
      fileName: "../../insumos.csv",
      content,
      dataType: "RESOURCES",
      mapping,
      context: context(),
      idempotencyKey,
    });

    expect(created.reused).toBe(false);
    expect(created.job.status).toBe("PENDING");
    expect(created.job.fileName).toBe("insumos.csv");
    expect(created.job.checksum).toHaveLength(64);
    expect(created.job.fileSizeBytes).toBe(content.byteLength);

    const stored = await prisma.importJob.findUniqueOrThrow({
      where: { id: created.job.id },
    });
    expect(stored.storageDriver).toBe("local");
    expect(stored.fileKey).toContain(userId);

    const storage = getStorage("local");
    const persisted = await storage.get(stored.fileKey);
    expect(persisted.toString("utf8")).toBe(content.toString("utf8"));

    const processed = await processImportJob(created.job.id, { userId });
    expect(processed.processed).toBe(true);
    expect(processed.job.status).toBe("COMPLETED");
    expect(processed.job.totalRows).toBe(2);
    expect(processed.job.createdCount).toBe(2);
    expect(processed.job.updatedCount).toBe(0);
    expect(processed.job.skippedCount).toBe(0);

    const resources = await prisma.resource.findMany({
      where: { userId, code: { startsWith: code } },
      orderBy: { code: "asc" },
    });
    expect(resources).toHaveLength(2);
    expect(resources[0].price.toString()).toBe("120.5");

    const again = await processImportJob(created.job.id, { userId });
    expect(again.processed).toBe(false);
    expect(again.message).toContain("concluído");

    const duplicate = await createImportJob({
      userId,
      fileName: "insumos.csv",
      content,
      dataType: "RESOURCES",
      mapping,
      context: context(),
      idempotencyKey,
    });
    expect(duplicate.reused).toBe(true);
    expect(duplicate.job.id).toBe(created.job.id);

    const listed = await listImportJobs(userId, 100);
    expect(listed.some((job) => job.id === created.job.id)).toBe(true);
  });

  it("deduplica por checksum + contexto quando não há chave explícita", async () => {
    const code = uniqueCode("AUTO");
    const content = Buffer.from(
      csv([{ code, description: "Cimento", unit: "sc", price: "38,90" }])
    );

    const first = await createImportJob({
      userId,
      fileName: "auto.csv",
      content,
      dataType: "RESOURCES",
      mapping,
      context: context(),
    });
    const second = await createImportJob({
      userId,
      fileName: "auto.csv",
      content,
      dataType: "RESOURCES",
      mapping,
      context: context(),
    });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.job.id).toBe(first.job.id);
  });

  it("falha com checksum divergente sem alterar o catálogo", async () => {
    const code = uniqueCode("TAMPER");
    const content = Buffer.from(
      csv([{ code, description: "Cal", unit: "kg", price: "2,50" }])
    );

    const created = await createImportJob({
      userId,
      fileName: "tamper.csv",
      content,
      dataType: "RESOURCES",
      mapping,
      context: context(),
      idempotencyKey: `tamper-${code}`,
    });

    const stored = await prisma.importJob.findUniqueOrThrow({
      where: { id: created.job.id },
    });
    const storage = getStorage("local");
    await storage.put(stored.fileKey, Buffer.from("conteudo adulterado"), {
      upsert: true,
    });

    const processed = await processImportJob(created.job.id, { userId });
    expect(processed.job.status).toBe("FAILED");
    expect(processed.job.errorMessage).toContain("Checksum");

    const count = await prisma.resource.count({
      where: { userId, code },
    });
    expect(count).toBe(0);
  });

  it("respeita o isolamento por usuário", async () => {
    const other = await prisma.user.upsert({
      where: { email: "test.etapa12.other@obracalc.com" },
      update: {},
      create: {
        email: "test.etapa12.other@obracalc.com",
        name: "Outro Usuário",
        passwordHash: "hash-outro",
      },
    });

    const code = uniqueCode("OWN");
    const created = await createImportJob({
      userId,
      fileName: "owner.csv",
      content: Buffer.from(
        csv([{ code, description: "Pedra", unit: "m3", price: "80,00" }])
      ),
      dataType: "RESOURCES",
      mapping,
      context: context(),
      idempotencyKey: `owner-${code}`,
    });

    expect(await getImportJob(other.id, created.job.id)).toBeNull();
    await expect(
      processImportJob(created.job.id, { userId: other.id })
    ).rejects.toThrow("não encontrado");

    await prisma.user.delete({ where: { id: other.id } }).catch(() => undefined);
  });
});
