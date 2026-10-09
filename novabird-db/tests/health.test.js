import { describe, expect, it } from "vitest";
import { checkDue, brokenReason, quickCheckOk, CHECK_EVERY_STARTS, CHECK_EVERY_MS } from "../src/db/health.js";

describe("Indexprüfung: wann", () => {
  const now = 1_000_000_000_000;
  it("nach unsauberem Beenden immer", () => {
    expect(checkDue({ unclean: true, starts: 1, lastCheck: now, now })).toBe("unclean");
  });
  it("alle 20 Starts", () => {
    expect(checkDue({ unclean: false, starts: CHECK_EVERY_STARTS - 1, lastCheck: now, now })).toBe(null);
    expect(checkDue({ unclean: false, starts: CHECK_EVERY_STARTS, lastCheck: now, now })).toBe("starts");
  });
  it("alle 14 Tage, aber nicht ohne bisherigen Ausgangspunkt", () => {
    expect(checkDue({ unclean: false, starts: 2, lastCheck: now - CHECK_EVERY_MS - 1, now })).toBe("days");
    expect(checkDue({ unclean: false, starts: 2, lastCheck: now - CHECK_EVERY_MS + 1000, now })).toBe(null);
    expect(checkDue({ unclean: false, starts: 2, lastCheck: 0, now })).toBe(null);
  });
});

describe("Fehlerklassen", () => {
  it("erkennt beschädigte Datenbank und zu neues Schema", () => {
    expect(brokenReason(new Error("database disk image is malformed"))).toBe("corrupt");
    expect(brokenReason("file is not a database")).toBe("corrupt");
    expect(brokenReason(new Error("NS_ERROR_FILE_CORRUPTED"))).toBe("corrupt");
    expect(brokenReason(new Error("Could not open connection to /x/index.sqlite: 2152857611"))).toBe("corrupt");
    expect(brokenReason(new Error("Index-Schema v9 ist neuer als dieses Add-on (v4). Index löschen oder Add-on aktualisieren."))).toBe("newer");
  });
  it("andere Fehler sind nicht „kaputt“", () => {
    expect(brokenReason(new Error("timeout"))).toBe(null);
    expect(brokenReason(undefined)).toBe(null);
    expect(brokenReason(new Error("database is locked"))).toBe(null);
  });
  it("quick_check: nur genau „ok“ zählt", () => {
    expect(quickCheckOk([{ r: "ok" }])).toBe(true);
    expect(quickCheckOk([{ r: "OK" }])).toBe(true);
    expect(quickCheckOk([{ r: "*** in database main *** Page 5: btreeInitPage() returns error code 11" }])).toBe(false);
    expect(quickCheckOk([])).toBe(false);
    expect(quickCheckOk(undefined)).toBe(false);
  });
});
