# Implantação — ObraCalc (Etapa 12)

Este documento descreve a implantação em produção na **Vercel** com **PostgreSQL gerenciado**, **Supabase Storage** para arquivos persistentes, **cron de processamento** da fila de importações e **backups externos verificáveis**.

> Regra de ouro: nenhum segredo real é versionado. `.env` é ignorado pelo Git e `.env.example` contém apenas placeholders.

---

## 1. Arquitetura de produção

| Componente | Serviço | Observação |
| --- | --- | --- |
| Aplicação | Vercel (Next.js 16, Node.js) | Build `npm run vercel-build` |
| Banco | PostgreSQL gerenciado (Supabase, Neon, RDS etc.) | `DATABASE_URL` para runtime e `DIRECT_URL` para DDL/backup |
| Arquivos | Supabase Storage (bucket privado) | Disco da Vercel é efêmero; storage local é bloqueado em produção |
| Fila de importação | Tabela `import_jobs` + cron `/api/cron/import-jobs` | Processamento sob demanda + recuperação de jobs travados |
| Backups | `pg_dump` + S3 ou Supabase Storage | Executado por script/CI, nunca pelo runtime serverless |
| Saúde | `GET /api/health` | Público, sem segredos |

Limites padrão (configuráveis por ambiente):

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `IMPORT_MAX_FILE_BYTES` | 25 MB | Rejeita uploads maiores com HTTP 413. Na Vercel, o limite de corpo da função é 4,5 MB; veja a seção 8. |
| `IMPORT_MAX_ROWS` | 100.000 | Rejeita CSVs acima do limite |
| `IMPORT_JOB_MAX_ATTEMPTS` | 3 | Tentativas por job |
| `IMPORT_JOB_STALE_MINUTES` | 15 | Job `RUNNING` travado volta para `PENDING` |
| `IMPORT_CRON_BATCH_SIZE` | 5 | Jobs processados por execução do cron |
| `BACKUP_RETENTION_DAYS` | 30 | Expurgo de backups antigos |

---

## 2. Pré-requisitos

- [ ] Conta na Vercel com o repositório conectado.
- [ ] PostgreSQL gerenciado criado, com SSL habilitado.
- [ ] Projeto Supabase criado e bucket privado disponível (pode ser criado automaticamente pelo app).
- [ ] `AUTH_SECRET` forte (mínimo 32 caracteres).
- [ ] `CRON_SECRET` forte (mínimo 16 caracteres).
- [ ] Destino de backup externo: bucket S3 **ou** bucket Supabase separado do bucket de arquivos.
- [ ] Cliente PostgreSQL (`pg_dump`, `pg_restore`, `psql`) na máquina/CI que executará backups.
- [ ] Plano Vercel compatível com a frequência de cron e com a duração das funções (ver seção 8).

Gere segredos sem gravá-los no repositório:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 3. Variáveis de ambiente

Configure na Vercel em **Production** (e valores distintos em **Preview**).

| Variável | Obrigatória em produção | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | Sim | Conexão do runtime (pooled, com `sslmode=require`; em Supabase acrescente `pgbouncer=true&connection_limit=1`). |
| `DIRECT_URL` | Recomendada | Conexão direta para migrações e backups. Evita o pooler. |
| `AUTH_SECRET` | Sim | Assina sessão/JWT. Mínimo 32 caracteres. Rotação invalida sessões. |
| `AUTH_URL` | Sim | URL pública HTTPS, ex.: `https://obracalc.seudominio.com.br`. |
| `NEXTAUTH_URL` | Não | Compatibilidade; use o mesmo valor de `AUTH_URL`. |
| `CRON_SECRET` | Sim | Protege `/api/cron/*` com `Authorization: Bearer`. |
| `STORAGE_DRIVER` | Sim | `supabase` em produção (o valor `local` é rejeitado). |
| `NEXT_PUBLIC_SUPABASE_URL` | Sim (com Supabase) | URL do projeto Supabase (pública por design). |
| `SUPABASE_SERVICE_ROLE_KEY` | Sim (com Supabase) | **Segredo**; usada apenas no servidor. |
| `SUPABASE_STORAGE_BUCKET` | Não | Padrão `obracalc`. Bucket privado. |
| `BACKUP_S3_BUCKET` | Recomendada | Destino externo dos dumps. |
| `BACKUP_S3_REGION` | Recomendada | Região do bucket S3. |
| `BACKUP_S3_ACCESS_KEY` | Recomendada | Credencial com permissão de escrita/leitura no prefixo. |
| `BACKUP_S3_SECRET_KEY` | Recomendada | **Segredo**. |
| `BACKUP_PREFIX` | Não | Padrão `backups`. |
| `BACKUP_RETENTION_DAYS` | Não | Padrão 30. |
| `AI_ENCRYPTION_KEY` | Recomendada | 64 caracteres hexadecimais. Se vazia, deriva de `AUTH_SECRET`. |
| `OPENAI_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY` | Não | Opcionais; podem ser cadastradas pela UI (criptografadas). |
| `PG_BIN` | Não | Caminho do `bin` do PostgreSQL para scripts locais/CI. |

