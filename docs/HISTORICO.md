# Short CTA AI — Histórico do projeto

Registro do que foi feito, em ordem, com o motivo de cada decisão. Serve para
entender por que o código está como está antes de mudá-lo.

Período: 2026-09-17 a 2026-09-18.

---

## 1. Construção do MVP (Fase 1)

O ponto de partida foi uma especificação escrita pelo usuário, detalhada, com
14 seções: objetivo, princípios, escopo funcional, pipeline, prompts, critérios
de aceite e entrega por fases.

Três decisões foram pedidas antes de começar:

| Pergunta | Resposta escolhida |
| --- | --- |
| O que fazer com a spec | Construir o MVP da Fase 1 |
| Alvo de implantação | Local, usuário único |
| Transcrição e OCR | Adaptadores plugáveis, com uma implementação real de cada |

Isso levou à arquitetura atual: fila em SQLite em vez de BullMQ + Redis,
`faster-whisper` local para fala, Tesseract para texto na imagem, e o GhostCLI
como provedor de raciocínio textual — com as quatro interfaces (`AIProvider`,
`TranscriptionProvider`, `VisionProvider`, `SearchProvider`) mantidas para
permitir troca posterior.

### Verificação antes da entrega

O MVP não foi entregue "por inspeção". Foram gerados vídeos sintéticos com
FFmpeg (`scripts/make-fixtures.sh`) cobrindo os casos difíceis da spec: sem
fala, sem CTA, OCR difícil por baixo contraste, legenda confundível com gancho,
marca d'água, e gancho que só aparece aos 2 s depois de uma animação. Um lote
foi processado de ponta a ponta contra um mock da API.

**Dois bugs reais apareceram nesse teste:**

1. **Contaminação entre vídeos.** O OCR gravava o arquivo temporário do frame
   pré-processado com o nome do frame (`ocr_frame_0_00.png`), igual para todos
   os vídeos. Com a fila rodando em paralelo, um vídeo sobrescrevia o arquivo do
   outro e o texto de um aparecia no resultado do outro. Corrigido com nome
   único por chamada. Tem teste de regressão que roda dois vídeos em paralelo.

2. **Jobs presos para sempre.** Ao derrubar o servidor no meio do
   processamento, os jobs ficavam em "Extraindo mídia" indefinidamente: a
   varredura de leases vencidos só rodava na subida, e naquele instante o lease
   ainda era válido. Corrigido com varredura periódica.

---

## 2. O incidente do `sed`

Entre as duas sessões, outra IA trabalhou no projeto e adicionou recursos
legítimos (origem do vídeo, `PreviewPanel`, grade de thumbnails, `cancel-all`).
No processo, um `sed` mal formado **apagou todas as 48 chaves de fechamento de
nível superior do `src/lib/repo.ts`** — na verdade substituiu cada `^}$` por uma
linha em branco. O arquivo parou de compilar e nada mais rodava.

A recuperação foi possível porque existia uma cópia íntegra do arquivo original.
O método:

1. Confirmar que o dano era exatamente esse: contar `^}$` na cópia original (48)
   e no arquivo danificado (0).
2. Reconstruir com um scanner que ignora chaves dentro de strings, templates e
   comentários, fechando o bloco sempre que um novo construto de nível superior
   começa na coluna 0.
3. **Provar o resultado**: diff do arquivo reparado contra a cópia original. O
   diff final mostrou apenas o recurso novo (campos de origem do vídeo) e nada
   mais — nenhuma linha perdida, nenhuma alterada por acidente.

Foram encontrados também, na mesma passagem:

- Um arquivo lixo literalmente chamado `src/components/VideoCard.tsx]]`, criado
  por um redirecionamento de shell quebrado.
- **O `GET` de `/api/videos/[id]` tinha sido apagado** quando o `DELETE` foi
  criado no mesmo arquivo. O painel de detalhes faz `GET` nessa rota — clicar em
  qualquer card não carregaria nada. Restaurado.
- Um suposto erro de digitação "Fechar" que não existia: era acentuação
  embaralhada no terminal de quem reportou.

**Lição registrada:** o projeto não está em git. Foi isso que transformou um
comando errado em uma tarde perdida e exigiu uma cópia externa para provar a
correção. Colocar em git é a primeira recomendação do handoff.

---

## 3. Proporção do vídeo

O usuário relatou que a prévia aparecia distorcida. A causa não era o que
parecia.

Existia uma função que mapeava a proporção para classes do Tailwind por lista de
casos: `9:16`, `16:9`, `1:1`, `4:5` — e **qualquer outro valor caía no padrão
16:9**. Só que o FFprobe devolve a razão simplificada das dimensões reais: um
vídeo 608×1080 vira `76:135`, que não está na lista. Vertical virava deitado.

