# CTAs Otimizados por Estratégia de Engagement

## O Problema que Resolvemos

Antes: você capturava comentários e a IA gerava CTAs "genéricos" - apoiados nos comentários, mas sem considerar **qual padrão de engajamento o público estava realmente demonstrando**.

Agora: a IA analisa os comentários para identificar a ESTRATÉGIA DE COPYWRITING mais efetiva para este público específico.

---

## As 5 Estratégias Detectadas

### 1. **RESOLVE DÚVIDA** 
**Quando ativa**: Muita gente pergunta qual é o nome do filme/série/ator

**Que o público quer**: A resposta à pergunta que fizeram  
**Técnica de CTA**: Prometer revelar a resposta SEM entregar o título no gancho  
**Exemplo de gancho**:
- "Qual é o nome dessa série? 👀"
- "Você consegue adivinhar qual filme é esse?"
- "Milhares querendo saber o nome..."

**Por quê funciona**: Demanda comprovada. O público já mostrou que quer saber. Um gancho que promete responder está apoiado no que eles pediram, não num palpite.

---

### 2. **SUSPENSE**
**Quando ativa**: Confusão clara sobre o que acontece na trama

**Que o público quer**: Entender o que está acontecendo  
**Técnica de CTA**: Nomear a lacuna, deixar em aberto (SEM resolver)  
**Exemplo de gancho**:
- "Mas afinal, por que ele fez isso?"
- "Você entendeu o final?"
- "Esse plot twist deixou todos confusos..."

**Por quê funciona**: A confusão já está plantada. Aprofundar a lacuna (em vez de preenchê-la) faz o público voltar para resolver a dúvida.

---

### 3. **FOMO** (Fear Of Missing Out)
**Quando ativa**: Muito debate em cascata nos comentários (respostas, contra-argumentações)

**Que o público quer**: Participar da discussão  
**Técnica de CTA**: Sugerir que há uma conversa importante em andamento  
**Exemplo de gancho**:
- "Os comentários estão ON 🔥"
- "Todo mundo discutindo nos comentários..."
- "A comunidade não está concordando sobre isso"

**Por quê funciona**: Medo de perder a conversa. Se veem que há debate ativo, querem entrar.

---

### 4. **CURIOSIDADE** (Pure Engagement)
**Quando ativa**: Alto engajamento geral (muitos likes, comentários curtidos, compartilhamentos)

**Que o público quer**: Ver/entender algo que intriga  
**Técnica de CTA**: Revelar 1% para fazer querer os 100%  
**Exemplo de gancho**:
- "Só admiradores dessa série vão entender isso"
- "Esse momento é DEMAIS 😱"
- "Detalhe que ninguém reparou..."

**Por quê funciona**: Engajamento puro. A audiência está ligada. Um detalhe pequeno mantém a atenção.

---

### 5. **DEBATE** (Controversial/Opinion-Driven)
**Quando ativa**: Opiniões divergentes, argumentações acaloradas

**Que o público quer**: Defender sua posição / ouvir outros  
**Técnica de CTA**: Nomear o conflito, deixar em aberto (sem tomar lado)  
**Exemplo de gancho**:
- "Será que o personagem estava certo?"
- "Esse final foi bom ou ruim? Vem comentar"
- "O filme é overrated ou underrated?"

**Por quê funciona**: Gente adora argumentar. Um ponto de vista em debate atrai defensores de ambos os lados.

---

## Como Usar (UX)

### Fluxo No App

1. **Capture comentários** via extensão (botão "Capturar comentários ↗")
   - A extensão abre o post do Instagram/TikTok
   - Auto-extrai comentários, respostas, likes

2. **Clique em "Reanalisar CTAs (Otimizado)"** (novo botão)
   - App analisa padrões de comentários
   - Detecta qual estratégia é MAIS forte
   - Gera 3 CTAs (cada um usando técnica diferente)

3. **Veja a análise**:
   - **Estratégia Principal**: Qual é a mais forte? "RESOLVE_DUVIDA" / "SUSPENSE" / "FOMO" / "CURIOSIDADE" / "DEBATE"
   - **Insights por estratégia**:
     - RESOLVE_DUVIDA: "5 pessoas perguntaram o nome"
     - SUSPENSE: "3 confusões detectadas sobre o enredo"
     - FOMO: "12 respostas em 2 comentários - debate ativo"
     - CURIOSIDADE: "7 likes média entre comentários"
     - DEBATE: "8 opiniões divergentes detectadas"

