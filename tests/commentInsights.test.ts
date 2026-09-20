import { describe, expect, it } from "vitest";
import { extrairSinais } from "../src/lib/pipeline/commentInsights";
import type { PostComment } from "../src/lib/repo";

let seq = 0;
function c(partial: Partial<PostComment> & { text: string }): PostComment {
  seq += 1;
  return {
    id: `c${seq}`,
    externalId: `e${seq}`,
    parentExternalId: null,
    author: "@alguem",
    likeCount: 0,
    publishedLabel: null,
    position: seq,
    ...partial,
  };
}

describe("extrairSinais", () => {
  it("conta o pedido pelo nome da obra em suas várias formas", () => {
    // É o sinal mais valioso do acervo: demanda direta por identificação.
    const s = extrairSinais([
      c({ text: "que filme é esse?" }),
      c({ text: "Que filme eh esse??" }),
      c({ text: "qual o nome do filme" }),
      c({ text: "nome da serie por favor" }),
      c({ text: "cena linda demais" }),
    ]);
    expect(s.pedidosDeNome).toBeGreaterThanOrEqual(4);
    expect(s.temSinal).toBe(true);
  });

  it("agrupa a mesma pergunta escrita de jeitos diferentes", () => {
    const s = extrairSinais([
      c({ text: "Por que ela não contou pra ele?" }),
      c({ text: "por que ela nao contou pra ele???" }),
      c({ text: "POR QUE ELA NÃO CONTOU PRA ELE" }),
    ]);
    expect(s.perguntasRecorrentes[0].vezes).toBe(3);
  });

  it("ordena os mais curtidos e ignora reação sem conteúdo", () => {
    const s = extrairSinais([
      c({ text: "kkkkkkkk", likeCount: 9000 }),
      c({ text: "essa cena me quebrou por dentro", likeCount: 120 }),
      c({ text: "melhor momento do filme inteiro", likeCount: 300 }),
    ]);
    expect(s.maisCurtidos[0].texto).toContain("melhor momento");
    // 9000 curtidas em "kkkkkkkk" não sustentam gancho nenhum.
    expect(s.maisCurtidos.some((x) => x.texto.startsWith("kkk"))).toBe(false);
  });

  it("identifica o comentário que gerou debate", () => {
    const pai = c({ text: "ele estava certo em fazer aquilo", externalId: "pai1" });
    const s = extrairSinais([
      pai,
      c({ text: "discordo totalmente disso", parentExternalId: "pai1" }),
      c({ text: "concordo demais com você", parentExternalId: "pai1" }),
      c({ text: "nem vem, ele errou feio", parentExternalId: "pai1" }),
    ]);
    expect(s.maisRespondidos[0].respostas).toBe(3);
    expect(s.totalRespostas).toBe(3);
  });

  it("recusa gerar quando os comentários são só reação", () => {
    // Prefere dizer "não dá" a devolver um gancho apoiado em nada — mesmo
    // princípio do campo de CTA que fica vazio quando o OCR não lê.
    const s = extrairSinais([
      c({ text: "kkkkk" }),
      c({ text: "😂😂😂" }),
      c({ text: "rsrs" }),
      c({ text: "top" }),
    ]);
    expect(s.temSinal).toBe(false);
    expect(s.motivoSemSinal).toBeTruthy();
  });

  it("não tem sinal quando não há comentário nenhum", () => {
    const s = extrairSinais([]);
    expect(s.temSinal).toBe(false);
    expect(s.motivoSemSinal).toContain("Nenhum comentário");
  });
});