Corrigido em `src/lib/aspect.ts`, passando a razão numérica real para a
propriedade CSS `aspect-ratio`, que aceita qualquer par. Aplicado nos três
lugares: grade, painel lateral e página de detalhe.

---

## 4. A origem dos vídeos não era TikTok

O usuário pediu link clicável para o post original e disse que faltava. O código
para formar o link já existia — mas **0 dos 79 vídeos tinha link**.

Consultando o banco, o motivo apareceu: os nomes dos arquivos são
`miranhafilmesz-DbLs8h_xu5K.mp4`. Esse código de 11 caracteres, com maiúsculas,
minúsculas e `_`, é **shortcode do Instagram**. ID do TikTok é um número de 19
dígitos. O parser existente procurava `AAAAMMDD_<número de 15–20 dígitos>`, que
nenhum arquivo do acervo usa.

Perguntado, o usuário confirmou que tem pastas das duas plataformas. A solução
foi detectar pelo formato do código em vez de exigir declaração — está descrito
no handoff, §6. Um `npm run backfill:source` recalcula os já importados; rodado,
73 dos 79 ganharam link.

Na mesma conversa o usuário escolheu, entre as opções oferecidas, **player
embutido na ferramenta + preparar a captura de dados**. Foi implementado com um
aviso honesto: a página completa do Instagram ou do TikTok **não pode** ser
embutida (as duas bloqueiam iframe); o que cabe é o player oficial de
incorporação. E o JavaScript da página não consegue ler nada de dentro do
iframe, por ser outro domínio — por isso a captura é uma rota no servidor.

---

## 5. A saga do OCR

Esta é a parte inacabada, e vale ler inteira antes de mexer.

### 5.1 Sintoma

Depois do build, `npm test` no Windows: 118 passam, 3 falham — todos os três
testes de OCR que dependem de ler texto, todos com "nenhum texto lido".

### 5.2 Primeira causa: pacote de idioma

