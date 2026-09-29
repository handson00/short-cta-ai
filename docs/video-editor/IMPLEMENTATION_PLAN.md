# Editor de Vídeos Verticais em Massa — Plano e Andamento

Rastreador de fases do módulo, conforme
`EDITOR_VIDEO_VERTICAL_EM_MASSA_MODULO.md` (§96–§105).

**Este arquivo é atualizado ao fim de cada fase concluída.** Antes de marcar uma
fase como pronta, leia §156 da spec: `typecheck`, `tests` e `build` precisam
passar.

Legenda: ✅ pronto e verificado · ⚠️ parcial · ❌ não feito

---

## Situação geral

| Fase | Escopo | Estado |
| --- | --- | --- |
| 0 | Análise + documentação | ✅ 2026-09-28 |
| 1 | Foundation | ✅ 2026-09-27 |
| 2 | Video Library | ✅ redefinida — os vídeos vêm da Fila (2.5); drag & drop deixou de se aplicar |
| 2.5 | Promoção explícita para a edição | ✅ 2026-09-28 |
| 3 | Crop manual | ✅ 2026-09-28 |
| 4 | Smart Crop V1 | ✅ 2026-09-28 |
| 5 | Templates | ✅ 2026-09-28 |
| 6 | Preview (proxy + 3 modos) | ⚠️ parcial — aba Preview feita, proxy não |
| 7 | Exportação MP4 | ✅ 2026-09-28 |
| 8 | Fila de jobs + formato para Reels/TikTok | ✅ 2026-09-28 |
| 8.1 | Revisão e alinhamento do módulo | ✅ 2026-09-29 |
| 9 | Perfis de origem | ❌ |
| 10 | Texto (CTA) e áudio | ✅ 2026-09-29 |

---

## Fase 0 — Análise e documentação · ✅ 2026-09-28

A spec (§162) pedia esta fase **antes** da Fase 1. Ela foi pulada na primeira
implementação: a análise existia, mas registrada em `HISTORICO.md` em vez dos
arquivos que a §148 especifica. Fechada agora, junto com a Fase 3.

Entregue: `ARCHITECTURE.md` e este arquivo.

---

## Fase 1 — Foundation · ✅ 2026-09-27

Módulo, rotas, modelos, integração FFprobe e detecção de FFmpeg.

**Aceite (§96):** usuário consegue abrir o módulo e importar um vídeo. ✅

Nota de crédito: `api/editor/status/route.ts` faz o **teste real de
inicialização** do encoder que a §52 exige, em vez de confiar na lista de
`ffmpeg -encoders`.

---

## Fase 2 — Video Library · ⚠️ parcial

Entregue: importação múltipla, thumbnails, metadados, seleção individual e
"selecionar todos", grade da biblioteca integrada.

**Falta para fechar:**

| Item (§97) | Estado |
| --- | --- |
| Drag & drop | ❌ |
| Remover vídeo da lista | ❌ |
| Aceite: "20 vídeos sem travar a interface" | ❌ não verificado |

Ressalva conhecida: `api/editor/import` percorre os arquivos em série dentro de
uma única requisição HTTP e lê cada vídeo inteiro em `Buffer`. Isso contraria
§73 (não bloquear a UI) e §74 (não carregar vídeo inteiro em RAM). Vale
reescrever quando o upload manual deixar de ser fallback.

---

## Fase 2.5 — Promoção explícita para a edição · ✅ 2026-09-28

Fora da spec original, pedida pelo usuário depois de usar a Fase 3.

### O problema relatado

"Tem alguns vídeos que estão repetidos." Não estavam: o acervo tinha **98
vídeos distintos e a rota devolvia 109 linhas**.

A causa era *fan-out* de `LEFT JOIN`. Cada reanálise insere uma linha nova em
`scene_analyses`, e o `LEFT JOIN` multiplicava o vídeo por quantas análises ele
tivesse. Seis vídeos tinham análise repetida (17 linhas) — exatamente as 11
linhas extras. O vídeo com 6 análises aparecia 6 vezes na grade.

**A lição, que já é a terceira vez neste projeto:** o sintoma na tela
("vídeos duplicados") não era o defeito. Não havia nada duplicado nos dados de
vídeo; a consulta é que os multiplicava.

### A decisão de fluxo

O editor listava **todos** os vídeos do acervo. O usuário pediu que a entrada
na edição fosse explícita: terminar a análise não deve jogar o vídeo na segunda
fase sozinho.

Por que a promoção explícita é melhor do que filtrar por `status = done`:

- O usuário controla o lote. Analisar 98 vídeos não obriga a editar 98.
- É reversível — dá para tirar um vídeo da edição sem apagá-lo do acervo.
- Separa as duas fases de verdade: a Fila é análise, o Editor é produção.
- Um filtro por status mudaria de conteúdo sozinho conforme jobs terminassem,
  no meio de uma sessão de edição.

### Arquivos

