/**
 * Erros tipados do motor de cálculo.
 *
 * O motor é determinístico e falha de forma explícita: nunca ignora silenciosamente
 * um componente sem preço, uma unidade incompatível ou um ciclo de composições.
 * Todos os erros carregam um `code` estável, adequado para logs, auditoria e testes.
 */
export class EngineError extends Error {
  readonly code: string;

  constructor(message: string, code = 'ENGINE_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

/** Valor textual/numérico inválido para conversão em Decimal. */
export class InvalidDecimalError extends EngineError {
  constructor(message: string) {
    super(message, 'INVALID_DECIMAL');
  }
}

/** Política de arredondamento inválida (casas decimais ou modo desconhecido). */
export class InvalidRoundingPolicyError extends EngineError {
  constructor(message: string) {
    super(message, 'INVALID_ROUNDING_POLICY');
  }
}

/** Taxa percentual inválida (negativa, não finita, etc.). */
export class InvalidPercentageError extends EngineError {
  constructor(message: string) {
    super(message, 'INVALID_PERCENTAGE');
  }
}

/** Unidades incompatíveis ou fator de conversão inexistente/ambíguo. */
export class UnitConversionError extends EngineError {
  constructor(message: string) {
    super(message, 'UNIT_CONVERSION_ERROR');
  }
}

/** Dependência circular entre composições (A -> B -> A). */
export class CircularCompositionError extends EngineError {
  readonly cycle: string[];

  constructor(cycle: string[]) {
    super(
      `Dependência circular detectada entre composições: ${cycle.join(' -> ')}`,
      'CIRCULAR_COMPOSITION'
    );
    this.cycle = cycle;
  }
}

/** Componente sem insumo nem composição auxiliar resolvida. */
export class UnresolvedComponentError extends EngineError {
  constructor(message: string) {
    super(message, 'UNRESOLVED_COMPONENT');
  }
}

/** Dados estruturais inválidos de uma composição. */
export class InvalidCompositionError extends EngineError {
  constructor(message: string) {
    super(message, 'INVALID_COMPOSITION');
  }
}

/** Composição fechada sem valor total informado. */
export class InvalidClosedCompositionError extends EngineError {
  constructor(message: string) {
    super(message, 'INVALID_CLOSED_COMPOSITION');
  }
}
