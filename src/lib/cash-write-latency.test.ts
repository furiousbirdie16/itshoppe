import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Recording a cash transaction used to make four sequential network round trips
 * before the user saw a confirmation: getUser, the insert, getUser again inside
 * logActivity, then the activity_logs insert. These tests pin it to one.
 */

// vi.mock's factory is hoisted above the file body, so these must be too.
const { getUser, getSession, activityInsert, txnInsertSingle } = vi.hoisted(() => ({
  getUser: vi.fn(async () => ({ data: { user: { id: "u1", email: "a@b.c" } } })),
  getSession: vi.fn(async () => ({ data: { session: { user: { id: "u1", email: "a@b.c" } } } })),
  activityInsert: vi.fn(() => Promise.resolve({ error: null })),
  txnInsertSingle: vi.fn(async () => ({ data: { id: "t1", amount: 100, direction: "out" }, error: null })),
}));

/** Resolves only when released, so we can prove a call isn't awaited. */
function deferred<T>() {
  let release!: (v: T) => void;
  const promise = new Promise<T>((res) => { release = res; });
  return { promise, release };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser, getSession },
    from: (table: string) => {
      if (table === "activity_logs") return { insert: activityInsert };
      return {
        insert: () => ({ select: () => ({ single: txnInsertSingle }) }),
      };
    },
    functions: { invoke: vi.fn(async () => ({ error: null })) },
  },
}));

import { createCashTransaction } from "@/lib/api";
import { logActivity } from "@/lib/activity-log";

beforeEach(() => {
  vi.clearAllMocks();
  activityInsert.mockImplementation(() => Promise.resolve({ error: null }));
});

describe("cash write latency", () => {
  it("never calls the auth server to stamp who recorded a transaction", async () => {
    await createCashTransaction({ account_id: "a1", amount: 100, direction: "out" });

    // getUser is a network round trip to /auth/v1/user; getSession reads cache.
    expect(getUser).not.toHaveBeenCalled();
    expect(getSession).toHaveBeenCalled();
  });

  it("still stamps the actor onto the row", async () => {
    await createCashTransaction({ account_id: "a1", amount: 100, direction: "out" });
    expect(txnInsertSingle).toHaveBeenCalledTimes(1);
  });

  it("does not wait for the audit-log write before returning", async () => {
    const blocked = deferred<{ error: null }>();
    activityInsert.mockImplementation(() => blocked.promise);

    let settled = false;
    const call = createCashTransaction({ account_id: "a1", amount: 100, direction: "out" })
      .then(() => { settled = true; });

    await call;
    expect(settled).toBe(true);
    // The audit insert was started but is still in flight — it never blocked.
    expect(activityInsert).toHaveBeenCalledTimes(1);

    blocked.release({ error: null });
  });

  it("logs an audit failure instead of surfacing it to the caller", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    activityInsert.mockImplementation(() => Promise.resolve({ error: new Error("boom") }));

    await expect(logActivity("did_thing", "thing", "id1")).resolves.toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(err).toHaveBeenCalledWith("Failed to log activity:", expect.anything());
    err.mockRestore();
  });

  it("skips the audit write entirely when signed out", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } } as never);
    await logActivity("did_thing", "thing", "id1");
    expect(activityInsert).not.toHaveBeenCalled();
  });
});