| Arquivo | O que mudou |
| --- | --- |
| `src/lib/schema.ts` | Tabela `editor_videos` (roster da fase de edição) |
| `src/lib/editorRepo.ts` | `addVideosToEditor` / `removeVideoFromEditor` / `listEditorVideoIds` |
| `src/app/api/editor/queue/route.ts` | Novo — GET / POST / DELETE da promoção |
| `src/app/api/editor/library/route.ts` | Só vídeos promovidos; **todo agregado virou subconsulta** |
| `src/components/Library.tsx` | Botão "Enviar para edição (N)" na barra de seleção |
| `src/components/editor/EditorShell.tsx` | Estado vazio explicando o fluxo; × para remover da edição |

### Decisões que não são óbvias

- **Nenhum agregado usa `LEFT JOIN`.** Contagem de comentários, hashtags, CTA e
  análise viraram subconsultas correlacionadas. Isso elimina a classe inteira
  do defeito, não só a ocorrência do `scene_analyses`.
- **`INSERT OR IGNORE` + transação.** Mandar o mesmo vídeo duas vezes é gesto
  normal do usuário ("selecionar todos" depois de já ter mandado alguns), não
  erro. A resposta distingue `added` de `alreadyThere` para a interface poder
  dizer a diferença em vez de mentir "98 enviados".
- **Remover da edição não apaga o vídeo.** `DELETE` só tira de `editor_videos`;
  o acervo e a análise ficam intactos.

### Verificação

| O quê | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` | ✅ 156/156 |
| `npm run build` | ✅ |
| Editor vazio quando nada foi promovido | ✅ |
| Vídeo com 6 `scene_analyses` → 1 card | ✅ (era 6) |
| 98 vídeos promovidos → 98 cards | ✅ (era 109) |
| Promover duas vezes não duplica | ✅ `added: 0, alreadyThere: 1` |

**Não verificado:** o botão "Enviar para edição" clicado no navegador.

---

## Fase 3 — Crop manual · ✅ 2026-09-28

**Aceite (§98):** usuário define manualmente o conteúdo útil. ✅

### Arquivos criados

| Arquivo | Função |
| --- | --- |
| `src/lib/editor/crop.ts` | Geometria do recorte: arraste, clamp, conversão fração ↔ pixel |
| `src/components/editor/CropOverlay.tsx` | Retângulo sobre o vídeo, com 8 handles e arraste |
| `src/app/api/editor/crop/route.ts` | GET / POST / DELETE do recorte por vídeo |
| `tests/editorCrop.test.ts` | 14 testes da geometria |

### Arquivos modificados

| Arquivo | O que mudou |
| --- | --- |
| `src/lib/schema.ts` | Tabela `editor_video_crops` (recorte por vídeo, §61) |
| `src/lib/editorRepo.ts` | CRUD de recorte; o arquivo deixou de ser código morto |
| `src/components/editor/EditorShell.tsx` | Painel de recorte, campos numéricos, botões de aplicar |

### Decisões que não são óbvias

- **O recorte é guardado em fração (0..1), não em pixel** (§24). O mesmo valor
  serve a 720×1280 e 1080×1920, e é o que vai permitir que um perfil de origem
  (Fase 9) valha para vídeos de resoluções diferentes.
- **`toPixels()` arredonda para par.** H.264 em yuv420p recusa lado ímpar; um
  recorte de 911 px só falharia na exportação (Fase 7), longe da causa.
- **Os campos numéricos mostram pixels da fonte, não fração.** "x = 84" é
  conferível contra o arquivo; "x = 0,0778" não é.
- **O cliente envia só o retângulo** (§83). A rota recusa qualquer coisa que
  não seja número — uma string `-vf crop=...` devolve 422.
- **`saveVideoCrops()` é transação.** "Aplicar a todos" sobre dezenas de vídeos
  ou grava tudo ou não grava nada: um lote pela metade deixaria o usuário sem
  saber quais vídeos ficaram com o recorte antigo.
- **Resetar volta ao quadro inteiro**, não a um retângulo sugerido. Sugerir um
  recorte sem ter analisado o vídeo seria inventar — isso é trabalho da Fase 4.

### Verificação

| O quê | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` | ✅ 156/156 (14 novos) |
| `npm run build` | ✅ |
| API: gravar, ler de volta, apagar | ✅ via curl |
| API: recorte fora do quadro | ✅ 422 com mensagem específica |
| API: string de filtro FFmpeg no lugar do número | ✅ 422 |
| **Arraste dos handles no navegador** | ❌ **não verificado** |

O último item é importante: a geometria está coberta por testes unitários, mas
ninguém arrastou um handle numa tela ainda. Antes de considerar a fase
entregue de fato, abra `/editor`, selecione um vídeo e confirme que o retângulo
responde ao mouse.

---

## Fase 4 — Smart Crop V1 · ✅ 2026-09-28

**Aceite (§99):** o vídeo central é detectado automaticamente em exemplos com
moldura predominantemente estática. ✅

### Como funciona

A ideia da §16: numa moldura de outra página, o quadro externo fica parado e o
filme no meio muda o tempo todo. Medindo quanto cada pixel varia ao longo dos
frames, a região do conteúdo se separa sozinha.

