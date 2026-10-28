import { describe, it, expect } from "vitest";
import {
  fuzzyScore,
  levenshtein,
  normalizeText,
  rankByFuzzy,
  similarity,
} from "../fuzzy";

describe("Busca textual aproximada (fuzzy)", () => {
  it("normaliza acentos, caixa e pontuação", () => {
    expect(normalizeText("Alvenaria Cerâmica, 9x19x19!")).toBe(
      "alvenaria ceramica 9x19x19"
    );
    expect(normalizeText(null)).toBe("");
  });

  it("calcula distância de Levenshtein e similaridade", () => {
    expect(levenshtein("alvenaria", "alvenaria")).toBe(0);
    expect(levenshtein("alvenaria", "alvenari")).toBe(1);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(similarity("argamassa", "argamassa")).toBe(1);
    expect(similarity("argamassa", "argamasa")).toBeGreaterThan(0.8);
  });

  it("prioriza igualdade e prefixo de código", () => {
    const exact = fuzzyScore("98459", { code: "98459", description: "Alvenaria" });
    const prefix = fuzzyScore("98459", { code: "98459-1", description: "Alvenaria" });
    const unrelated = fuzzyScore("98459", {
      code: "11111",
      description: "Serviço qualquer",
    });

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(unrelated);
    expect(unrelated).toBe(0);
  });

  it("tolera erros de digitação em descrições", () => {
    const score = fuzzyScore("alvenaria ceramica", {
      code: "COMP-1",
      description: "Alvenaria de vedação com blocos cerâmicos",
    });

    expect(score).toBeGreaterThan(0);
  });

  it("reconhece radicais da mesma família (concreto/concretagem)", () => {
    const radical = fuzzyScore("concreto", {
      code: "SINAPI-400",
      description: "Concretagem de laje",
    });
    const unrelated = fuzzyScore("concreto", {
      code: "SINAPI-300",
      description: "Armação de aço",
    });

    expect(radical).toBeGreaterThan(0);
    expect(unrelated).toBe(0);
  });

  it("ordena resultados por aderência e respeita o limite", () => {
    const items = [
      { code: "SINAPI-100", description: "Concreto usinado" },
      { code: "SINAPI-200", description: "Forma de madeira para concreto" },
      { code: "SINAPI-300", description: "Armação de aço" },
      { code: "SINAPI-400", description: "Concretagem de laje" },
    ];

    const ranked = rankByFuzzy(items, "concreto", (item) => item, 3);

    expect(ranked).toHaveLength(3);
    expect(ranked[0].item.code).toBe("SINAPI-100");
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });

  it("sem consulta preserva a ordem original", () => {
    const items = [{ code: "B" }, { code: "A" }];
    const ranked = rankByFuzzy(items, "   ", (item) => item);
    expect(ranked.map((entry) => entry.item.code)).toEqual(["B", "A"]);
  });
});
