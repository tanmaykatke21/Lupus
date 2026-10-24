import { describe, expect, it } from "vitest";
import { askSchema, resolveAnswer } from "./ask";
import { validateClasses } from "./scheduleOcr";

const classes = [{ id: "c1", course: "CSE 214" }];
const sat6am = Date.parse("2026-10-24T10:00:00Z");

describe("resolveAnswer", () => {
  it("accepts known places and rejects invented ones", () => {
    expect(resolveAnswer({ action: "place", placeId: "javits", reply: "ok" }, classes, sat6am, null)).toMatchObject({ type: "place", placeId: "javits" });
    expect(resolveAnswer({ action: "place", placeId: "hogwarts", reply: "ok" }, classes, sat6am, null).type).toBe("none");
  });

  it("only accepts the user's own classes", () => {
    expect(resolveAnswer({ action: "class", classId: "c1", reply: "" }, classes, sat6am, null).type).toBe("class");
    expect(resolveAnswer({ action: "class", classId: "c9", reply: "" }, classes, sat6am, null).type).toBe("none");
  });

  it("resolves trains from our schedule, never from the model", () => {
    const r = resolveAnswer({ action: "train", trainDirection: "west", trainAfter: "18:00", reply: "" }, classes, sat6am, null);
    expect(r.type).toBe("train");
    if (r.type !== "train") return;
    expect(r.train.direction).toBe("west");
    expect(r.train.expected).toBeGreaterThanOrEqual(Date.parse("2026-10-24T22:00:00Z")); // 6 PM EDT
  });

  it("rejects unknown categories", () => {
    expect(resolveAnswer({ action: "category", category: "casino", reply: "" }, classes, sat6am, null).type).toBe("none");
    expect(resolveAnswer({ action: "category", category: "dining", reply: "" }, classes, sat6am, null).type).toBe("category");
  });

  it("omits classId from the schema when there are no classes", () => {
    expect(JSON.stringify(askSchema([]))).not.toContain("classId");
  });
});

describe("validateClasses", () => {
  it("keeps well-formed classes and drops bad times, days and unknown places", () => {
    const out = validateClasses([
      { course: "CSE 214", days: ["mon", "wed", "funday"], start: "9:30", end: "10:50", building: "JAVITS", room: "100", placeId: "javits" },
      { course: "AMS 210", days: ["tue"], start: "25:00" },
      { course: "WRT 102", days: ["fri"], start: "13:00", placeId: "narnia" },
      { course: "", days: ["mon"], start: "10:00" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ course: "CSE 214", days: ["mon", "wed"], start: "09:30", placeId: "javits" });
    expect(out[1]).toMatchObject({ course: "WRT 102", placeId: null });
  });
});