Validação local antes do deploy:

```bash
npx tsx scripts/check-env.ts --production
npm run security:secrets
```

> `AI_ENCRYPTION_KEY` vazia gera apenas um **aviso**, nunca um erro. O healthcheck cita o nome da variável, mas nunca seu valor.

### 3.1 Separação entre produção e preview

- Use **banco e bucket diferentes** para Preview.
- Nunca aponte Preview para o banco de produção.
- Segredos de produção ficam apenas no escopo **Production**.

---

## 4. Preparação do banco e do storage

### 4.1 Banco

1. Crie o banco e o usuário da aplicação.
2. Habilite SSL e guarde a URL **pooled** (`DATABASE_URL`) e a **direta** (`DIRECT_URL`).
3. Não execute `db:seed` em produção: o seed cria o usuário de demonstração `demo@obracalc.com.br` com senha conhecida.
4. Aplique as migrações (o build da Vercel também aplica — ver seção 5):

```bash
# Com DIRECT_URL configurada no ambiente (não versionar)
npm run db:migrate:prod
npx prisma migrate status
```

As migrações são versionadas em `prisma/migrations/` e aplicadas com `prisma migrate deploy`, que é idempotente e serializado por advisory lock.

### 4.2 Storage

1. Crie o bucket privado (padrão `obracalc`) ou deixe o app criá-lo na primeira escrita.
2. A `SUPABASE_SERVICE_ROLE_KEY` só pode existir no servidor.
3. Não torne o bucket público: arquivos de importação podem conter dados de clientes.
4. Configure versionamento/lifecycle no bucket de backups conforme a política de retenção.

---

## 5. Deploy na Vercel

`vercel.json` já define:

- `buildCommand`: `npm run vercel-build`
- cron `/api/cron/import-jobs` a cada 5 minutos
- `maxDuration` de 300 s para rotas de importação/cron e 30 s para o healthcheck

Passos:

- [ ] Importe o repositório na Vercel (framework detectado: Next.js).
- [ ] Configure todas as variáveis da seção 3 em **Production**.
- [ ] Garanta Node.js 20.9+ (recomendado 22) no projeto.
- [ ] Faça o deploy.
- [ ] Confira nos logs de build: `prisma generate`, migrações aplicadas e `next build` concluído.
- [ ] Abra `https://<domínio>/api/health` e confirme `status: "ok"`.
- [ ] Ajuste `AUTH_URL`/`NEXTAUTH_URL` para o domínio final e redeploy se necessário.
- [ ] Cadastre o domínio e valide HTTPS/cookies `Secure`.

### 5.1 Migrações no build

`vercel-build` executa `tsx scripts/migrate-deploy.ts` antes do `next build`. O script usa `DIRECT_URL` quando presente e `DATABASE_URL` caso contrário.

Boas práticas:

- Prefira migrações **compatíveis para frente** (adicionar colunas/tabelas; evitar remoções no mesmo deploy).
- Em times com muitos deploys simultâneos, acompanhe o lock de migração nos logs.
- Se a política da organização exigir, mova a migração para um job de CI dedicado e mantenha o build apenas compilando. Nesse caso, remova a chamada de migração do `vercel-build` e execute `npm run db:migrate:prod` antes do promote.

---

## 6. Verificação pós-deploy (smoke test)

