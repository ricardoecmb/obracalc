# ObraCalc

Sistema profissional de **orçamento de obras da construção civil brasileira**, com interface em português (pt-BR), cálculo determinístico e relatórios reconciliados.

A Etapa 12 adiciona a operação em produção: **Vercel + PostgreSQL gerenciado**, **storage persistente**, **fila de importações durável**, **backups externos verificáveis** e as suítes completas de testes.

## Recursos

- **Bases e insumos**: importação de SINAPI/SICRO/CSV, catálogo de recursos, histórico de preços append-only.
- **Composições**: composições analíticas e fechadas, validação de ciclos, custos com encargos sociais.
- **Orçamentos**: EAP, itens, BDI, revisões, snapshots imutáveis e auditoria.
- **Relatórios**: analítico, sintético, recursos, ABC, resumo por etapa, memória de BDI e auditoria — em **XLSX, CSV e PDF**.
- **Importações duráveis**: upload multipart, checksum SHA-256, idempotência, retentativas, processamento sob demanda e cron.
- **Segurança**: senhas com bcrypt, chaves de IA criptografadas (AES-256-GCM), headers de segurança e cron autenticado.
- **Operação**: healthcheck, backups com manifesto, verificação de restauração e runbooks.

## Stack

| Camada | Tecnologia |
| --- | --- |
| Aplicação | Next.js 16 (App Router), React 19, TypeScript |
| Estilo/UI | Tailwind CSS 4, lucide-react |
| Banco | PostgreSQL + Prisma 6 |
| Autenticação | Auth.js (NextAuth 5) |
| Planilhas/PDF | ExcelJS, PapaParse, @react-pdf/renderer |
| Testes | Vitest, Playwright |
| Deploy | Vercel, Supabase Storage/S3, PostgreSQL gerenciado |

## Requisitos

- Node.js **20.9+** (recomendado 22)
- PostgreSQL **14+**
- Cliente PostgreSQL (`pg_dump`, `pg_restore`, `psql`) para backups/restauração

## Como rodar localmente

```bash
npm ci
cp .env.example .env      # preencha DATABASE_URL e AUTH_SECRET
npx prisma migrate deploy
npm run db:seed           # opcional: dados de demonstração (NÃO usar em produção)
npm run dev
```

Acesse `http://localhost:3000`. O seed cria o usuário de demonstração:

```
E-mail: demo@obracalc.com.br
Senha:  demo123456
```

> O storage local (`.storage/`) é usado em desenvolvimento. Em produção, `STORAGE_DRIVER=supabase` é obrigatório.

## Variáveis de ambiente

Copie `.env.example` e ajuste. As principais:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão do runtime (pooled em produção). |
| `DIRECT_URL` | Conexão direta para migrações e backups. |
| `AUTH_SECRET` / `AUTH_URL` | Sessão e URL pública. |
| `CRON_SECRET` | Protege `/api/cron/*` (obrigatório em produção). |
| `STORAGE_DRIVER` | `local` (dev) ou `supabase` (produção). |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage (service role só no servidor). |
| `BACKUP_S3_*` | Destino externo dos backups (recomendado). |
| `AI_ENCRYPTION_KEY` | Chave mestra das chaves de IA (recomendada em produção). |

Detalhes e checklist completo: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Scripts

```bash
npm run dev              # desenvolvimento
npm run build            # prisma generate + next build
npm run vercel-build     # migrações + build (usado na Vercel)
npm run start            # produção local

npm run db:migrate       # migração de desenvolvimento
npm run db:migrate:prod  # migrate deploy usando DIRECT_URL/DATABASE_URL
npm run db:seed          # dados de demonstração
npm run db:studio        # Prisma Studio

npm test                 # Vitest (unitários + integração)
npm run test:security    # testes de segurança
npm run test:performance # CSV grande / determinismo
npm run test:e2e         # Playwright

npm run env:check        # validação de ambiente
npm run security:secrets # varredura de segredos versionados

npm run backup           # pg_dump + upload + manifesto
npm run backup:verify    # restauração em banco descartável
npm run backup:prune     # expurgo por retenção
```

## Testes e verificação

