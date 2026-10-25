import { describe, expect, it } from "vitest";
import { crowding } from "./crowding";

describe("crowding", () => {
  it("counts standing room before calling a bus full", () => {
    expect(crowding(0.3)?.label).toBe("Plenty of seats");
    expect(crowding(0.8)?.tone).toBe("warn");
    expect(crowding(1.0)?.label).toBe("Standing room only");
    expect(crowding(1.09)?.label).toBe("Standing room only");
    expect(crowding(1.1)?.tone).toBe("danger");
    expect(crowding(null)).toBeNull();
  });
});
