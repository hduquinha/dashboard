import { computeDropPosition, needsRebalance, rebalancePositions } from "@/lib/leadPosition";

describe("computeDropPosition", () => {
  it("returns 0 for an empty column", () => {
    expect(computeDropPosition(null, null)).toBe(0);
  });

  it("returns a value below the first card when dropped at the top", () => {
    expect(computeDropPosition(null, 100)).toBeLessThan(100);
  });

  it("returns a value above the last card when dropped at the bottom", () => {
    expect(computeDropPosition(100, null)).toBeGreaterThan(100);
  });

  it("returns the midpoint when dropped between two cards", () => {
    expect(computeDropPosition(100, 200)).toBe(150);
  });
});

describe("needsRebalance", () => {
  it("is false when there is room between neighbors", () => {
    expect(needsRebalance(100, 200)).toBe(false);
  });

  it("is false at the edges of a column", () => {
    expect(needsRebalance(null, 200)).toBe(false);
    expect(needsRebalance(100, null)).toBe(false);
  });

  it("is true when neighbors have converged to the same float", () => {
    expect(needsRebalance(100, 100)).toBe(true);
    expect(needsRebalance(100, 100.00000001)).toBe(true);
  });
});

describe("rebalancePositions", () => {
  it("assigns increasing integer-step positions preserving order", () => {
    const result = rebalancePositions([5, 2, 9]);
    expect(result.get(5)).toBe(0);
    expect(result.get(2)).toBe(1000);
    expect(result.get(9)).toBe(2000);
  });
});
