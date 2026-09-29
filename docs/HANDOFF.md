# Short CTA AI — Handoff

**Leia este arquivo primeiro.** Ele descreve o estado real do projeto em
2026-09-29: o que funciona, o que está pendente e o que fazer a seguir.

Companheiros deste documento:

- [`HISTORICO.md`](./HISTORICO.md) — o que aconteceu e **por quê**, em ordem.
- [`ROADMAP.md`](./ROADMAP.md) — fases da esteira de análise.
- [`video-editor/`](./video-editor/) — o módulo de edição em massa: arquitetura
  e andamento fase a fase.
- [`arquivo/`](./arquivo/) — relatórios de sessões antigas. **Não descrevem o
  estado atual.**

---

## 1. O que é o projeto

Duas fases de trabalho sobre cortes curtos de filmes e séries:

1. **Análise (a "Fila", página inicial).** Importa vídeos em lote, analisa cada
   um (áudio, texto na tela, cena, comentários do post) e sugere textos-gancho
   para aparecer **acima** do vídeo.
2. **Edição (`/editor`).** Os vídeos analisados são promovidos para a edição,
   onde recebem recorte, template (fundo, logo) e saem exportados em MP4 pronto
   para Reels e TikTok.

Neste projeto, **"CTA" significa o texto-gancho exibido sobre o vídeo**, não uma
chamada para clicar em um botão.

O material do usuário são cortes baixados de redes sociais. O acervo atual (98
vídeos) é **todo do TikTok**; nas primeiras versões era quase todo do Instagram
Reels, e por isso o código trata as duas plataformas. A saída do editor vale
para as duas.

---

## 2. Onde as coisas estão

| Item | Valor |
| --- | --- |
| Pasta do projeto | `E:\short-cta-ai` (Windows) |
| Sistema | Windows 11, Node.js v24, FFmpeg 9.0.1 |
| Banco | SQLite em `data/short-cta-ai.db` |
| Vídeos | 98, todos com link de origem identificado |
| Exportados | `data/output/` (fora do git) |
| Assets de template | `data/templates/` (fora do git) |
| Repositório | `github.com/handson00/short-cta-ai`, branch `master` |

### Stack

Next.js 15.5.25 (App Router) · React 19 · TypeScript 5.9 · Tailwind 3.4 ·
better-sqlite3 12 · zod 4 · vitest 3.

Decisão de arquitetura: **local, usuário único**. As duas filas (análise e
exportação) são persistidas no próprio SQLite, sem Redis.

`npm start` escuta em `0.0.0.0`: a aplicação fica acessível na rede local,
protegida pela senha de `APP_PASSWORD`.

---

## 3. Como rodar

```cmd
npm install
npm run doctor          # diagnóstico do ambiente: diz o que falta
npm run build
npm start               # http://localhost:3000
```

Senha de acesso: `APP_PASSWORD` no `.env.local`.

### Scripts disponíveis

| Comando | Para que serve |
| --- | --- |
| `npm run doctor` | Verifica SQLite nativo, FFmpeg, Tesseract, idiomas, o Python da transcrição, segredos |
| `npm run ocr:check -- caminho\video.mp4` | Mostra o comando de OCR executado, no frame cru e no tratado |
| `npm run cta:debug -- caminho\video.mp4 <dur> <max>` | Roda o pipeline inteiro num vídeo e mostra frames, OCR e classificação |
| `npm run backfill:source` | Recalcula plataforma/ID/link dos vídeos já importados |
| `npm run mock:ghostcli` | Sobe um servidor falso da API, para rodar sem credencial |
| `npm run worker` | Worker de análise em processo separado (exige `WORKER_IN_PROCESS=false`) |
| `npm test` | 304 testes |
| `npm run typecheck` | `tsc --noEmit` |

### Armadilhas do ambiente — cada uma já custou horas

1. **npm bloqueia install scripts.** Se `better-sqlite3` não carregar, rode
   `npm approve-scripts better-sqlite3` e `npm approve-scripts esbuild`, depois
   `npm install` de novo.
2. **`node --import tsx/esm` quebra no Node 24** com `ERR_REQUIRE_CYCLE_MODULE`.
   Use o binário `tsx` direto, como os scripts do `package.json` já fazem.
