# Short CTA AI — Fases e o que falta

Estado em 2026-09-29. Leia [`HANDOFF.md`](./HANDOFF.md) antes.

Este roadmap cobre a **esteira de análise** (a Fila). O módulo de edição tem
o seu próprio: [`video-editor/IMPLEMENTATION_PLAN.md`](./video-editor/IMPLEMENTATION_PLAN.md).

Legenda: ✅ pronto e verificado · ⚠️ existe mas com ressalva · ❌ não feito

---

## Fase 0 — Desbloqueio

| # | Item | Estado |
| --- | --- | --- |
| 0.1 | Colocar o projeto em git e commitar o estado atual | ✅ 2026-09-18 |
| 0.2 | **Resolver o OCR no Windows** (`HANDOFF.md` §5.1) | ✅ 2026-09-18 — era CRLF no parser do TSV |
| 0.3 | Instalar `faster-whisper` e ligar a transcrição | ✅ 2026-09-28 — o caminho do Python estava errado (`HANDOFF.md` §5.2) |
| 0.4 | Testar o GhostCLI contra a API real, não o mock | ✅ em uso contra `https://ghostcli.dev/v1`: ~950 chamadas registradas |
| 0.9 | Segundo provedor de IA com plano gratuito | ✅ 2026-09-30 — Google Gemini pelo mesmo cliente, com modelo reserva (HISTORICO §28, §32) |
| 0.5 | Reanalisar o acervo depois da correção do OCR | ✅ os 98 vídeos têm análise visual pós-correção; 65 com CTA fixo detectado |
| 0.7 | Reanalisar os 92 vídeos com transcrição falhada | ✅ encerrado 2026-09-29 — o usuário apagou esses vídeos; os 7 atuais têm fala |
| 0.8 | Deixar a análise mais rápida (HISTORICO §27) | ✅ 2026-09-29 — transcrição na GPU (5×), beam 1, OCR junto com a fala, pista própria para "Gerar CTAs"; parte local na CPU 84,5 → 58,6 s |

A Fase 0 está cumprida, sem pendência: os vídeos que tinham CTAs gerados sem
ouvir o diálogo foram apagados pelo usuário em 2026-09-29, e todo o acervo
atual tem fala transcrita.

---

## Fase 1 — MVP funcional

Era o escopo contratado. Está essencialmente completo.

| Item | Estado | Observação |
| --- | --- | --- |
| Upload em lote (arquivos e pasta) | ✅ | Validação por conteúdo, não por extensão |
| Dedupe por hash | ✅ | Opção de ignorar ou reanalisar |
| Fila persistente com retomada | ✅ | Testada derrubando o servidor no meio |
| Estados da fila (10 estados da spec) | ✅ | Indicador de atividade, sem percentual falso |
| FFmpeg: metadados, miniatura, áudio, frames | ✅ | Seleção de instantes adaptada à duração |
| Dedupe de frames quase idênticos | ✅ | Average hash 8×8 |
| Transcrição (`faster-whisper`) | ✅ | Ligada desde 2026-09-28; na GPU desde 2026-09-29 (`FASTER_WHISPER_DEVICE=auto`, cai para a CPU sem CUDA) |
| CTA a partir do enredo pela fala | ⚠️ | 2026-09-29: a geração lê a transcrição; sem chamada real conferida ainda (HISTORICO §24) |
| OCR e classificação do texto | ✅ | Detecta o CTA fixo do vídeo; verificado em vídeo real |
| Integração GhostCLI | ✅ | Em uso contra a API real (item 0.4) |
| Integração Google Gemini | ✅ | 188 chamadas ok, 11 reaproveitadas; análise e geração em ~3,9 s. 186 no `gemini-3.5-flash-lite` |
| Validação da saída do modelo | ✅ | zod + regras editoriais + uma correção |
| Geração de CTAs com distribuição por estilo | ✅ | A soma bate com a quantidade pedida |
| Identificação de obra | ✅ | Só afirma com evidência; correção manual |
| Revisão manual (copiar, editar, escolher, favoritar) | ✅ | |
| Regenerar CTAs / Analisar novamente | ✅ | Regenerar reaproveita a análise salva |
| Exportação CSV e JSON | ✅ | Escape correto, sem injeção de fórmula |
| Configurações + teste de conexão | ✅ | Chave nunca chega ao navegador |
| Autenticação | ✅ | Senha única, sessão assinada |
| Retenção de dados | ✅ | Configurável, com execução manual |

