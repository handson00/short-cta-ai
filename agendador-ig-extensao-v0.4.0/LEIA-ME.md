# Agendador IG — integração com o Short CTA AI

Extensão do Chrome do usuário que agenda reels no Instagram pela própria página
do Instagram. **Esta cópia é a 0.5.0**: a 0.4.0 original mais o recebimento de
posts da página de Exportações do Short CTA AI (HISTORICO §46).

> A pasta ainda se chama `v0.4.0` de propósito: o Chrome identifica uma
> extensão carregada sem compactação pelo **caminho da pasta**. Renomear a pasta
> cria outra extensão, com outro armazenamento, e os rascunhos somem de vista.

## Não há código-fonte

O painel (`assets/dashboard-*.js`) é React **compilado e minificado**, e o
código-fonte não está no projeto nem em outro lugar da máquina (procurado em
2026-10-02). Por isso a integração **não toca no painel**: ela grava nos mesmos
lugares em que o painel lê, do mesmo jeito que ele grava.

Se o código-fonte aparecer e a extensão for recompilada, os arquivos abaixo
precisam ser levados para o projeto-fonte — a compilação sobrescreve
`background.js` e `manifest.json`.

## O que mudou em relação à 0.4.0

| Arquivo | Mudança |
| --- | --- |
| `manifest.json` | versão 0.5.0; `host_permissions` para `localhost:3000` e `127.0.0.1:3000`; content script `ponte-short-cta.js` nesses dois endereços |
| `background.js` | `importScripts("ponte-horarios.js")` no topo; bloco novo no fim (`ag:receber-do-sistema`). O código original está intacto |
| `ponte-short-cta.js` | **novo** — ponte entre a página do sistema e a extensão |
| `ponte-horarios.js` | **novo** — réplica das regras de horário do painel |
| `content.js`, `dashboard.html`, `assets/` | **inalterados** |

## Como funciona

```
Página de Exportações (localhost:3000)
  │ 1. POST /api/agendador/<jobId>  → post montado + link assinado do vídeo
  │ 2. window.postMessage  ─────────▶ ponte-short-cta.js (roda na página)
  │                                      │ chrome.runtime.sendMessage
  │                                      ▼
  │                                 background.js
  │                                   3. baixa o MP4 pelo link (15 min, um vídeo só)
  │                                   4. guarda no IndexedDB  agendador-ig / videos / <id>
  │                                   5. acrescenta o post em chrome.storage.local["agendador-ig/state"]
  │                                   6. recarrega as abas do painel
  │ ◀────────── resposta ───────────────┘
  │ 7. POST /api/agendador/<jobId>/confirmar  → recibo no banco do sistema
```

O post entra como **`rascunho`**, no **próximo horário livre** da grade
(`settings.times`, a partir de `settings.startDate`, com 20 min de antecedência
e pulando horários já ocupados) — o mesmo que acontece ao importar um vídeo à
mão no painel. **Nada é programado no Instagram** por este caminho: quem
programa continua sendo o painel, quando o usuário clica.

### O post gravado

Os mesmos campos que o painel cria ao importar (`id, fileName, size, mime,
duration, width, height, thumb, caption, hashtags, date, time, status,
createdAt`), mais um campo extra:

```json
"origem": { "app": "short-cta-ai", "exportJobId": "ejb_…", "videoId": "vid_…" }
```

O painel preserva campos que não conhece (ele atualiza posts com
`{...post, ...mudança}`). É o `origem.exportJobId` que impede o mesmo vídeo de
entrar duas vezes: enquanto o post existir no painel (e não estiver
`cancelado`), um novo envio é recusado com o motivo.

### Recusas, todas com motivo na tela do sistema

- o painel está programando posts agora (`status: "agendando"`) — recarregar o
  painel no meio interromperia o envio ao Instagram;
- o vídeo já está no painel;
- o link do vídeo não é do sistema (só `localhost:3000`/`127.0.0.1:3000`, só a
  rota `/api/agendador/video`);
- o download chegou com tamanho diferente do anunciado;
- a página que pediu não é do sistema (o background confere `sender.origin`).

### O painel não sabe que alguém de fora grava

Ele lê o estado uma vez, ao abrir, e depois só grava (não escuta
`storage.onChanged`). Por isso o background recarrega as abas do painel depois
de gravar — e, se uma aba gravou o estado antigo por cima nesse meio-tempo,
repõe o post uma vez (confere 1,5 s depois).

## Regras copiadas do painel

`ponte-horarios.js` reproduz `mm`, `Es`, `Fl`, `pd`, `_r`, `ro`, `Ol`, `fd` e o
estado padrão `Pi` do painel 0.4.0. O sistema reproduz, em
`src/lib/agendadorPost.ts`, a junção legenda + hashtags (`Ns`), a validação de
hashtag (`Dn`) e os limites de 2200 caracteres e 30 hashtags (`Lo`).
**Se o painel mudar essas regras, as cópias precisam mudar junto.** Os testes
estão em `tests/agendador.test.ts`.

## Instalar esta versão

1. `chrome://extensions` → remova (ou desative) o Agendador IG carregado de
   `Downloads\agendador-ig-extensao-v0.4.0`. Duas cópias ativas colocariam dois
   botões "Agendar posts" no Instagram.
2. "Carregar sem compactação" → escolha `E:\short-cta-ai\agendador-ig-extensao-v0.4.0`.
3. Recarregue a aba do Instagram e a página de Exportações do sistema.

Trocar de pasta troca o armazenamento: os rascunhos da instalação antiga não
aparecem na nova. Em 2026-10-02 a antiga tinha 1 rascunho de teste.
