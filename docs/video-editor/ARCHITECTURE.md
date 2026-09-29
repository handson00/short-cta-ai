# Editor de Vídeos Verticais — Arquitetura

Como o módulo se encaixa no Short CTA AI, em 2026-09-29. Descreve o que
**existe**, não um plano.

Andamento por fase: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
Estado geral do projeto: [`../HANDOFF.md`](../HANDOFF.md).

---

## 1. Adaptações da stack de referência

A spec (§6) sugere Tauri + Rust + rusqlite + Zustand. O projeto já existia em
Next.js, e a §7 e a §159 mandam priorizar a arquitetura existente.

| Spec | Aqui | Por quê |
| --- | --- | --- |
| Tauri + Rust | Next.js API Routes | O app já é Next.js 15; não há shell desktop |
| IPC | HTTP (`fetch`) | Consequência da anterior |
| rusqlite | better-sqlite3 | Reaproveita o singleton `db()` |
| Zustand | Estado local de React | Módulo isolado; não justifica dependência nova |
| `image` / `imageproc` | FFmpeg com saída `rawvideo`/`gray` | Lê pixels sem biblioteca de imagem |
| Paleta própria (§88) | Design system `ink-*` / `accent` | §7: reutilizar o que existe |

**Nenhuma dependência nova** foi adicionada ao `package.json` pelo módulo.

---

## 2. Fluxo

```
Fila (análise) ──"Enviar para edição"──▶ editor_videos
                                            │
   /editor ── recorte manual / Smart Crop ──▶ editor_video_crops
          ── template (fundo, logo, slot) ──▶ editor_templates
          ── "Aplicar template" ────────────▶ editor_videos.template_id
          ── texto próprio (opcional) ──────▶ editor_video_texts
          ── aba Preview (mesma composição da exportação)
          ── "Exportar": o navegador desenha a camada de texto de cada vídeo
             ─▶ /api/editor/text-layer ─▶ editor_jobs  (fila)
                                            │
                          worker no processo do servidor
                          FFmpeg: filter graph + preset Reels/TikTok
                                            │
                                   data/output/<nome>_editado.mp4
```

---

## 3. Camadas

```
Navegador
  /editor → EditorShell.tsx
              ├─ TemplatePanel.tsx      (coluna esquerda: template)
              ├─ grade dos vídeos       (centro: seleção, lote)
              ├─ aba Recorte / Preview  (coluna direita)
              │     ├─ CropOverlay.tsx         retângulo + handles
              │     └─ CompositionPreview.tsx  a mesma composição da exportação
              └─ ExportQueuePanel.tsx   (progresso do lote)
                        │  fetch JSON
Servidor   /api/editor/*  (todas autenticadas)
                        │
           lib/editor/   crop · motion · template · textLayout ·
                         filterGraph · exportPreset · progress ·
                         assets · encoder                      ← funções puras
                         smartCrop · export · exportQueue      ← chamam FFmpeg
           components/editor/textCanvas.ts  ← desenha o texto (preview E exportação)
           lib/editorRepo.ts                                   ← banco
                        ▼
                  SQLite + disco
```

A parte pura (`crop`, `motion`, `template`, `filterGraph`, `exportPreset`,
`progress`) não chama FFmpeg nem lê disco: recebe números, devolve números ou
texto. É o que permite testar a geometria, a detecção e o comando do FFmpeg
sem vídeo.

### Duas regras que já quebraram a aplicação

- **Componente `"use client"` nunca importa de `repo.ts`, `db.ts` ou
  `editorRepo.ts`** — nem com `import type`. O bundler puxa o `better-sqlite3`
  para o navegador. `lib/editor/crop.ts` e `template.ts` são seguros no cliente
  porque são geometria pura; o tipo de job da fila é declarado no próprio
  `ExportQueuePanel.tsx`.
