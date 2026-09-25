import { describe, test, expect } from "bun:test";
import { capOutput } from "../src/search-formatter";

const node = (node_id: string, level: number, content: string) => ({ node_id, title: node_id, level, content });

describe("capOutput", () => {
  test("passes through output under the cap", () => {
    expect(capOutput([node("a", 1, "x")], "short", 100)).toBe("short");
  });

  test("several nodes over the cap → outline with ids and sizes", () => {
    const nodes = [node("n1", 2, "a".repeat(500)), node("n2", 3, "b".repeat(700))];
    const out = capOutput(nodes, "z".repeat(1300), 200);
    expect(out).toContain("outline only");
    expect(out).toContain("[n1] ## n1 (500 chars)");
    expect(out).toContain("  [n2] ### n2 (700 chars)");
    expect(out).not.toContain("aaaa");
  });

  test("one node over the cap → truncated head with marker", () => {
    const out = capOutput([node("n1", 2, "")], "y".repeat(1000), 100);
    expect(out.startsWith("y".repeat(100) + "\n")).toBe(true);
    expect(out).toContain("[truncated: 100 of 1000 chars]");
  });
});
