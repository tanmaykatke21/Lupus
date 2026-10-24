// Campus data for the prototype. Coordinates are approximate — adjust as needed.
// kind: building | dorm | dining | lecture | lab | transit | parking

const PLACES = [
  { id: "sac",       name: "Student Activities Center (SAC)", kind: "dining",  lat: 40.91450, lng: -73.12430 },
  { id: "union",     name: "Stony Brook Union",               kind: "building", lat: 40.91700, lng: -73.12200 },
  { id: "library",   name: "Melville Library",                kind: "building", lat: 40.91570, lng: -73.12250 },
  { id: "javits",    name: "Javits Lecture Center",           kind: "lecture", lat: 40.91330, lng: -73.12220 },
  { id: "frey",      name: "Frey Hall",                       kind: "lecture", lat: 40.91320, lng: -73.12350 },
  { id: "ncs",       name: "New Computer Science",            kind: "lab",     lat: 40.91410, lng: -73.11960 },
  { id: "eng",       name: "Engineering Building",            kind: "lab",     lat: 40.91300, lng: -73.12050 },
  { id: "wang",      name: "Charles B. Wang Center",          kind: "building", lat: 40.91580, lng: -73.11960 },
  { id: "staller",   name: "Staller Center",                  kind: "building", lat: 40.91580, lng: -73.12100 },
  { id: "eastdine",  name: "East Side Dining",                kind: "dining",  lat: 40.91730, lng: -73.11880 },
  { id: "westdine",  name: "West Side Dining",                kind: "dining",  lat: 40.91270, lng: -73.13010 },
  { id: "westapts",  name: "West Apartments",                 kind: "dorm",    lat: 40.91270, lng: -73.13120 },
  { id: "tabler",    name: "Tabler Quad",                     kind: "dorm",    lat: 40.90960, lng: -73.12930 },
  { id: "roth",      name: "Roth Quad",                       kind: "dorm",    lat: 40.90990, lng: -73.12370 },
  { id: "kelly",     name: "Kelly Quad",                      kind: "dorm",    lat: 40.91780, lng: -73.12840 },
  { id: "hquad",     name: "H Quad",                          kind: "dorm",    lat: 40.91780, lng: -73.12560 },
  { id: "mendelsohn",name: "Mendelsohn Quad",                 kind: "dorm",    lat: 40.91840, lng: -73.12390 },
  { id: "chapin",    name: "Chapin Apartments",               kind: "dorm",    lat: 40.90480, lng: -73.11780 },
  { id: "stadium",   name: "LaValle Stadium",                 kind: "building", lat: 40.91900, lng: -73.12270 },
  { id: "hsc",       name: "Health Sciences / Hospital",      kind: "building", lat: 40.90860, lng: -73.11520 },
  { id: "southp",    name: "South P Lot",                     kind: "parking", lat: 40.90100, lng: -73.12550 },
  { id: "lirr",      name: "Stony Brook LIRR Station",        kind: "transit", lat: 40.92040, lng: -73.12820 },
];

// Bus stops (each sits near a place; `near` is used for labels only).
const STOPS = [
  { id: "s_lirr",   name: "Railroad Station",   lat: 40.92010, lng: -73.12790 },
  { id: "s_sac",    name: "SAC Loop",           lat: 40.91410, lng: -73.12490 },
  { id: "s_union",  name: "Union / Library",    lat: 40.91660, lng: -73.12140 },
  { id: "s_east",   name: "East Side Dining",   lat: 40.91760, lng: -73.11930 },
  { id: "s_west",   name: "West Apartments",    lat: 40.91220, lng: -73.13070 },
  { id: "s_tabler", name: "Tabler",             lat: 40.90920, lng: -73.12860 },
  { id: "s_roth",   name: "Roth Quad",          lat: 40.90940, lng: -73.12300 },
  { id: "s_kelly",  name: "Kelly / H Quad",     lat: 40.91740, lng: -73.12700 },
  { id: "s_chapin", name: "Chapin",             lat: 40.90510, lng: -73.11850 },
  { id: "s_hsc",    name: "Health Sciences",    lat: 40.90890, lng: -73.11600 },
  { id: "s_southp", name: "South P Lot",        lat: 40.90140, lng: -73.12500 },
];

// Simplified routes. headway = minutes between buses, first/last = service hours (24h).
// Times between stops are derived from distance; replace with ETA Spot data when wired.
const ROUTES = [
  { id: "outer",   name: "Outer Loop",       color: "#ED2350", headway: 12, first: 7,  last: 24,
    stops: ["s_lirr", "s_kelly", "s_west", "s_tabler", "s_southp", "s_chapin", "s_hsc", "s_east", "s_union", "s_lirr"] },
  { id: "inner",   name: "Inner Loop",       color: "#2B6CB0", headway: 10, first: 7,  last: 23,
    stops: ["s_sac", "s_kelly", "s_union", "s_east", "s_roth", "s_tabler", "s_west", "s_sac"] },
  { id: "express", name: "Railroad Express", color: "#2F855A", headway: 15, first: 6,  last: 24,
    stops: ["s_lirr", "s_union", "s_sac", "s_southp", "s_sac", "s_union", "s_lirr"] },
  { id: "hospital",name: "Hospital/Chapin",  color: "#B7791F", headway: 20, first: 7,  last: 22,
    stops: ["s_sac", "s_union", "s_hsc", "s_chapin", "s_hsc", "s_union", "s_sac"] },
];

// Student shortcuts through buildings. open/close in 24h (close may be 24 = midnight).
// Walking through these is treated as a straight line with no detour penalty.
const SHORTCUTS = [
  { id: "sc1", name: "Through Melville Library",    from: "union",   to: "javits",   open: 8,  close: 24, note: "Use the main floor corridor" },
  { id: "sc2", name: "Through SAC",                 from: "frey",    to: "sac",      open: 7,  close: 24, note: "Enter by the bookstore" },
  { id: "sc3", name: "Engineering ↔ NCS bridge",    from: "eng",     to: "ncs",      open: 7,  close: 23, note: "2nd floor connector" },
  { id: "sc4", name: "Staller lobby cut-through",   from: "staller", to: "wang",     open: 9,  close: 23, note: "" },
];

// Approximate eastbound/westbound departures from Stony Brook (Port Jefferson Branch).
// Replace with MTA GTFS data. Format "HH:MM".
const LIRR_DEPARTURES = {
  westbound: ["05:41","06:21","06:58","07:35","08:12","09:30","10:51","12:21","13:51","15:21","16:40","17:48","18:55","20:21","21:51","23:21"],
  eastbound: ["07:10","08:48","10:18","11:48","13:18","14:48","16:20","17:31","18:22","19:14","20:15","21:46","23:16","00:46"],
};