| Suíte | Resultado da Etapa 12 |
| --- | --- |
| Vitest (unitários + integração) | **214 testes / 21 arquivos** aprovados |
| Segurança | **11 testes** (env, cron, path traversal, segredos) |
| Performance | **2 testes**: prévia de 50 mil linhas e importação de 4 mil linhas (~13–17 s) |
| Relatórios | **3 testes**: CSV com BOM/`;`/CRLF, XLSX válido, PDF `%PDF` |
| E2E (Playwright) | **6 testes** aprovados (login, headers, API 401, cron, health) |

Comandos de verificação:

```bash
npx tsc --noEmit
npx eslint <arquivos alterados>
npm test
npm run test:e2e
npm run build
npm run security:secrets
```

> O E2E usa `http://localhost:3000` por padrão (hidratação do Next em dev). Para outro alvo, defina `PLAYWRIGHT_BASE_URL`.

## Arquitetura de importação

1. O wizard envia o arquivo via `POST /api/import/jobs` (multipart).
2. O arquivo é validado, recebe SHA-256 e é gravado no storage persistente.
3. Um registro `ImportJob` é criado com chave de idempotência e contexto.
4. O processamento ocorre sob demanda (`POST /api/import/jobs/{id}/process`) e/ou pelo cron `/api/cron/import-jobs`.
5. Jobs `RUNNING` travados voltam para `PENDING` após `IMPORT_JOB_STALE_MINUTES`.
6. O checksum é reconferido na leitura; divergência falha o job sem alterar o catálogo.
7. O relatório e os erros ficam persistidos no próprio job e visíveis no histórico.

## Operação e recuperação

- [Checklist de implantação](docs/DEPLOYMENT.md)
- [Rotinas e runbooks de operação](docs/OPERATIONS.md)
- [Recuperação de desastre e evidência de restauração](docs/RECOVERY.md)
- Workflow de backup: `.github/workflows/backup.yml`

**Evidência de restauração (28/10/2026):** backup `cmvs61ofh0001knyk1r0wrla8`, checksum `ffe9ca83…7912a`, 10 tabelas conferidas, 2 migrações, `verified: true` em 2,3 s. Detalhes em [docs/RECOVERY.md](docs/RECOVERY.md).

## Estrutura

```
prisma/                 schema, migrações e seed
scripts/                migração de produção, env, segredos, backup e verificação
src/app/                rotas, páginas e API (App Router)
src/lib/actions/        Server Actions
src/lib/services/       regras de negócio (importação, snapshots, custos)
src/lib/engine/         cálculo determinístico (Decimal)
src/lib/reports/        modelos e exportadores XLSX/CSV/PDF
src/lib/storage/        drivers local e Supabase
src/lib/backup/         pg_dump, S3 e verificação de restauração
src/lib/security/       cron, paths e varredura de segredos
e2e/                    testes Playwright
docs/                   implantação, operação e recuperação
```

## Segurança

- Nenhum segredo versionado: `.env*` é ignorado, exceto `.env.example` com placeholders.
- `SUPABASE_SERVICE_ROLE_KEY` e chaves de IA nunca são expostas ao cliente.
- APIs sem sessão retornam `401 JSON`; páginas redirecionam para `/login`.
- Headers: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- Cron exige `Authorization: Bearer $CRON_SECRET` com comparação em tempo constante.
- Uploads validam tamanho, linhas, nome de arquivo e checksum; chaves de storage bloqueiam path traversal.
- Auditoria registra criação/conclusão/falha de jobs e operações sensíveis.

## Limitações conhecidas

- `pg_dump`/`pg_restore` não rodam no runtime serverless: backups são executados por script/CI.
- A Vercel limita o corpo da requisição a **4,5 MB**; em produção, ajuste `IMPORT_MAX_FILE_BYTES` ou use upload direto para o storage antes de aceitar arquivos maiores.
- O cron a cada 5 minutos e `maxDuration = 300` dependem do plano da Vercel.
- A restauração de verificação exige permissão para criar bancos; use um cluster de staging quando o provedor não permitir.
- Aviso de CSS do Tailwind 4 (`@theme`) no build é pré-existente e não bloqueante.
