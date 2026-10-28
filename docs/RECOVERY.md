# Recuperação de desastre — ObraCalc

Procedimentos para restaurar dados, validar backups e responder a incidentes.
Documentos relacionados: [DEPLOYMENT.md](./DEPLOYMENT.md) e [OPERATIONS.md](./OPERATIONS.md).

---

## 1. Objetivos de recuperação

| Métrica | Alvo atual | Como é obtido |
| --- | --- | --- |
| **RPO** (perda máxima de dados) | Até 24 h | Backup diário às 03:00 UTC (workflow). Ative PITR no provedor para reduzir a minutos. |
| **RTO** (tempo de retorno) | Até 2 h | Restauração em banco novo + troca de conexão + smoke test. |
| **RTO de rollback de aplicação** | Até 15 min | Promote do deployment anterior na Vercel. |
| **Verificação de backup** | Diária | `npm run backup:verify` no workflow. |
| **Simulação de restauração completa** | Mensal | Runbook da seção 5, com evidência registrada. |

> O backup é lógico (`pg_dump` custom). Para RPO menor, habilite **PITR** no PostgreSQL gerenciado e mantenha o backup lógico como proteção adicional/portabilidade.

---

## 2. Anatomia do backup

Cada execução de `npm run backup`:

1. Cria um registro `backup_logs` com status `STARTED`.
2. Executa `pg_dump --format=custom --no-owner --no-privileges`.
3. Calcula SHA-256 do arquivo.
4. Coleta um **manifesto**: contagens de `users`, `projects`, `budgets`, `budget_revisions`, `budget_items`, `resources`, `compositions`, `revision_snapshots`, `audit_entries`, `import_jobs` e número de migrações aplicadas.
5. Envia o dump para S3 (se `BACKUP_S3_*` configurado) ou Supabase Storage.
6. Atualiza o registro com status `COMPLETED`, chave, driver, tamanho, checksum e manifesto.

`npm run backup:verify`:

1. Seleciona o backup mais recente `COMPLETED` (ou `--backup-id`).
2. Baixa o objeto e **recalcula o checksum**.
3. Cria um banco descartável `obracalc_restore_<timestamp>`.
4. Restaura com `pg_restore --exit-on-error --no-owner --no-privileges`.
5. Compara as contagens do manifesto com o banco restaurado e o número de migrações.
6. Marca `restore_verified = true` e remove o banco temporário (salvo `--keep-database`).

---

## 3. Pré-requisitos de recuperação

- [ ] Acesso ao bucket de backups (S3 ou Supabase Storage).
- [ ] `pg_dump`, `pg_restore` e `psql` disponíveis (ou `PG_BIN` definido).
- [ ] Credencial com permissão de **criar/remover bancos** para a verificação, ou um cluster de staging equivalente.
- [ ] `DIRECT_URL` do banco de origem (sem pooler) para backup/restauração.
- [ ] Espaço em disco suficiente para o dump e para o banco restaurado.
- [ ] Registro do incidente aberto e responsável definido.

> Em provedores que não permitem `CREATE DATABASE` pelo usuário da aplicação, execute a verificação em um cluster de staging com a mesma versão do PostgreSQL, ou crie o banco manualmente e adapte o comando de restauração.

---

## 4. Verificação de backup (sem tocar em produção)

```bash
# Backup mais recente
npm run backup:verify

# Backup específico
npx tsx scripts/verify-restore.ts --backup-id <id>

# Manter o banco restaurado para inspeção
npx tsx scripts/verify-restore.ts --backup-id <id> --keep-database
```

Saída esperada (resumo):

```json
{
  "event": "backup.restore-verify",
  "verified": true,
  "migrationsApplied": 2,
  "durationMs": 2304
}
```

Checklist:

- [ ] `verified: true`.
- [ ] Todas as tabelas do manifesto com contagem idêntica.
- [ ] `migrationsApplied` igual ao manifesto.
- [ ] Checksum do objeto baixado confere.
- [ ] Banco temporário removido (ou removido manualmente após inspeção).
- [ ] Evidência registrada (ID, checksum, data, responsável).

---

## 5. Restauração completa (incidente em produção)

Use quando os dados de produção estiverem corrompidos/perdidos e for necessário voltar a um ponto consistente.

### 5.1 Preparação

- [ ] Declare o incidente e **suspenda escritas** (modo manutenção ou desative o tráfego).
- [ ] Escolha o backup: mais recente válido ou ponto anterior ao incidente.
- [ ] Registre `backup_logs.id`, checksum e horário.
- [ ] Faça um snapshot/backup do estado atual, se possível, para forense.
- [ ] Crie um banco novo (não sobrescreva o banco atual).

### 5.2 Restaurar em banco novo

```bash
# Exemplo com psql/pg_restore no PATH
export PGPASSWORD='***'   # prefira .pgpass ou cofre; não registre em histórico

psql -h <host> -p 5432 -U <user> -d postgres \
  -c 'CREATE DATABASE obracalc_recovery'

pg_restore \
  --host <host> --port 5432 --username <user> \
  --dbname obracalc_recovery \
  --no-owner --no-privileges --exit-on-error \
  caminho/para/backup.dump
```

Se o dump estiver no S3/Supabase, baixe-o primeiro pelo console do provedor ou reutilize o script de verificação com `--keep-database`.

### 5.3 Validar o banco restaurado

```sql
SELECT count(*) FROM users;
SELECT count(*) FROM projects;
SELECT count(*) FROM budgets;
SELECT count(*) FROM budget_revisions;
SELECT count(*) FROM budget_items;
SELECT count(*) FROM resources;
SELECT count(*) FROM compositions;
SELECT count(*) FROM revision_snapshots;
SELECT count(*) FROM audit_entries;
SELECT count(*) FROM import_jobs;

SELECT count(*) FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;

SELECT id, status, created_at FROM backup_logs ORDER BY created_at DESC LIMIT 5;
```