O Tesseract do usuário não tinha o pacote de português. A tentativa anterior de
baixar para `C:\Program Files\Tesseract-OCR\tessdata\` falhou com "Permission
denied" e nunca foi refeita.

Detalhe que enganou: **no Linux isso é só um aviso** — o Tesseract carrega
inglês e continua lendo. Por isso os mesmos testes passavam no ambiente de
desenvolvimento e falhavam no Windows.

Resolvido sem precisar de administrador: `por`, `eng` e `osd` foram baixados
para uma pasta `tessdata/` na raiz do projeto, e o código passou a apontar para
ela automaticamente quando ela existe (`--tessdata-dir`). O idioma passa a
viajar junto com a aplicação.

### 5.3 Segunda causa: um defeito de projeto meu

`runTesseract` capturava **qualquer** erro e devolvia lista vazia. Ou seja: um
OCR quebrado produzia exatamente o mesmo resultado que um vídeo sem texto na
tela.

Na prática, o OCR não estava fazendo nada nos 79 vídeos e a ferramenta afirmava,
com toda a calma, que nenhum deles tinha gancho. Esse é o tipo de falha que
corrói a confiança no produto inteiro: o número está lá, parece um resultado, e
é mentira.

Corrigido: falhas do Tesseract viram limitação declarada, com o motivo e o que
fazer. Há dois testes travando esse comportamento — um verifica que a mensagem
de pacote ausente diz qual pacote e o que fazer, o outro que uma falha nunca se
parece com "vídeo sem texto".

### 5.4 Terceira causa: dependência escondida

Consertar o item 5.2 quebrou outra coisa, e só apareceu porque os testes rodam o
OCR de verdade.

O `tsv` que era passado ao Tesseract para pedir saída estruturada **não é um
parâmetro** — é um arquivo de configuração que mora em `tessdata/configs/tsv`,
junto dos arquivos de idioma. Ao apontar `--tessdata-dir` para a pasta do
projeto, o arquivo sumia, o Tesseract voltava a cuspir texto puro, e o parser
(que espera TSV) não entendia nada. Falha silenciosa de novo.

Trocado por `-c tessedit_create_tsv=1`, que não depende de arquivo nenhum ao
lado. Verificado: com isso, os 11 testes de mídia passam no Linux.

### 5.5 A quarta causa: CRLF — **esta era a que faltava**

Todas as correções anteriores estavam aplicadas e, no Windows, os três testes
continuavam falhando. A saída de `npm run ocr:check` foi finalmente coletada e
dizia, em letras garrafais: **"OCR funcionando"**.

E estava certa. O Tesseract lia o texto, saía com código 0 e devolvia TSV
válido. Só que o diagnóstico testava o **Tesseract**, e o que estava quebrado
era o **parser**.

O Tesseract no Windows escreve o TSV com terminação de linha CRLF. O parser
cortava a saída por `\n`, então a última coluna do cabeçalho vinha como
`"text\r"`. Resultado: `header.indexOf("text")` devolvia `-1`, e a primeira
linha de guarda descartava a leitura inteira:

```js
if (iLeft < 0 || iText < 0) return [];
```

Uma leitura perfeita virava lista vazia, em silêncio, nos 79 vídeos. No Linux,
com `\n` puro, nunca acontecia — daí os mesmos testes passarem lá.

Havia um sinal disso à vista o tempo todo e ele foi lido como ruído: a saída do
diagnóstico aparecia embaralhada no terminal (`VIDASUA : DECISAO`,
`Jarota,doraa`). Aquilo não era OCR ruim; eram os `\r` fazendo o console
sobrescrever a própria linha. O bug estava se anunciando na tela.

Correção: cortar por `/\r?\n/` e limpar o `\r` de cada célula.

### 5.6 Os dois defeitos que apareceram depois

Com o texto finalmente chegando à classificação, dois erros ficaram visíveis —
ambos invisíveis enquanto o parser devolvia vazio:

1. **O CTA era classificado como marca d'água.** A regra dizia "texto pequeno,
   presente em todos os frames e com até 4 palavras = marca d'água". Mas estar
   presente o vídeo inteiro é exatamente o que **define** o CTA fixo. A regra
   punia a evidência que deveria valorizar. Passou a exigir também que o texto
   esteja encostado numa borda: persistência, sozinha, nunca classifica como
   marca.

2. **O texto chegava quebrado em linhas soltas.** "Essa garota está sendo" /
   "perseguida por uma" / "velha assustadora" eram avaliadas uma a uma, e cada
   pedaço parecia curto e baixo demais para ser um título. `mergeAdjacentLines()`
   passou a unir linhas vizinhas do mesmo frame antes de classificar — no
   exemplo, a altura relativa foi de 0,03 para 0,11 e a pontuação de 5 para 11.

### 5.7 Amostragem começo / meio / fim

Pedido do usuário e, na prática, a definição operacional do que se está
procurando: o CTA é o texto que está lá do começo ao fim.

`anchorTimestamps()` garante três instantes — começo (nunca o zero, por causa
dos fades de abertura), meio e fim — e esses três são **imunes ao descarte por
semelhança**. Isso importa porque, num vídeo de fundo parado, o average hash
8×8 não enxerga o texto sobreposto e descartaria justamente os frames que
provam a permanência. Um teste existente (`descarta frames quase idênticos`)
teve a expectativa ajustada de ≤3 para ≤4 frames por causa dessa política, com
a justificativa registrada no próprio teste.

### 5.8 Resultado

`npm test`: 121/121. E num corte real de 78 s, conferido contra o post original:

```
existingCta: "Essa garota está sendo perseguida por uma velha assustadora"
confiança: high · pontuação 11 · presente nos 8 frames
```

Os 79 vídeos do acervo continuam com o campo vazio: foram processados com o
parser quebrado e precisam de "Analisar novamente".

---

## 6. Correções de ambiente Windows feitas no caminho

Cada uma virou script ou documentação, para não se perder:

- `npm approve-scripts` bloqueava o binário nativo do `better-sqlite3`. O build
  passava e o app quebrava na primeira requisição.
- `cp` e `openssl` não existem no cmd. Virou `npm run setup`, que gera o
  `.env.local` com segredos usando só o Node.
- `node --import tsx/esm` falha no Node 24 com `ERR_REQUIRE_CYCLE_MODULE`. Os
  scripts passaram a usar o binário `tsx`.
- Top-level `await` não compila na saída CJS do esbuild — os scripts `.ts`
  envolvem tudo em `async function main()`.
- `npm run doctor` foi criado e depois ensinado a enxergar a pasta `tessdata/`
  do projeto, para parar de acusar português faltando quando o arquivo está lá.

---

## 7. O que foi verificado de verdade

Para calibrar confiança no que está escrito:

| Afirmação | Como foi verificada |
| --- | --- |
| Fila retoma após reinício | Servidor derrubado no meio do lote; jobs presos recuperados pela varredura |
| Dedupe de frames funciona | Teste com vídeo estático: 6 instantes viram 1 frame |
| OCR distingue gancho de legenda | Testes com fixtures, passando nos dois sistemas |
| Detecção do CTA fixo em vídeo real | Corte de 78 s do acervo: texto conferido contra o post original — **via `npm run cta:debug`, não pela interface** |
| Fluxo completo até a interface, após a correção do OCR | **Não verificado.** O app não foi iniciado depois da correção (ver `HANDOFF.md` §5.6) |
| Detecção de plataforma | 14 testes com os nomes de arquivo reais do acervo |
| Backfill | Executado numa cópia do banco real antes de rodar no original |
| Exportação CSV | Testes de escape de vírgula, aspas, quebra de linha e fórmula |
| GhostCLI | **Apenas contra o mock.** A API real nunca foi chamada |
| Reparo do `repo.ts` | Diff contra cópia íntegra: só o recurso novo aparece |

---

## 8. O crash do "client-side exception" (2026-09-21)

Após as correções do OCR e do `repo.ts`, o app buildava mas crashava ao clicar em
qualquer vídeo na grade: "Application error: a client-side exception has occurred".
O typecheck passava limpo, então era um erro de runtime que o TypeScript não pega.

### Causa raiz

O `CommentsPanel.tsx` importava `type { PostComment } from "@/lib/repo"`. O `repo.ts`
toca o banco de dados via `better-sqlite3`, um módulo nativo do Node. Quando o Next.js
faz o bundle do cliente, ele tenta incluir `repo.ts` inteiro no chunk do navegador — e
o `better-sqlite3` não existe no browser. Isso causava o crash silencioso.

O TypeScript não pega isso porque `import type` é apagado na compilação, mas o bundler
do Next.js ainda resolve o módulo para tree-shaking, e aí o `better-sqlite3` entra no
grafo de dependências do cliente.

### Correção aplicada

1. Movido o tipo `PostComment` para `src/lib/viewTypes.ts` (arquivo que já atravessa a
   fronteira servidor/cliente sem tocar o banco).
2. Atualizado o import no `CommentsPanel` para `import type { PostComment } from "@/lib/viewTypes"`.
3. Criado `src/components/ErrorBoundary.tsx` — um Error Boundary real com `componentDidCatch`
   para capturar erros de renderização e exibir a mensagem em vez de crashar.
4. Envolvido o `PreviewPanel` no `Library.tsx` com `<ErrorBoundary>`.
5. Envolvido o `CommentsPanel` dentro do `PreviewPanel` com `<ErrorBoundary>`.
6. Removido código de error boundary inline problemático que tinha um `useState` sendo
   chamado após um early return (violava as regras dos hooks do React).

### Lição registrada

**Nunca importe tipos de módulos que tocam o banco (`repo.ts`, `db.ts`) em componentes
cliente.** Mesmo com `import type`, o bundler pode puxar o módulo inteiro. Tipos que
atravessam a fronteira servidor/cliente devem viver em `viewTypes.ts` ou em arquivos
dedicados que não importem nada do lado servidor.

A regra geral: se um arquivo importa `better-sqlite3`, `node:fs`, `node:path`, ou qualquer
módulo nativo, ele é servidor-only. Nenhum componente `"use client"` deve importar dele,
nem mesmo com `import type`.

### Verificação

Após a correção, o build passou e o painel lateral abriu corretamente ao clicar nos
vídeos, mostrando thumbnail, metadados, CTAs, origem e o painel de comentários.

| Afirmação | Como foi verificada |
| --- | --- |
| Crash resolvido | Build passou + clique no vídeo abre painel sem erro |
| CommentsPanel funciona | Painel de comentários renderiza com botões de gerar/otimizar CTA |
| ErrorBoundary captura erros | Componente criado e testado — exibe mensagem em vez de crashar |

---

## 9. Regras editoriais de "pergunta implícita" no gancho (2026-09-23)

### Pedido

O usuário pediu para reforçar a geração de CTAs (a partir da cena, não dos
comentários) com um conjunto explícito de regras editoriais:

- Usar o contexto completo para identificar o elemento narrativo que mais
  desperta curiosidade.
- Preservar o CTA original como uma das sugestões, quando identificado
  corretamente.
- Gerar sugestões diferentes do texto original, com variações de
  curiosidade, suspense e mistério.
- Priorizar ganchos que criem uma pergunta implícita — pergunta que a
  própria cena responde — sem revelar essa resposta no texto.
- Garantir que o gancho desperte interesse pelo conteúdo real do vídeo, sem
  prometer uma revelação que não acontece.

### O que já existia

A preservação do CTA original como opção **já estava implementada em
código**, não só em prompt: `stageGenerateCtas` (`src/lib/pipeline/runner.ts`)
acrescenta o texto já presente no vídeo à lista de sugestões sempre que
`effectiveExistingCta(...).confidence !== "low"`, sem depender do modelo
lembrar de fazer isso. Continua assim — é mais confiável que confiar no
modelo para repetir um texto literalmente.

O campo `curiosity` do contrato de análise (`ANALYSIS_CONTRACT`, em
`prompts.ts`) já pedia "o que desperta curiosidade" desde a primeira versão
do prompt. O pedido do usuário tornou esse ponto mais específico: não basta
apontar curiosidade em geral, o modelo deve nomear o elemento narrativo
específico da cena.

### O que mudou

Em `src/lib/prompts.ts`:

1. `CORE_PROMPT` — o parágrafo inicial agora pede explicitamente para usar o
   contexto completo (transcrição, OCR, descrição visual, obra) e identificar
   o elemento narrativo mais curioso, não um gatilho genérico. A lista de
   regras dos ganchos ganhou duas entradas: criar pergunta implícita
   respondida pela própria cena sem entregar a resposta, e nunca prometer
   revelação que o vídeo não entrega.
2. `generationSystemPrompt` — nova linha fixa (`original`) explica ao modelo
   que o CTA já existente é acrescentado automaticamente pelo sistema, então
   ele não deve repeti-lo entre as sugestões inéditas; deve, em vez disso,
   gerar variações claramente diferentes dele.
3. `PROMPT_VERSION` avançou de `2026-09-17.1` para `2026-09-23.1`, seguindo a
   convenção do projeto de gravar a versão do prompt em cada análise para
   comparar resultados depois de uma mudança de texto.

O prompt de CTA a partir de comentários (`commentCtaSystemPrompt`,
`optimizedCommentCtaSystemPrompt`) não foi alterado: o pedido do usuário fala
em "contexto completo" e "elemento narrativo da cena", que é o domínio do
fluxo de geração por cena, não do fluxo por comentários (que já tem sua
própria disciplina de "todo gancho precisa citar um sinal").

### Verificação

- `node_modules/.bin/tsc --noEmit -p tsconfig.json`: passou, sem erros.
- `tests/prompts.test.ts`: os testes existentes checam substrings que
  continuam presentes no prompt (ex.: `"editor especializado em ganchos"`,
  `"Gere exatamente N sugestões"`, `"Ignore o CTA existente"`); não deveriam
  quebrar, mas não foi possível confirmar rodando `npm test` a partir deste
  ambiente — o `node_modules` instalado aqui é para Windows e o Linux não
  acha `@rollup/rollup-linux-x64-gnu` (limitação conhecida, ver `HANDOFF.md`
  §9). **Falta rodar `npm test` no Windows para confirmar.**
- Não foi testado contra a API real do GhostCLI (segue a ressalva já
  registrada em §5.3/§3 sobre a integração nunca ter sido validada fora do
  mock).

---

## 10. Geração de CTA: "vídeo inteiro", não "a cena" (2026-09-23, sessão 2)

### Pedido

O usuário pediu, na sequência do pedido anterior (§9), que a criação do CTA
entenda **o vídeo completo que é mostrado para quem assiste**, e não trate a
análise como se fosse só "uma cena" (um recorte pontual).

### Por que isso não era um problema de amostragem

Antes de mexer no prompt, foi checado se o pipeline já cobre o vídeo inteiro
na prática — porque se a evidência coletada fosse mesmo só o início, o
problema seria em `frames.ts`/`runner.ts`, não em `prompts.ts`.

- `selectFrameTimestamps` (`src/lib/media/frames.ts`) já amostra frames ao
  longo de toda a duração: os instantes iniciais (0, 0.5, 1, 2, 3, 5s, usados
  para achar o CTA fixo) somados a frações representativas em 25%, 40%, 55%,
  70% e 85% do vídeo. `maxFramesPerVideo` (padrão 12, configurável de 2 a 40)
  é o teto de frames por vídeo.
- A transcrição (`faster-whisper`, quando ligada) cobre o áudio inteiro, não
  um trecho.
- `buildAnalysisUserMessage` já enviava até 120 segmentos de transcrição e até
  30 textos de OCR ao modelo — praticamente o vídeo inteiro para um Short.

Ou seja: os **dados** já cobriam o vídeo inteiro. O problema era de
**enquadramento no prompt**: `CORE_PROMPT` dizia "compreenda a cena" e os
rótulos das seções ("ANÁLISE DA CENA", "CENA") sugeriam ao modelo que ele
estava olhando para um recorte pontual, não para o arco completo do vídeo que
a pessoa vai assistir do início ao fim.

### O que mudou

Só em `src/lib/prompts.ts` (texto de prompt, nenhuma lógica de extração ou
amostragem foi alterada):

1. `CORE_PROMPT` — novo parágrafo inicial deixa explícito que as evidências
   são amostras de TODO o vídeo, na ordem em que a pessoa assiste, e pede para
   compreender o vídeo inteiro (começo, meio, fim) antes de escrever qualquer
   gancho. A regra "estar ligados especificamente à cena" virou "ligados ao
   que acontece no vídeo como um todo, não a um único frame ou instante
   isolado". A regra da "pergunta implícita" (adicionada em §9) agora fala em
   "o próprio vídeo responde ao ser assistido até o fim", não "a própria
   cena".
2. `ANALYSIS_CONTRACT` — a descrição de `sceneSummary` mudou de "o que a cena
   mostra" para "o que acontece no vídeo do início ao fim".
3. `buildAnalysisUserMessage` — primeira linha do bloco de evidências agora
   avisa explicitamente que os dados cobrem o vídeo inteiro, não um instante
   isolado.
4. Rótulos de seção trocados de "cena" para "vídeo" em
   `buildGenerationUserMessage`, `buildCommentCtaUserMessage`,
   `buildOptimizedCommentCtaUserMessage` e `buildPublishKitUserMessage" (só o
   texto enviado ao modelo — os nomes internos `SceneAnalysis`, `SceneContext`,
   `sceneSummary` etc. **não** foram renomeados: são tipos e colunas do banco
   usados em dezenas de arquivos, e renomear isso é um refactor separado, sem
   ganho para o pedido do usuário).