1. **16 frames** (§14) em tons de cinza, a 180px de largura, pulando o primeiro
   e o último segundo (fade, intro, encerramento).
2. **Variação temporal**: diferença média absoluta entre frames consecutivos.
3. **Projeção** do mapa de movimento em linhas e colunas.
4. **Span**: primeiro e último índice acima de 30% do máximo do perfil.
5. **Confiança** = separação × captura, normalizada em 0–100 (§21, §22).

### Arquivos criados

| Arquivo | Função |
| --- | --- |
| `src/lib/editor/motion.ts` | Detecção pura: variação temporal, projeção, span, confiança |
| `src/lib/editor/smartCrop.ts` | Extração dos frames via FFmpeg |
| `src/app/api/editor/smart-crop/route.ts` | POST, individual ou em lote |
| `tests/editorMotion.test.ts` | 16 testes |

### Desvios da spec, e por quê

| Spec | Aqui | Motivo |
| --- | --- | --- |
| §17 threshold binário + §18 morfologia (closing/opening/dilatação/erosão) | Projeção em linhas/colunas + suavização de janela 3 | A morfologia existe para achar formas arbitrárias. Aqui a forma é sempre um retângulo alinhado aos eixos, e projetar resolve isso com muito menos código e sem biblioteca de imagem |
| §19 detecção de bordas · §20 múltiplos candidatos · §92 consenso | Um único candidato | §142 pede primeira versão determinística e simples; §108 não exige precisão perfeita |
| §14 frames a 270×480 ou 360×640 | 180px de largura | O objetivo é localizar um retângulo, não ler texto |

**Nenhuma dependência nova.** Os frames saem do FFmpeg como
`-f rawvideo -pix_fmt gray` — um byte por pixel, sem cabeçalho — o mesmo truque
que `media/ffmpeg.ts` já usava para o *average hash*. Não há PNG para decodificar
e o projeto não ganhou `sharp` nem `jimp`.

### Decisões que não são óbvias

- **A suavização alarga o retângulo em ~1 pixel de análise por lado, de
  propósito.** Sobrar é invisível no vídeo final; faltar corta conteúdo, que é
  o pior erro que esta detecção pode cometer (§108). Há teste travando isso.
- **O span usa primeiro/último acima do limiar, não a maior sequência
  contígua.** Uma cena escura no meio do corte derruba o movimento por alguns
  instantes, e pegar só o maior trecho contíguo cortaria o conteúdo ao meio.
- **Diferença média absoluta, não variância.** Uma mudança lenta de iluminação
  inflaria a variância do quadro inteiro e apagaria justamente o contraste
  entre moldura parada e conteúdo em movimento.
- **Detectar não aplica** (§22). No individual, a detecção carrega o retângulo
  no editor e mostra a confiança; quem grava é o usuário. Só o lote grava
  direto, porque revisar 30 um a um anularia o ganho — e aí o aviso diz quantos
  saíram com confiança baixa.
- **"Nenhuma moldura detectada" não é erro.** Um vídeo que ocupa o quadro
  inteiro devolve `hasBorder: false` e nada é gravado. Gravar o quadro inteiro
  como "detecção" faria uma não-descoberta parecer resultado.

### Verificação

