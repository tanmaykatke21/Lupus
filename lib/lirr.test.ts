import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { campusDate, campusTime, upcomingTrains, type LirrSchedule } from "./lirr";
import { parseRealtime } from "./lirrRealtime";

const schedule: LirrSchedule = {
  builtAt: "", feedVersion: null, validFrom: "20261021", validTo: "20261108",
  station: { id: "14", name: "Stony Brook", lat: 40.92, lng: -73.128 },
  services: {
    weekday: { add: ["20261023"], remove: [] },
    weekend: { add: ["20261024", "20261025"], remove: [] },
  },
  trips: [
    { tripId: "W1", serviceId: "weekday", train: "1", branch: "Port Jefferson Branch", color: "#006EC7", direction: "west",
      headsign: "Penn", origin: "Port Jefferson", terminal: "Penn Station", startsHere: false, endsHere: false,
      at: { stonyBrook: { arr: 420, dep: 421 }, penn: { arr: 530, dep: 530 } } },
    { tripId: "S1", serviceId: "weekend", train: "6609", branch: "Port Jefferson Branch", color: "#006EC7", direction: "west",
      headsign: "Huntington", origin: "Port Jefferson", terminal: "Huntington", startsHere: false, endsHere: false,
      at: { stonyBrook: { arr: 435, dep: 435 } } },
    { tripId: "E1", serviceId: "weekend", train: "6604", branch: "Port Jefferson Branch", color: "#006EC7", direction: "east",
      headsign: "Port Jefferson", origin: "Huntington", terminal: "Port Jefferson", startsHere: false, endsHere: false,
      at: { stonyBrook: { arr: 457, dep: 457 } } },
    { tripId: "LATE", serviceId: "weekday", train: "99", branch: "Port Jefferson Branch", color: "#006EC7", direction: "east",
      headsign: "Port Jefferson", origin: "Penn Station", terminal: "Stony Brook", startsHere: false, endsHere: true,
      at: { stonyBrook: { arr: 1470, dep: 1470 } } }, // 24:30 on the Friday service day
  ],
};

describe("campus time", () => {
  it("converts New York wall time across DST", () => {
    expect(new Date(campusTime("20261024", 420)).toISOString()).toBe("2026-10-24T11:00:00.000Z"); // EDT
    expect(new Date(campusTime("20261102", 420)).toISOString()).toBe("2026-11-02T12:00:00.000Z"); // EST
  });
  it("gives the New York calendar date, not UTC's", () => {
    expect(campusDate(Date.parse("2026-10-24T02:00:00Z"))).toBe("20261023"); // 10 PM Friday in NY
  });
});

describe("upcomingTrains", () => {
  const sat6am = Date.parse("2026-10-24T10:00:00Z");

  it("lists only trains whose service runs that day, soonest first", () => {
    const t = upcomingTrains(schedule, null, { now: sat6am, kind: "departures" });
    expect(t.map(x => x.train)).toEqual(["6609", "6604"]);
    expect(t[0].destination).toBe("Huntington · change for NYC");
    expect(t[0].delayMin).toBeNull(); // schedule only
  });

  it("merges realtime delays and cancellations", () => {
    const rt = { "S1|20261024": { canceled: false, delaySec: 240 }, "E1|20261024": { canceled: true, delaySec: null } };
    const [late, canceled] = upcomingTrains(schedule, rt, { now: sat6am, kind: "departures" });
    expect(late.delayMin).toBe(4);
    expect(late.expected - late.scheduled).toBe(240_000);
    expect(canceled.canceled).toBe(true);
  });

  it("includes after-midnight trips from the previous service day and skips terminating trains for departures", () => {
    const sat0015 = Date.parse("2026-10-24T04:15:00Z");
    expect(upcomingTrains(schedule, null, { now: sat0015, kind: "arrivals" }).map(t => t.train)).toContain("99");
    expect(upcomingTrains(schedule, null, { now: sat0015, kind: "departures" }).map(t => t.train)).not.toContain("99");
  });

  it("filters by direction", () => {
    expect(upcomingTrains(schedule, null, { now: sat6am, kind: "departures", direction: "east" }).map(t => t.train)).toEqual(["6604"]);
  });
});

describe("parseRealtime", () => {
  it("reads the saved MTA feed and keys trips by id and start date", () => {
    const rt = parseRealtime(new Uint8Array(readFileSync("data/samples/lirr-gtfs-rt.pb")));
    const keys = Object.keys(rt);
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every(k => /^GO\w+\|\d{8}$/.test(k))).toBe(true);
  });
});
