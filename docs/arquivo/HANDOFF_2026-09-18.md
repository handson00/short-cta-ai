# Short CTA AI — Handoff

**Leia este arquivo primeiro.** Ele descreve o estado real do projeto em
2026-09-18, o que está funcionando, o que está quebrado e o que fazer a seguir.

Companheiros deste documento:

- [`HISTORICO.md`](./HISTORICO.md) — o que aconteceu e **por quê**, em ordem.
- [`ROADMAP.md`](./ROADMAP.md) — fases, o que já saiu e o que falta.

---

## 1. O que é o projeto

Uma esteira local para preparar Shorts: importa vídeos curtos em lote, analisa
cada um (áudio, texto na tela, cena) e sugere textos-gancho para aparecer
**acima** do vídeo.

Neste projeto, **"CTA" significa o texto-gancho exibido sobre o vídeo**, não uma
chamada para clicar em um botão.

O material do usuário são cortes de filmes e séries baixados de redes sociais —
na prática, quase tudo do **Instagram Reels**, apesar do nome "TikTok" aparecer
em partes antigas do código e da conversa.

---

## 2. Onde as coisas estão

| Item | Valor |
| --- | --- |
| Pasta do projeto | `E:\short-cta-ai` (Windows) |
| Sistema | Windows 11, Node.js v24 |
| Banco | SQLite em `data/short-cta-ai.db` |
| Vídeos importados | 79 (nomes internos em `data/uploads/`) |
| Controle de versão | **nenhum** — o projeto não está em git |

### Stack

Next.js 15.5.25 (App Router) · React 19 · TypeScript 5.9 · Tailwind 3.4 ·
better-sqlite3 12 · zod 4 · vitest 3.

Decisão de arquitetura: **local, usuário único**. Fila persistida no próprio
SQLite, sem Redis. A especificação original previa BullMQ + Redis para escala;
as interfaces foram desenhadas para permitir essa troca depois sem reescrever o
pipeline.

---

## 3. Como rodar

```cmd
npm install
npm run doctor          # diagnóstico do ambiente: diz o que falta
npm run build
npm start               # http://localhost:3000
```

Senha de acesso: está em `APP_PASSWORD` no `.env.local`.

### Scripts disponíveis

| Comando | Para que serve |
| --- | --- |
| `npm run doctor` | Verifica SQLite nativo, FFmpeg, Tesseract, idiomas, Python, segredos |
| `npm run ocr:check` | Mostra o comando de OCR executado e o erro cru do Tesseract |
| `npm run ocr:check -- caminho\video.mp4` | O mesmo, num vídeo específico |
| `npm run backfill:source` | Recalcula plataforma/ID/link dos vídeos já importados |
| `npm run mock:ghostcli` | Sobe um servidor falso da API, para rodar sem credencial |
| `npm run worker` | Worker em processo separado (exige `WORKER_IN_PROCESS=false`) |
| `npm test` | 121 testes |
| `npm run typecheck` | `tsc --noEmit` |

### Armadilhas do ambiente Windows

1. **npm bloqueia install scripts.** Se `better-sqlite3` não carregar, rode
   `npm approve-scripts better-sqlite3` e `npm approve-scripts esbuild`, depois
   `npm install` de novo.
2. **`node --import tsx/esm` quebra no Node 24** com `ERR_REQUIRE_CYCLE_MODULE`.
   Use o binário `tsx` direto, como os scripts do `package.json` já fazem.
3. **Top-level `await` não compila** nos scripts `.ts` (saída CJS do esbuild).
   Envolva em `async function main()` e chame no fim.
4. **`npm test` não carrega o `.env.local`.** Os testes veem os valores padrão
   de `src/lib/env.ts`, não a sua configuração. Isso importa para o OCR.

---

## 4. Estado: o que funciona

Verificado de ponta a ponta, com vídeos reais processados:

- Importação em lote (arquivos ou pasta inteira), validação por conteúdo do
  arquivo, limite de tamanho e duração, dedupe por hash SHA-256.
- Fila persistente com lease e heartbeat, concorrência configurável,
  cancelamento, nova tentativa, e **retomada após reinício do worker**
  (testado derrubando o servidor no meio do processamento).
- FFmpeg/FFprobe: metadados, miniatura, áudio 16 kHz mono, frames escolhidos
  conforme a duração real, com descarte de frames quase idênticos.
- Detecção de origem por nome de arquivo, com plataforma identificada pelo
  formato do código (ver §6).
- Geração de CTAs via GhostCLI com contrato de saída validado no backend,
  uma tentativa de correção, e promoção do melhor candidato quando a
  recomendação do modelo não se sustenta. **Testado apenas contra o mock.**
- Seleção múltipla na grade + exclusão em lote.
- Exportação CSV/JSON com escape correto e proteção contra injeção de fórmula.
- Player do post original embutido no painel, e rota de captura de metadados.