| O quê | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` | ✅ 172/172 (16 novos) |
| `npm run build` | ✅ |
| Detecção em 3 vídeos reais do acervo | ✅ ~1,6 s por vídeo |

Os três devolveram largura cheia com uma faixa vertical central — a forma
esperada para esse material (corte de filme no meio, texto estático acima e
abaixo). Confiança entre 82 e 85.

**Não verificado:** se o retângulo detectado está visualmente correto sobre a
imagem. A forma é plausível e consistente, mas ninguém conferiu na tela.

### Limitação conhecida

Moldura com elemento animado (logo girando, texto piscando) gera movimento
fora da região do vídeo e alarga o retângulo. A confiança cai junto — é o que
o aviso de "revisar" existe para dizer. O caminho para isso é a Fase 9: um
perfil de origem gravado uma vez vale para todos os vídeos da mesma página.

---

## Fase 5 — Templates · ✅ 2026-09-28

**Aceite (§100):** o usuário consegue inserir o crop no template. ✅

### Arquivos criados

| Arquivo | Função |
| --- | --- |
| `src/lib/editor/template.ts` | Geometria da composição: fit/fill, slot ↔ fração, validação |
| `src/app/api/editor/templates/route.ts` | CRUD + atribuição a vídeos |
| `src/app/api/editor/template-asset/route.ts` | Upload e entrega de fundo/overlay/logo |
| `src/components/editor/TemplatePanel.tsx` | Editor de template com preview da composição |
| `tests/editorTemplate.test.ts` | 16 testes |

### Arquivos modificados

| Arquivo | O que mudou |
| --- | --- |
| `src/lib/env.ts` | `templatesDir` |
| `src/lib/db.ts` | Cria o diretório; migração de `template_id` |
| `src/lib/schema.ts` | `editor_videos.template_id` |
| `src/lib/editorRepo.ts` | `setVideoTemplate`; `deleteEditorTemplate` agora limpa referências |
| `src/app/api/editor/library/route.ts` | Expõe `templateId` |
| `src/components/editor/EditorShell.tsx` | Painel de template, atribuição em lote, badge no card |

### Decisões que não são óbvias

- **A conta de encaixe mora em `template.ts`, fora da interface.** É a mesma
  conta que o preview e a exportação (Fase 7) precisam fazer. Duas
  implementações da mesma composição é a forma mais fácil de o preview mentir
  sobre o resultado final (§86).
- **`croppedAspect()` usa a proporção do recorte, não a do arquivo.** Recortar
  muda a forma do que vai ser encaixado; usar a proporção original deformaria
  o vídeo. Há teste para isso.
- **O slot reusa o `CropOverlay`.** É o mesmo gesto — arrastar um retângulo
  normalizado — então é o mesmo componente, agora sobre o canvas.
- **Upload validado por assinatura de bytes, não por extensão** (§84), e
  gravado com nome gerado pelo servidor. Mesma regra do upload de vídeo.
- **Canvas com lado ímpar é recusado na hora de salvar.** H.264 em yuv420p não
  aceita, e descobrir isso só na exportação seria descobrir longe da causa.

### Um defeito que só o teste end-to-end pegou

Apagar um template deixava os vídeos apontando para ele: a interface mostrava
o selo "Template" num vídeo sem template.

Causa: `editor_videos` já existia no banco, então `template_id` entrou por
`ALTER TABLE ADD COLUMN` — e o SQLite **não cria chave estrangeira por ALTER**.
O `ON DELETE SET NULL` declarado no `CREATE TABLE` nunca existiu naquele banco.

Correção: `deleteEditorTemplate` limpa as referências explicitamente, numa
transação, sem depender da FK. Vale como regra para o módulo: **coluna
adicionada por migração não tem a constraint que o schema declara.**

### Verificação

| O quê | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` | ✅ 188/188 (16 novos) |
| `npm run build` | ✅ |
| Criar template | ✅ |
| Slot fora do canvas | ✅ 422 nomeando a borda |
| Canvas com lado ímpar | ✅ 422 |
| Atribuir a vários vídeos | ✅ `changed: 2` |
| Apagar template zera as referências | ✅ depois da correção |

**Verificado pelo usuário no navegador (2026-09-28):** criou "Meu template 1"
com fundo e logo enviados pela interface, slot em modo FILL. O upload e o
editor funcionam.

---

## Fase 5.1 — Template criado na plataforma · ✅ 2026-09-28

Pedido do usuário depois de usar a Fase 5: poder montar um template do zero,
sem depender de uma imagem pronta, e tirar o import de vídeo do editor.

### O que mudou

| Pedido | Implementação |
| --- | --- |
| "criar um próprio template dentro da plataforma" | `backgroundColor` em hex: dá para montar um template só com cor de fundo, sem imagem nenhuma |
| "colocar uma logo, uma logo fixa" | `logoX/Y/Width/Height` em pixels do canvas, arrastável no preview e editável por campo numérico |
| "quero apenas importar os templates, não precisa importar outras coisas" | Removido o upload manual de vídeo do editor. Os vídeos entram só pela Fila |

### Decisões que não são óbvias

- **A logo reusa o `CropOverlay`, com um seletor "Área do vídeo / Logo".** Dois
  retângulos arrastáveis simultâneos na mesma tela competiriam pelo clique; o
  seletor diz qual está em edição, e os campos numéricos seguem a mesma
  escolha.
- **A validação da logo só roda quando existe imagem de logo.** Um template sem
  logo não pode ser recusado por uma posição de logo que ninguém vai usar.
- **A rota `/api/editor/import` continua no disco**, só sem interface. O pedido
  foi "por enquanto"; manter o backend deixa o retorno barato.
- **Cor de fundo validada como `#RRGGBB` no servidor.** O seletor de cor do
  navegador sempre manda válido, mas a rota não pode depender do cliente.

### Verificação

Typecheck limpo, `npm test` 194/194 (6 novos), build refeito. Pela API: criar
template só com cor e logo (sem imagem), recusar cor malformada, recusar logo
fora do canvas, e aplicar o template a 3 vídeos de uma vez (`changed: 3`).

---

## Fase 7 — Exportação MP4 · ✅ 2026-09-28

**Aceite (§102):** um vídeo pode ser renderizado corretamente. ✅

É a fase que fecha o ciclo: antes dela o módulo preparava tudo e não produzia
arquivo nenhum.

### Arquivos criados

| Arquivo | Função |
| --- | --- |
| `src/lib/editor/filterGraph.ts` | Monta o `filter_complex` (§46, §47) — puro, testável |
| `src/lib/editor/progress.ts` | Lê `-progress pipe:1` (§57) — puro, testável |
| `src/lib/editor/encoder.ts` | Escolhe o encoder com teste real de init (§51–§53) |
| `src/lib/editor/export.ts` | Roda o FFmpeg, arquivo parcial, cancelamento |
| `src/app/api/editor/export/route.ts` | POST exporta, DELETE cancela |
| `tests/editorExport.test.ts` | 21 testes |

