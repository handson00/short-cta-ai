# Coletor de Comentarios TikTok

Extensao Chrome (Manifest V3) que captura os comentarios, as respostas e as
hashtags do video do TikTok aberto na aba atual. Tudo roda no seu navegador,
com a sua propria sessao logada. Nada e enviado para nenhum servidor.

## Instalacao

1. Descompacte a pasta em um lugar fixo do computador.
2. Abra `chrome://extensions`.
3. Ative o **Modo do desenvolvedor** (canto superior direito).
4. Clique em **Carregar sem compactacao** e selecione esta pasta.
5. Fixe a extensao na barra (icone do quebra-cabeca -> alfinete).

## Uso

1. Abra a pagina de um video: `https://www.tiktok.com/@perfil/video/123...`
2. Clique no icone da extensao.
3. Ajuste as opcoes:
   - **Maximo de comentarios**: digite o numero ou use os atalhos
     **20 / 50 / 100 / 300 / Tudo** (Tudo = teto de 5000). A coleta para
     exatamente nesse numero.
   - **Incluir as respostas** e **Respostas por comentario** (padrao 20)
4. Clique em **Capturar comentarios**.
5. Durante a coleta, **Parar e usar o que ja veio** encerra na hora e entrega
   o que foi capturado ate ali.
6. Use **Copiar JSON**, **Copiar CSV** ou **Baixar JSON**.

A ultima captura fica guardada: se voce fechar e reabrir o popup na mesma
pagina, os botoes de copiar continuam valendo.

## Como ela captura

- **Modo API (padrao):** chama os mesmos endpoints internos que a propria
  pagina usa (`/api/comment/list/` e `/api/comment/list/reply/`) com os cookies
  da sessao aberta. E rapido e traz data exata, curtidas e o total de respostas.
  Referencia: ~100 comentarios + ~140 respostas em cerca de 1 minuto.
- **Modo leitura da tela (reserva):** se a API falhar, a extensao abre o painel
  de comentarios, rola a lista, clica em "Visualizar N respostas" e le o DOM.
  A lista do TikTok e virtualizada (so ~20 itens no DOM por vez), entao a
  coleta e incremental e deduplicada por autor + data + texto.

## Formato do JSON

```json
{
  "capturadoEm": "2026-09-17T12:00:00.000Z",
  "fonte": "api",
  "video": {
    "id": "7570182480762899730",
    "url": "https://www.tiktok.com/@perfil/video/7570182480762899730",
    "autor": "perfil",
    "autorNome": "Nome do Perfil",
    "descricao": "texto da legenda #tag",
    "publicadoEm": "2025-11-07T...",
    "duracaoSegundos": 101,
    "musica": "titulo - autor",
    "estatisticas": { "visualizacoes": 0, "curtidas": 0, "comentarios": 0, "compartilhamentos": 0, "salvos": 0 },
    "hashtags": ["#filme", "#series"]
  },
  "parametros": { "limite": 100, "incluirRespostas": true, "maxRespostas": 20 },
  "totais": { "comentarios": 100, "respostas": 142, "geral": 242, "comentariosNoVideo": 542 },
  "hashtags": {
    "doVideo": ["#filme"],
    "nosComentarios": [{ "tag": "#parte2", "vezes": 7 }],
    "todas": ["#filme", "#parte2"]
  },
  "comentarios": [
    {
      "posicao": 1,
      "nivel": 1,
      "id": "7571093099322753810",
      "autor": "@usuario",
      "autorNome": "Nome",
      "perfilUrl": "https://www.tiktok.com/@usuario",
      "texto": "comentario",
      "data": "2025-11-10",
      "dataHora": "2025-11-10T12:30:05.000Z",
      "curtidas": 332,
      "respostasTotal": 5,
      "fixado": false,
      "hashtags": [],
      "respostas": [{ "nivel": 2, "autor": "@outro", "texto": "resposta", "curtidas": 8 }]
    }
  ]
}
```

O CSV tem uma linha por comentario e por resposta, com as colunas:
`nivel, posicao, id, autor, nome, texto, data, curtidas, respostas, hashtags, respondendo_a`.

## Arquivos

- `manifest.json` - permissoes (`activeTab`, `scripting`, `storage`) e host `tiktok.com`
- `content.js` - coleta (API + reserva por DOM), leitura de metadados e hashtags
- `popup.html` / `popup.css` / `popup.js` - interface, copiar JSON/CSV, download

## Limites e cuidados

- Funciona apenas em paginas de video (`/@perfil/video/<id>`), nao no feed.
- Coleta so o que a sua sessao ja pode ver; nao acessa conteudo privado.
- Capturas muito grandes e seguidas podem ser limitadas pelo TikTok. Se a API
  falhar, a extensao cai sozinha no modo de leitura da tela, que e mais lento.
- Se o TikTok mudar os nomes das classes CSS, apenas o modo reserva e afetado;
  os seletores ficam concentrados no objeto `SEL`, no topo de `content.js`.
