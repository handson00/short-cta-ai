# PROMPT PARA CONTINUAR RESOLUÇÃO - Short CTA AI Build

## CONTEXTO
Projeto: **Short CTA AI** - ferramenta Next.js 15.5.25 com TypeScript que gera textos-gancho (CTA) para vídeos curtos.

Localização: `E:\short-cta-ai` (Windows)

**Objetivo**: Fazer o `npm run build` funcionar completamente e depois rodar `npm start`

---

## SITUAÇÃO ATUAL

### ✅ JÁ RESOLVIDO (6 erros)
Consulte `E:\short-cta-ai\BUILD_STATUS.md` para detalhes completos. Resumo:

1. Corrigido `capture/route.ts` - removida propriedade inválida
2. Atualizado `tsconfig.json` - target para ES2021
3. Atualizadas definições de tipos em `types.ts`
4. Corrigida interface `TextCandidate` em `ctaDetection.ts`
5. Reformulada `ValidatedCtaResult` em `validation.ts`
6. Corrigido `runner.ts:255` - mudado `analyzeScene(context)` para `analyzeScene(frames)`

Todos os 6 arquivos já foram modificados e as mudanças estão em `E:\short-cta-ai`

### ⚠️ AINDA PENDENTE
Conforme `npm run typecheck` mostrou, ainda existem ~21 erros TypeScript não resolvidos:
- Strings sendo usadas como objetos com propriedades
- Type mismatches em validação e providers
- Incompatibilidades de tipos em vários módulos

---

## INSTRUÇÕES - PRÓXIMOS PASSOS

### 1. VER STATUS ATUAL
```cmd
cd E:\short-cta-ai
npm run typecheck
```

### 2. RODAR BUILD
```cmd
npm run build
```

### 3. CORRIGIR CADA ERRO CONFORME APARECER
Para cada erro que aparecer:
- Ler a mensagem de erro completa
- Abrir o arquivo indicado
- Identificar o type mismatch ou propriedade faltante
- Atualizar definição de tipo OU corrigir o código
- Rodar `npm run build` novamente
- Repetir até não haver mais erros

### 4. APÓS BUILD BEM-SUCEDIDO
```cmd
npm start
```

---

## DICAS IMPORTANTES

### Tipos de Erros Comuns Encontrados:
1. **Property XXX does not exist on type YYY**
   - Adicionar a propriedade faltante à interface em `types.ts`
   - Ou remover o acesso à propriedade no código

2. **Type 'XXX' is not assignable to type 'YYY'**
   - Verificar se está passando o argumento correto
   - Atualizar tipo em `types.ts` se necessário

3. **Type 'string[]' is not assignable to type 'string'**
   - Tipo esperado é string, mas recebendo array
   - Corrigir lógica no código ou tipo na interface

### Arquivos Críticos (Frequentemente com Erros):
- `src/lib/types.ts` - Definições de tipos
- `src/lib/pipeline/runner.ts` - Orquestração do pipeline
- `src/lib/pipeline/validation.ts` - Validação de resultados
- `src/lib/prompts.ts` - Construção de prompts
- `src/lib/repo.ts` - Acesso a repositório/dados

### Ambiente:
- Windows CMD/PowerShell
- Node.js com npm
- Next.js 15.5.25
- TypeScript com `noEmit: true` (não compila, só verifica tipos)

---

## FLUXO RECOMENDADO

```
1. Ler BUILD_STATUS.md (contexto)
2. cd E:\short-cta-ai
3. npm run build
4. Ler erro completo
5. Abrir arquivo indicado
6. Encontrar a linea do erro
7. Determinar tipo correto (types.ts ou lógica do código)
8. Corrigir
9. npm run build novamente
10. Repetir 4-9 até build suceder
11. npm start
```

---

## CONTEXTO DO PROJETO

- **Stack**: Next.js + TypeScript + Zod (schema validation)
- **Propósito**: Análise de vídeos com IA para gerar CTAs (chamadas à ação)
- **Funcionalidade**: 
  - Extrai frames de vídeos
  - Transcreve áudio
  - Analisa visualmente o conteúdo
  - Gera sugestões de CTA baseado em análise de cena
  - Permite re-análise baseada em comentários

---

## CONTATO ANTERIOR

Este trabalho foi iniciado por Claude Haiku 4.5 em 2026-09-20.
Todos os 6 arquivos já estão modificados e salvos em `E:\short-cta-ai`.

---

## SUCESSO QUANDO:
- ✅ `npm run build` roda sem erros
- ✅ `npm start` inicia o servidor
- ✅ Aplicação está acessível (provavelmente em http://localhost:3000)