### O pipeline

```
[0:v] crop(origem) → scale(encaixe) → crop(slot)          ┐
[1:v] fundo: imagem OU cor sólida via lavfi → scale       ├→ overlay
      overlay (opcional) → logo (opcional)                ┘
      → fps → format=yuv420p → encoder → MP4 +faststart
```

### Decisões que não são óbvias

- **O filter graph é função pura que devolve texto.** Dá para conferir o
  comando num teste sem rodar o FFmpeg, e nenhuma string do navegador entra
  nele: os argumentos vão em array, nunca linha de shell (§45, §83).
- **Grava em `.processing` e renomeia no fim** (§114). Um cancelamento nunca
  deixa um MP4 truncado com cara de pronto.
- **O nome de saída nunca sobrescreve** (§110): `_editado`, `_editado_2`… Se o
  usuário ajustou o template e rodou de novo, ainda pode comparar.
- **Encoder pedido explicitamente que não funciona não cai para CPU em
  silêncio.** Trocar por baixo faria a exportação demorar dez vezes mais sem
  explicação. Só `auto` desce a lista.
- **Exportação sequencial** (§56): vinte FFmpegs ao mesmo tempo deixariam a
  máquina inutilizável, e cada um mais lento do que todos em fila.
- **O parser de progresso corta por `/\r?\n/`.** Não é zelo: foi um `\r` não
  tratado na saída do Tesseract que manteve o OCR deste projeto "quebrado" por
  dois dias. Há teste com CRLF.

### Dois defeitos que os testes e o teste real pegaram

**1. `toPixels` devolvia lado ímpar.** Arredondava para par e *depois* limitava
ao tamanho da fonte — com fonte de lado ímpar, o `Math.min` desfazia o
arredondamento. O H.264 recusaria, mas só na exportação, longe da causa.
Corrigido com `evenUp`/`evenDown`: o limite também precisa ser par.

**2. `.processing` quebrava o FFmpeg.** Ele deduz o container pela extensão e
recusava `arquivo.mp4.processing`. Corrigido com `-f mp4` explícito, mantendo
a proteção do §114.

### Verificação

