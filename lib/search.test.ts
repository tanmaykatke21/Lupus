import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Place } from "./places";
import { editDistance, normalize, searchPlaces } from "./search";

// Search runs against the real catalog (names and nicknames); coordinates don't matter here.
const catalog = (
  JSON.parse(readFileSync(path.join(__dirname, "..", "data", "place-catalog.json"), "utf8")) as {
    places: Omit<Place, "lat" | "lng">[];
  }
).places.map((p) => ({ ...p, lat: 0, lng: 0 }));

const top = (q: string) => searchPlaces(catalog, q)[0]?.place.id;

describe("searchPlaces", () => {
  it("finds places by nickname", () => {
    expect(top("SAC")).toBe("sac");
    expect(top("sbuh")).toBe("hospital");
    expect(top("new cs")).toBe("new-cs");
  });

  it("matches as you type", () => {
    expect(top("jav")).toBe("javits");
    expect(top("lib")).toBe("library");
    expect(top("west ap")).toBe("west-apts");
  });

  it("forgives small typos", () => {
    expect(top("javitz")).toBe("javits");
    expect(top("staler")).toBe("staller");
    expect(top("chemestry")).toBe("chemistry");
  });

  it("matches initials of long names", () => {
    expect(top("ess")).toBe("ess");
    expect(top("cmm")).toBe("cmm");
  });

  it("ranks exact names above partial matches", () => {
    const ids = searchPlaces(catalog, "engineering").map((h) => h.place.id);
    expect(ids[0]).toBe("engineering");
    expect(ids).toContain("light-eng");
    expect(ids).toContain("heavy-eng");
  });

  it("returns nothing for empty or unrelated queries", () => {
    expect(searchPlaces(catalog, "   ")).toEqual([]);
    expect(searchPlaces(catalog, "xyzzy")).toEqual([]);
  });
});

describe("helpers", () => {
  it("normalizes punctuation and ampersands", () => {
    expect(normalize("Earth & Space")).toBe("earth and space");
    expect(normalize("Charles B. Wang Center")).toBe("charles b wang center");
  });

  it("measures edit distance with swaps", () => {
    expect(editDistance("javits", "javtis")).toBe(1);
    expect(editDistance("stony", "brook")).toBeGreaterThan(2);
  });
});