- [ ] `GET /api/health` retorna **200** com `checks.database=true`, `checks.environment=true`, `checks.storage="supabase"`.
- [ ] O JSON do healthcheck não contém URL de banco, tokens nem valores de segredos.
- [ ] Login funciona e a sessão persiste após recarregar.
- [ ] Rota protegida sem sessão redireciona para `/login`; API sem sessão retorna **401 JSON**.
- [ ] `/api/import/jobs` sem sessão retorna **401**.
- [ ] Cron sem `Authorization` retorna **401**; com `Bearer $CRON_SECRET` retorna **200**.
- [ ] Importe um CSV pequeno em `/import`: job criado, arquivo no bucket, status `COMPLETED`, histórico atualizado.
- [ ] Gere relatório XLSX, CSV e PDF e confira os totais.
- [ ] Cabeçalhos de segurança presentes (`X-Frame-Options: DENY`, CSP, `nosniff`, `Referrer-Policy`).
- [ ] Execução manual do workflow de backup concluída e `backup:verify` com `verified: true`.

Exemplo de chamada autenticada do cron:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" https://<domínio>/api/cron/import-jobs
```

---

## 7. Backups externos

O runtime da Vercel **não** executa `pg_dump`. Os backups rodam em CI ou em uma máquina com acesso ao banco:

```bash
npm run backup          # pg_dump + checksum + manifesto + upload
npm run backup:verify   # baixa, restaura em banco descartável e compara contagens
npm run backup:prune    # remove backups além da retenção
```

- Destino: S3 quando as quatro `BACKUP_S3_*` estão preenchidas; caso contrário, Supabase Storage.
- O manifesto registra contagens das tabelas principais e o número de migrações aplicadas.
- A verificação cria `obracalc_restore_<timestamp>`, restaura o dump e compara tabela por tabela; o banco é removido ao final (use `--keep-database` para inspecionar).
- O workflow `.github/workflows/backup.yml` agenda backup diário às 03:00 UTC e verificação de restauração. Configure os segredos indicados no próprio arquivo.

Detalhes e evidência do teste realizado: [RECOVERY.md](./RECOVERY.md).

---

## 8. Limitações de plano da Vercel

- **Corpo da requisição:** as funções da Vercel limitam o corpo a **4,5 MB**. O padrão de `IMPORT_MAX_FILE_BYTES` é 25 MB para instalações Node/self-hosted; em produção na Vercel configure, por exemplo, `IMPORT_MAX_FILE_BYTES=4194304` (4 MiB) ou implemente upload direto para o storage com URL assinada antes de ampliar o limite.
- **Cron a cada 5 minutos** exige plano Pro (Hobby permite apenas execuções diárias). Ajuste `vercel.json` conforme o plano.
- **`maxDuration = 300`** depende do plano; em planos com limite menor, a função é interrompida. Nesse caso:
  - reduza `IMPORT_MAX_ROWS`/`IMPORT_MAX_FILE_BYTES`;
  - mantenha `IMPORT_CRON_BATCH_SIZE` baixo;
  - o cron recupera jobs travados após `IMPORT_JOB_STALE_MINUTES` e continua a fila.
- O **Fluid Compute** (quando disponível) ajuda em importações longas; monitore duração e erros.

---

## 9. Rollback

1. Na Vercel, abra **Deployments** e promova o deployment anterior (`Promote to Production`).
2. Verifique `/api/health` e o login.
3. Migrações são **forward-only**: só faça rollback de aplicação se o schema continuar compatível.
4. Para mudanças destrutivas, use o padrão expand/contract (dois deploys).
5. Se houver corrupção de dados, siga [RECOVERY.md](./RECOVERY.md) antes de novos deploys.

---

## 10. Checklist final de aceite

- [ ] Aplicação acessível em HTTPS e healthcheck `ok`.
- [ ] Migrações reproduzíveis a partir de banco vazio (`prisma migrate deploy`).
- [ ] Storage persistente ativo; nenhum arquivo gravado no disco da Vercel.
- [ ] Fila de importação processando e recuperando jobs travados.
- [ ] Backups externos agendados, com checksum e manifesto.
- [ ] Restauração demonstrada em banco descartável (`verified: true`).
- [ ] Nenhum segredo versionado (`npm run security:secrets`).
- [ ] Suítes unitária, integração, E2E, segurança e performance executadas.
- [ ] Runbooks de operação e recuperação publicados.
