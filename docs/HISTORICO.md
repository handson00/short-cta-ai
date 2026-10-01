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

---

## 8. Captura automática de comentários em lote (2026-09-27)

### Contexto

A captura de comentários era manual: o usuário precisava clicar em "Capturar
comentários ↗" para cada vídeo individualmente, abrindo uma aba do TikTok por
vez. Com dezenas de vídeos na fila, isso se tornou impraticável. O usuário
pediu um botão que automatizasse todo o processo.

### Arquitetura escolhida

**Extensão-driven com backend como orquestrador** — descartou-se Puppeteer no
backend (pesado, detectável pelo TikTok, perde sessão real do usuário) e
scraping direto via fetch (TikTok bloqueia sem cookies válidos). A extensão já
tinha scraper funcional e roda com a sessão real do usuário logado.

Fluxo: UI → Backend (fila SQLite) → Extensão (polling) → TikTok → Ingest API.

### O que foi feito

**1. Tabela e funções de fila** (`repo.ts`):
- Nova tabela `capture_queue` com campos: id, video_id, url, status
  (pending/processing/done/error), attempts, timestamps.
- `addToCaptureQueue()`: insere vídeos na fila, ignora duplicatas pendentes.
- `getPendingCaptures(limit)`: retorna próximos itens para a extensão processar.
- `completeCaptureQueueItem()` / `failCaptureQueueItem()`: marca conclusão ou
  erro (após 3 falhas, marca como error permanente).
- `captureQueueSummary()`: resumo por status para exibição na UI.

**2. Endpoints da API**:
- `POST /api/extension/capture-queue`: recebe lista de vídeos da UI e adiciona
  à fila. Exige sessão do app.
- `GET /api/extension/pending-captures?limit=N`: retorna itens pendentes para
  a extensão. Autenticado por COMMENTS_INGEST_TOKEN (mesmo token do ingest).
- `POST /api/extension/pending-captures`: marca item como done ou error.
  Mesma autenticação por token.

**3. Botão na UI** (`Library.tsx`):
- Novo botão "Capturar comentários (N)" na barra de seleção em lote, ao lado
  do botão de excluir. Aparece quando há vídeos selecionados.
- Filtra apenas vídeos com URL de origem (sem URL = impossível abrir no TikTok).
- Chama `POST /api/extension/capture-queue` e exibe confirmação com contagem.

**4. Polling na extensão** (`background.js`):
- `pollCaptureQueue()` roda a cada 30s via `setInterval`.
- Consulta `/api/extension/pending-captures` usando token do storage local.
- Para cada item: abre aba em background → aguarda carregamento → injeta
  content script → coleta comentários → envia via ingest API → marca como
  done na fila → fecha aba.
- Delay de 8s entre capturas para evitar rate-limit do TikTok.
- Em caso de erro: marca como error na fila (após 3 tentativas vira error
  permanente).
- Reutiliza funções existentes (`aguardarCarregamento`, `garantirScript`).

**5. Permissões da extensão** (`manifest.json`):
- Adicionada permissão `"tabs"` necessária para `chrome.tabs.create()` em
  background e `chrome.tabs.remove()`.

### Verificação

- `npm run typecheck`: passou limpo.
- `npm run build`: rotas `/api/extension/capture-queue` e
  `/api/extension/pending-captures` listadas no output.
- Manifest da extensão validado com nova permissão.

### Como usar

1. Na página principal (Fila), selecione os vídeos desejados clicando nos
   checkboxes.
2. Clique em "Capturar comentários (N)" na barra de seleção.
3. A extensão (deve estar instalada e com o token configurado) irá processar
   automaticamente a cada 30s, abrindo abas em background.
4. Os comentários capturados aparecem nos respectivos vídeos após o
   processamento.

### Verificação end-to-end (2026-09-27)

> **Correção em 2026-09-29:** esta validação estava errada. Os comentários que
> chegaram vieram da captura disparada pelo popup, não da fila: a fila nunca
> processou um pedido (0 tentativas em 196 linhas). Ver §20.

- Usuário selecionou 98 vídeos na Fila e clicou em "Capturar comentários (98)".
- Backend confirmou: `98 vídeo(s) adicionado(s) à fila de captura`.
- Consulta via API (`GET /api/extension/pending-captures`) confirmou 98 itens
  com status `pending` na tabela `capture_queue`.
- Após recarregar a extensão no Chrome (`chrome://extensions` → reload), o
  polling iniciou automaticamente e os vídeos começaram a ser processados.
- Fluxo completo validado: UI → fila SQLite → polling da extensão → TikTok →
  ingest API → comentários salvos nos vídeos.

### Estado atual

- Captura automática em lote funcional e testada em produção.
- Backend completo (tabela + endpoints + botão UI).
- Extensão com polling ativo e permissões atualizadas.
- Editor de vídeos: Fase 1 concluída (ver seção 9).
- Documentação atualizada até esta seção.

---

## 9. Editor de Vídeos Verticais em Massa — Fase 1 (Foundation)

Implementado em 2026-09-27. Módulo isolado integrado ao projeto existente
(Next.js 15 + React 19 + SQLite + FFmpeg), sem alterar stack ou arquitetura
global.

### Adaptações da especificação

- **Tauri/Rust → Next.js API Routes**: backend em `/api/editor/*` usando o
  wrapper FFmpeg existente (`src/lib/media/run.ts`).
- **IPC → HTTP**: comunicação frontend-backend via fetch.
- **Rusqlite → better-sqlite3**: reutiliza singleton `db()` e padrão de
  migrations inline.
- **Zustand → React state local**: módulo isolado, sem nova dependência.
- **Paleta**: segue design system existente (`ink-*`, `accent`).

### Arquivos criados

- `src/lib/schema.ts` — tabelas `editor_templates`, `source_profiles`,
  `editor_jobs` adicionadas ao schema existente.
- `src/lib/types.ts` — tipos `EditorCrop`, `EditorTemplate`,
  `EditorTemplateConfig`, `SourceProfile`, `EditorJob`, `EditorJobStatus`,
  `EditorAudioSettings`, `EditorExportSettings`, `EditorSystemStatus`.
- `src/lib/editorRepo.ts` — CRUD completo para templates, source profiles e
  jobs do editor.
- `src/app/api/editor/status/route.ts` — endpoint GET que verifica FFmpeg,
  FFprobe e encoders disponíveis (NVENC, QSV, AMF, libx264) com teste real
  de inicialização.
- `src/app/editor/page.tsx` — página do módulo com auth guard.
- `src/components/editor/EditorShell.tsx` — componente cliente que exibe
  status do sistema e placeholder das próximas fases.

### Arquivos modificados

- `src/app/layout.tsx` — item "Editor" adicionado à navegação principal.

### Verificação

- Typecheck limpo (`npm run typecheck` exit 0).
- Tabelas criadas automaticamente na próxima inicialização do servidor.
- Rota `/api/editor/status` funcional e autenticada.

### Próximas fases

| Fase | Escopo |
|------|--------|
| 2 | Importação múltipla + FFprobe + thumbnails |
| 3 | Crop manual com overlay retangular |
| 4 | Smart Crop V1 (variação temporal + threshold) |
| 5 | Templates (CRUD + video slot + fit/fill) |
| 6 | Preview proxy 360p com cache |
| 7 | Exportação MP4 (FilterGraphBuilder + progresso) |
| 8 | Fila de jobs sequenciais com cancelamento |
| 9 | Source profiles (salvar/carregar crop por origem) |

### Estado atual

- Fase 1 concluída e verificada.
- Fase 2 revisada concluída (ver abaixo).
- Módulo acessível em `/editor` com biblioteca integrada.

---

## 10. Editor de Vídeos — Fase 2 Revisada (Biblioteca Integrada)

Implementado em 2026-09-28. Em vez de upload manual como fonte primária, o
editor agora lista os vídeos já processados na plataforma (com CTA, comentários,
hashtags e análise de cena) e permite seleção em lote para edição.

### Arquivos criados

- `src/app/api/editor/library/route.ts` — endpoint GET que retorna vídeos da
  biblioteca com metadados completos (CTA, contagem de comentários/hashtags,
  status da análise, thumbnail).

### Arquivos modificados

- `src/components/editor/EditorShell.tsx` — substituiu a grade de uploads
  manuais por uma grade da biblioteca com:
  - Seleção individual por clique e botão "Selecionar todos"
  - Badges visuais para CTA, Análise, Comentários e Hashtags
  - Preview do texto do CTA gerado
  - Barra de ação com contador de selecionados e botão "Editar selecionados →"
  - Upload manual mantido como `<details>` colapsável (fallback)
  - Carregamento paralelo de status do sistema + biblioteca no mount

### Integração com dados existentes

- CTAs gerados na Fila aparecem como preview nos cards do editor
- Contagem de comentários capturados pela extensão exibida como badge
- Hashtags virais geradas por IA contabilizadas nos cards
- Source profiles poderão ser pré-preenchidos com crop detectado na análise
  visual (Fase 4)
- Rota `/api/editor/import` permanece como fallback para vídeos externos

### Verificação

- Typecheck limpo (`npm run typecheck` exit 0).
- Build regenerado com sucesso.
- Servidor precisa ser reiniciado no CMD (`npm start`) para refletir.

### Próximas fases

| Fase | Escopo |
|------|--------|
| 3 | Crop manual com overlay retangular |
| 4 | Smart Crop V1 (variação temporal + threshold) |
| 5 | Templates (CRUD + video slot + fit/fill) |
| 6 | Preview proxy 360p com cache |
| 7 | Exportação MP4 (FilterGraphBuilder + progresso) |
| 8 | Fila de jobs sequenciais com cancelamento |
| 9 | Source profiles (salvar/carregar crop por origem) |

### Ajuste de layout (2026-09-28)

- Editor reestruturado em duas colunas: lista de vídeos à esquerda e preview
  lateral à direita.
- Cards da biblioteca agora usam `aspect-video` (mesma proporção da página
  principal / Fila).
- Preview lateral exibe player de vídeo, metadados (resolução, duração), CTA
  gerado e badges de análise/comentários/hashtags.
- Clique no card seleciona para edição em lote E ativa o preview
  simultaneamente.
- Typecheck limpo, build regenerado.

### Estado atual

- Fase 2 revisada concluída e documentada.
- Biblioteca de vídeos processados integrada ao editor.
- Layout de duas colunas com preview lateral funcional.
- Seleção em lote funcional na UI.
- Pronto para iniciar Fase 3 (crop manual).

---

## 11. Transcrição: 95 vídeos analisados surdos (2026-09-28)

O usuário relatou que a transcrição não funcionava. A tela dizia "Sem fala
compreensível reconhecida neste vídeo · Provedor: faster-whisper".

### A causa

`FASTER_WHISPER_PYTHON` no `.env.local` apontava para um caminho inexistente —
erro de um dígito no nome da pasta:

```
python-3.14.7+20250901-win32-x64   ← configurado
python-3.14.7+20260901-win32-x64   ← pasta real
```

E o caminho corrigido também não serviria: aquele Python não tem o pacote. O
`faster_whisper` 1.2.1 está no Python 3.12
(`C:/Users/adz/AppData/Local/Programs/Python/Python312/python.exe`).

### Por que ninguém percebeu

Esta é a **segunda vez** que o mesmo padrão custa caro no projeto — a primeira
foi o OCR (§ do HANDOFF 5.1).

O backend estava certo: `runner.ts` capturava o erro e gravava
`"Transcrição indisponível: faster-whisper nao esta instalado..."` em
`transcripts.warnings_json`. O `repo.ts` mapeava o campo corretamente e o
`view.ts` o repassava ao cliente. Mas o painel de Transcrição em
`VideoDetailView.tsx` só olhava `hasSpeech` e imprimia uma frase genérica.

Resultado: **95 dos 98 vídeos** tinham a mensagem de falha gravada no banco, e
a interface dizia a mesma coisa que diria para um vídeo genuinamente mudo. A IA
vinha gerando CTAs sem o diálogo — o resumo de cena de um vídeo dizia
literalmente "Não há transcrição de áudio disponível".