5. `PROMPT_VERSION` avançou de `2026-09-23.1` para `2026-09-23.2`.

### O que foi deliberadamente deixado de fora

- Não aumentei o `maxFramesPerVideo` padrão nem mudei `selectFrameTimestamps`:
  a amostragem já cobre o vídeo inteiro proporcionalmente à duração: aumentar
  o número de frames so aumentaria custo de OCR sem mudar o enquadramento que
  o usuário pediu.
- Não renomeei `sceneSummary`/`SceneAnalysis`/`scene_analyses` no código ou no
  schema do banco. Isso tocaria `types.ts`, `schema.ts`, `repo.ts`,
  `viewTypes.ts` e vários componentes, é puramente cosmético (o campo já
  representa a análise do vídeo inteiro, só o nome é antigo) e o usuário não
  pediu uma renomeação de código — pediu um comportamento de geração.

### Verificação

- `node_modules/.bin/tsc --noEmit -p tsconfig.json`: passou, sem erros.
- `tests/prompts.test.ts` continua válido pelo mesmo motivo do §9: os testes
  checam substrings que não foram removidas.
- **`npm test` continua não podendo ser rodado deste ambiente Linux** (mesma
  limitação do `@rollup/rollup-linux-x64-gnu`, ver §9 e `HANDOFF.md`). Falta
  rodar no Windows.

