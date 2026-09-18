# Short CTA AI — Fases e o que falta

Estado em 2026-09-18. Leia [`HANDOFF.md`](./HANDOFF.md) antes.

Legenda: ✅ pronto e verificado · ⚠️ existe mas com ressalva · ❌ não feito

---

## Fase 0 — Desbloqueio

| # | Item | Estado |
| --- | --- | --- |
| 0.1 | Colocar o projeto em git e commitar o estado atual | ✅ 2026-09-18 |
| 0.2 | **Resolver o OCR no Windows** (`HANDOFF.md` §5.1) | ✅ 2026-09-18 — era CRLF no parser do TSV |
| 0.3 | Instalar `faster-whisper` e ligar a transcrição | ❌ **agora é o gargalo** |
| 0.4 | Testar o GhostCLI contra a API real, não o mock | ❌ |
| 0.5 | Reanalisar os 79 vídeos já importados | ❌ foram processados com o OCR quebrado e estão com o campo vazio |

Com o OCR funcionando, a IA já enxerga o texto da tela, mas continua surda. Para
corte de filme o diálogo é o que define o conflito — 0.3 é uma instalação
simples com ganho imediato, e é o melhor retorno por esforço agora.

Ordem sugerida: 0.3, depois 0.5 (para o acervo refletir o que a ferramenta já
sabe fazer), depois 0.4.

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
| Transcrição (`faster-whisper`) | ⚠️ | Implementado, **desligado** por falta do pacote |
| OCR e classificação do texto | ✅ | Detecta o CTA fixo do vídeo; verificado em vídeo real |
| Integração GhostCLI | ⚠️ | Implementada, testada só contra mock |
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
| 3.4 | Métricas de custo e uso por lote | A página "Uso da IA" já mostra requisições, modelo, tempo e erros. Falta custo. |
| 3.5 | Comparação de CTAs escolhidos ao longo do tempo | Cada análise já grava a versão do prompt e o modelo — a base para comparar existe. |

---

## Dívidas técnicas conhecidas

| Item | Onde | Impacto |
| --- | --- | --- |
| `npm test` não carrega `.env.local` | `vitest.config.ts` | Médio — testes veem configuração diferente do app |
| Testes de OCR usam só vídeos sintéticos | `tests/media.test.ts` | Médio — travam a lógica de classificação, não medem a qualidade do OCR no material real. Use `npm run cta:debug` num corte de verdade |
| Nenhum teste cobre saída de binário com CRLF | `tests/` | Médio — foi esse o bug que custou dois dias; um teste de `parseTesseractTsv` com `\r\n` impediria a volta |
| GhostCLI não verificado contra a API real | `src/lib/providers/ai/` | Alto se for para produção |
| Nome "TikTok" ainda aparece em lugares antigos | vários | Baixo — cosmético, mas confunde |
| 6 dos 79 vídeos sem origem identificável | dados | Baixo — nomes fora de padrão, esperado |

---

## Perguntas em aberto para o usuário

1. Configurar o token do Facebook para captura do Instagram, ou seguir sem?
2. Os 6 vídeos sem link têm origem recuperável de outra fonte (planilha, log do
   downloader)?
3. Agora que o OCR funciona: manter a geração de CTA apoiada em OCR +
   transcrição, ou vale investir num provedor de visão (Fase 2.1)?
