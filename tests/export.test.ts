import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, escapeCsvField, toCsv, type ExportRow } from "../src/lib/export";

const ROW: ExportRow = {
  arquivo: "corte_01.mp4",
  obra: "",
  confianca_obra: "",
  cta_original: "A DECISAO PARECIA CRUEL",
  cta_recomendado: "Parecia uma decisão cruel… até descobrirem o motivo",
  cta_escolhido: "",
  alternativas: "Ele precisava decidir [suspense] | Dez segundos [ultracurto]",
  status: "Concluído",
};

describe("colunas do CSV", () => {
  it("segue exatamente a ordem exigida", () => {
    expect(CSV_COLUMNS.join(",")).toBe(
      "arquivo,obra,confianca_obra,cta_original,cta_recomendado,cta_escolhido,alternativas,status",
    );
  });
});

describe("escapeCsvField", () => {
  it("cita campos com vírgula", () => {
    expect(escapeCsvField("a, b")).toBe('"a, b"');
  });

  it("duplica aspas internas", () => {
    expect(escapeCsvField('ele disse "não"')).toBe('"ele disse ""não"""');
  });

  it("cita quebras de linha", () => {
    expect(escapeCsvField("linha1\nlinha2")).toBe('"linha1\nlinha2"');
  });

  it("neutraliza conteúdo que a planilha leria como fórmula", () => {
    for (const dangerous of ["=1+1", "+CMD", "-2", "@SUM(A1)"]) {
      expect(escapeCsvField(dangerous).startsWith("'")).toBe(true);
    }
  });

  it("não mexe em texto comum", () => {
    expect(escapeCsvField("Parecia cruel")).toBe("Parecia cruel");
  });

  it("protege fórmula e aspas ao mesmo tempo", () => {
    expect(escapeCsvField('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
  });
});

describe("toCsv", () => {
  it("monta cabeçalho, BOM e CRLF", () => {
    const csv = toCsv([ROW]);
    expect(csv.startsWith("﻿arquivo,")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain("corte_01.mp4");
  });

  it("uma linha por vídeo", () => {
    const csv = toCsv([ROW, { ...ROW, arquivo: "corte_02.mp4" }]);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(3);
  });
});