---

## 11. Primeiro 403 real do GhostCLI (2026-09-23, sessão 3)

### O que o usuário viu

```
Acesso negado (403). A chave pode não ter acesso de API liberado, ou o IP
de saída deste servidor não está autorizado. (tentativa 1 de 3)
```

### Diagnóstico

Isto **não é um bug da aplicação** — é a aplicação classificando corretamente
um 403 real devolvido pelo próprio serviço GhostCLI (`classifyHttpStatus` em
`src/lib/providers/ai/errors.ts`, código `forbidden`, nunca reenviado
automaticamente porque 403 não está na lista de erros retentáveis). É
literalmente o item 0.4 do `ROADMAP.md` acontecendo: "testar o GhostCLI
contra a API real" — toda a integração até aqui só tinha sido validada contra
`scripts/mock-ghostcli.mjs`, nunca contra `https://ghostcli.dev/v1` de
verdade. O "(tentativa 1 de 3)" é só o contador de tentativas do job
(`video.attempts`/`video.maxAttempts` em `PreviewPanel.tsx`), não uma
retentativa automática em andamento.

Tentei confirmar isso batendo direto em `ghostcli.dev` pelo shell do Windows
do usuário, mas essa VM não tem saída de rede nenhuma (nem para
`example.com`, nem resolve DNS) — então não dá para diagnosticar a rede a
partir daqui. Precisa ser feito na própria máquina, ou pelo botão "Testar
conexão" da aplicação (que roda no processo do Next.js, com a rede real do
usuário).