- **Estado em memória compartilhado vai no `globalThis`.** O Next.js carrega
  uma cópia de cada módulo para o `instrumentation.ts` (onde o worker roda) e
  outra para as rotas. A fila (`exportQueue.ts`), os FFmpegs em andamento
  (`export.ts`) e o cache de encoder (`encoder.ts`) guardam seu estado em
  `globalThis.__editor*`. Com variável solta de módulo, o cancelamento
  respondia "não cancelado" e o render seguia até o fim.

---

## 4. Rotas

| Rota | Método | Função |
| --- | --- | --- |
| `/api/editor/status` | GET | FFmpeg, FFprobe e encoders, com teste real de init (§52) |
| `/api/editor/queue` | GET · POST · DELETE | Vídeos na fase de edição (promover, remover) |
| `/api/editor/library` | GET | Os vídeos promovidos, com CTA, comentários, recorte e template |
| `/api/editor/crop` | GET · POST · DELETE | Recorte por vídeo; POST aceita vários IDs (§72) |
| `/api/editor/smart-crop` | POST | Detecção automática; até 50 vídeos por chamada |
| `/api/editor/templates` | GET · POST · PUT · DELETE | CRUD de templates; POST com `videoIds` aplica a vídeos |
| `/api/editor/template-asset` | GET · POST | Envio e entrega de imagens, fontes (TTF/OTF) e músicas; o campo `expect` recusa o tipo errado |
| `/api/editor/text` | PUT | Texto próprio de um vídeo (vazio volta ao CTA da análise) |
| `/api/editor/text-layer` | POST | Recebe a camada de texto que o navegador desenhou (PNG) |
| `/api/editor/export` | GET · POST · DELETE | Estado da fila, enfileirar, cancelar/limpar |
| `/api/editor/import` | POST | Upload manual — **sem interface desde a Fase 5.1**, mantido de propósito |
| `/api/editor/thumbnail` | GET | Miniatura do upload manual |

### Fronteira de segurança

- O cliente manda retângulos como números normalizados. O servidor valida com
  zod e monta os argumentos do FFmpeg sozinho, sempre em array, nunca linha de
  shell. Uma string de filtro vinda do navegador é recusada com 422 (§83).
- Imagens de template são validadas pelos primeiros bytes (PNG, JPG, WebP), não
  pela extensão, e gravadas com nome gerado pelo servidor.
- Arquivos só são servidos por `path.basename` dentro da pasta gerenciada:
  `../` não sai dela.

---

## 5. Banco

Declarado em `src/lib/schema.ts` com `CREATE TABLE IF NOT EXISTS`; colunas
adicionadas depois migram em `src/lib/db.ts`.

| Tabela | Uso |
| --- | --- |
| `editor_videos` | Vídeos promovidos para a edição; `template_id` é o template aplicado |
| `editor_video_crops` | Recorte por vídeo, em fração do quadro; `source` = manual ou auto |
| `editor_templates` | Templates; a configuração inteira em `config_json` |
| `editor_jobs` | Fila de exportação: status, progresso, arquivo de saída, erro; a camada de texto fica em `export_json.textLayer` |
| `editor_video_texts` | Texto próprio do vídeo no editor; sem linha, vale o CTA da análise |
| `source_profiles` | ❌ criada, sem uso — entra na Fase 9 |

A spec §138 pede migrations versionadas. O projeto usa DDL idempotente aplicada
na inicialização (§159: priorizar o padrão existente). Consequências a saber:
**não há downgrade**, e `ALTER TABLE ADD COLUMN` no SQLite **não cria chave
estrangeira** — por isso `deleteEditorTemplate` limpa as referências em
`editor_videos` explicitamente, em vez de confiar no `ON DELETE SET NULL`.

### Por que recorte e slot são normalizados

Frações de 0 a 1, não pixels (§24): o mesmo recorte vale para 720×1280 e
1080×1920. A conversão para pixel acontece só na borda — `toPixels()` e
`slotFromNormalized()` — e arredonda para par, porque H.264 em yuv420p recusa
lado ímpar e o erro só apareceria na exportação.

---

## 6. Regras de negócio que atravessam as camadas