3. **Top-level `await` não compila** nos scripts `.ts` (saída CJS do esbuild).
   Envolva em `async function main()` e chame no fim.
4. **`npm test` carrega o `.env.local`** (via `vitest.config.ts`). Teste que
   mexe em banco precisa apontar `DATA_DIR` para uma pasta temporária antes de
   importar qualquer módulo — ver `tests/queue.test.ts`.
5. **Saída de processo externo vem com CRLF.** Todo parser que corta a saída de
   um binário por `\n` precisa usar `/\r?\n/`. Foi isso que manteve o OCR
   "quebrado" por dois dias (§5.1).
6. **O Next.js carrega um módulo mais de uma vez.** O `instrumentation.ts` e as
   rotas de API recebem cópias separadas do mesmo arquivo. Estado em memória que
   precisa ser visto pelos dois — a fila de exportação, os FFmpegs em andamento,
   o cache de encoder — vai no `globalThis`. Com variável solta de módulo, o
   cancelamento de exportação respondia "não cancelado" e o render seguia.
7. **`ALTER TABLE ADD COLUMN` no SQLite não cria chave estrangeira.** Coluna
   adicionada por migração não tem o `ON DELETE` que o `CREATE TABLE` declara.
   Se o comportamento depende disso, escreva o comportamento.
8. **O Python da transcrição é um caminho absoluto no Windows.** Havia mais de
   um Python na máquina e só um tinha o `faster-whisper`. Na dúvida, rode
   `npm run doctor`.

---

## 4. O que funciona

Verificado de ponta a ponta, com vídeos reais:

**Análise**

- Importação em lote, validação por conteúdo, limite de tamanho e duração,
  dedupe por hash SHA-256.
- Fila persistente com lease e heartbeat, concorrência, cancelamento, nova
  tentativa e retomada após reinício.
- FFmpeg/FFprobe: metadados, miniatura, áudio, frames escolhidos conforme a
  duração real, com descarte de frames quase idênticos.
- **OCR e detecção do CTA fixo do vídeo.** Os 98 vídeos têm análise visual
  feita depois da correção do OCR; 65 tiveram o CTA fixo detectado (64 com
  confiança alta). O fluxo completo job → `runner.ts` → banco → interface está
  exercitado.
- **Transcrição local (`faster-whisper`)**, ligada desde 2026-09-28. Ver §5.2
  sobre os vídeos que ainda precisam ser reanalisados.
- **Geração de CTAs pelo GhostCLI contra a API real** (`https://ghostcli.dev/v1`,
  modelo `claude-sonnet-5`): ~670 chamadas registradas em `ai_request_logs`,
  1 erro. Contrato de saída validado no backend, uma tentativa de correção.
- Detecção de origem pelo nome do arquivo (§6).
- Comentários do post recebidos pela extensão do Chrome (95 vídeos com
  comentários), CTA a partir de comentários, kit de publicação e hashtags. A
  fila automática de captura foi corrigida em 2026-09-29 e ainda não rodou de
  verdade — ver §10.
- Exportação CSV/JSON com escape e proteção contra injeção de fórmula.

**Edição (`/editor`)** — detalhes em [`video-editor/`](./video-editor/)

- Promoção explícita da Fila para a edição ("Enviar para edição").
- Recorte manual e **Smart Crop** automático (variação temporal, sem IA).
- Templates criados na plataforma: cor ou imagem de fundo, logo posicionável.
- **O CTA sai desenhado sobre o vídeo**: estilo no template (fonte do sistema ou
  enviada, contorno, faixa, janela de tempo com fade), texto de cada vídeo pela
  regra da Fila, com texto próprio opcional. O navegador desenha a camada, a
  mesma do preview.
- **Áudio**: original, mudo, substituir pela música ou misturar, com volumes.
- Aba **Preview** com a mesma composição que a exportação produz.
- **Exportação em massa em fila**: 2 em paralelo com encoder de GPU, progresso
  por vídeo e do lote, cancelamento, retomada após reinício. Saída H.264 High
  1080×1920 30 fps, AAC, cor convertida para BT.709, `+faststart`.

---

## 5. Pendências

### 5.1 OCR — resolvido em 2026-09-18