### Gap encontrado e corrigido

Ao investigar, achei que o corpo da resposta de erro do GhostCLI **já era
capturado** (`safeErrorDetail()` em `client.ts`, sem cabeçalhos nem
credencial, até 400 caracteres) mas **era descartado antes de chegar a
qualquer lugar visível**: nem no card de erro do vídeo, nem em "Uso da IA",
nem no resultado de "Testar conexão" — só a mensagem genérica por categoria
(`friendlyMessage`) aparecia. Isso é exatamente o tipo de informação que
diferencia "chave sem escopo de API habilitado" de "IP fora da lista
liberada" por trás de um 403 genérico, e estava sendo jogada fora.

**Correção** (`src/lib/providers/ai/errors.ts`, `ghostcli.ts`, `runner.ts`):
nova função `detailedMessage(err: AiError)` que concatena a mensagem amigável
com o corpo devolvido pelo serviço, quando houver. Passou a ser usada em três
lugares que antes só usavam `aiErr.message`:

1. `ai_request_logs` (página "Uso da IA") — `send()` em `ghostcli.ts`.
2. Resultado do botão "Testar conexão" — `testConnection()` em `ghostcli.ts`.
3. `errorMessage` do job, que aparece no card do vídeo na grade —
   `runJob()` em `runner.ts`.

