import { describe, expect, it } from "vitest";
import { matchesSubscription } from "./filters";

const event = { magnitude: 3.5, region: "Azerbaijan. From Georgia border - 2km." };

describe("matchesSubscription", () => {
  it("пропускает событие при нулевом пороге и отсутствии ключевого слова", () => {
    expect(matchesSubscription(event, { minMagnitude: 0, regionKeyword: null })).toBe(true);
  });

  it("пропускает событие ровно на пороге", () => {
    expect(matchesSubscription(event, { minMagnitude: 3.5, regionKeyword: null })).toBe(true);
  });

  it("отсекает событие ниже порога", () => {
    expect(matchesSubscription(event, { minMagnitude: 4, regionKeyword: null })).toBe(false);
  });

  it("сопоставляет ключевое слово региона без учёта регистра", () => {
    expect(matchesSubscription(event, { minMagnitude: 0, regionKeyword: "azerbaijan" })).toBe(true);
  });

  it("отсекает событие, если ключевое слово не встречается", () => {
    expect(matchesSubscription(event, { minMagnitude: 0, regionKeyword: "tbilisi" })).toBe(false);
  });

  it("игнорирует пустое ключевое слово", () => {
    expect(matchesSubscription(event, { minMagnitude: 0, regionKeyword: "   " })).toBe(true);
  });
});