### Acrescentado depois, fora da spec original

| Item | Estado |
| --- | --- |
| Detecção de origem (Instagram/TikTok) pelo nome do arquivo | ✅ |
| Link clicável para o post original, na grade e no painel | ✅ |
| Player do post embutido no painel | ✅ |
| Proporção real do vídeo em todas as prévias | ✅ |
| Seleção múltipla + exclusão em lote | ✅ |
| Exclusão individual com cancelamento do job | ✅ |
| Captura de metadados do post (oEmbed) | ⚠️ TikTok sim, Instagram exige token |
| `npm run doctor` — diagnóstico de ambiente | ✅ |
| `npm run ocr:check` — diagnóstico do OCR (frame cru e tratado) | ✅ |
| `npm run cta:debug` — pipeline inteiro num vídeo, passo a passo | ✅ |
| Amostragem começo/meio/fim protegida do dedupe | ✅ |
| Fusão de linhas vizinhas em bloco antes de classificar | ✅ |
| `npm run backfill:source` — recalcula origem dos já importados | ✅ |
| `npm run mock:ghostcli` — rodar sem credencial | ✅ |

---

## Fase 2 — Qualidade editorial

**Adiada pelo usuário em 2026-09-29** ("não vou precisar dessas fases por
enquanto"). Não comece sem ele pedir.

Só faz sentido começar depois da Fase 0.

| # | Item | Notas para quem for fazer |
| --- | --- | --- |
| 2.1 | **Descrição visual da cena** | A interface `VisionProvider` já existe e hoje só faz OCR. Um provedor com modelo de visão preencheria `sceneDescription` e `visualClues`. Enquanto não existir, o sistema **declara** a limitação — não invente descrição. |
| 2.2 | Melhorar a classificação do CTA existente | A heurística acerta nos sintéticos e num corte real conferido. Colete casos errados de verdade (`npm run cta:debug`) antes de mexer nos pesos — o risco é ajustar por intuição e quebrar caso que já funcionava. |
| 2.3 | Identificação de obra com pesquisa externa | `SearchProvider` e a ferramenta `search_movie` já estão prontas e expostas ao modelo por tool calling. Falta configurar um endpoint em `SEARCH_PROVIDER`. |
| 2.4 | Captura do Instagram | Configurar token de app do Facebook para o oEmbed, ou decidir outro caminho. Ver `src/lib/capture.ts`. |
| 2.5 | Histórico de preferências de estilo | A página "Meu estilo" já guarda exemplos curados que entram no contexto. Falta medir se ajuda e evoluir a curadoria. |

---

## Fase 3 — Escala e operação

| # | Item | Notas |
| --- | --- | --- |
| 3.1 | Trocar a fila por BullMQ + Redis | Só se o uso passar de uma máquina. As interfaces foram desenhadas para isso; o `runner.ts` não precisa mudar. |
| 3.2 | Worker em processo separado | Já existe (`npm run worker` com `WORKER_IN_PROCESS=false`), falta usar de verdade e medir. |
| 3.3 | Armazenamento de objetos | Hoje os vídeos ficam em `data/uploads/` no disco local. |
| 3.4 | Métricas de custo e uso por lote | A página "Uso da IA" já mostra requisições, provedor, modelo, tempo e erros. Falta custo. |
| 3.5 | Comparação de CTAs escolhidos ao longo do tempo | Cada análise já grava a versão do prompt e o modelo — a base para comparar existe. |

---

## Dívidas técnicas conhecidas

| Item | Onde | Impacto |
| --- | --- | --- |
| Testes de OCR usam só vídeos sintéticos | `tests/media.test.ts` | Médio — travam a lógica de classificação, não medem a qualidade do OCR no material real. Use `npm run cta:debug` num corte de verdade |
| Nome "TikTok" ainda aparece em lugares antigos | vários | Baixo — cosmético, mas confunde |

Pagas desde a última revisão: o `npm test` passou a carregar o `.env.local`
(`vitest.config.ts`); há teste do parser do Tesseract com CRLF
(`tests/media.test.ts`); o GhostCLI está em uso contra a API real; e os 98
vídeos têm origem identificada.

---

---

## Fase 4 — Publicação (acrescentada em 2026-09-30)

Nasceu dos pedidos do usuário durante o uso, não do escopo original.

| # | Item | Estado |
| --- | --- | --- |
| 4.1 | Página de Exportações com os vídeos prontos | ✅ feed vertical 9:16, dados com botão de copiar |
| 4.2 | Pasta de saída configurável | ✅ validada com escrita real ao salvar |
| 4.3 | Legenda em português + 2 hashtags, por vídeo ou em lote | ✅ a principal; hashtags conferidas em 2 vídeos reais |
| 4.4 | Legenda em japonês + 1 hashtag japonesa, num botão à parte | ✅ conferida em 2 vídeos reais; ligável em Configurações |
| 4.6 | Retomar os vídeos que pararam por cota | ✅ 2026-10-01 — botão no bloco Progresso (HISTORICO §39) |
| 4.7 | Enviar para a extensão "Agendador IG" (rascunho, com o que foi marcado) | ⚠️ 2026-10-02 — rotas, regras e build testados; a extensão no Chrome não conferida (HISTORICO §46) |
| 4.5 | Publicar direto na plataforma | ❌ não feito. O 4.7 cobre o agendamento pela extensão do usuário, sem API oficial |

---

## Perguntas em aberto para o usuário

1. ~~Reanalisar os 93 vídeos sem transcrição (item 0.7)?~~ Respondida em
   2026-09-29: os vídeos foram apagados pelo usuário.
2. Configurar o token do Facebook para captura do Instagram, ou seguir sem?
3. Com OCR e transcrição funcionando: manter a geração de CTA apoiada neles, ou
   vale investir num provedor de visão (Fase 2.1)?

---

## Atualização 2026-09-21

A tabela da Fase 0 que ficava aqui foi incorporada à do topo (item 0.6 abaixo).

| # | Item | Estado |
| --- | --- | --- |
| 0.6 | **Corrigir crash do painel lateral** | ✅ 2026-09-21 — `PostComment` movido para `viewTypes.ts`; `ErrorBoundary` criado |

### Regra crítica adicionada

**Nunca importe tipos de `repo.ts` ou `db.ts` em componentes `"use client"`.**
Mesmo com `import type`, o bundler do Next.js pode puxar o módulo inteiro
(incluindo `better-sqlite3`) para o bundle do cliente. Tipos que atravessam
a fronteira servidor/cliente devem viver em `src/lib/viewTypes.ts`.

### Arquivos novos nesta sessão

| Arquivo | Função |
| --- | --- |
| `src/components/ErrorBoundary.tsx` | Captura erros de renderização React e exibe mensagem em vez de crashar |

### Arquivos alterados nesta sessão

| Arquivo | O que mudou |
| --- | --- |
| `src/lib/viewTypes.ts` | Adicionado tipo `PostComment` (antes vinha de `repo.ts`) |
| `src/components/CommentsPanel.tsx` | Import de `PostComment` agora vem de `viewTypes` |
| `src/components/PreviewPanel.tsx` | Removido error boundary inline problemático; `CommentsPanel` envolto em `ErrorBoundary` |
| `src/components/Library.tsx` | `PreviewPanel` envolto em `ErrorBoundary` |
