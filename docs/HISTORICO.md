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
