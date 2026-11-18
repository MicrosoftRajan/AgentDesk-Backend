export type EmailMessage = { to: string; subject: string; html: string; text: string };

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class EmailSendError extends Error {
  constructor(readonly code: string) {
    super("Email could not be sent");
    this.name = "EmailSendError";
  }
}

const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export function createResendSender(options: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
}): EmailSender {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async send(message) {
      let response: Response;
      try {
        response = await fetchImpl(RESEND_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: options.from, to: [message.to], subject: message.subject, html: message.html, text: message.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        const name = error instanceof Error ? error.name : "unknown";
        throw new EmailSendError(name === "TimeoutError" ? "RESEND_TIMEOUT" : "RESEND_NETWORK");
      }

      await response.arrayBuffer().catch(() => undefined);
      if (!response.ok) throw new EmailSendError(`RESEND_HTTP_${response.status}`);
    },
  };
}
