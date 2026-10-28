/**
 * ObraCalc - Motor de Cálculo Determinístico para Orçamentação de Obras
 *
 * Módulo puro de cálculo matemático, orçamentário e tarifário (BDI, SINAPI, SICRO)
 * utilizando precisão decimal exata via Decimal.js.
 *
 * Etapa 4: aritmética decimal, composições recursivas, desdobramento por
 * categoria, encargos sociais, conversão de unidades e reconciliação exata.
 */

export * from './types';
export * from './errors';
export * from './decimal';
export * from './rounding';
export * from './units';
export * from './bdi';
export * from './calculator';
