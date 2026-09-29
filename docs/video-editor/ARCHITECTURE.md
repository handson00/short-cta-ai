# Editor de Vídeos Verticais — Arquitetura

Como o módulo se encaixa no Short CTA AI. Entregável da Fase 0 (§95, §150 da
spec), escrito depois das Fases 1–3 — ele descreve o que **existe**, não um
plano.

Andamento por fase: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md).
Estado geral do projeto: [`../HANDOFF.md`](../HANDOFF.md).

---

## 1. Adaptações da stack de referência

A spec (§6) sugere Tauri + Rust + rusqlite + Zustand. O projeto já existia em
Next.js, e a §7 e a §159 mandam priorizar a arquitetura existente. As trocas:

| Spec | Aqui | Por quê |
| --- | --- | --- |
| Tauri + Rust | Next.js API Routes | O app já é Next.js 15; não há shell desktop |
| IPC | HTTP (`fetch`) | Consequência da anterior |
| rusqlite | better-sqlite3 | Reaproveita o singleton `db()` |
| Zustand | Estado local de React | Módulo isolado; não justifica dependência nova |
| `image` / `imageproc` | FFmpeg + (futuro) análise própria | O wrapper de FFmpeg já existe |
| Paleta própria (§88) | Design system `ink-*` / `accent` | §7: reutilizar o que existe |

Nenhuma dependência nova foi adicionada ao `package.json` pelo módulo.

---

## 2. Camadas

```
Navegador
  /editor  →  EditorShell.tsx   (seleção, painel de recorte)
                 └─ CropOverlay.tsx   (retângulo + handles)
                        │
                        │  lib/editor/crop.ts   (geometria pura, testável)
                        ▼
                     fetch JSON
                        │
Servidor       /api/editor/*   (autenticadas)
                 status · library · crop · import · thumbnail
                        │
                 lib/editorRepo.ts     (acesso ao banco)
                 lib/media/run.ts      (FFmpeg/FFprobe — reaproveitado)
                        ▼
                    SQLite + disco
```

**Regra do projeto que vale aqui:** componente `"use client"` nunca importa de
`repo.ts`, `db.ts` ou `editorRepo.ts` — nem com `import type`. O bundler puxa
o `better-sqlite3` para o cliente e a página quebra em runtime. Tipos que
atravessam a fronteira ficam em `types.ts` ou `viewTypes.ts`.
`lib/editor/crop.ts` é seguro no cliente porque é geometria pura.

---

## 3. Rotas

| Rota | Método | Função |
| --- | --- | --- |
| `/api/editor/status` | GET | FFmpeg, FFprobe e encoders, com teste real de init (§52) |
| `/api/editor/library` | GET | Vídeos já processados na plataforma, com CTA/comentários/hashtags |
| `/api/editor/crop` | GET · POST · DELETE | Recorte por vídeo; POST aceita vários IDs (§72) |
| `/api/editor/import` | POST | Upload manual (fallback) |
| `/api/editor/thumbnail` | GET | Serve thumbnail de import manual |

Todas exigem autenticação. `/api/editor/videos` existe mas **não tem chamador**
— é resíduo, deve ser apagado.

### Fronteira de segurança

O cliente envia o retângulo como quatro números normalizados. O servidor valida
com zod e monta qualquer argumento de FFmpeg por conta própria. Uma string de
filtro vinda do navegador é recusada com 422 (§83, §155).

---

## 4. Banco

Tabelas do módulo, declaradas em `src/lib/schema.ts` com
`CREATE TABLE IF NOT EXISTS`, no mesmo padrão do resto do projeto:

| Tabela | Uso hoje |
| --- | --- |
| `editor_video_crops` | ✅ recorte por vídeo, em fração do quadro |
| `source_profiles` | ❌ criada; entra na Fase 9 |
| `editor_templates` | ❌ criada; entra na Fase 5 |
| `editor_jobs` | ❌ criada; entra na Fase 8 |

A spec §138 pede migrations versionadas. O projeto usa DDL idempotente aplicada
na inicialização — §159 manda priorizar o padrão existente, então o módulo
seguiu esse. Consequência a saber: **não há downgrade**, e mudança destrutiva
de coluna exigiria script manual.

### Por que o recorte é normalizado

`crop_x`, `crop_y`, `crop_w`, `crop_h` são frações de 0 a 1, não pixels (§24).
Isso é o que vai permitir, na Fase 9, que um perfil de origem gravado a partir
de um vídeo 1080×1920 seja aplicado a um 720×1280 da mesma página sem
reconversão. A conversão para pixel acontece só na borda — `toPixels()`, que
arredonda para par porque H.264 em yuv420p recusa lado ímpar.

---

## 5. Onde o módulo toca o resto do app

O editor **não** é uma ilha: a Fase 2 foi redesenhada para consumir a
biblioteca que o pipeline de análise já produz.

- `/api/editor/library` lê `videos`, `user_selections`, `cta_suggestions`,
  `post_comments`, `publish_kits` e `scene_analyses`.
- O player e a thumbnail do painel reutilizam `/api/videos/[id]/media` e
  `/api/videos/[id]/thumb` — vídeos continuam servidos por ID interno, nunca
  por caminho de disco.
- `editor_video_crops.video_id` referencia `videos(id)` com `ON DELETE CASCADE`:
  apagar um vídeo leva o recorte junto.

Ainda não integrado, mas previsto: a análise visual já detecta a região do CTA
fixo (`ctaDetection.ts`), o que pode alimentar o Smart Crop da Fase 4 como
evidência adicional.

---

## 6. O que a arquitetura ainda não resolve

Registrado para ninguém presumir que existe:

- **Não há pipeline de renderização.** Nada monta filter graph nem chama FFmpeg
  para produzir MP4. É a Fase 7.
- **Não há fila do editor.** `editor_jobs` existe e `listPendingEditorJobs()`
  também, mas nenhum worker consome. A fila do pipeline de análise
  (`lib/queue.ts`) é separada e não sabe do editor. Fase 8.
- **O preview mostra o vídeo original.** Os três modos da §12
  (Original / Recorte / Resultado) e o proxy 360p com cache da §41 não existem.
- **Nenhum arquivo é escrito.** O módulo ainda só lê mídia e grava metadados.
  Quando a Fase 7 chegar, vale a §67 (nunca sobrescrever o original) e a §114
  (gravar em `.processing` e renomear no fim).
