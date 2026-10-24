import { describe, expect, it } from "vitest";
import { nextClass, type ClassEntry } from "./classes";
import { campusClock } from "./time";

const c = (over: Partial<ClassEntry>): ClassEntry => ({ id: "x", course: "CSE 214", days: ["mon", "wed"], start: "10:30", placeId: "javits", ...over });

describe("nextClass", () => {
  // Wednesday 2026-10-21, 09:00 ET
  const wed9 = new Date("2026-10-21T13:00:00Z");

  it("picks the next class later today", () => {
    const r = nextClass([c({ id: "a" }), c({ id: "b", start: "13:00" })], wed9, campusClock)!;
    expect(r.cls.id).toBe("a");
    expect(r.inMinutes).toBe(90);
  });

  it("rolls over to a later day once today's class has started", () => {
    const r = nextClass([c({ days: ["wed", "fri"] })], new Date("2026-10-21T15:00:00Z"), campusClock)!; // 11:00
    expect(r.inMinutes).toBe(2 * 1440 - 30); // Friday 10:30
  });

  it("ignores classes without a matched building", () => {
    expect(nextClass([c({ placeId: null })], wed9, campusClock)).toBeNull();
  });
});
