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
| Controle de versão | git, iniciado em 2026-09-18 |

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
| `npm run ocr:check` | Mostra o comando de OCR executado, no frame cru e no tratado |
| `npm run cta:debug -- caminho\\video.mp4 <dur> <max>` | Roda o pipeline inteiro num vídeo e mostra frames, OCR e classificação |
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
   de `src/lib/env.ts`, não a sua configuração.
5. **Saída de processo externo vem com CRLF.** Todo parser que corta a saída de
   um binário por `\n` precisa usar `/\r?\n/` e limpar o `\r` das células. Foi
   exatamente isso que manteve o OCR "quebrado" por dois dias (ver §5.1).

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
- **OCR e detecção do CTA fixo do vídeo:** o texto sobreposto é lido, as linhas
  vizinhas são unidas num bloco só, e o bloco que permanece do começo ao fim no
  terço superior é promovido a "CTA detectado no vídeo". Verificado num corte
  real de 78 s: devolveu o texto exato do post, com confiança alta.
  **Ressalva:** essa verificação foi feita por `npm run cta:debug`, que chama o
  provedor de visão diretamente. O caminho completo da aplicação — job na fila →
  `runner.ts` → gravação no banco → exibição na interface — ainda **não** foi
  exercitado depois da correção. Ver §5.6.
- Seleção múltipla na grade + exclusão em lote.
- Exportação CSV/JSON com escape correto e proteção contra injeção de fórmula.
- Player do post original embutido no painel, e rota de captura de metadados.

## 5. Estado: o que está quebrado ou desligado

### 5.1 OCR — **resolvido em 2026-09-18**

Ficou aberto por dois dias e bloqueava o produto. A causa raiz não era nenhuma
das três investigadas antes.

**A causa:** o Tesseract no Windows escreve o TSV com terminação de linha CRLF.
O parser cortava a saída só por `\n`, então a última coluna do cabeçalho vinha
como `"text\r"` em vez de `"text"`. Com isso:

```js
const iText = header.indexOf("text");   // -1 no Windows
if (iLeft < 0 || iText < 0) return [];  // descarta a leitura inteira
```

O OCR **nunca esteve quebrado**: o Tesseract lia o texto corretamente, saía com
código 0 e produzia TSV válido. O parser jogava tudo fora em silêncio, nos 79
vídeos. No Linux (`\n` puro) isso nunca acontecia — daí os mesmos testes
passarem lá e falharem aqui.

Por que demorou: o diagnóstico existente (`npm run ocr:check`) testava o
**Tesseract**, não o **parser**, e por isso dizia "OCR funcionando" enquanto a
aplicação não via texto nenhum. Um diagnóstico que não percorre o mesmo caminho
do código de produção não prova nada sobre ele.

As três causas investigadas antes (pacote de idioma ausente, o config `tsv`
sumindo com `--tessdata-dir`, erro do OCR sendo engolido) eram reais e as
correções continuam necessárias — elas só não eram *esta*.

**Dois defeitos de classificação apareceram depois, já corrigidos:**

| Defeito | Correção |
| --- | --- |
| O CTA era rebaixado a marca d'água. A regra dizia "pequeno + presente em todos os frames = marca d'água" — mas permanecer o vídeo inteiro é justamente o que **define** o CTA fixo | A regra passou a exigir também que o texto esteja encostado numa borda. Persistência, sozinha, nunca classifica como marca |
| O texto chegava quebrado em linhas soltas ("Essa garota está sendo" / "perseguida por uma" / "velha assustadora"), e cada pedaço parecia curto e baixo demais para ser um título | `mergeAdjacentLines()` une linhas vizinhas do mesmo frame num bloco antes de classificar. A altura relativa do exemplo foi de 0,03 para 0,11 |

**Como o CTA fixo é detectado hoje** (`ctaDetection.ts` + `frames.ts`):

1. Amostra frames em vários instantes, garantindo **começo, meio e fim**
   (`anchorTimestamps()`). O começo não é o instante 0 — muito Short abre com
   fade e ler o zero é a forma mais fácil de concluir que não há texto.
2. Esses três instantes são **imunes ao descarte por semelhança**: num vídeo de
   fundo parado, o average hash 8×8 não enxerga texto sobreposto e descartaria
   justamente a prova de permanência.
3. Une linhas vizinhas de cada frame num bloco.
4. Agrupa blocos iguais entre frames; o que aparece nos três instantes é, por
   definição, o texto fixo do vídeo.
5. Classifica (gancho / legenda / marca / perfil) e promove a `existingCta` o
   melhor gancho com pontuação ≥ 6.

**Verificado num corte real** de 78 s (1080×1920), com o texto conferido contra
o post original:

```
existingCta: "Essa garota está sendo perseguida por uma velha assustadora"
confiança: high · pontuação 11 · presente nos 8 frames
```

E `npm test`: 121/121.

**Atenção — os vídeos já importados precisam ser reanalisados.** Os 79 do acervo
foram processados com o parser quebrado e têm o campo vazio no banco. O
resultado antigo não se corrige sozinho: use "Analisar novamente".

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