4. **Escolha o CTA**:
   - Cada gancho mostra a **TÉCNICA usada** ("Promessa de resposta", "Nomear lacuna", etc)
   - Mostra qual **SINAL** dos comentários sustenta ("5 pessoas perguntaram que filme é")
   - Marca com ⭐ qual é o **recomendado**
   - Um clique para copiar e publicar

---

## O Que Muda No Código

### Backend

**Nova interface `CommentInsights`**:
```typescript
interface CommentInsights {
  // ... campos antigos
  estrategias: EstrategiasCTA;  // scoring de cada estratégia
  estrategiaPrincipal: string | null;  // qual é a mais forte?
}
```

**Novo tipo `OptimizedCommentCtaResult`**:
```typescript
interface OptimizedCommentCtaResult {
  suggestions: Array<{
    text: string;          // "Qual é o nome dessa série?"
    style: string;         // "resolveDuvida" / "suspense" / "fomo" / etc
    signal: string;        // "5 pessoas perguntaram"
    technique: string;     // "Prometer resposta sem entregar"
  }>;
  recommendedIndex: number;
  strategyExplained: string;  // "Estratégia principal: RESOLVE_DUVIDA porque..."
}
```

**Novo endpoint**:
```
POST /api/videos/[id]/cta-from-comments-optimized

Response:
{
  suggestions: [...],
  recommendedIndex: 0,
  strategyExplained: "...",
  insights: {
    estrategiaPrincipal: "resolveDuvida",
    estrategias: { ... },
    totalComentarios: 150,
    totalRespostas: 45
  }
}
```

### Frontend

**CommentsPanel.tsx**:
- Dois botões agora:
  - "Gerar CTA a partir dos comentários" (básico, análise simples)
  - "Reanalisar CTAs (Otimizado)" (análise estratégica NOVA)
- Exibe insights de estratégia (frequência, média, etc)
- Mostra TÉCNICA de copywriting de cada CTA
- Marcação visual do recomendado

---

## Por Que Funciona

### Antes (análise simples):
```
Comentários → "Há demanda, há confusão, há engajamento" → CTA genérico
```

**Resultado**: Um gancho que poderia funcionar, mas não é otimizado para ESTE público.

### Agora (análise estratégica):
```
Comentários → Estratégia MAIS FORTE detectada
           → Técnica de copywriting escolhida
           → CTA gerado especificamente para aquele padrão
```

**Resultado**: Gancho otimizado para o padrão de engajamento real que o público está demonstrando.

---

## Exemplos Práticos

### Post sobre "A Menina Que Roubava Livros"

**Comentários capturam**:
- 8 pessoas perguntam "que filme é esse?"
- 3 pessoas dizem "não entendi o final"
- 2 comentários muito curtidos sobre a atuação
- 12 respostas em um debate sobre o tema

**Análise detecta**:
- RESOLVE_DUVIDA: ⭐⭐⭐⭐⭐ (8 pedidos de nome)
- SUSPENSE: ⭐⭐⭐ (3 confusões)
- CURIOSIDADE: ⭐⭐ (2 comentários curtidos)
- FOMO: ⭐ (12 respostas, mas poucos comentários)
- DEBATE: ⭐ (sem muita divergência)

**Estratégia principal**: RESOLVE_DUVIDA

**CTAs Gerados**:
1. ⭐ "Qual é o nome dessa obra prima?" (RECOMENDADO - aproveita demanda comprovada)
   - Técnica: Prometer sem entregar
   - Sinal: 8 pessoas perguntaram
   
2. "Você entendeu o final?" (Suspense)
   - Técnica: Nomear lacuna
   - Sinal: 3 confusões sobre o enredo
   
3. "Detalhe da atuação que poucos repararam..." (Curiosidade)
   - Técnica: Revelar 1%
   - Sinal: Comentários muito curtidos sobre atuação

---

## Próximos Passos

1. **Teste local**: `npm test`, `npm run build`, `npm start`
2. **Carregue a extensão**: Chrome → Load unpacked → extensão
3. **Capture comentários** de um post real (Instagram/TikTok)
4. **Clique "Reanalisar (Otimizado)"**
5. **Veja o placar de estratégias** e **as técnicas** de cada CTA
6. **Copie o CTA recomendado** e republique com mais engajamento!

