// ============================================================================
// ObraCalc - Seed de demonstração
// ATENÇÃO: Dados fictícios apenas para demonstração e desenvolvimento.
// Não representam valores reais de referência SINAPI ou de mercado.
// ============================================================================

import { PrismaClient, DatabaseSource, TaxRegime, ResourceCategory, CompositionType } from '@prisma/client';
import { hash } from 'bcryptjs';
import Decimal from 'decimal.js';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed de demonstração...');

  // =========================================================================
  // 1. Usuário de demonstração
  // =========================================================================
  const passwordHash = await hash('demo123456', 12);
  
  const user = await prisma.user.upsert({
    where: { email: 'demo@obracalc.com.br' },
    update: {},
    create: {
      email: 'demo@obracalc.com.br',
      name: 'Usuário Demonstração',
      passwordHash,
      preferences: {
        create: {
          locale: 'pt-BR',
          currency: 'BRL',
          defaultDecimalPlaces: 2,
          defaultRoundingMode: 'ROUND_HALF_UP',
        },
      },
      professionalProfile: {
        create: {
          companyName: 'Construtora Demo Ltda.',
          cnpj: '12.345.678/0001-99',
          professionalName: 'Eng. Demo Silva',
          registrationType: 'CREA',
          registrationNumber: '123456/D-SP',
          state: 'SP',
          phone: '(11) 99999-0000',
        },
      },
    },
  });

  console.log(`  ✅ Usuário criado: ${user.email}`);

  // =========================================================================
  // 2. Unidades de medida padrão
  // =========================================================================
  const units = [
    { symbol: 'm', name: 'metro', dimension: 'LENGTH' },
    { symbol: 'm²', name: 'metro quadrado', dimension: 'AREA' },
    { symbol: 'm³', name: 'metro cúbico', dimension: 'VOLUME' },
    { symbol: 'kg', name: 'quilograma', dimension: 'MASS' },
    { symbol: 't', name: 'tonelada', dimension: 'MASS' },
    { symbol: 'un', name: 'unidade', dimension: 'UNIT' },
    { symbol: 'h', name: 'hora', dimension: 'TIME' },
    { symbol: 'mês', name: 'mês', dimension: 'TIME' },
    { symbol: 'l', name: 'litro', dimension: 'VOLUME' },
    { symbol: 'sc', name: 'saco', dimension: 'UNIT' },
    { symbol: 'vb', name: 'verba', dimension: 'OTHER' },
    { symbol: 'cj', name: 'conjunto', dimension: 'UNIT' },
    { symbol: 'pç', name: 'peça', dimension: 'UNIT' },
    { symbol: 'par', name: 'par', dimension: 'UNIT' },
    { symbol: 'gl', name: 'galão', dimension: 'VOLUME' },
    { symbol: 'cm', name: 'centímetro', dimension: 'LENGTH' },
    { symbol: 'mm', name: 'milímetro', dimension: 'LENGTH' },
    { symbol: 'km', name: 'quilômetro', dimension: 'LENGTH' },
  ];

  for (const unit of units) {
    await prisma.unit.upsert({
      where: { symbol: unit.symbol },
      update: {},
      create: unit,
    });
  }

  console.log(`  ✅ ${units.length} unidades de medida criadas`);

  // Conversões exatas de unidades
  const mUnit = await prisma.unit.findUnique({ where: { symbol: 'm' } });
  const cmUnit = await prisma.unit.findUnique({ where: { symbol: 'cm' } });
  const mmUnit = await prisma.unit.findUnique({ where: { symbol: 'mm' } });
  const kmUnit = await prisma.unit.findUnique({ where: { symbol: 'km' } });
  const kgUnit = await prisma.unit.findUnique({ where: { symbol: 'kg' } });
  const tUnit = await prisma.unit.findUnique({ where: { symbol: 't' } });
  const lUnit = await prisma.unit.findUnique({ where: { symbol: 'l' } });
  const m3Unit = await prisma.unit.findUnique({ where: { symbol: 'm³' } });

  if (mUnit && cmUnit && mmUnit && kmUnit && kgUnit && tUnit && lUnit && m3Unit) {
    const conversions = [
      { fromUnitId: mUnit.id, toUnitId: cmUnit.id, factor: '100', isExact: true },
      { fromUnitId: cmUnit.id, toUnitId: mUnit.id, factor: '0.01', isExact: true },
      { fromUnitId: mUnit.id, toUnitId: mmUnit.id, factor: '1000', isExact: true },
      { fromUnitId: mmUnit.id, toUnitId: mUnit.id, factor: '0.001', isExact: true },
      { fromUnitId: kmUnit.id, toUnitId: mUnit.id, factor: '1000', isExact: true },
      { fromUnitId: mUnit.id, toUnitId: kmUnit.id, factor: '0.001', isExact: true },
      { fromUnitId: kgUnit.id, toUnitId: tUnit.id, factor: '0.001', isExact: true },
      { fromUnitId: tUnit.id, toUnitId: kgUnit.id, factor: '1000', isExact: true },
      { fromUnitId: lUnit.id, toUnitId: m3Unit.id, factor: '0.001', isExact: true },
      { fromUnitId: m3Unit.id, toUnitId: lUnit.id, factor: '1000', isExact: true },
    ];

    for (const conv of conversions) {
      await prisma.unitConversion.upsert({
        where: {
          fromUnitId_toUnitId_version: {
            fromUnitId: conv.fromUnitId,
            toUnitId: conv.toUnitId,
            version: 1,
          },
        },
        update: {},
        create: { ...conv, version: 1 },
      });
    }
    console.log(`  ✅ ${conversions.length} conversões de unidades criadas`);
  }

  // =========================================================================
  // 3. Configuração BDI de demonstração
  // =========================================================================
  // ATENÇÃO: Valores fictícios apenas para demonstração
  const bdiConfig = await prisma.bdiConfig.create({
    data: {
      userId: user.id,
      name: 'BDI Padrão (Demonstração)',
      description: 'Configuração BDI de demonstração. NÃO usar como referência real.',
      ac: 0.03,     // 3% Administração Central
      cf: 0.01,     // 1% Custo Financeiro
      s: 0.005,     // 0,5% Seguros
      g: 0.005,     // 0,5% Garantias
      mi: 0.01,     // 1% Margem de Incerteza
      tm: 0.0065,   // 0,65% Tributos Municipais (ISS)
      te: 0.0365,   // 3,65% Tributos Estaduais (PIS/COFINS)
      tf: 0.0,      // 0% Tributos Federais
      l: 0.0616,    // 6,16% Lucratividade
      bdiRate: 22.12, // Resultado calculado pela fórmula
      isDefault: true,
    },
  });

  console.log(`  ✅ Configuração BDI criada: ${bdiConfig.name}`);

  // Vincular BDI padrão às preferências
  await prisma.userPreferences.update({
    where: { userId: user.id },
    data: { defaultBdiConfigId: bdiConfig.id },
  });

  // =========================================================================
  // 4. Cliente de demonstração
  // =========================================================================
  const client = await prisma.client.create({
    data: {
      userId: user.id,
      name: 'Prefeitura Municipal (Demo)',
      document: '12.345.678/0001-00',
      email: 'obras@prefeitura.demo.gov.br',
      phone: '(11) 3333-0000',
      address: 'Rua da Prefeitura, 100 - Centro - São Paulo/SP',
    },
  });

  console.log(`  ✅ Cliente criado: ${client.name}`);

  // =========================================================================
  // 5. Obra de demonstração
  // =========================================================================
  const project = await prisma.project.create({
    data: {
      userId: user.id,
      clientId: client.id,
      name: 'Reforma da Escola Municipal (Demo)',
      description: 'Obra de demonstração para teste do sistema.',
      address: 'Rua das Flores, 200',
      city: 'São Paulo',
      state: 'SP',
    },
  });

  console.log(`  ✅ Obra criada: ${project.name}`);

  console.log('\n🎉 Seed de demonstração concluído!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Login: demo@obracalc.com.br');
  console.log('  Senha: demo123456');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

main()
  .catch((e) => {
    console.error('❌ Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
