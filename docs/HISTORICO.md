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