**Qual template um vídeo usa.** O template **aplicado** ao vídeo
(`editor_videos.template_id`); o template aberto no painel só vale para vídeos
sem nenhum. A mesma regra vale na exportação (`enqueueExports`), na aba Preview
e no aviso depois de exportar, que diz quantos vídeos saíram com cada template.

**O que a exportação lê.** O recorte **salvo** (fotografado ao enfileirar) e o
template **salvo** (lido ao renderizar). A tela avisa quando há recorte ajustado
e não aplicado, ou template com alterações não salvas.

**O que o preview mostra é o que sai.** A conta de encaixe (`placeVideoInSlot`,
`cropRegionTransform`) mora em `template.ts` e o desenho num componente só,
`CompositionPreview`, usado pelo editor de template e pela aba Preview. A logo
cabe na caixa sem deformar dos dois lados: `object-contain` no navegador,
`force_original_aspect_ratio=decrease` no FFmpeg.

**Qual texto vai sobre o vídeo.** O texto próprio definido no editor; senão o CTA
pela regra da Fila (`view.ts`): editado, senão escolhido; a recomendação da
análise só por último, e a tela diz a origem.

**Texto é imagem, não comando.** `drawTextLayer` desenha num canvas — é o
preview, e o mesmo desenho vira o PNG da exportação. O FFmpeg só sobrepõe a
imagem (`overlay` com `enable='between(...)'` e `fade` no alfa). Mesma fonte,
mesma quebra de linha e emoji dos dois lados; nenhum texto do usuário entra no
comando do FFmpeg.

**Cor: converter, não só etiquetar.** Cada entrada (vídeo, fundo, overlay, logo,
texto) passa por `scale=...:out_color_matrix=bt709:out_range=tv` e é etiquetada
em seguida. 23 dos 98 vídeos do acervo são BT.601; só etiquetar a saída fazia o
filme sair com a cor desviada. Origem sem matriz declarada: HD = BT.709, abaixo
de 720p = BT.601 (a convenção dos players).

**Duração: o vídeo é a única fonte finita.** Toda imagem entra com `-loop 1`, a
música com `-stream_loop -1` e `atrim` pela duração, e todo overlay usa
`shortest=1`. Sem isso, um vídeo sem áudio exportava para sempre.

---

## 7. Exportação

- **Fila persistida** em `editor_jobs`, consumida por um worker que sobe com o
  servidor (`instrumentation.ts`). O POST só enfileira e responde na hora.
- **Claim atômico** numa transação: dois workers nunca pegam o mesmo job.
- **Concorrência pelo encoder:** 2 com GPU (NVENC/QSV/AMF), 1 com `libx264`.
  Ajustável por `EDITOR_EXPORT_CONCURRENCY` (1 a 4).
- **Arquivo parcial:** grava em `<nome>.processing` e renomeia no fim (§114). O
  nome é reservado na hora da escolha, para dois jobs do mesmo vídeo não
  colidirem, e nunca sobrescreve uma saída anterior (§110).
- **Cancelamento** mata o FFmpeg e apaga o parcial; **reinício** devolve os jobs
  interrompidos à fila e apaga parciais órfãos (§112).
- **Formato:** preset único em `exportPreset.ts` — H.264 High@4.1, 1080×1920,
  30 fps constante, ~10 Mbps (teto 12), GOP de 2 s, cor convertida para BT.709
  (§6), AAC-LC 192 kbps 48 kHz estéreo, MP4 com `+faststart`.
- **Áudio (§36):** original, mudo, substituir pela música ou misturar
  (`amix` com `normalize=0`, para o volume configurado ser o que sai).

---

## 8. O que a arquitetura ainda não resolve

- **Proxy de preview** (§41): a aba Preview compõe no navegador. A geometria é a
  mesma da exportação; a reamostragem de imagem é a do navegador, não a do
  FFmpeg.
- **Perfis de origem** (Fase 9): gravar o recorte de uma página e reaplicar.
- **Música no preview:** a aba Preview toca o vídeo mudo; a música só existe no
  arquivo exportado.
