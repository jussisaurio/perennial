// Email: sign-in codes. Resend in production; an in-memory outbox in development.

import { Context, Effect, Layer, Schema } from "effect";
import { Resend } from "resend";
import { AppConfig, type Config } from "./config";

/** The provider refused the message. */
export class MailFailed extends Schema.TaggedError<MailFailed>()("MailFailed", { message: Schema.String }) {}

export interface Mailer {
  readonly send: (to: string, subject: string, text: string) => Effect.Effect<void, MailFailed>;
}

export class Mail extends Context.Service<Mail, Mailer>()("perennial/Mail") {}

/** Development: keep messages in memory so tests and the local app can read them. */
export class OutboxMailer implements Mailer {
  readonly outbox: { to: string; subject: string; text: string }[] = [];
  readonly send = Effect.fn("Mail.outbox")((to: string, subject: string, text: string) =>
    Effect.sync(() => {
      this.outbox.push({ to, subject, text });
      const code = subject.match(/\d{6}/)?.[0];
      console.log(code ? `[mail] sign-in code for ${to}: ${code}` : `[mail] to=${to} subject=${JSON.stringify(subject)}\n${text}`);
    }),
  );
  latest(to: string) {
    return [...this.outbox].reverse().find((m) => m.to === to);
  }
}

function resendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    send: Effect.fn("Mail.send")(function* (to: string, subject: string, text: string) {
      // A request that never got an answer (the network, a bug) rejects: a defect.
      const { error } = yield* Effect.promise(() => resend.emails.send({ from, to, subject, text }));
      if (error) return yield* new MailFailed({ message: `email failed: ${error.message}` });
    }),
  };
}

export function createMailer(config: Config): Mailer {
  return config.mail.resendKey && !config.dev ? resendMailer(config.mail.resendKey, config.mail.from) : new OutboxMailer();
}

export const MailLive = Layer.effect(Mail, Effect.map(AppConfig, createMailer));