Ficou aberto por dois dias e bloqueava o produto.

**A causa:** o Tesseract no Windows escreve o TSV com terminação CRLF. O parser
cortava a saída só por `\n`, então a última coluna do cabeçalho vinha como
`"text\r"`, `header.indexOf("text")` dava `-1`, e a leitura inteira era
descartada em silêncio — nos 79 vídeos da época. No Linux isso nunca acontecia.

Por que demorou: o diagnóstico existente testava o **Tesseract**, não o
**parser**, e dizia "OCR funcionando" enquanto a aplicação não via texto
nenhum. Um diagnóstico que não percorre o mesmo caminho do código de produção
não prova nada sobre ele.

**Como o CTA fixo é detectado** (`ctaDetection.ts` + `frames.ts`):

1. Amostra frames garantindo **começo, meio e fim** (`anchorTimestamps()`). O
   começo não é o instante 0 — muito Short abre com fade.
2. Esses três instantes são **imunes ao descarte por semelhança**: num fundo
   parado, o average hash não enxerga texto sobreposto.
3. Une linhas vizinhas de cada frame num bloco (`mergeAdjacentLines()`).
4. O bloco que aparece nos três instantes é, por definição, o texto fixo.
5. Classifica (gancho / legenda / marca / perfil) e promove a `existingCta` o
   melhor gancho com pontuação ≥ 6. Persistência sozinha nunca classifica como
   marca d'água: é justamente o que define o CTA fixo.

### 5.2 Transcrição — corrigida em 2026-09-28; 93 vídeos por reanalisar

`FASTER_WHISPER_PYTHON` apontava para uma pasta inexistente (um dígito errado
no nome) e, mesmo corrigida, aquele Python não tinha o pacote. O certo é o
Python 3.12 da máquina.

O defeito ficou escondido porque o painel de transcrição mostrava "Sem fala
compreensível" também quando o **provedor falhava** — o motivo real estava
gravado em `transcripts.warnings_json`. O painel agora mostra o motivo.

**Pendente, decisão do usuário:** 93 vídeos têm gravada a falha de transcrição
(nenhum deles é vídeo mudo de verdade). A IA gerou os CTAs deles sem o diálogo.
Só melhoram com "Analisar novamente", que consome chamadas pagas do GhostCLI e
~1–2 min de CPU por vídeo (Whisper `small`).

### 5.3 Captura de metadados do Instagram exige token

`src/lib/capture.ts`: o oEmbed do TikTok é aberto; o do Instagram exige token
de app do Facebook. Sem ele, a captura responde explicando isso em vez de
devolver dado inventado. Decisão pendente do usuário.

### 5.4 Endereço do remoto do git

O `origin` está configurado como `github.com/handson00/short-cta-ai.git`, sem
`https://`, e o git trata isso como pasta local: `git push` falha. O push de
2026-09-28 foi feito com a URL completa. Para corrigir de vez:

```
git remote set-url origin https://github.com/handson00/short-cta-ai.git
git branch -u origin/master
```

---

## 6. Detecção de origem: como funciona

`src/lib/source.ts`. A detecção **não pergunta** a plataforma: deduz pelo
formato do código no nome do arquivo.

| Formato do nome | Plataforma | Link formado |
| --- | --- | --- |
| `usuario-DbLs8h_xu5K.mp4` (código de 10–12 caracteres) | Instagram | `https://www.instagram.com/reel/<codigo>/` |
| `AAAAMMDD_7234567890123456789.mp4` (ID numérico de 15–20 dígitos) | TikTok | `https://www.tiktok.com/@<usuario>/video/<id>` |
| `usuario_AAAAMMDD_texto.mp4` | — | sem link (aproveita usuário e data) |
| qualquer outro | — | sem link |

**Regra que não pode ser quebrada:** quando o código não aparece no nome,
**nenhum link é formado**. Um link inventado dá 404 e só se descobre clicando.
Há teste para isso em `tests/source.test.ts`.

---

## 7. Princípios do código (siga-os)

Estes não são preferências de estilo, são o que separa a ferramenta de um
gerador de texto bonito e errado:

1. **Nunca inventar.** Sem evidência, o campo fica vazio e a interface diz que
   está vazio. Vale para título da obra, link do post, descrição da cena — e
   para o Smart Crop, que diz "nenhuma moldura detectada" em vez de gravar o
   quadro inteiro como resultado.
2. **Falha nunca pode parecer ausência.** Um OCR quebrado não pode devolver o
   mesmo resultado que um vídeo sem texto. Esse padrão já escondeu três
   defeitos neste projeto: OCR, transcrição e os "cards duplicados" do editor.
3. **Limitações vão explícitas para o modelo.** O contexto enviado à IA declara
   o que *não* foi observado, para ausência de informação não virar certeza.
4. **Conteúdo de terceiros é dado, não instrução.** Transcrição, OCR, resultados
   de busca e comentários chegam ao modelo pela função `untrusted()` de
   `prompts.ts`, delimitados e rotulados.
5. **Credencial só no servidor.** A chave do GhostCLI nunca aparece em resposta
   de API, HTML, log ou armazenamento do navegador.
6. **O que o preview mostra é o que a exportação produz.** No editor, a conta de
   composição mora em `lib/editor/template.ts` e o desenho em um componente só
   (`CompositionPreview`). Duas implementações da mesma coisa divergem — foi
   assim que a logo saiu esticada no primeiro render.
7. **Comentários explicam o porquê, não o quê.** Em português; os existentes
   registram decisões — não apague.
8. **Testes em português**, nomeando o comportamento esperado.

---

## 8. Mapa do código

```
src/
  app/
    api/                rotas (todas exigem autenticação)
      editor/           rotas do módulo de edição
    page.tsx            Fila (Library)
    editor/             módulo de edição
    video/[id]/         página de detalhe
    settings/ style/ usage/
  components/
    Library.tsx         grade, upload, filtros, seleção, "Enviar para edição"
    PreviewPanel.tsx    painel lateral da Fila
    VideoDetailView.tsx página /video/[id]
    editor/             EditorShell, TemplatePanel, CropOverlay,
                        CompositionPreview, ExportQueuePanel
  lib/
    source.ts           detecção de plataforma e formação de link
    queue.ts            fila de análise + worker
    repo.ts             acesso ao banco (análise)
    editorRepo.ts       acesso ao banco (edição)
    schema.ts           DDL (fonte de verdade do schema)
    pipeline/           runner, detecção de CTA, validação da saída da IA
    providers/          ai (GhostCLI), vision (Tesseract), transcription, search
    editor/             crop, motion (Smart Crop), template, filterGraph,
                        exportPreset, export, exportQueue, encoder
```

---

## 9. Se você é a próxima IA, comece por aqui

1. `git status` — confirme que a árvore está limpa antes de mexer em qualquer
   coisa.
2. `npm run doctor` — veja o ambiente pelos olhos da aplicação.
3. `npm test` — devem passar 304/304.
4. Os comandos rodam direto no Windows (PowerShell): dá para rodar build,
   testes e o servidor daqui.
5. Pendências por ordem de valor:
   - **Recarregar a extensão** (versão 1.1.0) em `chrome://extensions` e
     confirmar que a fila automática consome os 5 pedidos que ficaram abertos
     (§10). A correção da extensão não pôde ser testada num navegador.
   - **Reanalisar os 93 vídeos sem transcrição** (§5.2) — decisão do usuário,
     porque custa chamadas pagas.
   - **Conferir na tela a Fase 10 e a 10.1** do editor: desenho do texto (fonte,
     emoji, quebra de linha), o campo de texto na seção "Texto (CTA)", o
     salvamento automático e uma exportação com texto e música disparada pela
     interface. O lado do FFmpeg foi medido; o navegador, não.
   - **Editor, Fase 9** (perfis de origem) e o proxy da Fase 6 — ver
     [`video-editor/IMPLEMENTATION_PLAN.md`](./video-editor/IMPLEMENTATION_PLAN.md).
   - **Corrigir o endereço do `origin`** (§5.4) para o `git push` funcionar
     sem a URL completa.

### Onde a última sessão parou (2026-09-29)

