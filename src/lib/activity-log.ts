import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface ActivityLog {
  id: string;
  user_id: string;
  user_email: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

/**
 * Records an audit entry without blocking the caller.
 *
 * Two deliberate choices, both about latency. `getSession` reads the cached JWT
 * locally, where `getUser` makes a network round trip to the auth server on
 * every call — and this runs after nearly every write in the app. The insert is
 * then not awaited: no caller can act on the result (failures are swallowed and
 * logged), so waiting for it only delays the user's confirmation. The trade-off
 * matches `notify` in api.ts — a tab closed within a moment of the action may
 * drop that one log line, while the record it describes is already saved.
 *
 * Stays `async` so the existing `await logActivity(...)` call sites are
 * unaffected; they now resolve immediately.
 */
export async function logActivity(
  action: string,
  entityType: string,
  entityId?: string,
  details?: Record<string, unknown>
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return;

    void db
      .from("activity_logs")
      .insert({
        user_id: user.id,
        user_email: user.email || "",
        action,
        entity_type: entityType,
        entity_id: entityId || null,
        details: details || {},
      })
      .then(({ error }: { error: unknown }) => {
        if (error) console.error("Failed to log activity:", error);
      });
  } catch (e) {
    console.error("Failed to log activity:", e);
  }
}

export async function getActivityLogs(): Promise<ActivityLog[]> {
  const { data, error } = await db
    .from("activity_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data;
}