## 5. Estado: o que está quebrado ou desligado

### 5.1 OCR não lê nada no Windows — **problema aberto, prioridade 1**

Três testes falham em `tests/media.test.ts`, todos por "nenhum texto lido":

```
× OCR e classificação do texto > encontra o gancho no terço superior
× OCR e classificação do texto > não promove legenda de diálogo a gancho
× OCR e classificação do texto > não mistura o texto de dois vídeos em paralelo
```

**Consequência prática:** o campo "CTA detectado no vídeo" fica vazio em todos
os 79 vídeos. A ferramenta diz que nenhum tem gancho, o que é falso.

**O que já foi investigado e descartado:**

| Hipótese | Resultado |
| --- | --- |
| Binário do Tesseract ausente | Descartado: se fosse, o teste "declara a limitação" também falharia, e ele passa |
| Pacote de idioma `por` ausente | Era verdade, e foi resolvido: `por`, `eng` e `osd` agora estão em `tessdata/` na raiz do projeto |
| `--tessdata-dir` faz sumir o config `tsv` | Confirmado e corrigido: agora usa `-c tessedit_create_tsv=1`, que não depende de arquivo ao lado |
| Erro do OCR sendo engolido pelo código | Confirmado e corrigido: falhas viram limitação declarada, com motivo |

Com todas essas correções, **os mesmos testes passam no Linux** (reproduzidos e
verificados numa cópia do projeto) e continuam falhando no Windows. A diferença
restante não foi identificada.

**Próximo passo, já preparado:**

```cmd
npm run ocr:check
npm run ocr:check -- data\uploads\10764b6c-f075-4955-9a4e-3afe92fc7a05.mp4
```

`scripts/ocr-check.ts` imprime: o caminho do binário, os idiomas, a pasta de
tessdata e os arquivos nela, **o comando exato executado**, o código de saída,
a saída de erro crua do Tesseract, e se o retorno veio em TSV. O parser só
entende TSV; se vier texto puro, é isso.

Suspeitas ainda não testadas, em ordem:

1. `npm test` não carrega `.env.local`, então `TESSERACT_PATH` fica no padrão
   `"tesseract"`. Se o binário responde mas é outro que o configurado, o
   comportamento pode divergir. Um `tests/setup.ts` com dotenv resolveria.
2. Diferença de versão: Tesseract 5.4.0 (UB-Mannheim/Windows) pode tratar
   como fatal o que o 5.3.4 do Linux trata como aviso.
3. Caminho com espaço (`C:/Program Files/...`) em algum ponto do spawn.

### 5.2 Transcrição desligada

`TRANSCRIPTION_PROVIDER=none` porque `faster-whisper` não está instalado.

Para ligar:

```cmd
pip install faster-whisper
```

e no `.env.local`:

```
TRANSCRIPTION_PROVIDER=faster-whisper
FASTER_WHISPER_PYTHON=python
```

No Windows o executável costuma ser `python`, não `python3`. A primeira análise
baixa o modelo (`small` tem ~500 MB).

**Isto importa mais do que parece:** com OCR quebrado *e* transcrição
desligada, a IA está analisando cenas praticamente sem evidência nenhuma. Os
CTAs gerados hoje não têm como ser específicos da cena. Resolver OCR **ou**
transcrição é pré-requisito para o produto fazer sentido.

### 5.3 GhostCLI nunca foi testado contra a API real

Todo o fluxo de IA foi validado contra `scripts/mock-ghostcli.mjs`. O endpoint,
o formato de autenticação e os IDs de modelo vieram da especificação escrita
pelo usuário, **não de uma consulta à documentação oficial**. Revalide antes de
processar um lote grande. O botão "Testar conexão" em Configurações faz uma
chamada mínima pelo backend.

### 5.4 Captura de metadados do Instagram exige token

`src/lib/capture.ts`: o oEmbed do TikTok é aberto e funciona. O do Instagram
exige token de app do Facebook. Como quase todo o acervo é Instagram, a captura
hoje responde com uma mensagem explicando isso, em vez de devolver dado
inventado. Decisão pendente do usuário: configurar o token oficial ou buscar
outro caminho.

### 5.5 O projeto não está em git

Já custou caro uma vez (ver `HISTORICO.md`, §2). Primeira coisa a fazer:

```cmd
git init
git add -A
git commit -m "estado funcional"
```

---

## 6. Detecção de origem: como funciona

`src/lib/source.ts`. O usuário tem pastas de mais de uma plataforma, então a
detecção **não pergunta** qual é — ela deduz pelo formato do código no nome do
arquivo:

