import { describe, expect, it } from "vitest";
import { mapLimit } from "../src/lib/concurrency";

describe("mapLimit", () => {
  it("mantém a ordem da entrada mesmo quando termina fora de ordem", async () => {
    const out = await mapLimit([30, 5, 15, 1], 4, async (ms, i) => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3]);
  });

  it("nunca passa do teto de tarefas simultâneas", async () => {
    let active = 0;
    let peak = 0;
    await mapLimit(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
    });
    expect(peak).toBe(3);
  });

  it("lista vazia não trava", async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  });
});
