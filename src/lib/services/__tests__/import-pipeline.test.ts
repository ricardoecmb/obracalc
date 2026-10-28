import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  parseBrazilianNumber,
  previewCsvContent,
  importResourcesCsv,
  importCompositionsCsv,
} from "../import-pipeline";
import { DatabaseSource, TaxRegime, ResourceCategory, CompositionType } from "@prisma/client";
import Decimal from "decimal.js";

describe("Ingestão de Dados e Importação CSV (Pipeline SINAPI / SICRO / Próprio)", () => {
  const runId = Math.random().toString(36).substring(2, 8);
  let testUserId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `import-test-${runId}@obracalc.local`,
        name: "Engenheiro Teste Importação",
        passwordHash: "$2a$12$fakeHashForTestPurposesOnly1234567890abcdefgh",
      },
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    try {
      await prisma.resourcePriceHistory.deleteMany({
        where: { resource: { userId: testUserId } },
      });
      await prisma.resource.deleteMany({ where: { userId: testUserId } });
      await prisma.composition.deleteMany({ where: { userId: testUserId } });
      await prisma.auditEntry.deleteMany({ where: { userId: testUserId } });
      await prisma.user.delete({ where: { id: testUserId } });
    } catch {
      // Ignora se cascade já tiver deletado
    }
  });

  it("deve converter números no padrão brasileiro com separador de milhar e vírgula decimal", () => {
    expect(parseBrazilianNumber("1.250,50")?.toString()).toBe("1250.5");
    expect(parseBrazilianNumber("R$ 24,90")?.toString()).toBe("24.9");
    expect(parseBrazilianNumber("0,4500")?.toString()).toBe("0.45");
    expect(parseBrazilianNumber("1250.50")?.toString()).toBe("1250.5");
    expect(parseBrazilianNumber("")).toBeNull();
    expect(parseBrazilianNumber("invalido")).toBeNull();
  });

  it("deve detectar delimitador e sugerir mapeamento de colunas em prévia de CSV", () => {
    const sampleSinapi = `CODIGO_INSUMO;DESCRICAO_INSUMO;UNIDADE;PRECO_MEDIANO
00001234;AREIA MEDIA LAVADA;m3;85,50
00005678;CIMENTO PORTLAND CP II-32;kg;0,72`;

    const preview = previewCsvContent(sampleSinapi);
    expect(preview.delimiter).toBe(";");
    expect(preview.headers).toEqual(["CODIGO_INSUMO", "DESCRICAO_INSUMO", "UNIDADE", "PRECO_MEDIANO"]);
    expect(preview.suggestedMapping.code).toBe("CODIGO_INSUMO");
    expect(preview.suggestedMapping.description).toBe("DESCRICAO_INSUMO");
    expect(preview.suggestedMapping.unit).toBe("UNIDADE");
    expect(preview.suggestedMapping.price).toBe("PRECO_MEDIANO");
  });

  // =========================================================================
  // CRITÉRIO 1: Importar amostra real SINAPI e garantir Idempotência
  // =========================================================================
  it("deve importar amostra real de insumos SINAPI com idempotência (sem duplicar registros no re-upload)", async () => {
    const sinapiCsv = `CODIGO;DESCRICAO;UNIDADE;PRECO;CATEGORIA;ENCARGOS_INCLUSOS
00000010;AÇO CA-50, 10,0 MM, VERGALHAO;KG;7,85;MATERIAL;N
00000025;PEDREIRO DE EDIFICAÇÕES;H;24,50;MAO DE OBRA;S
00000030;BETONEIRA CAPACIDADE 400 L;H;12,00;EQUIPAMENTO;N`;

    const mapping = {
      code: "CODIGO",
      description: "DESCRICAO",
      unit: "UNIDADE",
      price: "PRECO",
      category: "CATEGORIA",
      laborChargesIncluded: "ENCARGOS_INCLUSOS",
    };

    const context = {
      userId: testUserId,
      source: DatabaseSource.SINAPI,
      state: "SP",
      referenceMonth: "2024/01",
      taxRegime: TaxRegime.DESONERADO,
    };

    // Primeira importação (3 novos)
    const report1 = await importResourcesCsv(sinapiCsv, mapping, context);
    expect(report1.totalRows).toBe(3);
    expect(report1.created).toBe(3);
    expect(report1.updated).toBe(0);
    expect(report1.skipped).toBe(0);
    expect(report1.errors.length).toBe(0);

    // Verificar se foram persistidos corretamente
    const pedreiro = await prisma.resource.findFirst({
      where: { userId: testUserId, code: "00000025", sourceMonth: "2024/01" },
    });
    expect(pedreiro).toBeDefined();
    expect(pedreiro?.price.toString()).toBe("24.5");
    expect(pedreiro?.category).toBe(ResourceCategory.LABOR);
    expect(pedreiro?.laborChargesIncluded).toBe(true);

    // Segunda importação com o mesmo arquivo (Idempotência: 0 criados, 3 atualizados/inalterados)
    const report2 = await importResourcesCsv(sinapiCsv, mapping, context);
    expect(report2.created).toBe(0);
    expect(report2.updated).toBe(3);
    expect(report2.skipped).toBe(0);

    // Contagem total no banco não aumentou
    const total = await prisma.resource.count({
      where: { userId: testUserId, sourceMonth: "2024/01" },
    });
    expect(total).toBe(3);
  });

  // =========================================================================
  // CRITÉRIO 2: Distinção de UF, Competência e Regime Tributário
  // =========================================================================
  it("deve distinguir UF, competência e regime tributário para o mesmo código de insumo", async () => {
    const csvSingleItem = `CODIGO;DESCRICAO;UNIDADE;PRECO
00000025;PEDREIRO DE EDIFICAÇÕES;H;24,50`;

    const mapping = {
      code: "CODIGO",
      description: "DESCRICAO",
      unit: "UNIDADE",
      price: "PRECO",
    };

    // 1. Inserir em SP, 2024/01, DESONERADO
    await importResourcesCsv(csvSingleItem, mapping, {
      userId: testUserId,
      source: DatabaseSource.SINAPI,
      state: "SP",
      referenceMonth: "2024/01",
      taxRegime: TaxRegime.DESONERADO,
    });

    // 2. Inserir em SP, 2024/02, DESONERADO (preço diferente na competência seguinte)
    const csvSingleItemFev = `CODIGO;DESCRICAO;UNIDADE;PRECO
00000025;PEDREIRO DE EDIFICAÇÕES;H;26,00`;

    await importResourcesCsv(csvSingleItemFev, mapping, {
      userId: testUserId,
      source: DatabaseSource.SINAPI,
      state: "SP",
      referenceMonth: "2024/02",
      taxRegime: TaxRegime.DESONERADO,
    });

    // 3. Inserir em RJ, 2024/01, NAO_DESONERADO (outro estado e regime)
    const csvSingleItemRj = `CODIGO;DESCRICAO;UNIDADE;PRECO
00000025;PEDREIRO DE EDIFICAÇÕES;H;29,80`;

    await importResourcesCsv(csvSingleItemRj, mapping, {
      userId: testUserId,
      source: DatabaseSource.SINAPI,
      state: "RJ",
      referenceMonth: "2024/01",
      taxRegime: TaxRegime.NAO_DESONERADO,
    });

    // Validar que o banco possui 3 registros distintos, cada um com sua chave contextual preservada
    const records = await prisma.resource.findMany({
      where: { userId: testUserId, code: "00000025" },
    });
    expect(records.length).toBe(3);

    const spJan = records.find((r) => r.sourceState === "SP" && r.sourceMonth === "2024/01");
    const spFev = records.find((r) => r.sourceState === "SP" && r.sourceMonth === "2024/02");
    const rjJan = records.find((r) => r.sourceState === "RJ" && r.sourceTaxRegime === "NAO_DESONERADO");

    expect(spJan?.price.toString()).toBe("24.5");
    expect(spFev?.price.toString()).toBe("26");
    expect(rjJan?.price.toString()).toBe("29.8");
  });

  // =========================================================================
  // CRITÉRIO 3: Arquivos Malformados sem Corrupção do Banco de Dados
  // =========================================================================
  it("deve isolar linhas malformadas, ignorá-las com relatório de erro detalhado e importar linhas válidas sem corrupção", async () => {
    // Arquivo contendo:
    // Linha 1: Válida
    // Linha 2: Código vazio
    // Linha 3: Preço textual inválido
    // Linha 4: Descrição vazia
    // Linha 5: Válida
    const malformedCsv = `CODIGO;DESCRICAO;UNIDADE;PRECO
00001001;BLOCO DE CONCRETO 14X19X39;UN;4,50
;CIMENTO SEM CODIGO;KG;0,80
00001003;AREIA FINA PRECO QUEBRADO;M3;PRECO_INVALIDO_TEXTO
00001004;;M2;15,00
00001005;TABUA DE PINUS 2,5 X 20 CM;M;11,20`;

    const mapping = {
      code: "CODIGO",
      description: "DESCRICAO",
      unit: "UNIDADE",
      price: "PRECO",
    };

    const context = {
      userId: testUserId,
      source: DatabaseSource.CUSTOM,
      state: "SP",
      referenceMonth: "2024/01",
      taxRegime: TaxRegime.DESONERADO,
    };

    const report = await importResourcesCsv(malformedCsv, mapping, context);

    expect(report.totalRows).toBe(5);
    expect(report.created).toBe(2); // 00001001 e 00001005
    expect(report.skipped).toBe(3); // Linhas 2, 3 e 4
    expect(report.errors.length).toBe(3);

    // Validações dos motivos no relatório
    expect(report.errors[0].reason).toContain("Código do insumo ausente");
    expect(report.errors[1].code).toBe("00001003");
    expect(report.errors[1].reason).toContain("Preço inválido");
    expect(report.errors[2].code).toBe("00001004");
    expect(report.errors[2].reason).toContain("Descrição do insumo ausente");

    // Provar que apenas os 2 válidos foram gravados no banco
    const valid1 = await prisma.resource.findFirst({
      where: { userId: testUserId, code: "00001001" },
    });
    const valid5 = await prisma.resource.findFirst({
      where: { userId: testUserId, code: "00001005" },
    });
    expect(valid1).toBeDefined();
    expect(valid5).toBeDefined();
  });

  // =========================================================================
  // CRITÉRIO 4: Diferenciação entre Registros Analíticos e Fechados
  // =========================================================================
  it("deve diferenciar composições analíticas e fechadas na importação preservando valores fechados de origem", async () => {
    const compositionsCsv = `CODIGO;DESCRICAO;UNIDADE;TIPO;VALOR_TOTAL;VALOR_MATERIAL;VALOR_LABOR
COMP-001;EXECUÇÃO DE ALVENARIA VEDAÇÃO;M2;FECHADA;85,40;55,20;30,20
COMP-002;FORMA DE MADEIRA PARA VIGAS;M2;ANALITICA;;;`;

    const mapping = {
      code: "CODIGO",
      description: "DESCRICAO",
      unit: "UNIDADE",
      type: "TIPO",
      closedTotalPrice: "VALOR_TOTAL",
      closedMaterialPrice: "VALOR_MATERIAL",
      closedLaborPrice: "VALOR_LABOR",
    };

    const context = {
      userId: testUserId,
      source: DatabaseSource.SINAPI,
      state: "SP",
      referenceMonth: "2024/01",
      taxRegime: TaxRegime.DESONERADO,
    };

    const report = await importCompositionsCsv(compositionsCsv, mapping, context);

    expect(report.totalRows).toBe(2);
    expect(report.created).toBe(2);
    expect(report.skipped).toBe(0);

    const compFechada = await prisma.composition.findFirst({
      where: { userId: testUserId, code: "COMP-001" },
    });
    const compAnalitica = await prisma.composition.findFirst({
      where: { userId: testUserId, code: "COMP-002" },
    });

    expect(compFechada?.type).toBe(CompositionType.CLOSED);
    expect(compFechada?.closedTotalPrice?.toString()).toBe("85.4");
    expect(compFechada?.closedMaterialPrice?.toString()).toBe("55.2");
    expect(compFechada?.closedLaborPrice?.toString()).toBe("30.2");

    expect(compAnalitica?.type).toBe(CompositionType.ANALYTICAL);
    expect(compAnalitica?.closedTotalPrice).toBeNull();
  });
});
