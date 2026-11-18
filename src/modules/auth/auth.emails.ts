import type { EmailMessage } from "../../services/email.service";

export type LinkSettings = { frontendUrl: string | undefined; appScheme: string };

export function buildAuthLink(settings: LinkSettings, path: "reset-password" | "verify-email", token: string): string {
  const query = `token=${encodeURIComponent(token)}`;
  return settings.frontendUrl ? `${settings.frontendUrl}/${path}?${query}` : `${settings.appScheme}://${path}?${query}`;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, intro: string, button: string, link: string, footer: string): string {
  const href = escapeHtml(link);
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2333">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;padding:32px">
<tr><td style="font-size:20px;font-weight:700;color:#208AEF;padding-bottom:24px">AgentDesk</td></tr>
<tr><td style="font-size:22px;font-weight:600;padding-bottom:12px">${escapeHtml(title)}</td></tr>
<tr><td style="font-size:15px;line-height:22px;padding-bottom:24px">${escapeHtml(intro)}</td></tr>
<tr><td style="padding-bottom:24px"><a href="${href}" style="display:inline-block;background:#208AEF;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:10px">${escapeHtml(button)}</a></td></tr>
<tr><td style="font-size:13px;line-height:20px;color:#5b6475;padding-bottom:8px">If the button does not work, open this link:</td></tr>
<tr><td style="font-size:13px;line-height:20px;word-break:break-all;padding-bottom:24px"><a href="${href}" style="color:#208AEF">${href}</a></td></tr>
<tr><td style="font-size:13px;line-height:20px;color:#5b6475">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function verificationEmail(to: string, link: string): EmailMessage {
  const intro = "Confirm this email address for your AgentDesk account. The link works once and expires in 24 hours.";
  const footer = "If you did not create an AgentDesk account, you can ignore this email.";
  return {
    to,
    subject: "Verify your email for AgentDesk",
    html: layout("Verify your email", intro, "Verify email", link, footer),
    text: `AgentDesk\n\n${intro}\n\n${link}\n\n${footer}\n`,
  };
}

export function passwordResetEmail(to: string, link: string): EmailMessage {
  const intro = "Someone asked to reset the password for your AgentDesk account. The link works once and expires in 15 minutes.";
  const footer = "If this was not you, ignore this email. Your password stays the same.";
  return {
    to,
    subject: "Reset your AgentDesk password",
    html: layout("Reset your password", intro, "Reset password", link, footer),
    text: `AgentDesk\n\n${intro}\n\n${link}\n\n${footer}\n`,
  };
}
