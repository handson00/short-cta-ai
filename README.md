# Short CTA AI

> **Continuando este projeto?** Leia `docs/HANDOFF.md` primeiro: estado real,
> o que está quebrado e o próximo passo. O histórico das decisões está em
> `docs/HISTORICO.md` e as fases em `docs/ROADMAP.md`.

Esteira de preparação de Shorts: importa vídeos curtos em lote, analisa cada um
e sugere textos-gancho para aparecer acima do vídeo. Implementa a **Fase 1** da
especificação, no formato **local, usuário único**.

Neste projeto, "CTA" é o texto-gancho exibido sobre o vídeo — não uma chamada
para clicar em um botão.

---

## O que já funciona

- Importação em lote de `.mp4`, `.mov` e `.webm`, com validação pelo conteúdo
  (não pela extensão), limite de tamanho e duração, e detecção de duplicados por
  hash SHA-256 com a opção de ignorar ou reanalisar.
- Fila persistente em SQLite com lease, heartbeat, concorrência configurável,
  cancelamento, nova tentativa e **retomada após reinício do worker**.
- Extração com FFmpeg/FFprobe: metadados, miniatura, áudio 16 kHz mono e frames
  escolhidos de acordo com a duração real, com descarte de frames quase
  idênticos por *average hash*.
- Transcrição local por `faster-whisper` (interface `TranscriptionProvider`,
  com implementação alternativa `none`).
- OCR por Tesseract (interface `VisionProvider`) com classificação explícita do
  texto lido: gancho, legenda, marca d'água ou perfil — mais correção manual.
- Análise da cena e geração de CTAs pelo GhostCLI (interface `AIProvider`),
  com contrato de saída validado no backend e uma tentativa controlada de
  correção antes de marcar o job com erro.
- Identificação opcional da obra, com níveis `high`/`medium`/`low`, evidências,
  fontes e o estado `not_identified_safely` quando as evidências não bastam.
- Revisão manual: copiar, editar, escolher, favoritar, regenerar CTAs
  (reaproveitando a análise salva) e analisar novamente (refazendo tudo).
- Exportação em CSV e JSON, com escape de vírgulas, aspas, quebras de linha e
  neutralização de conteúdo que uma planilha interpretaria como fórmula.
- Página de uso da IA: requisições, modelo, tempo, status e erros recentes.

## O que ficou de fora (Fases 2 e 3)

- Descrição visual de cena: **não há modelo de visão configurado**. O sistema
  declara essa limitação em vez de inventar personagens, objetos ou ações.
- Pesquisa externa para identificar a obra: a interface `SearchProvider` existe
  e é exposta ao modelo pela ferramenta `search_movie`, mas o provedor padrão é
  `none`. Sem endpoint configurado, a identificação só usa as evidências do
  próprio vídeo.
- Armazenamento de objetos, métricas de custo por usuário e comparação
  histórica de CTAs escolhidos.

---

## Requisitos

| Item | Observação |
| --- | --- |
| Node.js 20+ | testado no 22 |
| FFmpeg e FFprobe | no PATH, ou aponte `FFMPEG_PATH` / `FFPROBE_PATH` |
| Tesseract OCR | com os idiomas `por` e `eng` (`TESSERACT_LANGS`) |
| Python 3 + `faster-whisper` | opcional; sem ele a transcrição fica desligada |

```bash
# Debian/Ubuntu
sudo apt install ffmpeg tesseract-ocr tesseract-ocr-por
pip install faster-whisper

# macOS
brew install ffmpeg tesseract tesseract-lang
pip install faster-whisper

# Windows (veja a seção Windows abaixo)
winget install Gyan.FFmpeg
winget install UB-Mannheim.TesseractOCR
pip install faster-whisper
```

## Instalação

Igual nos três sistemas — sem `cp`, sem `openssl`:

```bash
npm install
npm run setup      # cria o .env.local com os segredos gerados
npm run doctor     # diz o que ainda falta no ambiente
npm run build
npm start          # http://localhost:3000
```

Abra o `.env.local` e troque `APP_PASSWORD` antes de usar. Em desenvolvimento,
`npm run dev`.

