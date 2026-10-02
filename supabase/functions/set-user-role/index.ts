// Admin-only: changes another user's role between 'editor' and 'viewer'.
// Requires a fresh admin_mfa_sessions verification. The superuser's own
// role can never be changed through this function.
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

    const { userId, role } = await req.json();
    if (!userId || !["editor", "viewer"].includes(role)) {
      return json({ error: "Укажите userId и роль (editor или viewer)" }, 400);
    }
    if (userId === caller.id) {
      return json({ error: "Нельзя изменить собственную роль" }, 400);
    }

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
      return json({ error: "Только суперпользователь может менять роли" }, 403);
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
      return json({ error: "Нельзя изменить роль суперпользователя" }, 400);
    }

    const { error: updateErr } = await admin.from("profiles").update({ role }).eq("id", userId);
    if (updateErr) throw updateErr;

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