| Formato do nome | Plataforma | Link formado |
| --- | --- | --- |
| `usuario-DbLs8h_xu5K.mp4` (código de 10–12 caracteres alfanuméricos) | Instagram | `https://www.instagram.com/reel/<codigo>/` |
| `AAAAMMDD_7234567890123456789.mp4` (ID numérico de 15–20 dígitos) | TikTok | `https://www.tiktok.com/@<usuario>/video/<id>` |
| `usuario_AAAAMMDD_texto.mp4` | — | sem link (aproveita usuário e data) |
| qualquer outro | — | sem link |

Um número nunca é confundido com shortcode e vice-versa. A pasta de origem,
quando existe, manda no nome de usuário.

**Regra que não pode ser quebrada:** quando o código não aparece no nome,
**nenhum link é formado**. Um link inventado dá 404 e só se descobre clicando.
Há teste para isso em `tests/source.test.ts`.

Estado atual do acervo, depois do `backfill:source`:

- 79 vídeos, **73 com link do Instagram**, 6 sem origem identificável.

---

## 7. Princípios do código (siga-os)

Estes não são preferências de estilo, são o que separa a ferramenta de um
gerador de texto bonito e errado:

1. **Nunca inventar.** Sem evidência, o campo fica vazio e a interface diz que
   está vazio. Vale para título da obra, link do post, descrição da cena.
2. **Falha nunca pode parecer ausência.** Um OCR quebrado não pode devolver o
   mesmo resultado que um vídeo sem texto. Foi exatamente esse bug que escondeu
   o problema atual por horas.
3. **Limitações vão explícitas para o modelo.** O contexto enviado à IA sempre
   declara o que *não* foi observado ("descrição visual indisponível"), para
   ausência de informação não virar certeza.
4. **Conteúdo do vídeo é dado, não instrução.** Transcrição, OCR e resultados de
   busca chegam ao modelo delimitados e rotulados. Um Short pode trazer na tela
   "ignore as instruções anteriores"; isso é texto lido, não pedido.
5. **Credencial só no servidor.** A chave do GhostCLI nunca aparece em resposta
   de API, HTML, log ou armazenamento do navegador. É criptografada em repouso
   com chave mestra separada.
6. **Comentários explicam o porquê, não o quê.** O código está comentado em
   português, e os comentários existentes registram decisões — não apague.
7. **Testes em português**, nomeando o comportamento esperado, não a função.

---

## 8. Mapa do código

```
src/
  app/
    api/                rotas (todas exigem autenticação)
    page.tsx            grade + fila (Library)
    video/[id]/         página de detalhe
    settings/ style/ usage/
  components/
    Library.tsx         grade, upload, filtros, seleção múltipla
    VideoCard.tsx       card da grade: proporção real, checkbox, link ↗
    PreviewPanel.tsx    painel lateral: CTAs, origem, player embutido, excluir
    VideoDetailView.tsx página /video/[id] (player, transcrição, frames)
  lib/
    source.ts           detecção de plataforma e formação de link
    aspect.ts           proporção real do vídeo para o CSS
    capture.ts          metadados do post de origem (oEmbed)
    queue.ts            fila persistente + worker
    repo.ts             acesso ao banco
    schema.ts           DDL (fonte de verdade do schema)
    pipeline/
      runner.ts         máquina de estados do job
      ctaDetection.ts   classifica texto do OCR: gancho/legenda/marca/perfil
      ctaPlan.ts        distribuição por estilo + critérios editoriais
      validation.ts     valida a saída do modelo (zod + regras)
    providers/
      ai/               cliente GhostCLI, classificação de erro, retries
      vision/           Tesseract (OCR) | none
      transcription/    faster-whisper | none
      search/           http | none
```

### Entidades no banco

`videos`, `analysis_jobs`, `frames`, `transcripts`, `visual_analyses`,
`work_identifications`, `scene_analyses`, `cta_suggestions`, `user_selections`,
`ai_request_logs`, `style_examples`, `source_captures`, `app_settings`.

Cada análise grava a versão do prompt e o modelo usados, para comparar
resultados depois de uma mudança de texto.

---

## 9. Se você é a próxima IA, comece por aqui

1. `git init` e um commit, antes de tocar em qualquer coisa.
2. `npm run doctor` — veja o ambiente pelos olhos da aplicação.
3. `npm run ocr:check` e `npm run ocr:check -- data\uploads\<um-arquivo>.mp4` —
   resolva o §5.1. É o que bloqueia o produto.
4. Só depois disso pense em recursos novos. Veja `ROADMAP.md`.

E uma peculiaridade deste ambiente: o shell que alcança a pasta do usuário é
**Linux**, enquanto o projeto roda no **Windows**. Dá para ler, editar e rodar
`tsc` de lá, mas `npm run build`, `npm test` e qualquer coisa que dependa de
binário nativo (better-sqlite3, esbuild, SWC, Tesseract, FFmpeg do Windows)
**precisa ser rodado pelo usuário no cmd dele**. Peça a saída e leia.