`npm run doctor` verifica o binário nativo do SQLite, FFmpeg, FFprobe,
Tesseract com os idiomas configurados, o Python com `faster-whisper` e os
segredos do `.env.local`, apontando o comando que resolve cada pendência.

### Windows

O `npm install` pode terminar com um aviso de `allow-scripts`. Quando isso
acontece o binário nativo do `better-sqlite3` **não é baixado** e a aplicação
falha ao abrir o banco. Autorize e reinstale:

```cmd
npm approve-scripts better-sqlite3
npm approve-scripts esbuild
npm install
npm run doctor
```

FFmpeg e Tesseract não vêm no Windows. Com o winget:

```cmd
winget install Gyan.FFmpeg
winget install UB-Mannheim.TesseractOCR
```

Marque **Portuguese** entre os idiomas na instalação do Tesseract; sem ele,
deixe `TESSERACT_LANGS=eng` no `.env.local`. Abra um terminal novo depois de
instalar, para o PATH atualizar. Se preferir não mexer no PATH, aponte os
caminhos direto no `.env.local` usando barras normais:

```
FFMPEG_PATH=C:/ffmpeg/bin/ffmpeg.exe
FFPROBE_PATH=C:/ffmpeg/bin/ffprobe.exe
TESSERACT_PATH=C:/Program Files/Tesseract-OCR/tesseract.exe
```

O gerador de vídeos de teste (`npm run fixtures`) é um script bash: rode pelo
Git Bash ou WSL. Sem as fixtures, os testes de mídia são ignorados e o restante
da suíte roda normalmente.

### Rodar sem credencial do GhostCLI

Um servidor de mentira acompanha o projeto para você ver a esteira inteira
funcionando antes de contratar a API. Ele **não é um modelo**: devolve respostas
fixas no formato do contrato.

```bash
npm run mock:ghostcli                 # sobe em http://127.0.0.1:8787/v1
# no .env.local:
GHOSTCLI_BASE_URL=http://127.0.0.1:8787/v1
GHOSTCLI_API_KEY=gcli_mock
```

### Worker em processo separado

O worker sobe junto com o servidor por padrão. Para separar o processamento
pesado da interface:

```bash
# .env.local
WORKER_IN_PROCESS=false
```

```bash
npm start &
npm run worker
```

Os dois processos compartilham o mesmo SQLite em modo WAL; o lease impede que
peguem o mesmo job.

---

## Configuração

Tudo em **Configurações → IA → GhostCLI**: estado da conexão, chave, base URL,
modelo de análise e de geração, teste de conexão, timeout, tentativas,
quantidade de CTAs, idioma, criatividade, os controles de pesquisa externa,
análise do CTA existente, uso do CTA como referência e prevenção de spoilers,
além da concorrência da fila, limites de arquivo e política de retenção.

A lista de modelos **não é fixa no frontend**: o campo aceita qualquer ID e o
backend oferece apenas sugestões da documentação consultada. Disponibilidade
depende do plano da sua conta — confirme com **Testar conexão**.

### Credencial

1. `GHOSTCLI_API_KEY` no ambiente tem precedência e nunca é gravada no banco.
2. Se preferir salvar pela interface, defina `SECRETS_MASTER_KEY`: a chave é
   cifrada com AES-256-GCM em repouso. Depois de salva só pode ser substituída,
   nunca lida de volta pela interface.
3. Todas as chamadas partem do servidor. A chave não aparece em HTML, respostas
   da API interna, logs ou armazenamento do navegador.

---

## Como o pipeline decide

**Extração.** Os instantes começam em 0, 0,5, 1, 2, 3 e 5 segundos e se ajustam
à duração real — nada de pedir um frame aos 5s de um vídeo de 3s. Frames quase
idênticos são descartados: repetição não acrescenta evidência e custa OCR.

**CTA existente.** O primeiro frame não basta: muitos títulos entram depois de
uma animação. Cada bloco de texto é avaliado por posição, tamanho relativo,
persistência entre frames, confiança do OCR e forma da frase. Um `@perfil`, uma
chamada de plataforma ou um texto pequeno presente em todos os frames viram
marca d'água; texto no terço inferior vira legenda. Só um bloco com pontuação
suficiente é apresentado, e abaixo da confiança alta a interface diz "Possível
CTA encontrado" em vez de afirmar a leitura.