### Correção

| Arquivo | O que mudou |
| --- | --- |
| `.env.local` | `FASTER_WHISPER_PYTHON` para o Python 3.12 |
| `src/components/VideoDetailView.tsx` | O painel exibe os `warnings` quando não há fala, em vez da frase genérica |

### Verificação

Rodado o comando exato de produção num áudio real: 80 segmentos em português.
Depois, reanálise de **um** vídeo pelo caminho completo da aplicação
(job → `runner.ts` → banco → interface): `has_speech: 1`, idioma `pt`, 2.421
caracteres. O resumo da cena passou de "evidências extremamente limitadas" para
a narrativa real do corte.

### Pendência

Os outros 94 vídeos continuam com a transcrição falha gravada. Só melhoram com
"Analisar novamente", e reprocessar consome chamadas reais do GhostCLI.

### A lição, de novo

Uma falha de provedor não pode chegar à tela com a mesma aparência de um dado
ausente. Quando isso acontece, o sistema perde a capacidade de avisar que está
quebrado — e continua produzindo resultado com cara de normal.

---

## 12. Editor de Vídeos — Fase 3 (Crop Manual)

Implementada em 2026-09-28. Aceite da §98 da spec: o usuário define manualmente
a região útil do vídeo.

Antes de implementar, o módulo foi auditado contra a especificação. A auditoria
encontrou três coisas que a documentação anterior não registrava:

- `editorRepo.ts` tinha 292 linhas e **nenhum chamador** — as três tabelas do
  editor nunca recebiam uma linha.
- O botão "Editar selecionados →" não tinha `onClick`. Todo o fluxo de seleção
  terminava num botão decorativo.
- `/api/editor/videos` também não tinha chamador, duplicando `/library`.

Isso fazia o módulo parecer mais pronto do que estava: na prática, o editor
**não recortava, não aplicava template e não exportava** — as três coisas que
justificam o módulo (§164).

### Arquivos criados

| Arquivo | Função |
| --- | --- |
| `src/lib/editor/crop.ts` | Geometria do recorte: arraste, clamp, fração ↔ pixel |
| `src/components/editor/CropOverlay.tsx` | Retângulo sobre o vídeo, 8 handles, arraste |
| `src/app/api/editor/crop/route.ts` | GET / POST / DELETE do recorte por vídeo |
| `tests/editorCrop.test.ts` | 14 testes |
| `docs/video-editor/ARCHITECTURE.md` | Entregável pendente da Fase 0 (§150) |
| `docs/video-editor/IMPLEMENTATION_PLAN.md` | Rastreador de fases (§151) |

### Arquivos modificados

| Arquivo | O que mudou |
| --- | --- |
| `src/lib/schema.ts` | Tabela `editor_video_crops` (§61) |
| `src/lib/editorRepo.ts` | CRUD de recorte; deixou de ser código morto |
| `src/components/editor/EditorShell.tsx` | Painel de recorte, campos numéricos, botões de aplicar; `fileInputRef` duplicado removido |

### Decisões que não são óbvias

- **Recorte guardado em fração (0..1), não em pixel** (§24): o mesmo valor serve
  a 720×1280 e 1080×1920. É o que vai permitir o perfil de origem da Fase 9.
- **`toPixels()` arredonda para par.** H.264 em yuv420p recusa lado ímpar; um
  recorte de 911 px só quebraria na exportação, longe da causa.
- **Campos numéricos em pixels da fonte.** "x = 84" é conferível contra o
  arquivo; "x = 0,0778" não é.
- **Geometria fora do componente** (`lib/editor/crop.ts`): é a única parte do
  recorte que dá para testar sem navegador.
- **`saveVideoCrops()` é transação.** "Aplicar a todos" ou grava tudo ou não
  grava nada — um lote pela metade deixaria o usuário sem saber quais vídeos
  ficaram com o recorte antigo.
- **Resetar volta ao quadro inteiro**, não a um retângulo sugerido. Sugerir
  recorte sem ter analisado o vídeo seria inventar; isso é a Fase 4.

### Verificação

Typecheck limpo, `npm test` 156/156 (14 novos), build regenerado. Pela API:
gravar, ler de volta e apagar funcionam; recorte que ultrapassa a borda devolve
422 com mensagem específica; uma string `-vf crop=...` no lugar do número
também devolve 422 (§83).

**Não verificado:** o arraste dos handles no navegador. A geometria tem teste
unitário, mas ninguém arrastou um handle numa tela ainda.

### Estado atual

- Fase 3 concluída; Fase 0 fechada retroativamente.
- Andamento por fase agora vive em `docs/video-editor/IMPLEMENTATION_PLAN.md`.
- Próxima: Fase 4 (Smart Crop V1).

---

## 13. Editor — "vídeos duplicados" e a promoção explícita (2026-09-28)

O usuário usou o crop manual, funcionou, e relatou: "tem alguns vídeos que
estão repetidos".

### Não havia nada duplicado

98 vídeos distintos no acervo; a rota `/api/editor/library` devolvia **109
linhas**. A causa era *fan-out* de `LEFT JOIN`: cada reanálise insere uma linha
nova em `scene_analyses`, e o JOIN multiplicava o vídeo por quantas análises
ele tivesse. Seis vídeos tinham análise repetida, somando 17 linhas — as 11
linhas extras. O vídeo que eu havia reanalisado na sessão anterior tinha 6
análises e aparecia 6 vezes na grade.

É a terceira vez que o sintoma na tela aponta para o lugar errado neste
projeto (OCR, transcrição, agora isto). O padrão se repete: o dado estava
certo, a camada que o lê é que estava errada.

**Correção:** todo agregado da rota virou subconsulta correlacionada —
contagem de comentários, hashtags, CTA e análise. Isso elimina a classe inteira
do defeito, não só a ocorrência do `scene_analyses`.

### A mudança de fluxo

O editor listava todos os vídeos do acervo. O usuário pediu que a entrada na
segunda fase fosse explícita: depois de analisar, ele seleciona o que quer e
manda para a edição por um botão.

Foi implementado como promoção explícita (`editor_videos`) em vez de filtro por
`status = done`, porque:

- O usuário controla o lote — analisar 98 não obriga a editar 98.
- É reversível: dá para tirar da edição sem apagar do acervo.
- Um filtro por status mudaria de conteúdo sozinho conforme jobs terminassem,
  no meio de uma sessão de edição.

### Arquivos

| Arquivo | O que mudou |
| --- | --- |
| `src/lib/schema.ts` | Tabela `editor_videos` |
| `src/lib/editorRepo.ts` | `addVideosToEditor` / `removeVideoFromEditor` / `listEditorVideoIds` |
| `src/app/api/editor/queue/route.ts` | Novo — GET / POST / DELETE |
| `src/app/api/editor/library/route.ts` | Só promovidos; agregados viraram subconsulta |
| `src/components/Library.tsx` | Botão "Enviar para edição (N)" |
| `src/components/editor/EditorShell.tsx` | Estado vazio com o caminho; × para remover |

### Verificação

Typecheck limpo, 156/156, build refeito. Vídeo com 6 análises passou a gerar 1
card; os 98 do acervo geram 98 cards. Promover o mesmo vídeo duas vezes devolve
`added: 0, alreadyThere: 1` em vez de duplicar.

O `editor_videos` foi deixado **vazio** de propósito: o usuário escolhe o que
promover.

---

## 14. Editor — Fase 4 (Smart Crop V1)

Implementada em 2026-09-28. Aceite da §99: o vídeo central é detectado
automaticamente em molduras predominantemente estáticas.

### A ideia

Numa moldura de outra página, o quadro externo fica parado e o filme no meio
muda o tempo todo. Medindo quanto cada pixel varia ao longo dos frames, a
região do conteúdo se separa sozinha — sem modelo de IA, sem GPU, offline
(§142).

16 frames em cinza a 180px → diferença média absoluta entre frames consecutivos
→ projeção em linhas e colunas → primeiro/último índice acima de 30% do máximo
→ confiança = separação × captura.

### Sem dependência nova

Os frames saem do FFmpeg como `-f rawvideo -pix_fmt gray`: um byte por pixel,
sem cabeçalho. É o mesmo truque que `media/ffmpeg.ts` já usava para o average
hash. Não há PNG para decodificar, e o projeto não ganhou `sharp` nem `jimp`.

### Desvio consciente da spec

A spec pede threshold binário (§17), morfologia (§18), detecção de bordas (§19)
e consenso entre candidatos (§92). Aqui é projeção em linhas/colunas.

Motivo: morfologia existe para achar formas arbitrárias. A forma procurada aqui
é sempre um retângulo alinhado aos eixos, e projetar resolve isso com muito
menos código e sem biblioteca de imagem. A §108 não exige precisão perfeita e a
§142 pede primeira versão determinística.

### Arquivos criados

| Arquivo | Função |
| --- | --- |
| `src/lib/editor/motion.ts` | Detecção pura — testável sem vídeo |
| `src/lib/editor/smartCrop.ts` | Extração dos frames via FFmpeg |
| `src/app/api/editor/smart-crop/route.ts` | POST, individual ou em lote |
| `tests/editorMotion.test.ts` | 16 testes |

`src/components/editor/EditorShell.tsx` ganhou "Detectar automaticamente", o
aviso de confiança nas três faixas da §22 e a detecção em lote.

### Decisões que não são óbvias

- **A suavização alarga o retângulo em ~1 pixel por lado, de propósito.**
  Sobrar é invisível no vídeo final; faltar corta conteúdo, o pior erro
  possível aqui. Há teste travando isso — um teste falhou exatamente nesse
  ponto e a resposta certa foi corrigir o teste, não o código.
- **O span usa primeiro/último acima do limiar**, não a maior sequência
  contígua: uma cena escura no meio do corte cortaria o conteúdo ao meio.
- **Diferença média absoluta, não variância.** Mudança lenta de iluminação
  inflaria a variância do quadro inteiro e apagaria o contraste que interessa.
- **Detectar não aplica** (§22). O individual carrega o retângulo e mostra a
  confiança; quem grava é o usuário. Só o lote grava direto — e o aviso diz
  quantos saíram com confiança baixa, em vez de um "30 detectados" que
  esconderia os que precisam de revisão.
- **"Nenhuma moldura detectada" não é erro.** Devolve `hasBorder: false` e não
  grava nada. Gravar o quadro inteiro como "detecção" faria uma não-descoberta
  parecer resultado.

### Verificação

Typecheck limpo, 172/172 testes, build refeito. Detecção rodada em 3 vídeos
reais do acervo: ~1,6 s por vídeo, confiança entre 82 e 85, todos devolvendo
largura cheia com faixa vertical central — a forma esperada para esse material.

**Não verificado:** se o retângulo está visualmente certo sobre a imagem.

### Limitação conhecida

Moldura com elemento animado alarga o retângulo, e a confiança cai junto. O
caminho para isso é a Fase 9 (perfil de origem): gravar o recorte uma vez e
reusar em todos os vídeos da mesma página.

---

## 15. Editor — Fase 5 (Templates)

Implementada em 2026-09-28. Aceite da §100: o usuário consegue inserir o crop
no template.

### O que entrou

Upload de fundo, overlay e logo; CRUD de templates; área do vídeo (video slot)
ajustável por arraste ou por campo numérico; modos FIT e FILL; atribuição do
template a vários vídeos de uma vez; e um preview que desenha as camadas na
ordem da §28.

As tabelas `editor_templates` — criadas na Fase 1 e sem uso desde então —
finalmente passaram a receber dados.

### Decisões que não são óbvias

- **A conta de encaixe mora em `lib/editor/template.ts`, fora da interface.**
  É a mesma conta que o preview e a exportação (Fase 7) precisam fazer. Duas
  implementações da mesma composição é a forma mais fácil de o preview mentir
  sobre o resultado final (§86).
- **`croppedAspect()` usa a proporção do recorte, não a do arquivo.** Recortar
  muda a forma do que vai ser encaixado; usar a proporção original deformaria
  o vídeo.