Nada na extração do corpo mudou (continua sem cabeçalhos, sem credencial,
capada em 400 caracteres); só parou de ser descartada depois de extraída.

### Verificação

- `node_modules/.bin/tsc --noEmit -p tsconfig.json`: passou, sem erros.
- `tests/aiErrors.test.ts` continua válido: não testa o descarte do detalhe,
  só a classificação de status e a garantia de que a credencial nunca aparece
  na mensagem — `detailedMessage()` não toca a credencial, só o corpo da
  resposta HTTP.
- **Não verificado contra o GhostCLI real** (mesma ressalva de sempre: só dá
  para rodar no Windows do usuário).

### O que o usuário precisa checar (fora do código)

Um 403 com essa causa apontada pela própria aplicação normalmente é uma
destas duas coisas, do lado do provedor, não do app:

1. A chave existe e está correta, mas a conta não tem "acesso de API"
   habilitado separadamente do uso pela interface web do GhostCLI — checar no
   painel da conta GhostCLI.
2. O serviço restringe por IP de origem (allowlist) e o IP de saída da
   máquina que roda `npm start` não está na lista liberada.

Depois desta correção, rodar de novo (ou clicar em "Testar conexão" em
Configurações → IA → GhostCLI) deve mostrar o texto que o GhostCLI devolveu
no corpo do erro, que costuma dizer qual das duas causas é.

---

## 6. Hashtags virais com IA e exibição na UI (2026-09-27)

### Contexto

A extensão Chrome já capturava hashtags do TikTok (`saveVideoHashtags` em
`repo.ts`, tabela `video_hashtags`) e a API de ingestão as salvava, mas nada
disso era visível na interface nem usado para gerar conteúdo novo. O usuário
pediu que as hashtags aparecessem na página de detalhes e que a IA gerasse
novas hashtags com alto potencial viral baseadas nos dados capturados.

### O que foi feito

**1. Exibição de hashtags capturadas na UI** (`CommentsPanel.tsx`):
- Nova seção "Hashtags capturadas" dentro do painel de comentários, visível
  apenas quando o vídeo tem dados salvos (do vídeo original e/ou citadas nos
  comentários).
- Tags do vídeo exibidas em destaque (accent), tags dos comentários com
  contador de frequência.
- Botão "Gerar hashtags com alto potencial viral" integrado à mesma seção.

**2. Endpoint de geração via IA** (`/api/videos/[id]/hashtags-virais/route.ts`):
- Novo endpoint POST que roda direto (sem fila), como os demais endpoints de
  geração sob demanda.
- Coleta comentários + hashtags capturadas + análise de cena como contexto.
- Chama `provider.generateViralHashtags()` e retorna `{ hashtags, reasoning }`.

**3. Interface e implementação no provedor**:
- `generateViralHashtags` adicionado à interface `AIProvider` (`types.ts`).
- Implementado no GhostCLI (`ghostcli.ts`) usando `converse()` sem ferramentas.
- Parse tolerante: filtra strings válidas do array `hashtags`, extrai
  `reasoning` opcional, lança `AiError` se nenhuma hashtag válida for retornada.