**Contexto.** Transcrição, OCR, descrição visual (quando houver) e resultados de
busca entram delimitados e rotulados como dados. Um Short pode trazer na tela
"ignore as instruções anteriores"; isso chega ao modelo como texto lido, não
como pedido. As limitações do pipeline vão explícitas, para que ausência de
informação não seja confundida com certeza.

**Geração.** A distribuição entre estilos se ajusta à quantidade pedida: se você
pediu 10, a soma das categorias é 10. O backend valida tipos, comprimentos,
categorias e duplicações, descarta fórmulas genéricas e, se a recomendação do
modelo não se sustentar, promove o melhor candidato pelos critérios de
fidelidade, curiosidade, clareza, tamanho, spoiler e variedade. Nenhuma métrica
inventada de "chance de viralizar" é exibida.

**Obra.** Sem título não há identificação, qualquer que seja a confiança
alegada: o resultado vira `not_identified_safely`. A correção manual do usuário
tem precedência e sobrevive a uma nova análise.

---

## Estrutura

```
src/
  app/                 páginas e rotas de API
  components/          interface (dark mode, mobile-first)
  lib/
    media/             FFmpeg, seleção de frames, hashing
    pipeline/          etapas, detecção de CTA, avaliação editorial, validação
    providers/
      ai/              cliente GhostCLI, classificação de erros
      transcription/   faster-whisper | none
      vision/          tesseract | none
      search/          http | none
    queue.ts           fila persistente e worker
    repo.ts            acesso ao banco
    settings.ts        preferências e credencial
scripts/               worker separado, fixtures, mock do GhostCLI
tests/                 105 testes (unitários e de integração)
```

### Entidades

`videos`, `analysis_jobs`, `frames`, `transcripts`, `visual_analyses`,
`work_identifications`, `scene_analyses`, `cta_suggestions`, `user_selections`,
`ai_request_logs`, `style_examples`, `app_settings`.

Cada análise grava a versão do prompt e o modelo usados, para comparar
resultados depois de uma mudança de texto.

---

## Testes

```bash
npm run fixtures   # gera vídeos de teste com FFmpeg
npm test
npm run typecheck
```

Os testes cobrem, entre outros, os casos exigidos nos critérios de aceite:
vídeo sem fala, sem CTA, com OCR difícil, com obra desconhecida e com falha de
um provedor. Os testes de mídia usam FFmpeg e Tesseract de verdade sobre os
vídeos de `tests/fixtures`; sem as fixtures, esse bloco é ignorado.

---

## Segurança e privacidade

- Rotas de configuração, teste e processamento exigem autenticação
  (`APP_PASSWORD`). Sem senha definida, a aplicação recusa subir em produção.
- Uploads são validados por conteúdo e gravados com nome gerado pelo servidor;
  o nome original serve apenas para exibição.
- Vídeos e frames são servidos por ID interno — caminhos de disco nunca chegam
  ao cliente.
- Os logs operacionais registram operação, modelo, status e duração. Não
  registram transcrições nem o conteúdo enviado ao modelo.
- A política de retenção apaga vídeos, transcrições e resultados por idade,
  e pode ser disparada manualmente em Configurações.

Identificar a obra ou gerar um título **não concede direitos de uso do vídeo** —
a interface lembra isso na tela de detalhe.

---

## Limites conhecidos

- A qualidade do OCR depende do vídeo. Texto com pouco contraste é lido com
  confiança baixa, e nesse caso o sistema prefere não afirmar a leitura.
- Sem modelo de visão, o resumo da cena se apoia em fala e texto. Em um corte
  mudo e sem legenda, o contexto disponível é pequeno — e isso é declarado.
- A fila em SQLite atende bem um usuário local com dezenas a centenas de
  vídeos. Para vários usuários simultâneos ou várias máquinas, troque por
  BullMQ + Redis mantendo as mesmas interfaces.
- As informações sobre o endpoint, a autenticação e os modelos do GhostCLI
  devem ser revalidadas contra a documentação oficial na implantação.