- [ ] Contagens compatíveis com o manifesto do backup.
- [ ] Migrações aplicadas corretamente.
- [ ] Consultas de sanidade em orçamentos/revisões/snapshots.
- [ ] `npx prisma migrate status` sem pendências (usando a URL do banco restaurado).

### 5.4 Promover o banco restaurado

- [ ] Atualize `DATABASE_URL` (runtime) e `DIRECT_URL` (migrações/backup) na Vercel para o banco restaurado.
- [ ] Redeploy ou reinicie as funções para recriar o pool de conexões.
- [ ] Valide `/api/health`.
- [ ] Execute o smoke test: login, listagem de orçamentos, importação pequena, relatório.
- [ ] Reative o tráfego.
- [ ] Monitore erros 5xx, fila e conexões por pelo menos 1 hora.
- [ ] Comunique a recuperação e o RPO efetivo (hora do backup).

### 5.5 Limpeza

- [ ] Mantenha o banco antigo isolado (sem tráfego) até a validação final.
- [ ] Remova bancos temporários após o encerramento.
- [ ] Atualize o registro do incidente com RPO/RTO realizados.
- [ ] Agende post-mortem sem culpa.

---

## 6. Restauração parcial

Use quando apenas uma tabela/registros foram afetados.

1. Restaure o dump em um banco de staging.
2. Extraia apenas os dados necessários:

```bash
pg_restore --data-only --table=budget_items \
  --host <host> --username <user> --dbname obracalc_staging backup.dump
```

3. Compare chaves/contagens e monte o `INSERT`/`UPDATE` com cuidado (respeite FKs e `updated_at`).
4. Execute em transação no banco de produção, com backup recente e janela de manutenção.
5. Valide totais e reconciliação dos relatórios após a operação.

> Nunca use `--clean` em produção: ele remove objetos antes de recriar.

---

## 7. Recuperação de storage (arquivos de importação)

- Ative **versionamento** no bucket S3/Supabase e preserve a política de retenção.
- Se o storage for perdido:
  - os dados já importados permanecem no banco;
  - jobs antigos podem ficar sem o arquivo original (não é possível reprocessá-los);
  - restaure o bucket pelo versionamento/backup do provedor ou solicite novo upload.
- Valide objetos referenciados por `import_jobs.file_key` e `backup_logs.storage_key`.
- Nunca armazene dumps apenas no disco local em produção.

---

## 8. Cenários e respostas

| Cenário | Ação principal | RPO | RTO estimado |
| --- | --- | --- | --- |
| Bug em deploy | Rollback na Vercel | 0 | 15 min |
| Dados corrompidos por operação | Restaurar backup em banco novo + validação | 24 h (ou PITR) | 1–2 h |
| Tabela removida acidentalmente | PITR (se disponível) ou restauração completa | minutos–24 h | 1–2 h |
| Banco indisponível | Failover/PITR do provedor | conforme provedor | 30 min–2 h |
| Storage indisponível | Restaurar bucket/versionamento | conforme provedor | 30 min–2 h |
| Vazamento de segredo | Rotacionar credenciais e invalidar sessões | 0 | 30 min |
| Região do provedor indisponível | Restaurar último backup em nova região | 24 h | 2–4 h |

---

## 9. Evidência de restauração — Etapa 12

Teste executado em **28/10/2026** no ambiente local de homologação:

| Item | Valor |
| --- | --- |
| ID do backup | `cmvs61ofh0001knyk1r0wrla8` |
| Driver (demonstração) | `local` (em produção: `s3` ou `supabase`) |
| Chave | `backups/2026/10/28/2026-10-28T13-44-31-892Z-obracalc-cmvs61ofh0001knyk1r0wrla8.dump` |
| Tamanho | 219.487 bytes |
| Checksum SHA-256 | `ffe9ca838500c6914e8c7bb153a24fd34774e308891edc5aefad80398cb7912a` |
| Migrações aplicadas | 2 |
| Banco de restauração | `obracalc_restore_1793195078837` |
| Resultado | `verified: true` |
| Duração da restauração | 2.304 ms |

Contagens conferidas (manifesto × banco restaurado):

| Tabela | Contagem |
| --- | --- |
| `users` | 11 |
| `projects` | 238 |
| `budgets` | 219 |
| `budget_revisions` | 245 |
| `budget_items` | 224 |
| `resources` | 472 |
| `compositions` | 272 |
| `revision_snapshots` | 62 |
| `audit_entries` | 430 |
| `import_jobs` | 0 |

O banco descartável foi removido após a verificação. Em produção, o mesmo procedimento é executado pelo workflow `.github/workflows/backup.yml`, com destino externo (S3 ou Supabase Storage).

---

## 10. Checklist de simulação mensal

- [ ] Escolher um backup recente e um banco/cluster de teste.
- [ ] Executar `npm run backup:verify -- --backup-id <id>` (ou `--keep-database`).
- [ ] Conferir checksum, contagens e migrações.
- [ ] Executar consultas de reconciliação em um orçamento com snapshot.
- [ ] Medir tempo total e comparar com o RTO.
- [ ] Registrar evidência e lições aprendidas.
- [ ] Atualizar este documento se o procedimento mudar.

---

## 11. Pós-incidente

- [ ] Confirmar que os dados restaurados estão íntegros e os relatórios reconciliam.
- [ ] Verificar fila de importações e jobs órfãos.
- [ ] Confirmar backups seguintes (`COMPLETED` + `verified`).
- [ ] Documentar causa raiz, impacto, RPO/RTO reais e ações corretivas.
- [ ] Criar tarefas para evitar recorrência.
