import { describe, expect, it } from "vitest";
import { formatJson } from "./formatJson";

describe("formatJson", () => {
  it("keeps short arrays inline and nested lists one item per line", () => {
    const out = formatJson({ a: [1, 2], b: [[1, 2], [3, 4]], c: { d: ["x", "y"] } }, 2);
    expect(out).toContain('"a": [1, 2]');
    expect(out).toContain("[1, 2],\n    [3, 4]");
    expect(out).toContain('"d": ["x", "y"]');
    expect(JSON.parse(out)).toEqual({ a: [1, 2], b: [[1, 2], [3, 4]], c: { d: ["x", "y"] } });
    expect(out.endsWith("}\n")).toBe(true);
  });
});
