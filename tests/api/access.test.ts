// Row-level security as seen through PostgREST: who can read which names and which money rows.
// Uses only the anon key and the demo users' own sessions.

import {
  api,
  book,
  expectOk,
  hoursBefore,
  LIVE,
  rest,
  SKIP_MESSAGE,
  USERS,
  type Json,
} from "./helpers.ts";

if (!LIVE) console.warn(SKIP_MESSAGE);

const T = 60_000;
const ids = (rows: Json[]) => rows.map((r) => r.id as string);

describe.skipIf(!LIVE)("TaskNest data access (RLS)", () => {
  it(
    "anonymous visitors can browse active taskers and their names, nothing else",
    async () => {
      const taskers = await rest(null, "taskers", "select=id,display_name,status,category");
      expect(taskers.length).toBeGreaterThan(0);
      expect(taskers.every((t: Json) => t.status === "active")).toBe(true);
      const tara = taskers.find((t: Json) => t.id === USERS.tara.id);
      if (tara) expect(tara.display_name).toBe("Tara Tasker");
      expect(ids(taskers)).not.toContain(USERS.pia.id); // pending KYC
      const names = await rest(null, "display_names", "select=id,display_name");
      expect(ids(names)).not.toContain(USERS.ava.id);
      expect(await rest(null, "profiles", "select=id")).toEqual([]);
      expect(await rest(null, "bookings", "select=id")).toEqual([]);
    },
    T,
  );

  it(
    "clients see tasker names but never another client; profiles stay private and carry no emails",
    async () => {
      const names = await rest("ava", "display_names", "select=*");
      const byId = new Map(names.map((n: Json) => [n.id, n]));
      expect(byId.get(USERS.ava.id)?.display_name).toBe("Ava");
      expect(ids(names)).not.toContain(USERS.ben.id);
      for (const n of names)
        expect(Object.keys(n).sort()).toEqual(["display_name", "id", "updated_at"]);
      const profiles = await rest("ava", "profiles", "select=*");
      expect(ids(profiles)).toEqual([USERS.ava.id]);
      expect(Object.keys(profiles[0])).not.toContain("email");
      const taskers = await rest("ava", "taskers", `id=eq.${USERS.tara.id}&select=id,display_name`);
      expect(taskers).toEqual([{ id: USERS.tara.id, display_name: "Tara Tasker" }]);
    },
    T,
  );

  it(
    "a tasker sees only the FIRST name of a client they have a booking with",
    async () => {
      const b = await book("ben", { minutes: 60 });
      expectOk(b, 201);
      try {
        const seen = await rest(
          "tara",
          "display_names",
          `id=eq.${USERS.ben.id}&select=id,display_name`,
        );
        expect(seen).toEqual([{ id: USERS.ben.id, display_name: "Ben" }]);
        expect(await rest("tara", "profiles", `id=eq.${USERS.ben.id}&select=id`)).toEqual([]);
      } finally {
        await api(
          "ben",
          "POST",
          `/bookings/${b.body.booking.id}/cancel`,
          { reason: "cleanup" },
          { now: hoursBefore(b.slot.startAt, 72) },
        );
      }
    },
    T,
  );

  it(
    "clients and taskers cannot read the ledger or back-office tables; taskers see their own payable lines",
    async () => {
      expect(await rest("ava", "ledger_txns", "select=id&limit=5")).toEqual([]);
      expect(await rest("ava", "ledger_lines", "select=id&limit=5")).toEqual([]);
      expect(await rest("ava", "audit_log", "select=id&limit=5")).toEqual([]);
      expect(await rest("ava", "integrity_violations", "")).toEqual([]);
      const own = await rest("tara", "ledger_lines", "select=account,party&limit=50");
      for (const l of own) expect(l).toEqual({ account: "tasker_payable", party: USERS.tara.id });
      expect((await rest("admin", "ledger_txns", "select=id&limit=1")).length).toBe(1);
    },
    T,
  );
});
