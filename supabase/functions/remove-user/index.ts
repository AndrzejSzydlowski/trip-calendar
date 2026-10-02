// Admin-only: removes a user's access entirely (deletes their auth account).
// Requires a fresh admin_mfa_sessions verification. The superuser account
// can never be removed through this function.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Не авторизован" }, 401);
    const caller = userData.user;

    const { userId } = await req.json();
    if (!userId) return json({ error: "Укажите userId" }, 400);
    if (userId === caller.id) return json({ error: "Нельзя удалить самого себя" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .single();
    if (profile?.role !== "admin") {
      return json({ error: "Только суперпользователь может удалять участников" }, 403);
    }

    const { data: mfaRow } = await admin
      .from("admin_mfa_sessions")
      .select("verified_at")
      .eq("user_id", caller.id)
      .maybeSingle();
    const fresh = mfaRow && Date.now() - new Date(mfaRow.verified_at).getTime() < 12 * 60 * 60 * 1000;
    if (!fresh) {
      return json({ error: "Требуется подтверждение по коду (2FA)" }, 403);
    }

    const { data: target } = await admin.from("profiles").select("role").eq("id", userId).single();
    if (target?.role === "admin") {
      return json({ error: "Нельзя удалить суперпользователя" }, 400);
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) throw delErr;

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