- **O slot reusa o `CropOverlay` da Fase 3.** É o mesmo gesto, agora sobre o
  canvas em vez do vídeo.
- **Upload validado por assinatura de bytes, não por extensão** (§84), com nome
  gerado pelo servidor — mesma regra do upload de vídeo.
- **Canvas com lado ímpar é recusado ao salvar.** H.264 em yuv420p não aceita,
  e descobrir isso só na exportação seria descobrir longe da causa.

### Um defeito que só o teste end-to-end pegou

Apagar um template deixava os vídeos apontando para ele, e a interface mostrava
o selo "Template" num vídeo que não tinha mais nenhum.

Causa: `editor_videos` já existia no banco do usuário, então `template_id`
entrou por `ALTER TABLE ADD COLUMN` — e o SQLite **não cria chave estrangeira
por ALTER TABLE**. O `ON DELETE SET NULL` declarado no `CREATE TABLE` nunca
existiu naquele banco.

Correção: `deleteEditorTemplate` limpa as referências explicitamente, numa
transação, sem depender da FK.

**Regra que fica:** coluna adicionada por migração não tem a constraint que o
schema declara. Se o comportamento depende dela, escreva o comportamento.

### Verificação

Typecheck limpo, 188/188 testes (16 novos), build refeito. Pela API: criar
template, recusar slot fora do canvas (422 nomeando a borda), recusar canvas
ímpar, atribuir a vários vídeos, e apagar zerando as referências.

**Não verificado:** preview da composição na tela, upload pelo navegador e
arraste do slot.

---

## 16. Editor — Fase 5.1 (template criado na plataforma)

Pedido do usuário depois de usar a Fase 5, em 2026-09-28.

### Três pedidos

1. **"Criar um próprio template dentro da plataforma"** — montar do zero, sem
   depender de uma imagem pronta. Virou `backgroundColor` em hex: dá para ter
   um template só com cor de fundo.
2. **"Colocar uma logo, uma logo fixa"** — `logoX/Y/Width/Height` em pixels do
   canvas, arrastável no preview e editável por campo numérico.
3. **"Quero apenas importar os templates, não precisa importar outras coisas"**
   — removido o upload manual de vídeo do editor. Os vídeos entram só pela
   Fila, pelo botão "Enviar para edição".

### Decisões que não são óbvias

- **A logo reusa o `CropOverlay`, com um seletor "Área do vídeo / Logo".** Dois
  retângulos arrastáveis ao mesmo tempo competiriam pelo clique; o seletor diz
  qual está em edição, e os campos numéricos seguem a mesma escolha.
- **A validação da logo só roda quando existe imagem de logo.** Um template sem
  logo não pode ser recusado por uma posição que ninguém vai usar.
- **A rota `/api/editor/import` continua no disco, só sem interface.** O pedido
  foi "por enquanto"; manter o backend deixa o retorno barato.
- **Cor de fundo validada como `#RRGGBB` no servidor**, mesmo o seletor do
  navegador sempre mandando válido: a rota não pode depender do cliente.

### Verificação

Typecheck limpo, 194/194 testes, build refeito. Pela API: template só com cor e
logo (sem imagem), recusa de cor malformada, recusa de logo fora do canvas, e
aplicação a 3 vídeos de uma vez.

O usuário já havia criado "Meu template 1" pelo navegador, com fundo e logo
enviados pela interface e slot em modo FILL — o upload e o editor funcionam.

### O que ainda falta para "ficar pronto"

Aplicar o template hoje **grava a associação**, não produz arquivo. O vídeo
final só existe depois da Fase 7 (exportação): FilterGraphBuilder, render em
MP4/H.264/AAC e progresso. É o próximo passo.

---

## 17. Editor — Fase 7 (Exportação MP4)

Implementada em 2026-09-28. Aceite da §102: um vídeo pode ser renderizado
corretamente. É a fase que fecha o ciclo — antes dela o módulo preparava tudo
e não produzia arquivo nenhum.

### Estrutura

O `filter_complex` é montado por uma função pura (`lib/editor/filterGraph.ts`)
que devolve texto. Isso permite conferir o comando num teste sem rodar o
FFmpeg, e garante que nenhuma string vinda do navegador vire comando: os
argumentos vão em array, nunca linha de shell (§45, §83).

O mesmo vale para o parser de progresso (`lib/editor/progress.ts`), que lê o
`-progress pipe:1`.

### Decisões que não são óbvias

- **Grava em `.processing` e renomeia no fim** (§114): cancelamento nunca deixa
  um MP4 truncado com cara de pronto.
- **O nome de saída nunca sobrescreve** (§110). Quem ajustou o template e
  rodou de novo ainda pode comparar os dois resultados.
- **Encoder pedido explicitamente que não funciona não cai para CPU em
  silêncio.** Trocar por baixo faria a exportação demorar dez vezes mais sem
  explicação. Só `auto` desce a lista de prioridade.
- **Exportação sequencial** (§56): vinte FFmpegs simultâneos deixariam a
  máquina inutilizável, e cada um mais lento do que todos em fila.
- **O parser corta por `/\r?\n/`**, com teste de CRLF. Foi um `\r` não tratado
  na saída do Tesseract que manteve o OCR deste projeto quebrado por dois dias.

### Dois defeitos pegos antes de virarem problema

**`toPixels` devolvia lado ímpar.** Arredondava para par e *depois* limitava ao
tamanho da fonte — com fonte de lado ímpar, o `Math.min` desfazia o
arredondamento. O H.264 recusaria, mas só na exportação, longe da causa. O
teste "todas as dimensões são pares" pegou. Corrigido com `evenUp`/`evenDown`:
quando o número é um limite, ele também precisa ser par.

**`.processing` quebrava o FFmpeg.** Ele deduz o container pela extensão e
recusava `arquivo.mp4.processing`. Só apareceu no teste com vídeo real.
Corrigido com `-f mp4` explícito, mantendo a proteção do §114.

### Verificação

Typecheck limpo, 219/219 testes (21 novos), build refeito.

**Render real:** um vídeo de 92 s saiu em 13,5 s. O encoder foi escolhido
sozinho — `h264_qsv` (Intel Quick Sync), ~7× tempo real. O `ffprobe` confirmou
H.264 · 1080×1920 · yuv420p · 30 fps · AAC, e um frame extraído confirmou a
composição: vídeo encaixado no slot, logo aplicada, fundo do template.

Nenhum `.processing` sobrou na pasta.

### O que fica para a Fase 8

A exportação em lote roda dentro da requisição HTTP. Para dezenas de vídeos
precisa virar fila com estado persistido: a tabela `editor_jobs` já recebe
status e progresso, falta o worker que a consome.

---

## 18. Editor — logo deformada e aba de Preview (Fase 7.1)

Relatado pelo usuário depois do primeiro render real, em 2026-09-28: "a logo
saiu muito esticada". E o pedido de uma aba para ver o resultado antes de
exportar.

### O defeito

O filter graph fazia `scale=240:240`, que força as duas dimensões e deforma
qualquer logo que não seja quadrada.

O detalhe importante: **o preview do template já estava certo.** Ele usava
`object-contain`, que cabe a imagem na caixa sem deformar. Preview e exportação
discordavam — exatamente o que a §86 manda evitar, e a razão de ela existir.

Correção:

```
scale=LW:LH:force_original_aspect_ratio=decrease
overlay=LX+(LW-overlay_w)/2:LY+(LH-overlay_h)/2
```

A expressão com `overlay_w`/`overlay_h` centraliza a logo na caixa; as
dimensões reais só existem em tempo de execução, porque dependem da proporção
do arquivo enviado.

Verificado comparando dois renders do mesmo vídeo e recortando a região da
logo: antes visivelmente esticada na horizontal, depois na proporção correta.

### A aba de Preview

O painel da direita ganhou duas abas: Recorte e Preview. A de Preview mostra o
vídeo tocando dentro do template, com o recorte aplicado — o resultado da
exportação, antes de exportar.

Para isso a composição virou um componente único, `CompositionPreview.tsx`,
usado pelo editor de template **e** pela aba. O `TemplatePanel` perdeu ~70
linhas duplicadas.

A decisão foi direta consequência do defeito acima: duas telas desenhando a
mesma composição por caminhos diferentes é a forma mais fácil de uma mentir
sobre o resultado.

### O que a aba não é

Não é o proxy 360p com cache da §41. A composição é montada no DOM — é
instantânea e deixa tocar o vídeo, mas quem renderiza é o navegador, não o
FFmpeg. A geometria, que é o que importa, vem da mesma função dos dois lados.

### Observação sobre os arquivos já exportados

Os vídeos exportados antes desta correção têm a logo esticada e precisam ser
exportados de novo. Como o nome de saída nunca sobrescreve (§110), os antigos
continuam na pasta — apague-os à mão se não quiser guardá-los.

---

## 19. Editor — Fase 8 (fila de exportação e formato para Reels/TikTok)

Implementada em 2026-09-28. Pedido do usuário: exportar em massa, rápido, e no
melhor formato para TikTok e Instagram.

### Velocidade

A exportação saiu de dentro da requisição HTTP. O POST enfileira um job por
vídeo em `editor_jobs` e responde em ~0,3 s; um worker no processo do servidor
consome a fila. Antes, a conexão ficava presa pelo lote inteiro e estourava o
timeout com dezenas de vídeos.

Concorrência pelo tipo de encoder: 2 em paralelo com GPU (circuito dedicado),
1 com `libx264` (que já usa todos os núcleos sozinho). Medido: 3 vídeos,
~4,5 min de conteúdo, em 42 s com `h264_qsv` — ~6,5× tempo real.

### Formato

Preset único em `lib/editor/exportPreset.ts`: H.264 High @ 4.1, 1080×1920,
30 fps constante, ~10 Mbps com teto de 12, keyframe a cada 2 s, cor BT.709
marcada, AAC-LC 192 kbps 48 kHz estéreo, MP4 com `+faststart`.

A lógica: as plataformas recomprimem tudo que recebem, então o arquivo
exportado é a matéria-prima dessa recompressão. Mira-se qualidade alta e
compatibilidade máxima, não tamanho mínimo. São escolhas de engenharia sobre o
que as plataformas publicam; revisar se as recomendações mudarem.

### Três defeitos que só o teste real pegou

**Cópias separadas do módulo no Next.js.** O `instrumentation` e as rotas de
API carregam cada um sua cópia do mesmo arquivo. O worker rodava numa; a rota
consultava outra, vazia. A API mostrava `encoder: null` e — o grave — **o
cancelamento devolvia `false` e o render seguia até o fim**. Corrigido com o
estado em `globalThis`.

Regra que fica: **estado em memória que precisa ser visto pelo worker e pelas
rotas vai no `globalThis`, nunca em variável solta de módulo.**

**Cor sem tag no QSV.** As flags de cor na saída não chegavam ao bitstream;
o `ffprobe` mostrava primaries e transfer como `unknown`. Corrigido com
`setparams` no filter graph, que marca a cor em cada frame.

**Nível 4.0 em vez de 4.1.** O QSV lê o nível por uma opção inteira: `4.1`
virava 4. Corrigido passando `41`.

Os três passariam em qualquer teste unitário. Só apareceram rodando o
servidor de verdade e conferindo o arquivo no `ffprobe`.

### Corrigido de passagem

`updateEditorJobStatus` tinha `COALESCE(?, started_at)` com os argumentos
invertidos: cada atualização de progresso reescrevia a hora de início.

### Verificação

Typecheck limpo, 239/239 testes (20 novos). Enfileirar responde na hora; 2
renders em paralelo e o terceiro entra quando abre vaga; cancelar um render em
andamento funciona e não deixa `.processing`; o `ffprobe` da saída confere com
o preset.

---

## 20. Revisão geral e alinhamento (2026-09-29)

Pedido do usuário: "faça as correções necessárias, de forma que fique tudo
alinhado", agindo como engenheiro sênior. Em vez de partir da documentação, a
revisão partiu dos dados reais — e eles contradisseram a documentação em vários
pontos.