| O quê | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` | ✅ 219/219 (21 novos) |
| `npm run build` | ✅ |
| **Render de um vídeo real de 92 s** | ✅ 13,5 s com `h264_qsv` |
| Saída conferida no `ffprobe` | ✅ H.264 · 1080×1920 · yuv420p · 30 fps · AAC |
| Composição conferida num frame extraído | ✅ vídeo no slot, logo aplicada |
| Nenhum `.processing` sobrando | ✅ |

O encoder foi escolhido sozinho: `h264_qsv` (Intel Quick Sync), ~7× tempo real.

### O que ficou para a Fase 8

A exportação em lote roda dentro da requisição HTTP. Para dezenas de vídeos
isso precisa virar fila com estado persistido — a tabela `editor_jobs` já
recebe status e progresso, falta o worker que a consome.

---

## Fase 7.1 — Logo deformada e aba de Preview · ✅ 2026-09-28

Relatado pelo usuário depois do primeiro render real: "a logo saiu muito
esticada", e o pedido de uma aba para ver o resultado **antes** de exportar.

### O defeito da logo

O filter graph fazia `scale=240:240`, que força as duas dimensões e deforma
qualquer logo que não seja quadrada. Uma logo larga esticava para preencher a
altura da caixa.

O preview do template, porém, já estava **certo**: usava `object-contain`, que
cabe a imagem na caixa sem deformar. Ou seja, preview e exportação discordavam
— exatamente o que a §86 manda evitar.

Correção no `filterGraph.ts`:

```
scale=LW:LH:force_original_aspect_ratio=decrease
overlay=LX+(LW-overlay_w)/2:LY+(LH-overlay_h)/2
```

A expressão com `overlay_w`/`overlay_h` centraliza a logo na caixa: as
dimensões reais só existem em tempo de execução, porque dependem da proporção
do arquivo enviado.

**Verificado comparando dois renders do mesmo vídeo**, recortando a região da
logo: antes visivelmente esticada na horizontal, depois na proporção correta.

### A aba de Preview

O painel da direita ganhou duas abas: **Recorte** e **Preview**. A de Preview
mostra o vídeo tocando dentro do template, com o recorte já aplicado — o
resultado da exportação, antes de exportar.

Para isso, a composição virou um componente só: `CompositionPreview.tsx`, usado
tanto pelo editor de template quanto pela aba. **Duas telas desenhando a mesma
composição por caminhos diferentes é a forma mais fácil de uma mentir sobre o
resultado** (§86) — e o defeito da logo acabou de mostrar o custo disso.

O `TemplatePanel` perdeu ~70 linhas de composição duplicada.

### O que isto não é

Não é o proxy 360p com cache da §41. A composição é montada no DOM, então é
instantânea e permite tocar o vídeo — mas quem renderiza é o navegador, não o
FFmpeg. Diferenças de reamostragem entre os dois são possíveis; a geometria,
que é o que importa aqui, vem da mesma função.

### Verificação

Typecheck limpo, 219/219 testes, build refeito. Render real conferido em frame
extraído, antes e depois.

**Não verificado:** a aba Preview na tela.

---

## Fase 8 — Fila de exportação e formato para Reels/TikTok · ✅ 2026-09-28

**Aceite (§103):** vários vídeos são processados com concorrência controlada. ✅

Pedido do usuário: exportar em massa, rápido, e no melhor formato para
TikTok e Instagram.

### Arquivos

| Arquivo | Função |
| --- | --- |
| `src/lib/editor/exportQueue.ts` | Worker: claim, concorrência, cancelamento, retomada |
| `src/lib/editor/exportPreset.ts` | Preset de saída para Reels/TikTok — puro, testável |
| `src/components/editor/ExportQueuePanel.tsx` | Progresso do lote e de cada vídeo, cancelar, ETA |
| `src/app/api/editor/export/route.ts` | Agora só enfileira e responde na hora |
| `src/lib/editorRepo.ts` | `claimNextEditorJob` e demais funções da fila |
| `src/instrumentation.ts` | Sobe a fila junto com o servidor |
| `tests/editorPreset.test.ts` | 20 testes do contrato de formato |

### Velocidade

- **A requisição não renderiza mais.** Enfileira e volta em ~0,3 s; antes
  prendia a conexão pelo lote inteiro e estourava o timeout com 30 vídeos.
- **Concorrência pelo tipo de encoder.** GPU (QSV/NVENC/AMF) tem circuito
  dedicado: 2 em paralelo quase dobram a vazão. O `libx264` já usa todos os
  núcleos sozinho, então fica em 1 — dois só disputariam a mesma CPU.
  Ajustável por `EDITOR_EXPORT_CONCURRENCY` (1 a 4).
- **Medido:** 3 vídeos (~4,5 min de conteúdo) em 42 s com `h264_qsv`, 2 em
  paralelo. ~6,5× tempo real.

### O formato

As plataformas recomprimem tudo que recebem; o arquivo exportado é a
matéria-prima dessa recompressão. O preset mira qualidade alta e
compatibilidade máxima, não tamanho mínimo.

| Parâmetro | Valor | Por quê |
| --- | --- | --- |
| Vídeo | H.264 High @ 4.1, yuv420p | Todo celular decodifica |
| Resolução | 1080×1920, 30 fps constante | 9:16; VFR dessincroniza áudio na recompressão |
| Bitrate | ~10 Mbps, teto 12 Mbps | Acima disso não sobra ganho visível após a recompressão |
| Keyframe | a cada 2 s | Regular para o corte e o seek da plataforma |
| Cor | BT.709 marcada em cada frame | Sem a tag, alguns celulares mostram lavado |
| Áudio | AAC-LC 192 kbps, 48 kHz, estéreo | |
| Container | MP4 com `+faststart` | O processamento começa antes do upload terminar |

Os valores são escolha de engenharia sobre o que as plataformas publicam.
Revise se as recomendações delas mudarem.

### Três defeitos que só o teste real pegou

**1. Cópias separadas do módulo no Next.js.** O `instrumentation` e as rotas
de API carregam cada um sua cópia de `exportQueue.ts` e `export.ts`. O worker
rodava numa cópia; a rota consultava outra, vazia. Sintomas: a API mostrava
`encoder: null, concurrency: 1` e **o cancelamento devolvia `false` com o
render seguindo até o fim**. Corrigido guardando o estado em `globalThis`,
compartilhado entre as cópias.

**2. Cor sem tag no QSV.** As flags `-color_primaries`/`-color_trc` de saída
não chegavam ao bitstream: o `ffprobe` mostrava `unknown`. Corrigido marcando a
cor em cada frame com `setparams` no filter graph.

**3. Nível 4.0 em vez de 4.1.** O QSV lê o nível pela opção genérica do FFmpeg,
que é inteira: `4.1` virava 4. Corrigido passando `41`, conferido no QSV e no
libx264.

### Outros detalhes

- **Claim atômico:** ler o próximo job e marcá-lo como `processing` numa
  transação, para nunca renderizar o mesmo vídeo duas vezes.
- **Nome de saída reservado na hora:** com exports em paralelo, dois jobs do
  mesmo vídeo escolheriam o mesmo nome. O `.processing` é criado vazio no
  momento da escolha e conta como ocupado.
- **Retomada (§112):** ao subir, jobs em `processing` voltam para `pending` e
  `.processing` órfãos são apagados — só na pasta de saída, só essa extensão.
- **Progresso gravado só quando o inteiro muda:** o FFmpeg manda várias linhas
  por segundo.
- **Progresso não ressuscita job cancelado:** a atualização só vale para quem
  ainda está em `processing`.
- **Corrigido de passagem:** `updateEditorJobStatus` tinha o `COALESCE` de
  `started_at` invertido e reescrevia a hora de início a cada atualização.

### Verificação

| O quê | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ exit 0 |
| `npm test` | ✅ 239/239 (20 novos) |
| Enfileirar responde na hora | ✅ ~0,3 s |
| 2 em paralelo, o 3º entra quando abre vaga | ✅ |
| Cancelar job em andamento | ✅ depois da correção do `globalThis` |
| Nenhum `.processing` após cancelar | ✅ |
| `ffprobe` da saída | ✅ High · 1080×1920 · 30/1 CFR · ~10 Mbps · AAC-LC 48 kHz estéreo · moov no início |

---

## Fase 8.1 — Revisão e alinhamento · ✅ 2026-09-29

Revisão do módulo inteiro contra o uso real, pedida pelo usuário depois da
Fase 8. Detalhes e motivos no `HISTORICO.md`, §20.

### Defeitos corrigidos

| Defeito | Efeito para o usuário | Correção |
| --- | --- | --- |
| A exportação usava o template aberto no painel para o lote inteiro | O template **aplicado** a cada vídeo era ignorado em silêncio | `enqueueExports` resolve o template por vídeo; o do painel só vale para quem não tem. A aba Preview segue a mesma regra |
| A detecção em lote mandava todos os vídeos num pedido só | "Selecionar todos" com mais de 50 vídeos dava erro; sem progresso | Pacotes de 10, com "Analisando 20 de 98…" |
| Template editado e não salvo | A exportação usava a versão antiga sem aviso | Selo "alterações não salvas"; aviso de recorte não aplicado na aba Preview |
| Cache de encoder por cópia de módulo | Cada contexto testava os encoders de novo | Cache no `globalThis`; a rota de status reusa o teste da fila |

### Limpeza

- Removidos: a rota `/api/editor/videos` (sem chamador) e as funções de job que
  a fila substituiu (`listPendingEditorJobs`, `listEditorJobsByVideo`,
  `deleteEditorJob`).
- Arquivos de teste que eu havia gerado em `data/output/` e os jobs deles foram
  apagados; os exportados pelo usuário ficaram.

### Testes

`tests/editorJobs.test.ts` (13): claim atômico, hora de início preservada,
progresso que não ressuscita job cancelado, retomada após reinício, regra do
template por vídeo, nome de saída. O teste da hora de início foi conferido
contra o defeito original: reintroduzido o `COALESCE` invertido, ele falha.

### Verificação

| O quê | Resultado |
| --- | --- |
| `npm run typecheck` | ✅ |
| `npm test` | ✅ 259/259 |
| `npm run build` | ✅ |
| Exportação pelo caminho real, conferida no `ffprobe` | ✅ nível 4.1; primaries, transfer e colorspace BT.709 |
| Template do painel "pronto" × vídeo com "novo" aplicado | ✅ o job saiu com "novo" |

---

## Fase 10 — Texto (CTA) e áudio · ✅ 2026-09-29

**Aceite (§105):** texto, CTA, áudio, música, volume e mixagem. ✅

É a fase que junta as duas metades do produto: a análise gera o CTA, e agora
ele sai **desenhado sobre o vídeo exportado**.

### A decisão central: o texto é desenhado pelo navegador

A spec (§34) oferece `drawtext`, libass ou "gerar layer PNG temporária", e manda
priorizar a consistência entre preview e exportação. O caminho escolhido foi o
PNG desenhado **no navegador**, pela mesma função (`drawTextLayer`) que desenha
o preview:

| `drawtext` do FFmpeg | Camada PNG do navegador |
| --- | --- |
| Fonte do FFmpeg ≠ fonte do navegador: as linhas quebram em lugares diferentes | Mesma fonte, mesma quebra — o PNG é o preview |
| Não desenha emoji colorido — e os CTAs gerados usam emoji ("⚠️ A SORTE…") | Emoji sai como na tela |
| Não quebra linha sozinho | `layoutText` quebra e diminui a fonte até caber |
| Escape de `:`, `'`, `%`, `\` notoriamente traiçoeiro | Nenhum texto entra no comando do FFmpeg |