**Isto importa mais do que parece:** com o OCR resolvido, a IA já enxerga o
texto da tela — mas continua surda. Para corte de filme, o diálogo é o que
define o conflito, e é ele que separa um CTA genérico de um específico da cena.
É a melhor relação entre esforço e retorno no projeto agora.

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

### 5.5 Git: iniciado, mas sem histórico anterior

O repositório foi criado em 2026-09-18, com um commit do estado funcional. Todo
o trabalho anterior a essa data não tem histórico — o incidente descrito em
`HISTORICO.md` §2 aconteceu justamente por isso.

A partir daqui: commite antes de qualquer alteração grande, e nunca use `sed`
em lote sobre arquivo de código sem ter o `git status` limpo antes.

---

### 5.6 O que ainda não foi verificado depois da correção do OCR

Registrado para ninguém confundir "corrigido" com "entregue":

| Item | Situação |
| --- | --- |
| `npm run build` e `npm test` | ✅ rodados; 121/121 |
| Detecção do CTA em vídeo real | ✅ via `npm run cta:debug`, texto conferido contra o post |
| `npm start` com a correção aplicada | ❌ **nunca executado** |
| Fluxo completo job → `runner.ts` → banco → interface | ❌ **nunca exercitado** após a correção |
| Os 79 vídeos do acervo | ❌ ainda com o campo vazio; precisam de "Analisar novamente" |

**Próximo passo concreto:** subir o app, pegar **um** vídeo (o `adz.mp4` serve, o
texto esperado é "Essa garota está sendo perseguida por uma velha assustadora"),
clicar em "Analisar novamente" e confirmar que o CTA aparece na tela. Só depois
disso reprocessar o lote — se algo estiver errado, é melhor descobrir em um
vídeo do que em 79.

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

1. `git status` — confirme que a árvore está limpa antes de mexer em qualquer
   coisa. O projeto está em git desde 2026-09-18.
2. `npm run doctor` — veja o ambiente pelos olhos da aplicação.
3. `npm test` — devem passar 121/121. Se algum de mídia falhar, rode
   `npm run cta:debug -- data\uploads\<arquivo>.mp4 <duração> 8` antes de
   formular qualquer hipótese: ele mostra frames, OCR e classificação em
   sequência, no mesmo caminho que a aplicação percorre.
4. O gargalo atual é a **transcrição desligada** (§5.2), não o OCR. Depois dela,
   `ROADMAP.md`.

Uma regra que este projeto pagou caro para aprender: quando um diagnóstico diz
que está tudo bem e o sistema diz que não, desconfie do diagnóstico — ele
provavelmente não percorre o mesmo caminho do código de produção.

E uma peculiaridade deste ambiente: o shell que alcança a pasta do usuário é
**Linux**, enquanto o projeto roda no **Windows**. Dá para ler, editar e rodar
`tsc` de lá, mas `npm run build`, `npm test` e qualquer coisa que dependa de
binário nativo (better-sqlite3, esbuild, SWC, Tesseract, FFmpeg do Windows)
**precisa ser rodado pelo usuário no cmd dele**. Peça a saída e leia.

---

## 10. Comentários do post de origem

Os comentários **não** vêm pelo botão "Capturar dados" — oEmbed não devolve
comentários, nem no TikTok nem no Instagram. Ler comentários de posts de
terceiros só seria possível automatizando um navegador logado, o que contraria
os termos das duas plataformas e coloca a conta do usuário em risco.

A decisão foi outra: **a aplicação não coleta, ela recebe.** Quem coleta é a
extensão do usuário, na aba que ele já tem aberta, e envia para cá.

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
  ler; qualquer programa fora dele ignora. Por isso a rota exige o token e nunca
  responde com credenciais. Sem `COMMENTS_INGEST_TOKEN`, ela recusa tudo — um
  coletor que ainda não existe não pode deixar porta aberta na máquina.
- **A rota não usa a sessão do app.** A extensão roda na aba do Instagram e não
  tem o cookie desta aplicação.
- **Captura substitui, não acumula.** O pedido é "os 20 últimos comentários", e
  uma captura nova representa o estado atual do post. Acumular misturaria
  leituras de datas diferentes sem como distinguir.
- **O link é casado pelo código do post**, no mesmo formato que `source.ts`
  grava em `platform_video_id`. URL fora do padrão devolve 422 em vez de
  chutar: gravar comentários no vídeo errado é pior que não gravar.

### Aviso para quem for usar isso na geração de CTA

Comentário é **texto de terceiros vindo da internet** — é o vetor mais óbvio de
injeção de prompt que este projeto tem. Se um dia alimentar o modelo, precisa ir
delimitado e rotulado como dado, igual ao OCR e à transcrição já vão
(`prompts.ts`, função `untrusted`). Hoje os comentários **não** entram em
nenhum prompt: são só exibidos.

Na interface eles são renderizados como texto puro, nunca como HTML.
