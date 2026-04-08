import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins/admin";
import { db } from "./db.js";

async function sendWelcomeEmail(name: string, email: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;

  const from = process.env.RESEND_FROM ?? "Scrappy <noreply@scrappy.studio>";
  const notifyTo = process.env.CONTACT_TO ?? "hello@scrappy.studio";

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#131313;font-family:'Inter',sans-serif;color:#e2e2e2;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#131313;padding:48px 24px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#1f1f1f;border:1px solid rgba(255,255,255,0.08);border-radius:4px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="padding:32px 36px 24px;border-bottom:1px solid rgba(255,255,255,0.06);">
            <span style="font-size:11px;font-weight:900;letter-spacing:0.14em;text-transform:uppercase;color:#ff590a;">● Scrappy</span>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px;">
            <h1 style="margin:0 0 16px;font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#e2e2e2;">
              You're on the list, ${name.split(" ")[0]}.
            </h1>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#a0a0a0;">
              Thank you for signing up for <strong style="color:#e2e2e2;">Scrappy</strong> — the AI-powered web scraping and structured data extraction engine.
            </p>
            <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#a0a0a0;">
              We're putting the finishing touches on our hosted trial. As soon as it's ready, you'll be the first to know.
            </p>
            <p style="margin:0 0 32px;font-size:15px;line-height:1.7;color:#a0a0a0;">
              In the meantime, if you'd like an early preview or want to tell us about your use case, just reply to this email — we'd love to hear from you.
            </p>
            <a href="mailto:${notifyTo}?subject=Preview%20Request"
               style="display:inline-block;background:#ff590a;color:#380c00;padding:12px 28px;border-radius:2px;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.04em;text-transform:uppercase;">
              Request a Preview
            </a>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 36px;border-top:1px solid rgba(255,255,255,0.06);">
            <p style="margin:0;font-size:11px;color:#4a4a4a;letter-spacing:0.06em;text-transform:uppercase;font-family:'Space Grotesk',sans-serif;">
              © 2025 Scrappy · You're receiving this because you signed up at scrappy.studio
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: email, subject: "You're on the Scrappy list", html }),
  });

  // Notify ourselves
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: notifyTo,
      subject: `New signup: ${email}`,
      html: `<p>New Scrappy signup: <strong>${name}</strong> &lt;${email}&gt;</p>`,
    }),
  });
}

if (!process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET env var is required");
}

export const auth = betterAuth({
  database: db,
  emailAndPassword: { enabled: true },
  session: {
    expiresIn: 60 * 60 * 24 * 30,   // 30 days
    updateAge: 60 * 60 * 24,          // refresh daily
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  plugins: [admin()],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          if (user.email === "daniel@megazord.studio") {
            db.prepare(`UPDATE "user" SET role = 'admin' WHERE id = ?`).run(user.id);
          }
          await sendWelcomeEmail(user.name, user.email).catch(console.error);
        },
      },
    },
  },
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_BASE_URL ?? "http://localhost:3000",
  basePath: "/api/auth",
  trustedOrigins: [
    "http://localhost:5173",
    ...(process.env.TRUSTED_ORIGINS ? process.env.TRUSTED_ORIGINS.split(",") : []),
  ],
});