**4. Prompt dedicado** (`prompts.ts`):
- `viralHashtagsSystemPrompt(count)`: princípios de classificação por hashtag
  (não distribuição), mix de categorias (obra, emoção, nicho, tendência),
  proibição de genéricas (#fyp, #viral), limite de 2-6 palavras por tag.
- `buildViralHashtagsUserMessage()`: monta contexto com hashtags do vídeo,
  hashtags mais citadas nos comentários (com frequência), padrões de
  engajamento (perguntas recorrentes, mais curtidos, confusão) e análise de
  cena (resumo, obra identificada, conflito, segredo).

**5. API de comentários atualizada** (`/api/videos/[id]/comments/route.ts`):
- GET agora retorna `hashtags: repo.getVideoHashtags(id)` junto com
  `comments` e `capturedAt`, eliminando chamada extra na UI.

### Verificação

- `npm run typecheck`: passou limpo após correção de cast em `extractJson`.
- `npm test`: 142/142 testes passando.
- `npm run build`: rota `/api/videos/[id]/hashtags-virais` listada no output.
- Banco de dados: 4 vídeos já possuem hashtags salvas na tabela
  `video_hashtags`, confirmando que a extensão está funcionando e os dados
  estão disponíveis para a nova funcionalidade.

### Estado atual do projeto (para continuidade)

- **Branch**: master, 14 arquivos modificados + 12 não rastreados (extensão
  Chrome completa + rotas da extensão + token de ingestão).
- **Worker**: embutido (`WORKER_IN_PROCESS=true`), inicia automaticamente com
  `npm start`.
- **Fila**: vazia (100 jobs concluídos, 98 vídeos analisados).
- **Próximo passo sugerido**: commitar as alterações pendentes e testar a
  geração de hashtags virais contra o GhostCLI real (requer chave válida e
  rede disponível na máquina do usuário).

---

## 7. Redimensionamento do player e correção de build (2026-09-27)

### Contexto

O player de vídeo na página de detalhes (`/video/[id]`) ocupava toda a largura
da coluna esquerda, ficando desproporcionalmente grande para vídeos verticais
(9:16). O usuário pediu que o player tivesse a mesma largura da coluna de
detalhes (320px) e ficasse centralizado na coluna principal.

### O que foi feito

**1. Player movido e redimensionado** (`VideoDetailView.tsx`):
- Player reposicionado no topo da coluna esquerda (coluna principal de análise).
- Container limitado a `max-w-[320px] mx-auto` — mesma largura da coluna de
  detalhes da direita, centralizado horizontalmente.
- Removido o wrapper de `aspect-ratio` inline que forçava altura excessiva em
  vídeos verticais; o `<video>` agora usa `w-full object-contain` dentro do
  container limitado.
- Player duplicado que havia sido inserido na coluna direita (dentro do
  `<aside>`) foi removido para evitar renderização dupla.

**2. Correção de mismatch do better-sqlite3**:
- O terminal do Hermes usa Node v26.7.0 (MODULE_VERSION 147), mas o CMD do
  usuário roda Node v24.19.0 (MODULE_VERSION 137). O `npm rebuild` feito pelo
  Hermes compilou o módulo nativo para a versão errada, causando
  `ERR_DLOPEN_FAILED` no `npm start` manual.
- Solução: o usuário precisa rodar `npm rebuild better-sqlite3` no próprio CMD
  (não pelo Hermes) para compilar com o Node correto.

**3. Build limpo e verificação**:
- Cache `.next` removido e build regenerado para garantir que as classes CSS
  atualizadas (`max-w-[320px] mx-auto`) fossem incluídas no chunk da página de
  detalhes.
- Typecheck passou limpo após todas as alterações.
- Servidor respondendo HTTP 200 após reinício.

### Lições aprendidas

- **Cache do Next.js em produção**: `npm start` serve arquivos do `.next` sem
  recarregar automaticamente. Após mudanças em componentes client-side, é
  necessário `rm -rf .next && npm run build` antes de reiniciar o servidor.
- **Node version mismatch no Windows**: quando o Hermes e o CMD do usuário usam
  versões diferentes do Node, módulos nativos como `better-sqlite3` devem ser
  reconstruídos sempre no ambiente onde o servidor será executado.
- **Vídeos verticais e aspect-ratio**: o wrapper `aspect-ratio: 9/16` combinado
  com largura total da coluna resulta em alturas excessivas (~568px para 320px
  de largura). Limitar a largura máxima do container é mais eficaz que limitar
  a altura do vídeo diretamente.

### Estado atual

- Player centralizado na coluna esquerda com `max-w-[320px]`, mesma largura da
  coluna de detalhes.
- Build limpo, typecheck limpo, servidor operacional.
- Documentação atualizada até esta seção.
