// Sends a one-time 6-digit code to the caller's own email.
// Callable by any authenticated user whose profile role is 'admin' —
// used both for login 2FA and before sensitive admin actions.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, handleOptions, json } from "../_shared/cors.ts";
import { generateCode, hashCode, sendEmail } from "../_shared/mail.ts";

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

    const { purpose = "login" } = await req.json().catch(() => ({}));
    if (!["login", "admin_action"].includes(purpose)) {
      return json({ error: "Некорректная цель кода" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "admin") {
      return json({ error: "Код 2FA доступен только суперпользователю" }, 403);
    }

    const code = generateCode();
    const codeHash = await hashCode(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin.from("mfa_codes").insert({
      user_id: user.id,
      purpose,
      code_hash: codeHash,
      expires_at: expiresAt,
    });
    if (insertErr) throw insertErr;

    await sendEmail(
      user.email!,
      "Ваш код подтверждения — Календарь поездок",
      `<p>Код подтверждения: <b style="font-size:20px">${code}</b></p>
       <p>Код действителен 10 минут. Если это были не вы — проигнорируйте письмо.</p>`,
    );

    return json({ ok: true, expiresAt });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
