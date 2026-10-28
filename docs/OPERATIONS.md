# Operação — ObraCalc

Rotinas, monitoramento e runbooks para manter a aplicação saudável em produção.
Documentos relacionados: [DEPLOYMENT.md](./DEPLOYMENT.md) e [RECOVERY.md](./RECOVERY.md).

---

## 1. Visão geral operacional

| Área | Sinal | Onde observar |
| --- | --- | --- |
| Aplicação | Erros 5xx, latência, cold starts | Vercel → Logs / Observability |
| Banco | Conexões, CPU, storage, locks | Painel do provedor PostgreSQL |
| Storage | Objetos, erros de upload/download | Painel do Supabase/S3 |
| Fila | Jobs `PENDING`, `RUNNING`, `FAILED` | Tabela `import_jobs` / histórico em `/import` |
| Cron | HTTP 200/401/503, duração | Vercel → Cron Jobs / Logs |
| Backups | `COMPLETED`, checksum, restauração | Tabela `backup_logs` + GitHub Actions |
| Auditoria | Eventos por entidade | Tabela `audit_entries` |

Limiares sugeridos (ajuste à realidade):

- Healthcheck falhando por **2 execuções consecutivas** → incidente.
- Erros 5xx acima de **1%** por 10 minutos → investigar.
- Jobs `PENDING` mais antigos que **15 minutos** → verificar cron.
- Jobs `FAILED` com crescimento diário → investigar dados/arquivo.
- Backup diário ausente ou `FAILED` → incidente de continuidade.
- Uso de disco do banco acima de **80%** → planejar expansão.

---

## 2. Rotinas

### 2.1 Diária

- [ ] Verificar `/api/health` (`status: "ok"`, `database: true`, `environment: true`, `storage: "supabase"`).
- [ ] Conferir execuções do cron de importações (sem 401 inesperado, sem 5xx).
- [ ] Revisar jobs `FAILED` e `PENDING` antigos.
- [ ] Confirmar backup do dia (`backup_logs.status = COMPLETED` e checksum presente).
- [ ] Verificar erros 5xx e picos de latência.
- [ ] Confirmar ausência de alertas de segredo/credencial no repositório.

Consultas úteis (via `psql` ou Prisma Studio):

```sql
-- Fila por status
SELECT status, count(*) FROM import_jobs GROUP BY status;

-- Jobs parados há mais de 15 minutos
SELECT id, status, attempts, created_at, started_at
FROM import_jobs
WHERE status IN ('PENDING','RUNNING')
  AND created_at < now() - interval '15 minutes'
ORDER BY created_at;

-- Últimos backups
SELECT id, status, storage_driver, file_size_bytes, restore_verified, created_at
FROM backup_logs
ORDER BY created_at DESC
LIMIT 10;
```

### 2.2 Semanal

- [ ] Revisar tendência de crescimento do banco e do storage.
- [ ] Revisar jobs reprocessados e causas de falha.
- [ ] Verificar expurgo de backups (`backup:prune`) e retenção efetiva.
- [ ] Revisar dependências com vulnerabilidades conhecidas (`npm audit`).
- [ ] Conferir acessos de usuários e perfis administrativos.

### 2.3 Mensal

- [ ] Executar **simulação de restauração** com `npm run backup:verify` e registrar evidência.
- [ ] Revisar RPO/RTO e plano de continuidade.
- [ ] Revisar logs de auditoria e retenção.
- [ ] Testar rollback de aplicação em Preview.
- [ ] Revisar rotação de segredos e validade de credenciais.

---

## 3. Comandos de operação

```bash
# Saúde e configuração
npm run env:check
npm run security:secrets

# Banco
npx prisma migrate status
npm run db:migrate:prod

# Testes
npm test
npm run test:security
npm run test:performance
npm run test:e2e

# Backups
npm run backup
npm run backup:verify
npm run backup:prune

# Build local equivalente ao da Vercel
npm run build
```

Em produção, comandos de banco/backup devem rodar em CI ou máquina autorizada com `DIRECT_URL`, nunca em uma função serverless.

---

## 4. Runbooks

### 4.1 Job de importação travado em `RUNNING`

**Sintoma:** job permanece `RUNNING` além de `IMPORT_JOB_STALE_MINUTES`.

**Ação:**

