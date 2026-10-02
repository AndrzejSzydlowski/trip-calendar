// Admin-only: invites a new user by email with a given role ('editor' | 'viewer').
// Requires a fresh admin_mfa_sessions verification (see verify-mfa-code).
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

    const { email, role } = await req.json();
    if (!email || !["editor", "viewer"].includes(role)) {
      return json({ error: "Укажите email и роль (editor или viewer)" }, 400);
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
      return json({ error: "Только суперпользователь может приглашать участников" }, 403);
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

    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email);
    if (inviteErr) throw inviteErr;

    const { error: profileErr } = await admin.from("profiles").upsert({
      id: invited.user.id,
      email,
      role,
      invited_by: caller.id,
    });
    if (profileErr) throw profileErr;

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