Ao exportar, o navegador desenha a camada de cada vídeo, envia
(`/api/editor/text-layer`) e só então enfileira; o job guarda o nome da camada,
como já guardava o recorte.

### O que entrou

- **Estilo no template:** caixa arrastável (terceiro alvo do seletor, ao lado de
  vídeo e logo), fonte do sistema ou TTF/OTF enviada, negrito, maiúsculas,
  alinhamento, tamanho máximo e mínimo (a fonte encolhe até caber), entrelinha,
  cor, contorno, faixa atrás do texto, e janela de exibição com fade de entrada
  e de saída (§35).
- **Conteúdo por vídeo:** o CTA da análise pela mesma regra da Fila (editado →
  escolhido), com a recomendação como último recurso e a origem indicada na
  tela. Na aba Preview dá para trocar o texto de um vídeo sem mexer na escolha
  da Fila.
- **Áudio (§36-§37):** original, mudo, substituir pela música ou misturar, com
  volume de cada um (0–200 %). A música entra em loop e é cortada no fim do
  vídeo.
- **Upload de assets** passou a aceitar fontes e músicas, reconhecidas pelos
  bytes; o campo diz o que espera, e uma música enviada no lugar da logo é
  recusada. A música é conferida com `ffprobe` antes de ser aceita.