### Verificado pelo caminho real

A exportação da Fase 8, conferida no `ffprobe` depois das correções de cor e de
nível: H.264 High **nível 4.1**, primaries/transfer/colorspace **BT.709**.

### Editor: três defeitos de lógica

1. **A exportação ignorava o template aplicado a cada vídeo.** Usava o template
   aberto no painel para o lote inteiro. Quem aplicou templates diferentes a
   grupos diferentes recebia tudo com um só. Agora cada vídeo sai com o seu; o
   do painel vale para quem não tem. A aba Preview segue a mesma regra, e o
   aviso depois de exportar diz quantos saíram com cada template. Conferido
   pelo caminho real: com "pronto" no painel e "novo" aplicado, o job saiu com
   "novo".
2. **A detecção em lote estourava com mais de 50 vídeos** (limite da rota) e
   não mostrava progresso. Agora vai em pacotes de 10.
3. **Alterações não salvas eram invisíveis.** A exportação lê o template e o
   recorte salvos; a tela agora avisa quando há mudança não salva.

### Fila de captura de comentários: nunca funcionou

Os dados mostraram 196 pedidos para 98 vídeos, **todos pendentes, com zero
tentativas**. Dois defeitos independentes:

- **No servidor,** `addToCaptureQueue` prometia ignorar vídeo já pedido com
  `INSERT OR IGNORE`, mas sem índice único não havia o que ignorar: dois cliques
  (às 18:34:02 e 18:34:54 de 27/09) enfileiraram cada vídeo duas vezes.
  Corrigido com um índice único parcial (um pedido aberto por vídeo), criado
  numa migração que antes remove as duplicatas. A tabela, que era criada de
  improviso dentro do `repo.ts`, passou para o `schema.ts`.
- **Na extensão,** o polling lia o token das chaves `ingestToken`/`apiBase`,
  mas o popup grava `shortCtaToken`/`shortCtaUrl`. O token vinha sempre vazio e
  o polling desistia em silêncio. Além disso usava `setInterval` num service
  worker do Manifest V3, que o Chrome encerra quando ocioso. Corrigido: chaves
  certas e `chrome.alarms` (permissão `alarms`, versão 1.1.0).

A §8 deste histórico registrava o fluxo como "validado de ponta a ponta". Os
comentários de 93 vídeos chegaram depois de a fila ser criada — mas pela
captura disparada no popup, que usa as chaves certas. A validação confundiu os
dois caminhos. É o padrão de sempre deste projeto: o sistema parecia funcionar
porque outro caminho entregava o resultado.

**Reconciliação dos dados:** depois da migração ficaram 98 pedidos. Para 93
deles o banco prova que o pedido foi atendido (comentários capturados depois de
o pedido existir); esses foram marcados como concluídos com a data real da
captura. Deixá-los pendentes faria a extensão corrigida reabrir 98 posts do
TikTok ao ser recarregada, repetindo capturas já feitas. Os 5 restantes (3 sem
comentário nenhum, 2 capturados antes do pedido) continuam pendentes e serão
processados quando a extensão for recarregada.

**Não verificado:** a extensão corrigida num navegador.

### Documentação que contradizia os dados

| Afirmação | Realidade |
| --- | --- |
| "GhostCLI testado apenas contra o mock" | ~670 chamadas reais registradas, 1 erro |
| "Reanalisar os 79 vídeos por causa do OCR" | Os 98 têm análise visual pós-correção; 65 com CTA detectado |
| "Transcrição desligada, é o gargalo" | Ligada desde 28/09; 93 vídeos por reanalisar |
| "Quase tudo do Instagram" | Os 98 vídeos atuais são do TikTok |
| "`npm test` não carrega o `.env.local`" | Carrega, via `vitest.config.ts` |
| "Nenhum teste cobre CRLF" | `tests/media.test.ts` cobre o parser do Tesseract |
| "Comentários não entram em nenhum prompt" | Entram em quatro; todos via `untrusted()` (conferido) |
| `prompts.ts`: "fontes no HANDOFF, §11" | Essa seção nunca existiu; o comentário agora diz onde está o resumo |

`HANDOFF.md`, `ROADMAP.md`, `README.md`, a arquitetura e o plano do editor
foram reescritos a partir dos dados.

### Raiz do repositório

Relatórios de sessões antigas estavam versionados na raiz e se contradiziam —
o `BUILD_STATUS.md` e o `PROMPT_PARA_CONTINUAR.md` instruíam a "fazer o build
funcionar", que funciona há dias. Foram movidos para `docs/arquivo/` com
`git mv` (nada foi apagado), junto com a cópia antiga do handoff e os `.bat`
da depuração de build. O `FUNCIONALIDADES_CTA_OTIMIZADO.md`, que documenta um
recurso vivo, foi para `docs/`. Três `.log` de build versionados apesar do
`*.log` no `.gitignore` saíram do índice (continuam no disco).

### Testes

259/259. Novos: `tests/editorJobs.test.ts` (13) e `tests/captureQueue.test.ts`
(7) — este último monta um banco no formato antigo, com a duplicata, e confere
a migração.

### Limpeza de artefatos de teste

Os MP4 que eu havia gerado nos testes das Fases 7 e 8 (~624 MB) e os jobs deles
foram apagados. Ficaram os três exportados pelo usuário às 22:10 de 28/09. Na
Fase 8 eu havia usado "Limpar lista", o que apagou também o registro (não os
arquivos) das exportações anteriores do usuário.

---

## 21. Editor — Fase 10 (texto do CTA e áudio no vídeo)

Implementada em 2026-09-29. É a fase que junta as duas metades do produto: a
análise gera o CTA, e agora ele sai desenhado sobre o vídeo exportado — o
texto-gancho "acima do vídeo" que dá nome ao projeto.

### Por que o texto é desenhado pelo navegador

O caminho óbvio seria o `drawtext` do FFmpeg. Foi descartado porque quebraria
a regra que o projeto já pagou caro para aprender (a logo esticada da Fase 7):
o preview precisa mostrar o que a exportação produz. Com `drawtext`, a fonte do
FFmpeg quebra as linhas em lugar diferente da do navegador, emoji colorido não
sai (os CTAs gerados usam emoji), nada quebra linha sozinho, e o escape de
caracteres especiais é uma fonte conhecida de erro.

Em vez disso, uma única função (`drawTextLayer`) desenha o texto num canvas.
O preview é esse canvas; na exportação, o mesmo desenho vira um PNG enviado ao
servidor, e o FFmpeg só sobrepõe a imagem. Nenhum texto do usuário entra no
comando do FFmpeg.

A quebra de linha e a redução de fonte até caber ficaram em `textLayout.ts`,
uma função pura que recebe o medidor de largura — no navegador, o canvas; nos
testes, um medidor falso. Por isso a regra é testável sem navegador.

### O CTA que vai para o vídeo

O editor usava "texto editado, senão o recomendado", ignorando a sugestão
**escolhida** na Fila. Agora segue a mesma regra da Fila (`view.ts`): editado,
senão escolhido; a recomendação da análise entra só por último, e a tela diz
de onde o texto veio. Um texto próprio pode ser definido por vídeo no editor
sem tocar na escolha da Fila.

### Dois defeitos antigos, achados pelos testes desta fase

**Vídeo sem áudio nunca terminava de exportar.** Antes de mexer no comando do
FFmpeg, a estrutura existente foi testada caso a caso. Resultado: um overlay só
termina quando todas as entradas terminam, e o fundo nunca termina. Nos vídeos
com áudio, o `-shortest` sobre o áudio encerrava o arquivo e disfarçava o
problema; num clipe de 4 s sem áudio, o render foi morto por timeout aos 25 s.
O modo "mudo" desta fase teria travado a fila em todo vídeo. Nova regra, medida
em todas as combinações: toda imagem entra em loop, todo overlay usa
`shortest=1`, e o vídeo é a única fonte finita.

**23 dos 98 vídeos saíam com a cor errada.** A medição do texto mostrou o fundo
vermelho saindo laranja. Investigado a fundo: 23 vídeos do acervo são BT.601
(`smpte170m`), e a Fase 8 passou a etiquetar a saída como BT.709 sem converter
os dados. Em barras de cor, o verde (14, 222, 4) saía (0, 189, 0) — o próprio
filme saía com a cor desviada, não só o fundo. Agora cada entrada é convertida
para BT.709 antes do overlay; vídeo sem matriz declarada segue a convenção dos
players. Medido depois: verde 12, 220, 2 nas origens BT.601 e BT.709; fundo
251, 0, 0.

A lição se repete: a Fase 8 conferiu as **etiquetas** no `ffprobe` e as deu por
certas. Etiqueta certa sobre dado errado passa em qualquer verificação que só
lê metadado. O que prova a cor é medir o pixel.

### Teste instável corrigido de passagem

Com a máquina carregada, o `beforeAll` dos testes de banco estourava o limite
padrão de 10 s do Vitest e a suíte inteira era pulada. `hookTimeout` alinhado ao
`testTimeout` (120 s) no `vitest.config.ts`.

### Verificação

Typecheck e build limpos; `npm test` 304/304. Renderizador de produção rodado
contra mídia sintética numa pasta temporária: os quatro cenários de áudio
terminam no fim do vídeo; o texto aparece e some na janela e nos fades medidos
pixel a pixel; a cor confere com a referência. Rotas novas conferidas no app
rodando, com os artefatos do teste removidos em seguida.

**Não verificado:** o desenho do texto no navegador, o arraste da caixa e a
exportação completa disparada pela tela.

---

## 22. Editor — texto editável no painel e salvamento automático (2026-09-29)

Pedido do usuário logo depois da Fase 10: ao ligar "Mostrar o CTA sobre o
vídeo", poder editar o texto ali mesmo, e toda alteração já ficar salva e
aparecer no preview em tempo real.

O campo de texto entrou na seção "Texto (CTA)" do painel de template, ligado ao
vídeo aberto e sincronizado com o campo da aba Preview. Texto e template passam
a ser salvos sozinhos meio segundo depois da última alteração; o botão "Salvar"
deu lugar a um indicador de estado. A aba Preview desenha o rascunho do
template aberto, sem esperar o salvamento.

Três cuidados que não são óbvios:

- **O rascunho de texto guarda de qual vídeo é.** Ao trocar de vídeo existe um
  render em que o campo ainda tem o texto do anterior; sem essa marca, o
  autosave o gravaria no vídeo novo.
- **O autosave do template não entra em laço.** O mesmo conteúdo nunca é
  enviado duas vezes seguidas, e um erro de validação (caixa fora do canvas,
  por exemplo) mostra a mensagem e espera a próxima alteração em vez de
  repetir o pedido.
- **A exportação espera o salvamento.** Como o preview agora mostra o rascunho
  e a fila lê o template salvo, exportar no meio de um salvamento sairia com a
  versão anterior. Com salvamento pendente ou com erro, a exportação recusa e
  explica.

Typecheck, 304/304 testes e build limpos. O comportamento na tela não foi
verificado.

## 23. Editor — Fase 9 (perfis de origem) (2026-09-29)

Aceite da §104: um lote de vídeos da mesma página reutiliza o recorte.

Antes de desenhar, o banco: os 98 vídeos são todos de `@helmermovies`, em três
resoluções (720×1280, 576×1024, 1080×1920), todas 9:16. A página já era
conhecida pelo nome do arquivo; o que faltava ao perfil era a proporção — um
recorte normalizado só aponta para a mesma região em vídeos de mesma proporção.

O perfil guarda o recorte, a página (`tiktok:helmermovies`) e a proporção do
vídeo em que foi desenhado. Um perfil serve a um vídeo quando página e
proporção batem; a regra (`matchProfile`) é a mesma na tela e no servidor.
Detalhes e arquivos em `video-editor/IMPLEMENTATION_PLAN.md`.

Decisões:

- **Recorte manual nunca é trocado em lote**; proporção diferente fica de fora
  com o motivo. Um lote que apagasse ajuste manual, ou cortasse um vídeo 1:1
  com um retângulo desenhado em 9:16, faria o erro aparecer só na exportação.