1. Confira se o cron está sendo executado e autenticado.
2. O próximo ciclo do cron recupera automaticamente o job (`RUNNING` antigo → `PENDING`).
3. Se necessário, o próprio usuário pode acionar `POST /api/import/jobs/{id}/process`.
4. Se o job falhar repetidamente, verifique `errorMessage` e o checksum do arquivo no storage.
5. Após `IMPORT_JOB_MAX_ATTEMPTS`, o job fica `FAILED`; corrija o arquivo/mapeamento e crie um novo job (idempotência evita duplicidade).

### 4.2 Cron retornando 401/503

- **401:** `CRON_SECRET` ausente/divergente ou header `Authorization` incorreto. Confirme a variável na Vercel e a configuração do cron.
- **503:** configuração de ambiente inválida ou `CRON_SECRET` não definido. Rode `npx tsx scripts/check-env.ts --production` com as variáveis de produção e corrija os erros.
- **500:** verifique logs da função e conectividade com o banco.

### 4.3 Falha de upload/leitura no storage

1. Confirme `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_STORAGE_BUCKET`.
2. Verifique se o bucket existe e é privado.
3. Confirme limites de tamanho (`IMPORT_MAX_FILE_BYTES`) e cota do provedor. Na Vercel, o corpo da requisição é limitado a 4,5 MB.
4. Erros de checksum indicam arquivo alterado/corrompido: o job falha sem alterar o catálogo e deve ser recriado.

### 4.4 Banco lento ou conexões esgotadas

1. Verifique conexões ativas e pool no provedor.
2. Prefira `DATABASE_URL` pooled no runtime e `DIRECT_URL` para DDL/backup.
3. Reduza `IMPORT_CRON_BATCH_SIZE` temporariamente.
4. Identifique consultas lentas e locks; evite migrações durante pico.
5. Se necessário, escale o plano do banco.

### 4.5 Backup falhou

1. Leia `backup_logs.error_message` (senhas são mascaradas).
2. Valide `DIRECT_URL`, SSL e permissões de leitura.
3. Confirme `pg_dump` disponível (`PG_BIN` ou PATH) e versão compatível com o servidor.
4. Valide credenciais do destino (S3/Supabase) e espaço/cota.
5. Reexecute `npm run backup`; depois `npm run backup:verify`.
6. Se o backup do dia não for recuperado, trate como incidente de continuidade e siga [RECOVERY.md](./RECOVERY.md).

### 4.6 Suspeita de vazamento de segredo

1. Revogue/rotacione a credencial imediatamente (banco, Supabase service role, S3, chaves de IA).
2. Se `AUTH_SECRET` foi rotacionada, todas as sessões serão invalidadas.
3. Se `AI_ENCRYPTION_KEY` for derivada de `AUTH_SECRET`, as chaves de IA armazenadas deixam de ser decifráveis; recadastre-as.
4. Remova o segredo do histórico do Git (BFG/filter-repo) e force a rotação.
5. Rode `npm run security:secrets` e verifique logs de acesso.
6. Registre o incidente e as ações tomadas.

### 4.7 Erro após deploy

1. Compare logs e o deployment anterior.
2. Se o erro for de schema, verifique `prisma migrate status` e a compatibilidade.
3. Promova o deployment anterior na Vercel.
4. Se dados estiverem inconsistentes, **pare escritas** e siga o runbook de restauração.

---

## 5. Gestão de mudanças

- [ ] Toda migração entra em `prisma/migrations/` e é revisada.
- [ ] Mudanças destrutivas usam expand/contract.
- [ ] Deploy em Preview com banco separado antes de Production.
- [ ] Rodar `npx tsc --noEmit`, `npm test`, `npm run test:e2e` e `npm run build`.
- [ ] Rodar `npm run security:secrets`.
- [ ] Ter plano de rollback e backup recente antes de migrações de risco.
- [ ] Registrar mudanças relevantes (changelog/issue).

---

## 6. Segurança operacional

- Menor privilégio: usuário de runtime não deve ser superusuário; credenciais de backup separadas.
- Segredos apenas em cofres/variáveis da Vercel; nunca em issues, logs ou commits.
- Preview nunca acessa dados de produção.
- Buckets privados; links assinados apenas quando necessário.
- Revisar `audit_entries` para operações sensíveis.
- Manter dependências atualizadas e monitorar CVEs.
- Limitar quem pode promover deployments e acessar o banco.

---

## 7. Evidências de operação

Registre em cada execução relevante:

- data/hora e responsável;
- resultado do healthcheck;
- quantidade de jobs por status;
- backup (ID, checksum, tamanho, destino);
- resultado da verificação de restauração;
- incidentes abertos e ações.

O teste de restauração da Etapa 12 está documentado em [RECOVERY.md](./RECOVERY.md).
