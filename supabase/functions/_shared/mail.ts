// Minimal transactional-email helper built on the Resend API.
// Set the RESEND_API_KEY and MFA_FROM_EMAIL secrets (see supabase/README.md).
export async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("MFA_FROM_EMAIL") ?? "Trip Calendar <onboarding@resend.dev>";
  if (!apiKey) {
    throw new Error("RESEND_API_KEY secret is not configured");
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to send email: ${res.status} ${text}`);
  }
}

export function generateCode(): string {
  // 6-digit numeric code, zero-padded.
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, "0");
}

export async function hashCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