- **O perfil vence a detecção automática** (ordem da §90) — moldura animada
  engana o Smart Crop, e é para isso que o perfil existe —, mas vídeos cuja
  detecção diverge do perfil (IoU < 0,85) são listados para revisão. O limite
  saiu do acervo: detecções da mesma página se sobrepõem com IoU ~0,96.
- **Recorte aplicado é cópia.** Atualizar o perfil não muda quem já o recebeu,
  e a tela diz isso; excluir mantém o recorte e só desfaz o vínculo
  (explicitamente: `profile_id` entrou por ALTER TABLE, sem FK).

Verificado: typecheck; 345/345 testes (26 novos, com banco temporário); a
migração numa cópia do banco real feita pela API de backup do SQLite (colunas
criadas, 5 recortes preservados, `foreign_key_check` limpo).

**Não verificado:** `npm run build` (o servidor do usuário estava rodando na
porta 3000, e o build reescreveria a `.next` debaixo dele), as rotas com o app
rodando e o painel na tela.

## 24. CTA a partir do enredo que a fala revela (2026-09-29)

Pedido do usuário: as sugestões de CTA devem nascer da transcrição — entender o
enredo pela fala e gerar ganchos mais fortes.

### O que estava errado

A transcrição ia só para a **análise**. A **geração** dos CTAs recebia apenas o
resumo de três frases que o modelo escreveu (`buildGenerationUserMessage`):
quem escrevia o gancho nunca lia uma fala.

### O que mudou

1. **Análise:** o contrato ganhou `plot` (o enredo reconstruído pelas falas:
   quem, o que quer, o que está em jogo, o que muda) e `keyLines` (2 a 5 falas
   literais, com o instante). O prompt declara a fala como evidência principal
   da história.
2. **Geração:** recebe enredo, falas-chave e a transcrição completa (até 6.000
   caracteres, com o corte declarado), antes do resumo e dentro de
   `untrusted()`. O prompt manda cada gancho partir de um elemento concreto do
   enredo, preferir o que os personagens dizem ao que a imagem sugere, nunca
   atribuir a alguém o que não está na transcrição, e dizer no `reason` em que
   fala se apoia. "Regenerar CTAs" também lê a transcrição atual.
3. **Tela:** o painel da Fila mostra "Enredo (pela fala)" com as falas-chave, e
   um aviso de em que os CTAs se apoiaram — fala, sem fala, versão antiga ou
   **transcrição falhou, com o motivo**.

`PROMPT_VERSION` passou a `2026-09-29-enredo-fala`.

### Decisões que não são óbvias

- **Fala-chave é conferida na transcrição** (`groundKeyLines`): ≥ 70% das
  palavras precisam estar lá, sem acento nem pontuação. Uma fala inventada
  pelo modelo apareceria na tela com cara de citação e entraria no CTA como
  evidência.
- **Sem fala recebida, o enredo é descartado** mesmo que o modelo o escreva, e
  `evidenceBasis` é calculado pelo servidor, não declarado pelo modelo.
