/**
 * Busca textual aproximada determinística.
 *
 * A pontuação prioriza, nesta ordem:
 *   1. igualdade exata de código;
 *   2. prefixo de código;
 *   3. conteúdo literal (código ou descrição);
 *   4. prefixo de palavra;
 *   5. similaridade por distância de edição.
 *
 * A normalização remove acentos, caixa e pontuação, de modo que
 * "alvenaria ceramica" encontre "Alvenaria Cerâmica".
 */

export interface FuzzyCandidate {
  code?: string | null;
  description?: string | null;
}

export interface FuzzyResult<T> {
  item: T;
  score: number;
}

/** Remove acentos, converte para minúsculas e colapsa espaços. */
export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Divide um texto normalizado em tokens úteis. */
export function tokenize(value: string | null | undefined): string[] {
  const normalized = normalizeText(value);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * Distância de Levenshtein com limite superior. Retorna `limit + 1` quando a
 * distância excede o limite, evitando trabalho desnecessário.
 */
export function levenshtein(a: string, b: string, limit = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = current[0];

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      current[j] = value;
      if (value < rowMin) rowMin = value;
    }

    if (rowMin > limit) return limit + 1;
    previous = current;
  }

  return previous[b.length];
}

/** Similaridade normalizada entre 0 e 1. */
export function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1;
  const distance = levenshtein(a, b, Math.max(2, Math.floor(maxLength * 0.6)));
  if (distance > maxLength) return 0;
  return Math.max(0, 1 - distance / maxLength);
}

/** Comprimento do prefixo comum entre duas strings. */
function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) index++;
  return index;
}

function scoreField(query: string, queryTokens: string[], field: string): number {
  if (!field) return 0;
  if (field === query) return 1;
  if (field.startsWith(query)) return 0.92;
  if (field.includes(query)) return 0.8;

  const fieldTokens = field.split(" ");
  let tokenScore = 0;

  for (const queryToken of queryTokens) {
    let best = 0;
    for (const fieldToken of fieldTokens) {
      if (fieldToken === queryToken) {
        best = Math.max(best, 1);
      } else if (fieldToken.startsWith(queryToken)) {
        best = Math.max(best, 0.9);
      } else if (fieldToken.includes(queryToken)) {
        best = Math.max(best, 0.75);
      } else if (queryToken.length >= 4) {
        // Radicais: "concreto" deve alcançar "concretagem", "argamassa" ->
        // "argamassamento", etc. Exige prefixo comum significativo para
        // evitar falsos positivos curtos.
        const prefix = commonPrefixLength(queryToken, fieldToken);
        if (prefix >= Math.max(4, Math.ceil(queryToken.length * 0.7))) {
          best = Math.max(best, 0.8);
        } else {
          const sim = similarity(queryToken, fieldToken);
          if (sim >= 0.7) best = Math.max(best, sim * 0.7);
        }
      } else if (queryToken.length >= 3) {
        const sim = similarity(queryToken, fieldToken);
        if (sim >= 0.7) best = Math.max(best, sim * 0.7);
      }
    }
    // Todos os tokens precisam encontrar alguma correspondência razoável.
    if (best === 0) return 0;
    tokenScore += best;
  }

  // Cobertura parcial: todos os tokens aparecem, mas fora de ordem/separados.
  return (tokenScore / queryTokens.length) * 0.7;
}

/**
 * Pontua um candidato. Retorna 0 quando não há correspondência.
 * O código tem peso maior que a descrição, pois é o identificador primário.
 */
export function fuzzyScore(
  query: string,
  candidate: FuzzyCandidate
): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 1;

  const queryTokens = normalizedQuery.split(" ");
  const code = normalizeText(candidate.code);
  const description = normalizeText(candidate.description);

  const codeScore = scoreField(normalizedQuery, queryTokens, code);
  const descriptionScore = scoreField(normalizedQuery, queryTokens, description);

  // Correspondência de código exata/prefixo domina a ordenação.
  const weighted = Math.max(codeScore * 1.25, descriptionScore);

  // Bônus quando todos os tokens da consulta aparecem na descrição.
  if (queryTokens.length > 1 && queryTokens.every((t) => description.includes(t))) {
    return weighted + 0.1;
  }

  return weighted;
}

/**
 * Filtra e ordena candidatos por aderência à consulta.
 * A ordenação é estável: empates mantêm a ordem original.
 */
export function rankByFuzzy<T>(
  items: readonly T[],
  query: string,
  getCandidate: (item: T) => FuzzyCandidate,
  limit?: number
): FuzzyResult<T>[] {
  const trimmed = query.trim();

  if (!trimmed) {
    const base = items.map((item) => ({ item, score: 1 }));
    return typeof limit === "number" ? base.slice(0, limit) : base;
  }

  const scored: FuzzyResult<T>[] = [];
  items.forEach((item, index) => {
    const score = fuzzyScore(trimmed, getCandidate(item));
    if (score > 0) {
      scored.push({ item, score: score + index * 1e-9 });
    }
  });

  scored.sort((a, b) => b.score - a.score);
  return typeof limit === "number" ? scored.slice(0, limit) : scored;
}
