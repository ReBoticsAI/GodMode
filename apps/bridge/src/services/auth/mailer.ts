import { config } from "../../config.js";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Transactional mail: Resend HTTP API or SMTP (nodemailer optional dynamic import).
 * When no provider is configured, logs in non-production and throws in production hubs.
 */
export async function sendMail(input: SendMailInput): Promise<void> {
  const from = config.email.from;
  const provider = config.email.provider;

  if (provider === "resend") {
    const key = config.email.resendApiKey;
    if (!key) throw new Error("RESEND_API_KEY is not configured");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html ?? undefined,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Resend failed: ${res.status} ${body}`);
    }
    return;
  }

  if (provider === "smtp") {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth:
        config.email.smtp.user && config.email.smtp.pass
          ? { user: config.email.smtp.user, pass: config.email.smtp.pass }
          : undefined,
    });
    await transport.sendMail({
      from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return;
  }

  if (config.isProduction) {
    throw new Error("EMAIL_PROVIDER is not configured for production mail");
  }
  console.info("[mail:dev]", { to: input.to, subject: input.subject, text: input.text });
}

export function verificationEmail(opts: { to: string; link: string }) {
  return {
    to: opts.to,
    subject: "Verify your GodMode email",
    text: `Verify your email by opening this link:\n\n${opts.link}\n\nIf you did not sign up, ignore this message.`,
    html: `<p>Verify your email:</p><p><a href="${opts.link}">${opts.link}</a></p>`,
  };
}

export function resetPasswordEmail(opts: { to: string; link: string }) {
  return {
    to: opts.to,
    subject: "Reset your GodMode password",
    text: `Reset your password:\n\n${opts.link}\n\nThis link expires soon. If you did not request it, ignore this message.`,
    html: `<p>Reset your password:</p><p><a href="${opts.link}">${opts.link}</a></p>`,
  };
}