- **Falha de transcrição é dita como falha** no prompt ("pode haver fala que
  não foi ouvida: não afirme que ninguém fala") e na tela, em vermelho. É o
  mesmo defeito do §11: 95 vídeos analisados surdos com o painel dizendo "sem
  fala compreensível".

### Estado do acervo — o que limita o ganho hoje

Consulta ao banco em 2026-09-29: **6 vídeos têm fala transcrita; 92 têm
gravada a falha antiga** ("faster-whisper não está instalado", da época do
caminho errado do Python). O `npm run doctor` confirma que a transcrição
funciona agora. A mudança só atua nesses 92 depois de "Analisar novamente",
que transcreve de novo (CPU local) e faz 2 chamadas pagas ao GhostCLI por
vídeo. Decisão do usuário.

Montada pelo caminho real num dos 6 vídeos com fala (cópia do banco), a
mensagem da geração passou a levar a narração inteira do corte, instante a
instante; antes levava três frases.

Verificado: typecheck; 345/345 testes (15 novos em `tests/enredoFala.test.ts`).
**Não verificado:** nenhuma chamada real ao modelo com o prompt novo — a
qualidade dos ganchos gerados ainda não foi vista —, o build e o painel na tela.

## 25. "Analisar novamente" em lote na Fila (2026-09-29)

Pedido do usuário: um botão na página principal para reanalisar os vídeos
selecionados antes de mandá-los para a edição.

Na barra de seleção da Fila: **"Analisar novamente (N)"**, e o atalho
**"Selecionar transcrição falhada (N)"**, que marca, dentro do filtro atual,
os vídeos cujos CTAs foram escritos sem ouvir a fala (§24). A confirmação diz
o custo (2 chamadas pagas por vídeo) e que o CTA **escolhido** na Fila é
desfeito, porque as sugestões são refeitas; o texto **editado** fica.

Rota nova `POST /api/videos/bulk-reanalyze`; a regra está em
`repo.requestReanalysis`, usada também pela rota individual.

**Um defeito antigo corrigido de passagem:** a rota individual criava um job
novo mesmo com o vídeo já em análise, e os dois jobs rodavam juntos sobre os
mesmos arquivos. Agora o vídeo com job aberto é pulado, com o motivo (409 na
rota individual).

**E um que o teste pegou:** a primeira versão da checagem usava `latestJob`,
que ordena por `created_at`. Dois jobs criados no mesmo milissegundo empatam,
e o empate às vezes devolvia o job antigo — o teste do duplo clique falhava em
2 de 4 rodadas. A checagem virou "existe job aberto para o vídeo?". Depois da
correção, 5 de 5. `latestJobsByVideo` tem o mesmo empate teórico no status
mostrado na tela; na prática não ocorre (um job novo nasce muito depois do
anterior terminar) e não foi mexido.

Verificado: typecheck, 350/350 testes (5 novos em `tests/reanalysis.test.ts`),
build, e a rota no app rodando só com chamadas sem custo (sem sessão → 401,
lista vazia → 400, vídeo inexistente → relatado). Contagem nesse momento: 7
vídeos com fala, 91 com transcrição falhada.

**Não verificado:** o botão clicado na tela e uma reanálise real disparada por
ele — isso consome chamadas pagas e fica para o usuário.

## 26. Economia de chamadas pagas: IA sob demanda, reaproveitamento e hashtags sem IA (2026-09-29)

Pedido do usuário: economizar nas chamadas à IA; hashtags só as capturadas
pela extensão — as 2 mais relevantes —; e o CTA principal sempre vindo da fala
e de curiosidade.

### O que mudou

1. **A importação não chama mais a IA.** Faz só a parte local (transcrição,
   frames, OCR) e o vídeo fica "Aguardando CTA". Na Fila, **"Gerar CTAs (N)"**
   roda a IA só nos selecionados (job `mode = 'ai'`, que pula a parte local já
   feita). Configuração "Gerar CTAs automaticamente ao importar" (desligada)
   devolve o comportamento antigo. "Tentar novamente" repete o modo do job que
   falhou, para um vídeo importado não passar a gastar sem pedido.
2. **Mesma entrada, nenhuma chamada.** `pipeline/aiCache.ts` calcula o SHA-256
   do texto exato que iria ao modelo, com as mesmas funções que montam o
   prompt. Igual ao da análise/geração salva, o resultado é reaproveitado e
   registrado em "Uso da IA" como **reaproveitada** — fora do total de
   requisições. Reaproveitar a geração também preserva o CTA escolhido na Fila.
   "Regenerar CTAs" é pedido explícito e sempre chama.
3. **Hashtags sem IA** (`pipeline/hashtagRank.ts`): as 2 mais relevantes entre
   as capturadas — no post original (+3), citada nos comentários (+vezes, teto
   5), fala do mesmo que o CTA (+5) ou aparece na fala (+3); genéricas (#fyp,
   #viral…) nunca entram; cada uma sai com o motivo. A rota
   `hashtags-virais`, o método do provedor e os dois prompts foram removidos —
   e com eles o registro dobrado que inflava "Uso da IA".
4. **CTA principal = curiosidade apoiada na fala.** O prompt pede; o validador
   garante: se a recomendação não é de curiosidade ou não tem palavra de
   conteúdo em comum com a fala (sem palavras comuns — `speechAnchor`), promove
   a curiosidade mais ancorada na transcrição.

### Decisões que não são óbvias

- **"Gerar CTAs" com transcrição FALHADA refaz a parte local antes.** Senão
  pagaria a IA para escrever sem ouvir a fala — o problema do §24.
- **Limite honesto das hashtags:** a extensão não mede visualização por
  hashtag (o TikTok não informa). "No post original" é o sinal mais próximo de
  "deu visualização", e a tela diz isso. No acervo atual as três capturadas são
  quase sempre as mesmas (#filme/#filmes, #cenasdefilme, #resumodefilmes) e os
  comentários não trazem hashtag: as 2 recomendadas empatam e saem pela ordem
  do post. O ranking só diferencia vídeos quando houver hashtag nos comentários
  ou ligada ao CTA.

### Dois defeitos corrigidos no caminho

- **Envio em pedaços da extensão.** Cada pedaço de 200 comentários substituía
  o anterior, e os pedaços 2+ chegavam com hashtags vazias que apagavam as do
  primeiro. Agora o servidor aceita `append` (a extensão 1.1.1 manda do
  segundo pedaço em diante) e nunca grava hashtag vazia por cima. No banco:
  nenhum vídeo passou de 197 comentários, então o defeito ainda não tinha
  apagado nada. 29 dos 95 vídeos têm hashtags vazias — não por este defeito
  (só age no 2º pedaço); a causa não foi determinada.
- **`video_hashtags` criada "na hora".** Ia para o schema: a leitura dava 500
  num banco que nunca recebeu hashtag (e a spec §138 proíbe tabela ad hoc).

### Verificado

Typecheck, build, 373/373 testes (23 novos em `iaSobDemanda.test.ts` e
`runnerModes.test.ts`: modos, reaproveitamento, hashtags, CTA principal,
pedaços). No app rodando, sem chamada paga: configuração desligada por padrão,
hashtags recomendadas em vídeos reais, rota antiga 404, modo inválido 422,
migração no banco real (216 jobs antigos como `full`).

**Não verificado:** uma importação real (só parte local) e um "Gerar CTAs" real
— consomem chamada paga ou arquivo novo; os botões na tela; a extensão 1.1.1
num navegador (precisa ser recarregada em `chrome://extensions`).

## 27. Análise de vídeo mais rápida (2026-09-29)

Pedido do usuário: deixar o processo de análise mais rápido. Primeiro medido,
depois mexido.

### Onde o tempo ia (medido)

- Banco real: job completo levava **60 s em média**; a IA, ~22 s (análise
  ~11 s + geração ~11 s, uma depois da outra — a geração lê a análise).
- Parte local num corte de 107 s: probe 0,0 s · thumbnail 0,1 s · frames 2,1 s
  · áudio 0,1 s · **transcrição 52 s** · OCR 4,4 s. A transcrição é quase tudo.
- Variantes do faster-whisper no mesmo áudio: mais threads de CPU quase não
  mudam (75,7 → 71,7 s); **beam 5 → 1** corta ~40% (71,7 → 43,3 s) com 98% das
  palavras iguais (a diferença foi pontuação; o beam 1 acertou "montanhas" onde
  o 5 escreveu "utanhas"). A máquina tem uma RTX 4050 que não era usada: faltava
  o cuBLAS/cuDNN no Python.

### O que mudou

1. **Beam 1 por padrão** (`FASTER_WHISPER_BEAM`, volta para 5 se precisar).
2. **Fala e texto na tela ao mesmo tempo** (`runner.transcribeAndReadText`): o
   OCR não depende do áudio, então some dentro do tempo da transcrição. A etapa
   mostrada é a que falta ("Lendo texto" só se o OCR passar da fala). Espera os
   dois mesmo se um falhar — nada fica gravando depois do job encerrado.
3. **Frames e OCR em paralelo** (`lib/concurrency.mapLimit`, 4 ffmpegs / 3
   Tesseracts por vídeo). O descarte de frames repetidos continua na ordem do
   vídeo e o OCR é juntado na ordem original: resultado idêntico (conferido —
   mesmos frames).
4. **Duas pistas na fila** (`queue.ts`): "Gerar CTAs" (job `ai`, só rede) não
   espera atrás de transcrição. Configuração nova "Gerando CTAs em paralelo"
   (padrão 3; o histórico não tem nenhum 429 do GhostCLI com 2).
5. **GPU opcional** (`FASTER_WHISPER_DEVICE=auto`): o script tenta CUDA/float16
   e, se as bibliotecas não estiverem lá, transcreve na CPU. No Windows ele
   registra as pastas `site-packages/nvidia/*/bin`, onde o pip põe as DLLs.
6. **Saída do transcritor sempre UTF-8.** Redirecionada para arquivo, o Python
   do Windows escrevia em cp1252. As transcrições salvas estavam íntegras
   (nenhum U+FFFD nas 6 do banco), mas não dependia disso.

### Números (vídeo real, mesma sessão)

- Parte local na CPU: **84,5 s → 58,6 s (−31%)**, mesmos 44 trechos de fala,
  mesmos frames.
- Transcrição na GPU (bibliotecas CUDA numa pasta isolada, sem tocar no Python
  do usuário): **10,4–10,8 s contra 53 s na CPU (5×)**, 474/474 palavras,
  99,6% idênticas (uma vírgula virou ponto).
- `auto` sem as bibliotecas: caiu para a CPU e transcreveu (59,6 s — ~6 s a
  mais pela tentativa na GPU). **Não ligar `auto` sem instalar as bibliotecas.**

### Um vazamento de teste corrigido

`runnerModes.test.ts` não isolava `DATA_DIR` e criou `data/artifacts/v1`
(vazia) nos dados reais. Removida; o teste agora usa pasta temporária.

### Verificado

Typecheck e 380/380 testes (novos: pistas da fila, `mapLimit`, OCR começando
durante a transcrição, etapa mostrada).

**GPU ligada (a pedido do usuário):** `nvidia-cublas-cu12` 12.9.2.10,
`nvidia-cudnn-cu12` 9.26.0.51 e `nvidia-cuda-nvrtc-cu12` 12.9.86 instalados no
Python do `.env.local`, que passou a `FASTER_WHISPER_DEVICE=auto`. Pelo
provedor do app: 14,3 s na primeira rodada (inclui iniciar a GPU), 43 trechos,
acentos íntegros. Build e servidor reiniciados.

**Não verificado:** um job real importado pela tela com tudo isso junto.

### Fato do ambiente, fora desta entrega

Às 15:53:54 (horário local), 92 vídeos saíram do banco com arquivos e artefatos.
Sobraram 6, de 2026-09-25. Só as rotas de exclusão da tela apagam linhas de
`videos`. Os comandos desta sessão só leram o banco. O usuário confirmou que
a exclusão foi dele, pela tela.

## 28. Google Gemini como segundo provedor de IA (2026-09-30)

Pedido do usuário: usar os modelos gratuitos do Google, escolhendo tudo em
Configurações, com a lista de modelos para escolher.

### Decisão: adaptar, não escrever outro provedor

O Google oferece um endpoint compatível com Chat Completions
(`https://generativelanguage.googleapis.com/v1beta/openai`, chave como
Bearer) — o mesmo formato que o cliente do GhostCLI já fala. Por isso o
provedor virou um só (`ChatCompletionsProvider`, em `providers/ai/ghostcli.ts`)
configurado por um **perfil** (`resolveAiProfile` em `settings.ts`): endereço,
chave, modelos, timeout. Prompts, validação, reparo, reaproveitamento por hash
e registro de uso são os mesmos para os dois provedores.

### O que mudou

- **Configurações → IA:** escolha do provedor no topo; para o Gemini, chave
  (salva criptografada, como a do GhostCLI, ou `GEMINI_API_KEY`), modelo de
  análise e de geração num `<select>`, "Atualizar lista" e "Testar conexão".
- **Lista de modelos** (`/api/settings/models`, `providers/ai/geminiModels.ts`):
  vem da conta pela API nativa `models.list` (chave no cabeçalho
  `x-goog-api-key`, nunca na URL). Ficam só modelos de texto (sem imagem, voz,
  ao vivo, embeddings). A marca "gratuito" vem da página de preços do Google,
  copiada com a data (a API não informa isso). Se a consulta falhar, a tela
  mostra o motivo e oferece os gratuitos conhecidos.
- **Uma chave por provedor:** trocar de provedor não apaga a chave do outro.
- **Erros do Google classificados pelo corpo, não só pelo status:** chave
  inválida chega como 400 e virou `auth_error` (pelo status, a tela mandaria
  conferir o modelo); 429 com quota `PerDay` virou `quota_exhausted`, que não é
  repetido; 429 por minuto respeita o `retryDelay` do corpo. O erro do Google
  pode vir dentro de uma lista, e o detalhe agora é lido nos dois formatos.
- **Fila:** com o Gemini, "Gerando CTAs em paralelo" fica em 1.
- **Uso da IA:** coluna `provider` em `ai_request_logs` (migração em `db.ts`) e
  na tela. A migração não é opcional: `logAiRequest` engole erro de propósito,
  e sem a coluna o registro de uso pararia em silêncio.

### Decisões que não são óbvias

- **Nunca troca de provedor sozinho.** Falhou ou acabou a cota: o vídeo mostra
  o erro. Cair para o GhostCLI gastaria chamada paga sem pedido.
- **Mudar de provedor ou de modelo muda o hash** do reaproveitamento (o modelo
  entra nele): a primeira geração com o Gemini chama a IA mesmo em vídeo já
  gerado pelo GhostCLI. É o certo — o resultado salvo é de outro modelo.
- **Privacidade:** no plano gratuito o Google pode usar o conteúdo enviado
  (transcrição, OCR, comentários) para melhorar os produtos, com revisão
  humana. A tela diz isso no bloco do Gemini.

### Verificado

Typecheck; 393/393 testes (13 novos em `tests/geminiProvider.test.ts`: erros
do Google, lista de modelos, uma chave por provedor, sem troca automática, e a
chamada de ponta a ponta — URL do Google, Bearer com a chave do Gemini, modelo
escolhido, `provider = gemini` no registro — com banco temporário). Conferido
que o banco real não foi tocado pelos testes.

**Não verificado:** nenhuma chamada real ao Google (falta a chave do usuário);
o formato real do 429 do endpoint compatível — a detecção de cota diária
segue o marcador `PerDay` que o Google usa nos `quotaId`, e sem ele o 429 é
tratado como limite por minuto; a tela; o build.

### Ajuste no mesmo dia: só os três modelos principais

Pedido do usuário: na lista, só os principais — básico, médio e avançado. A
tela deixou de listar todos os modelos da conta e oferece três, todos com plano
gratuito (`GEMINI_MAIN_MODELS` em `geminiModels.ts`):

| Nível | Modelo | Por quê |
| --- | --- | --- |
| Básico | `gemini-3.5-flash-lite` | Flash-Lite mais novo com plano gratuito |
| Médio | `gemini-3.8-flash` | Flash mais novo; padrão |
| Avançado | `gemini-2.5-pro` | Único Pro com plano gratuito (o `gemini-3.1-pro-preview` é pago) |

A conta continua sendo consultada, só para marcar cada um como disponível ou
não para a chave; se a consulta falhar, os três aparecem e o motivo vai em
vermelho. Um modelo salvo fora dos três continua visível no select ("Atual"),
para a tela não mostrar outro modelo sem o usuário ter trocado.

A documentação de chaves que o usuário trouxe diz que o Google **recusa chave
padrão sem restrição** e que chaves novas do AI Studio já saem do tipo "auth".
A dica do campo da chave e a mensagem do 403 na lista de modelos dizem isso.

396/396 testes (3 novos). Continua sem chamada real ao Google.

## 29. Editor — "Outro CTA": trocar o texto pelos CTAs gerados (2026-09-30)

Pedido do usuário: na seção "Texto (CTA)" do editor, um botão ao lado do texto
que carrega outro CTA gerado para o vídeo, e a indicação do estilo (curiosidade,
suspense…).

- `/api/editor/library` passa a mandar `ctaOptions` de cada vídeo: as sugestões
  do `cta_suggestions`, recomendada primeiro, sem texto repetido (o CTA que já
  estava no vídeo pode coincidir com um gerado). Uma consulta para todos os
  vídeos, não uma por vídeo.
- `CtaPicker` (painel de template e aba Preview): etiqueta com o estilo do texto
  que está sobre o vídeo ("Curiosidade", "Suspense"… ou "Texto próprio" quando
  não é um dos gerados), a nota "recomendado" / "já estava no vídeo" / "dos
  comentários", botões ‹ e "↻ Outro CTA" e a posição (3/10).
- A regra ("qual é o próximo", "de que estilo é o atual") está em
  `lib/editor/ctaOptions.ts`, pura e testada.

**Não muda a Fila:** o botão preenche o mesmo campo de texto do editor, que é
salvo sozinho como texto do vídeo no editor (`editor_video_texts`). Um CTA igual
ao da análise conta como "sem texto próprio", pela regra que já existia.

Verificado: typecheck; 404/404 testes (8 novos em `tests/editorCtaOptions.test.ts`,
a rota contra banco temporário). Banco real: 98 vídeos na edição, ~10 CTAs cada.
**Não verificado:** a tela e o build.

**Ajuste pedido pelo usuário:** o CTA que já estava no vídeo original
(`origin = 'original'`, lido pelo OCR) aparece com a etiqueta e a nota em
**verde**. Na fusão de textos repetidos, a marca "já estava no vídeo" passou a
sobreviver: antes, se o texto do vídeo coincidisse com um CTA gerado, só o
gerado ficava e o verde nunca apareceria. 404/404 testes.

## 30. Editor — aba Efeitos (2026-09-30)

Pedido do usuário: no painel de template, um botão para alternar para
"Efeitos" (como o Recorte ↔ Preview), com efeitos rápidos que funcionem em
"Este, Seleção ou Todos", e uma opção de aplicar em todos de uma vez.

### O que ficou de fora, e por quê

O pedido incluía "Anti Duplicidade", "efeitos que enganem as plataformas para
não identificar os vídeos" e "mudar o som para a plataforma não identificar".
Não foram feitos: o acervo é de cortes de filmes/séries de terceiros, e esses
efeitos existem para contornar a detecção de conteúdo (direitos autorais) das
plataformas. O usuário foi avisado e concordou em seguir só com os efeitos de
edição. Não reabrir sem uma conversa explícita sobre isso.

### Efeitos (lib/editor/effects.ts)

| Efeito | Exportação (FFmpeg) | Preview |
| --- | --- | --- |
| Espelhar | `hflip` depois do recorte | `scaleX(-1)` na caixa do recorte (a mesma região) |
| Cortar início/fim | `-ss`/`-t` na entrada: o grafo recebe só o trecho | o vídeo toca só o trecho |
| Realçar cores | `eq=contrast=1.08:saturation=1.18` | filtro CSS equivalente — **aproximado**, a tela diz |
| Velocidade 1,05–1,25× | `setpts` no vídeo, `atempo` no áudio original (sem mudar o tom) | `playbackRate` |
| Zoom leve 1,05–1,2× | recorte menor em volta do centro (`zoomRect`) | a mesma conta |
| Melhorar áudio | `highpass=f=80` + `loudnorm` a -14 LUFS no áudio final | — (preview é mudo) |

Decisões que não são óbvias:

- **A duração do texto e da música é a de SAÍDA** (`outputDuration`: trecho
  cortado ÷ velocidade). A música é cortada nela e não é acelerada.
- **Efeitos são por vídeo** (`editor_video_effects`) e **fotografados no job**
  ao exportar, como o recorte.
- **"Este vídeo" grava a cada toque; "Seleção" e "Todos" só pelo botão.** Um
  toque sem querer não pode reescrever os efeitos de 98 vídeos. Em lote a
  configuração inteira SUBSTITUI a de cada vídeo, e a tela diz isso.
- **"Todos" é resolvido no servidor** (`listEditorVideoIds`), não pela lista
  que o navegador tem.
- **Corte que deixa menos de 1 s** vira erro claro antes do FFmpeg.
- O painel de template fica **escondido, não desmontado**, quando a aba
  Efeitos está aberta: desmontar perderia o salvamento automático pendente.

### Verificado

Typecheck; 421/421 testes (17 novos em `tests/editorEffects.test.ts`). A
exportação foi **medida** com FFmpeg real sobre um vídeo sintético (esquerda
vermelha, direita azul, tom a -30 dB): 6 s → ~4 s com corte 0,5+0,5 e 1,25×;
o lado esquerdo passa de vermelho a azul com o espelho; o áudio sai perto de
-14 LUFS (+8 dB ou mais sobre a origem); os seis efeitos juntos renderizam.

Numa rodada da suíte completa, um teste de OCR (`media.test.ts`, "gancho no
terço superior") falhou uma vez com a máquina carregada pelo FFmpeg do teste
novo; passou isolado e em duas rodadas completas seguidas. Instabilidade de
carga, não regressão — mas fica anotada.

**Não verificado:** a aba na tela, o preview no navegador (velocidade, corte,
espelho) e uma exportação disparada pela interface; o build.

**Conferido depois, no mesmo dia:** o usuário buildou (10:29) e aplicou os
efeitos em Todos (98 vídeos, 10:33). Um vídeo real dele foi exportado pelo
mesmo motor, com saída na pasta temporária (nada na fila, no banco nem em
data/output): 61,65 s → 58,0 s (esperado 58,05), −22,3 → −14,3 LUFS,
1080×1920 H.264/AAC BT.709 no QSV, 8,4 s de render; o quadro comparado mostra
template, zoom e cor certos. Achado: o zoom corta as bordas — a legenda gravada
no filme, perto da borda de baixo, saiu cortada.

## 31. Editor — painel de preview acompanha a rolagem (2026-09-30)

Pedido do usuário: o painel da direita (Recorte / Preview) deve descer junto ao
rolar a lista de vídeos, que é longa.

O painel virou `sticky` logo abaixo do cabeçalho (`top-[72px]`), com altura
máxima da janela e rolagem interna quando é mais alto que ela.

**A causa de o `sticky` não bastar:** `globals.css` tinha `overflow-x: hidden`
em `html, body`. Isso transforma o `body` num contêiner de rolagem que nunca
rola, e todo `position: sticky` passa a se medir por ele — não gruda. O próprio
cabeçalho do app (`sticky top-0`) provavelmente já não grudava. Trocado por
`overflow-x: clip`, que esconde a sobra horizontal do mesmo jeito sem criar
contêiner de rolagem.

**Não verificado:** typecheck e build (o terminal ficou indisponível na hora) e
a tela.

## 32. Gemini: "Gerar CTAs" falhando com 503 e demorando minutos (2026-09-30)

Relato do usuário: pôs um vídeo para gerar CTA com o Gemini, deu erro e demorou
muito.

### O que o banco mostrou

- Configuração: análise em `gemini-3.5-flash-lite`, geração em
  `gemini-3.8-flash`, timeout 90 s, 2 tentativas extras.
- A **análise** funcionou em 3–4 s (flash-lite).
- A **geração** (3.8-flash) falhou: uma vez por timeout e depois com **503
  "This model is currently experiencing high demand"** — sobrecarga no Google;
  no plano gratuito o usuário é o último da fila.
- Job 1: 13:54 → erro às 14:03 (**9 min**). Job 2: 14:15 → erro às 14:20. A
  demora era insistir no modelo sobrecarregado: timeout de 90 s × tentativas do
  cliente × 3 tentativas do job.

### Correção

1. **Modelo reserva no Gemini** (`fallbackModel = gemini-3.5-flash-lite`,
   `ChatCompletionsProvider.send`): o modelo escolhido tem UMA chance, com
   espera de até 45 s e sem novas tentativas; se voltar 503, timeout, 429 ou
   cota esgotada, o reserva responde na hora. Chave recusada ou pedido inválido
   não acionam o reserva (outro modelo não resolveria). As duas chamadas ficam
   em "Uso da IA", com o modelo de cada uma. **Não é troca de provedor**: o
   reserva é do mesmo Gemini gratuito, e o GhostCLI (pago) continua sem reserva
   — lá o 503 é repetido no mesmo modelo, nunca trocado.
2. **Raciocínio baixo** (`reasoning_effort: "low"`, documentado pelo Google no
   endpoint compatível para Gemini 2.5 e 3.x): ganchos curtos não precisam de
   raciocínio longo, e ele é a maior parte do tempo de resposta. Se um modelo
   recusar o parâmetro, o cliente já repete a chamada sem os opcionais.

Nota: o reaproveitamento por hash usa o modelo CONFIGURADO. Se o reserva
atendeu, a próxima vez com a mesma entrada reaproveita o resultado dele.

### Defeito antigo corrigido de passagem

Na suíte completa, `iaSobDemanda` e `reanalysis` falharam de forma
intermitente: `latestJob` ordenava só por `created_at`, e dois jobs no mesmo
milissegundo empatavam — voltava o antigo (o "empate teórico" anotado no §25).
`latestJob`, `latestJobsByVideo` e `queueCounts` desempatam agora por `rowid`
(ordem de inserção). Depois: 425/425 em três rodadas completas seguidas.

### Verificado

Typecheck; 425/425 (4 novos em `geminiProvider.test.ts`: reserva no 503 com as
duas chamadas registradas, chave recusada sem reserva, raciocínio baixo só no
Gemini, GhostCLI sem troca de modelo). **Não verificado:** uma chamada real ao
Google com o reserva e o raciocínio baixo — depende do build e de o usuário
rodar "Gerar CTAs" de novo.

### Ajuste no mesmo dia: modelo recomendado por etapa

Pedido do usuário: na lista de modelos, marcar o recomendado para cada etapa —
o que faz o trabalho gastando menos.

- `GEMINI_MAIN_MODELS[].recommendedFor`: o **Básico (`gemini-3.5-flash-lite`)
  é o recomendado para análise e para geração**, pelo medido na conta do
  usuário (3–4 s; o 3.8-flash dava 503) e por ser o de maior cota gratuita. O
  padrão de instalação nova passou a ser ele. A escolha já salva do usuário não
  foi alterada.
- Na tela: "★ Recomendado" na opção, e, quando o escolhido é outro, a linha
  "Recomendado para esta etapa… Usar o recomendado".
- Reserva nos dois sentidos (`GEMINI_FALLBACK_MODELS`): escolhido o Médio, o
  reserva é o Básico; escolhido o Básico, o reserva é o Médio.

426/426 testes.

## 33. Editor — som no Preview (2026-09-30)

Relato do usuário: na aba Preview não dava para escutar o vídeo. O `<video>` do
`CompositionPreview` era sempre `muted` (o navegador bloqueia autoplay com
som). Agora há um botão 🔇/🔊 no canto do preview; o clique liga o som. Com o
template em "mudo" ou "substituir pela música", o botão fica desativado e diz
por quê — a música só existe no arquivo exportado. Typecheck, 426/426; tela
não conferida.

## 34. Editor — barra de exportação fixa e progresso à vista (2026-09-30)

Pedido do usuário: um botão para exportar os vídeos selecionados (ou todos) e
uma aba para acompanhar o carregamento, vídeo a vídeo e do lote.

**Os dois já existiam desde a Fase 8** — o que faltava era achá-los. Com 98
vídeos na lista, a barra de ações ficava DEPOIS de todos os cards (rolagem
inteira até o fim para achar "Exportar"), e o painel da fila fica no TOPO da
página: quem clicava em Exportar lá embaixo não via o progresso começar.

- A barra de ações virou `sticky bottom-3`: acompanha a janela enquanto a lista
  está à vista. Ganhou "Selecionar todos (N)" e o **Exportar em verde**
  (`emerald-600`), que é a ação final do módulo.
- A barra continua visível enquanto houver exportação em andamento, mesmo sem
  seleção, com o andamento do lote ("12 de 30 prontos · 40%") e um atalho que
  rola até o painel.
- Depois de enfileirar, a tela rola sozinha até o painel da fila
  (`id="fila-de-exportacao"`).
- O resumo vem do próprio painel (`onSummary`), não de uma segunda consulta: a
  conta do andamento continua num lugar só.

**Estado do acervo (conferido):** 98 vídeos na edição, **só 2 com template
aplicado**. Os outros 96 usam o template aberto no painel da esquerda — a
regra da §20, que o aviso pós-exportação já relata ("quantos saíram com cada
template"). Sem template aplicado e sem template aberto, a exportação recusa
com a contagem, em vez de gerar vídeo sem template.

Typecheck, 426/426. **Não verificado:** a tela e uma exportação disparada pela
interface.

## 35. Pasta de saída configurável e página de Exportações (2026-09-30)

Pedido do usuário: escolher em Configurações a pasta onde os vídeos são
gravados, e uma página nova (ao lado de Fila e Editor) com os vídeos já
prontos e todos os dados para copiar na hora de publicar.

### Pasta de saída

`settings.paths.outputDir` (vazio = a padrão, `EDITOR_OUTPUT_DIR`/`data/output`).
`lib/editor/outputDir.ts` resolve e valida; `export.ts` e `exportQueue.ts`
passaram a usar a resolvida no lugar de `env.outputDir`.

A validação **escreve um arquivo de teste** na pasta antes de salvar, e não só
confere se ela existe: pasta de rede, de disco removível ou sem permissão passa
no `existsSync` e falha na hora de gravar — no meio do lote, com o vídeo já
renderizado. Caminho relativo é recusado com instrução. A tela mostra a pasta
em uso (`outputDirInUse`), mesmo com o campo vazio.

### Página `/exports`

Rota `/api/exports` e `ExportsPanel`: os jobs `completed`, com miniatura, nome
do arquivo, tamanho, duração e, para copiar, CTA, hashtags, legenda do kit,
resumo, enredo e transcrição — cada um com botão próprio, mais "Copiar tudo"
(legenda + hashtags). Filtro "Desta sessão / Todos"; a sessão é marcada por
`globalThis.__appStartedAt`, gravado no `instrumentation.ts`.

Duas decisões:

- **Arquivo que sumiu é marcado, não escondido.** A primeira versão filtrava da
  lista quem não tinha mais o MP4 no disco. Isso é o padrão que o projeto já
  pagou caro (falha parecendo ausência): quem exportou 10 e visse 8 não teria
  como saber o que houve. Agora vem com `fileMissing` e o aviso na tela.
- **O CTA vem da mesma fonte do editor** (a sugestão com `is_recommended`), e
  não de `scene_analyses.recommended_text`. **Um teste pegou a divergência**:
  as duas não são a mesma coisa, e o que vale aqui é o texto que FOI para o
  vídeo.

### Layout em feed, como no celular

Pedido do usuário logo em seguida: a página no formato do TikTok/Instagram — o
vídeo à esquerda em 9:16, arrastando para cima para o próximo, e os dados do
vídeo em reprodução ao lado.

- `Feed`: moldura 9:16, gesto de arrastar (pointer events), roda do mouse com
  trava de uma rolagem por vídeo, setas ↑ ↓, clique para pausar e botão de som
  (começa mudo porque o navegador bloqueia autoplay com áudio). Resistência no
  primeiro e no último, como no celular.
- Só os vizinhos (anterior, atual, próximo) ficam montados: um `<video>` por
  exportação faria o navegador baixar dezenas de MP4 ao mesmo tempo.
- Rota nova `/api/exports/[jobId]/media`: serve o MP4 com suporte a `Range`
  (sem isso um arquivo de 70 MB só tocaria depois de baixar inteiro). **O
  caminho vem do job no banco, nunca do cliente** — aceitar caminho do
  navegador serviria qualquer arquivo da máquina. Job não concluído ou arquivo
  ausente devolvem 404.

Verificado: typecheck, 439/439 (13 novos em `tests/exportsPage.test.ts`, com
banco e pastas temporários, incluindo o Range e a recusa de id que não é job).
**Não verificado:** as telas, o gesto no navegador e o build.

### Fato do ambiente, fora desta entrega

Os dois primeiros vídeos exportados pelo usuário pela interface terminaram bem
(19:03 UTC, `completed`, 100%, ~27 s e ~22 s), mas os MP4 **não estão mais** em
`data/output` — a pasta está vazia, com data de modificação posterior à
exportação. Nada no código apaga `.mp4` de lá (`removeOrphanPartials` só
remove `.processing`). Perguntado ao usuário.

## 36. Som no feed e hashtags por IA nas Exportações (2026-09-30)

### O áudio do vídeo exportado

Relato: "na exportação está faltando o áudio". **Medido no arquivo do usuário**
(`20240321_..._editado.mp4`): tem trilha AAC, média −18 dB, pico −1,2 dB,
integrada −15,3 LUFS. O arquivo está certo; o problema era ouvir na tela.

**Causa achada:** `muted` no React é tratado como ATRIBUTO, e atributo de
`<video>` só vale na criação do elemento. O botão de som mudava o estado, o
React re-renderizava, e o vídeo continuava mudo. Corrigido no feed de
Exportações e no preview do Editor: o `muted` passa a ser aplicado na
PROPRIEDADE do elemento, por efeito. É a armadilha clássica do `<video>` em
React e não aparece em teste de unidade — só na tela.

### Hashtags por IA (pedido: "mais 2, virais")

Botão "✨ +2 com IA" em cada vídeo e "✨ +2 em todos (N)" para a lista inteira,
na página de Exportações. Uma chamada por vídeo; vídeo que já tem sugestão é
pulado (não gasta chamada), e "↻ Outras 2" refaz quando o usuário pede.

**O limite dito com honestidade, na tela e no prompt:** ninguém sabe de
antemão quais hashtags dão visualização — nem o modelo. O que se pede é
hashtag ESPECÍFICA, que classifica o conteúdo e leva o vídeo a quem procura
aquilo. Hashtag de volume (#viral, #fyp, #parati) é **recusada pelo
validador**, não só desaconselhada no prompt: ela mistura o vídeo com qualquer
assunto e não traz alcance (mesma regra do kit de publicação, §documentada em
`publishKitSystemPrompt`). O validador também impede repetir as que o vídeo já
tem — o modelo foi instruído, mas nada o obriga.

Na tela, as da IA aparecem em **verde**, separadas das capturadas pela
extensão, com o motivo no título: sugestão e fato observado não se misturam.

Guardadas em `video_hashtags.ia_json` (coluna nova, com migração em `db.ts`).
Cota esgotada ou credencial recusada **interrompem o lote** em vez de repetir o
erro em 98 vídeos.

Verificado: typecheck, 452/452 (13 novos em `tests/hashtagsIa.test.ts`).
**Não verificado:** uma chamada real ao modelo com este prompt — a qualidade
das hashtags ainda não foi vista; as telas; o build.

## 37. Legenda em japonês na página de Exportações (2026-09-30)

Pedido do usuário: gerar também uma legenda em japonês para cada vídeo, no
formato que ele trouxe (exemplos reais), sempre aberta pela hashtag `#tvアニメ`,
com a opção de desligar em Configurações.

- `publish.japaneseCaption` (ligada por padrão) e `publish.japaneseHashtag`
  (`#tvアニメ`, editável) em Configurações.
- `japaneseCaptionSystemPrompt`: os dois formatos dos exemplos — mistério curto
  e anúncio de revelação (`『tema』…ついに解禁!!`).
- `validateJapaneseCaption` confere o que o prompt não garante: que a resposta
  **veio mesmo em japonês** (kana/kanji — um modelo pode responder em
  português e a legenda perderia a razão de ser) e que a **hashtag abre o
  texto**, sem duplicar quando o modelo já a colocou.
- Guardada em `video_jp_captions` (tabela nova), separada de `publish_kits`:
  aquele é o kit em português, com outro prompt.
- Com a opção ligada, cada "gerar" faz **2 chamadas por vídeo**. Quem já tem
  hashtags mas não tem a legenda **não é pulado** (senão ligar a opção depois
  nunca geraria nada), e as hashtags não são refeitas à toa.

**O limite dito ao usuário, e na tela:** a hashtag é de anime japonês. Num
corte que não é anime ela classifica o vídeo como outra coisa, e hashtag fora
do assunto pode reduzir o alcance em vez de aumentar — é o contrário da regra
que o próprio projeto segue no kit de publicação. A escolha é do usuário; o
sistema não promete resultado.

### Correção do áudio (§36) conferida no arquivo

O MP4 do usuário tem áudio (−15,3 LUFS); o mudo era do player, por `muted` ser
atributo no React. Ver §36.

Verificado: typecheck, 461/461 (22 em `tests/hashtagsIa.test.ts`, incluindo
ligar a opção depois e o caso de resposta em português). **Não verificado:**
uma chamada real ao modelo — a qualidade do japonês não foi vista; as telas; o
build.

## 38. Revisão da documentação a partir dos dados (2026-09-30, fim do dia)

Pedido do usuário: "salve tudo na documentação". A revisão partiu do banco, não
do que os .md diziam — o mesmo método da §20.

### O que os dados mostraram, e os docs não

| Fato (banco, 2026-09-30) | O que estava escrito |
| --- | --- |
| 98 vídeos, 97 com fala transcrita | "7 vídeos" (§5.2 do HANDOFF, de 29/09) |
| 26.704 comentários em 98 vídeos; fila com 98 pedidos `done` | "a fila nunca funcionou" |
| Gemini com 38 chamadas ok, 9 reaproveitadas, 7 erros | "nenhuma chamada real ao Google" |
| Hashtags por IA e legenda japonesa geradas em 2 vídeos | "não verificado" |
| 98 vídeos com efeitos, 97 com recorte, 4 exportações prontas | — |

**A fila de captura de comentários funcionou** depois de o usuário recarregar a
extensão: é a confirmação que faltava desde a §20.

**As duas gerações de IA do dia foram conferidas no conteúdo**, não só no
status: num corte de viagem no tempo saíram `#maquinadotempo` e
`#ficcaocientifica`; num de atirador, `#atiradordeelite` e `#suspense`. As
legendas japonesas seguiram o formato dos exemplos do usuário (hashtag, gancho
com emoji, corpo, convite a ver até o fim), em ~1,2 s cada.

### O que foi reescrito

- `HANDOFF.md`: três fases (a de Exportações entrou), §4 "O que funciona" com
  os números reais, mapa do código com os arquivos novos, e o §9 refeito — uma
  tabela do que cada entrega do dia tem de prova e o que falta conferir na tela.
- `README.md`: Gemini na descrição da IA, efeitos, página de Exportações,
  pasta configurável, legenda japonesa, entidades e contagem de testes.
- `ROADMAP.md`: item 0.9 (segundo provedor) e a **Fase 4 — Publicação**, que
  nasceu dos pedidos durante o uso.
- `video-editor/ARCHITECTURE.md`: rotas de `/api/exports`, tabela
  `video_jp_captions`, e as regras de efeitos e da pasta de saída.
- `video-editor/IMPLEMENTATION_PLAN.md`: Fase 12 (página de Exportações).

### A pendência mais cara

**Nada desde `c59d36a` foi commitado** — §23 a §38, mais de 70 arquivos, dois
dias de trabalho só no disco. Está no topo do §9 do HANDOFF.

## 39. "Terminar os N com erro" na Fila (2026-10-01)

Caso real: o usuário mandou os 98 vídeos para "Gerar CTAs" com o Gemini
gratuito. **87 concluíram e 11 pararam com `quota_exhausted`** — a cota diária
do plano gratuito acabou no meio do lote. Para terminar, ele teria de achar os
11 na lista e selecionar um a um.

Agora o bloco "Progresso" mostra, quando há erro:

- quantos pararam **por cota esgotada**, com a instrução de esperar a cota
  renovar (os outros códigos de erro pedem outra ação, por isso são separados);
- o botão **"↻ Terminar os N com erro"**.

Decisões:

- **Quem acha os vídeos é o servidor** (`repo.listFailedVideos`), não o
  navegador: a tela pode estar filtrada, e "os que falharam" tem que ser todos.
- **Cada vídeo volta no MODO em que parou** (`local`, `ai` ou `full`). Um vídeo
  que falhou na parte local não pode, ao ser retomado, passar a gastar chamadas
  de IA que ninguém pediu — mesma regra do "Tentar novamente" individual.
- **Só o último job conta.** `listFailedVideos` desempata por `rowid`, como
  `latestJob` (§32): um vídeo que falhou e já foi retomado não aparece de novo,
  e dois cliques não duplicam nada.
- `QueueOverview` ganhou `failedByCode`, para a tela dizer **por que** pararam.
  "Cota esgotada" se resolve esperando; "arquivo não encontrado", não.

Verificado: typecheck, 466/466 (5 novos em `tests/retomarFalhados.test.ts`,
incluindo o modo preservado e o duplo clique). **Não verificado:** o botão
clicado na tela — depende do build e de a cota do usuário renovar.

## 40. Legenda em português como principal, e o japonês num botão à parte (2026-10-01)

Pedido do usuário: a legenda principal é a **em português**, gerada para o
vídeo; o japonês vira um **botão separado**, para ter as duas e escolher em
qual idioma publicar. E, junto com as 2 hashtags em português, **mais uma em
japonês**, como a que abre a legenda japonesa.

### Como ficou

Dois pacotes, dois botões, **uma chamada cada**:

| Botão | Gera | Guarda |
| --- | --- | --- |
| **Legenda (português)** | legenda + 2 hashtags | `video_captions.pt_text`, `video_hashtags.ia_json` |
| **Legenda (japonês)** | legenda + 1 hashtag japonesa | `video_captions.ja_text`, `video_hashtags.ia_ja_json` |

Cada um tem "para este vídeo" e "em todos (N)". Quem quer só o português não
paga pelo japonês — antes o japonês saía junto, obrigatoriamente.

Hashtags do vídeo: **2 capturadas + 2 em português + 1 em japonês = 5**, que é
exatamente o limite da plataforma (documentado em `publishKitSystemPrompt`).
Na tela elas vêm em cinza (capturadas), verde (IA) e azul (IA em japonês).

### Decisões que não são óbvias

- **A hashtag japonesa tem normalização própria** (`normalizeJapaneseTag`). A
  de português reduz a `[a-z0-9_]` e apagaria kana e kanji inteiros — a
  hashtag sairia vazia. Teste: `# 映画 好きな人と繋がりたい` → `#映画好きな人と繋がりたい`.
- **A legenda em português passa pela mesma regra do kit**: pedido explícito de
  engajamento ("comenta aqui") é recusado, porque faz o conteúdo deixar de ser
  recomendado.
- **A hashtag japonesa repetida da fixa é descartada**: ela já abre a legenda.
- **Gerar um idioma não apaga o outro** (`saveCaptions` grava só o que recebe).

### A migração

`video_jp_captions` virou `video_captions` (as duas línguas). A migração copia
e só então remove a antiga, **numa transação**: ou as legendas sobrevivem
inteiras, ou nada acontece. Cada uma custou uma chamada paga.

Conferida numa **cópia do banco real** (API de backup do SQLite, com o original
aberto só para leitura): as 2 legendas do usuário chegaram inteiras com a
hashtag de cada uma, a tabela antiga saiu, a coluna `ia_ja_json` foi criada, as
2 hashtags em português foram preservadas e o `foreign_key_check` ficou limpo.

Verificado: typecheck, 477/477 (28 em `hashtagsIa.test.ts`, 5 novos em
`migracaoLegendas.test.ts`, que monta um banco no formato antigo e abre pelo
caminho de produção). **Não verificado:** uma chamada real com o prompt novo da
legenda em português, e as telas.