Editor com as Fases 0–8, 8.1, 10 e 10.1 prontas e tudo commitado. A última
entrega foi o texto do CTA editável dentro da seção "Texto (CTA)" do template,
com texto e template salvos sozinhos e a aba Preview em tempo real
(`HISTORICO.md` §21 e §22). Nada disso foi visto funcionando na tela ainda.

Uma regra que este projeto pagou caro para aprender: quando um diagnóstico diz
que está tudo bem e o sistema diz que não, desconfie do diagnóstico — ele
provavelmente não percorre o mesmo caminho do código de produção.

---

## 10. Comentários do post de origem

Os comentários **não** vêm pelo botão "Capturar dados" — oEmbed não devolve
comentários. Ler comentários de posts de terceiros só seria possível
automatizando um navegador logado, o que contraria os termos das plataformas e
coloca a conta do usuário em risco.

A decisão foi outra: **a aplicação não coleta, ela recebe.** Quem coleta é a
extensão do usuário (`coletor-comentarios-tiktok/`) e envia para cá. Há dois
caminhos:

- **Captura pelo popup** — o usuário dispara na extensão. É o caminho que
  trouxe os comentários de 95 vídeos.
- **Fila automática** — o botão "Capturar comentários" da Fila grava pedidos em
  `capture_queue`, e a extensão os consome por polling. **Nunca funcionou até
  2026-09-29:** o polling lia o token de uma chave que o popup não grava, e
  dois cliques tinham enfileirado cada vídeo duas vezes. Corrigido nos dois
  lados (HISTORICO §20); a extensão corrigida é a versão 1.1.0 e precisa ser
  recarregada em `chrome://extensions` para valer.

### Contrato

```
POST http://localhost:3000/api/comments/ingest
Authorization: Bearer <COMMENTS_INGEST_TOKEN do .env.local>
Content-Type: application/json

{
  "postUrl": "https://www.instagram.com/reel/DbLs8h_xu5K/",
  "comments": [
    {
      "externalId": "17912...",          // opcional; sem ele não há aninhamento
      "parentExternalId": null,          // preenchido numa resposta
      "author": "@fulano",
      "text": "que filme é esse?",
      "likeCount": 12,                   // opcional
      "publishedLabel": "2 d"            // como a plataforma mostra; não é convertido
    }
  ]
}
```

Respostas: `200` com `{ok, videoId, gravados}`; `401` token inválido; `404`
nenhum vídeo importado corresponde ao post; `422` link não reconhecido ou
formato inesperado; `503` token não configurado.

### Decisões que não são óbvias

- **O token, não o CORS, é a proteção.** CORS só decide o que o navegador deixa
  ler; qualquer programa fora dele ignora. Sem `COMMENTS_INGEST_TOKEN`, a rota
  recusa tudo.
- **A rota não usa a sessão do app.** A extensão roda na aba do Instagram e não
  tem o cookie desta aplicação.
- **Captura substitui, não acumula.** Uma captura nova representa o estado atual
  do post; acumular misturaria leituras de datas diferentes.
- **O link é casado pelo código do post.** URL fora do padrão devolve 422 em vez
  de chutar: gravar comentários no vídeo errado é pior que não gravar.

### Comentários nos prompts

Comentário é **texto de terceiros vindo da internet** — o vetor mais óbvio de
injeção de prompt que o projeto tem. Hoje eles alimentam o CTA a partir de
comentários, o CTA otimizado, o kit de publicação e as hashtags; os quatro
construtores de prompt passam o conteúdo por `untrusted()` (conferido em
2026-09-29). Qualquer novo uso precisa fazer o mesmo.

Na interface eles são renderizados como texto puro, nunca como HTML.

---

## 11. Regra para componentes cliente

Em 2026-09-21 a aplicação buildava mas quebrava ao clicar em qualquer vídeo. O
`CommentsPanel.tsx` fazia `import type { PostComment } from "@/lib/repo"` — e,
mesmo sendo `import type`, o bundler puxava o `better-sqlite3` para o navegador.

**Nunca importe de `repo.ts`, `editorRepo.ts`, `db.ts` ou qualquer arquivo que
toque o banco em componentes `"use client"` — nem com `import type`.** Tipos que
atravessam a fronteira vivem em `viewTypes.ts` ou `types.ts`, ou são declarados
no próprio componente (como em `ExportQueuePanel.tsx`).
