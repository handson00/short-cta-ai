import { beforeAll, describe, expect, it } from "vitest";

const MASTER = "b".repeat(64);

let cryptoLib: typeof import("../src/lib/crypto");

beforeAll(async () => {
  process.env.SECRETS_MASTER_KEY = MASTER;
  cryptoLib = await import("../src/lib/crypto");
});

describe("credencial em repouso", () => {
  it("vai e volta", () => {
    const secret = "gcli_exemplo_de_chave_1234567890";
    const stored = cryptoLib.encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(cryptoLib.decryptSecret(stored)).toBe(secret);
  });

  it("gera payload diferente a cada gravação", () => {
    expect(cryptoLib.encryptSecret("mesma")).not.toBe(cryptoLib.encryptSecret("mesma"));
  });

  it("recusa payload adulterado", () => {
    const stored = cryptoLib.encryptSecret("gcli_teste");
    const parts = stored.split(".");
    parts[3] = Buffer.from("outra coisa").toString("base64url");
    expect(() => cryptoLib.decryptSecret(parts.join("."))).toThrow();
  });

  it("mascara sem revelar o miolo", () => {
    const masked = cryptoLib.maskSecret("gcli_abcdefghijklmnop");
    expect(masked).toContain("gcli_ab");
    expect(masked).not.toContain("defghijklm");
  });
});