### Dois defeitos antigos que os testes desta fase acharam

**1. Vídeo sem áudio nunca terminava de exportar.** Um overlay só termina quando
todas as entradas terminam, e o fundo (cor ou imagem) nunca termina. Nos vídeos
com áudio, o `-shortest` sobre o áudio disfarçava. Medido: um clipe de 4 s sem
áudio foi morto por timeout aos 25 s. O modo "mudo" desta fase teria disparado
isso em **todos** os vídeos. Correção: toda imagem entra em loop, todo overlay
usa `shortest=1`, e o vídeo é a única fonte finita.

**2. 23 dos 98 vídeos saíam com a cor errada.** Eles vêm em BT.601; a Fase 8
passou a *etiquetar* a saída como BT.709 sem *converter* os dados. Medido em
barras de cor: verde (14, 222, 4) saía (0, 189, 0), e o fundo vermelho saía
laranja. Correção: cada entrada (vídeo, fundo, overlay, logo, texto) é
convertida para BT.709 antes do overlay. Vídeo sem matriz declarada segue a
convenção dos players (HD = BT.709, abaixo de 720p = BT.601).

### Verificação

| O quê | Resultado |
| --- | --- |
| `npm run typecheck` · `npm run build` | ✅ |
| `npm test` | ✅ 304/304 |
| Renderizador de produção, 4 cenários (sem áudio + mudo; mistura; substituir; sem áudio + original) | ✅ todos terminam no fim do vídeo |
| Texto com janela 0,5–3 s e fades, medido pixel a pixel | ✅ invisível → entra → cheio → sai → invisível |
| Cor: origem BT.601 e BT.709 contra a referência | ✅ verde 12,220,2 nas duas; fundo 251,0,0 |
| Rotas novas pelo app rodando | ✅ texto próprio, upload de camada, recusa de tipo errado |

**Não verificado:** o desenho do texto no navegador (canvas, fontes, emoji), o
arraste da caixa de texto e a exportação completa disparada pela tela. A
mecânica do lado do FFmpeg foi medida com uma camada PNG de teste.

### 10.1 — Texto editável no painel e salvamento automático (2026-09-29)

Pedido do usuário: ao ligar "Mostrar o CTA sobre o vídeo", poder editar o texto
ali mesmo, e toda alteração já ficar salva e aparecer no preview na hora.

- **Campo de texto na seção "Texto (CTA)"** do painel de template, ligado ao
  vídeo aberto. É o mesmo rascunho do campo da aba Preview: os dois ficam em
  sincronia. Vazio = volta ao CTA da análise (mostrado como placeholder).
- **Texto salvo sozinho** 500 ms depois da última tecla. O rascunho guarda de
  qual vídeo é: ao trocar de vídeo há um render com o texto do anterior, e sem
  essa marca o autosave o gravaria no vídeo novo.
- **Template salvo sozinho** 500 ms depois da última alteração. O botão
  "Salvar" saiu; ficou "Criar template" para o template novo, e um indicador
  "salvando… / ✓ salvo / não salvo". O mesmo conteúdo nunca é enviado duas
  vezes seguidas, e erro de validação não tenta de novo em laço — espera a
  próxima alteração.
- **Aba Preview em tempo real:** quando o vídeo usa o template aberto no painel,
  ela desenha o rascunho, sem esperar o salvamento.
- **A exportação espera o salvamento:** com template salvando ou com erro, ela
  recusa e explica. A fila lê o template salvo, e sem isso sairia com a versão
  anterior à que o preview mostrava.

**Não verificado:** o comportamento na tela (digitação, salvamento, preview).

### Limitações conhecidas

- O preview não toca a música.
- O último quadro do vídeo (33 ms) se perde no encerramento pelo `shortest=1`.
- Apagar o texto próprio volta ao CTA; para um vídeo sair **sem** texto, use um
  template sem texto.

---

## Dívidas do módulo

| Item | Onde | Impacto |
| --- | --- | --- |
| `/api/editor/import` sem interface desde a Fase 5.1 | `src/app/api/editor/import/route.ts` | Baixo — mantida de propósito; o pedido foi "por enquanto" |
| Import manual carrega o vídeo inteiro em RAM | `src/app/api/editor/import/route.ts` | Médio — corrigir antes de religar a interface |
| `source_profiles` e seu CRUD sem uso | `schema.ts`, `editorRepo.ts` | Baixo — base da Fase 9 |
| Sem teste de interface | — | Médio — geometria, fila e formato têm teste; arrastar, clicar e tocar vídeo só foram conferidos pelo usuário |
