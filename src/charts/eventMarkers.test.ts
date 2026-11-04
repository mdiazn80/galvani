import { describe, expect, it } from "vitest";
import { assignLanes } from "./eventMarkers";

describe("assignLanes", () => {
  it("keeps separate markers in the first lane", () => {
    expect(assignLanes([0, 100, 200], [50, 50, 50], 3)).toEqual([0, 0, 0]);
  });

  it("moves overlapping labels to the next lane", () => {
    expect(assignLanes([0, 10, 20], [50, 50, 50], 3)).toEqual([0, 1, 2]);
  });

  it("reuses a lane once its label has ended", () => {
    expect(assignLanes([0, 10, 60], [50, 50, 50], 3)).toEqual([0, 1, 0]);
  });

  it("uses the lane that ends soonest when all are full", () => {
    expect(assignLanes([0, 5, 10], [50, 50, 50], 2)).toEqual([0, 1, 0]);
  });
});
