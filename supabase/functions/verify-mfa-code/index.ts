// Verifies a 6-digit code sent by send-mfa-code. On success, refreshes
// the caller's admin_mfa_sessions row (what RLS checks for sensitive
// profile/invite actions).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";
import { hashCode } from "../_shared/mail.ts";

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
    const user = userData.user;

    const { code, purpose = "login" } = await req.json();
    if (!code || typeof code !== "string") {
      return json({ error: "Введите код" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const codeHash = await hashCode(code.trim());

    const { data: row, error: findErr } = await admin
      .from("mfa_codes")
      .select("id, expires_at, consumed")
      .eq("user_id", user.id)
      .eq("purpose", purpose)
      .eq("code_hash", codeHash)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!row) return json({ error: "Неверный код" }, 400);
    if (row.consumed) return json({ error: "Код уже использован" }, 400);
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return json({ error: "Срок действия кода истёк" }, 400);
    }

    await admin.from("mfa_codes").update({ consumed: true }).eq("id", row.id);

    await admin
      .from("admin_mfa_sessions")
      .upsert({ user_id: user.id, verified_at: new Date().toISOString() });

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
