import { describe, expect, it } from "vitest";
import { computeStats } from "./stats";

describe("computeStats", () => {
  it("возвращает нули на пустом списке без деления на ноль", () => {
    expect(computeStats([])).toEqual({
      count: 0,
      averageMagnitude: null,
      maxMagnitude: null,
    });
  });

  it("считает количество, среднюю и максимальную магнитуду", () => {
    expect(computeStats([{ magnitude: 3 }, { magnitude: 4 }, { magnitude: 5 }])).toEqual({
      count: 3,
      averageMagnitude: 4,
      maxMagnitude: 5,
    });
  });

  it("округляет среднюю магнитуду до одного знака", () => {
    expect(computeStats([{ magnitude: 3.1 }, { magnitude: 3.2 }]).averageMagnitude).toBe(3.2);
  });
});
