// Accounts with Better Auth: email one-time codes now, social login later
// (one `account` row per sign-in method), and anonymous users.
//
// Anonymous learners: the app creates an anonymous user on the first write
// ("Start learning"). Signing in with email from that session links the
// accounts: Better Auth creates (or finds) the real user, calls onLinkAccount,
// then deletes the anonymous user. We move the learner's data first, in one
// transaction, merging with what the real account already has.

import type { SQL } from "bun";
import { betterAuth } from "better-auth";
import { anonymous, captcha, emailOTP } from "better-auth/plugins";
import { Pool } from "pg";
import type { Config } from "./config";
import { log } from "./log";
import type { Mailer } from "./mail";

export async function mergeUsers(sql: SQL, from: string, to: string) {
  await sql.begin(async (tx) => {
    // Rows with a globally unique id (made on the client): just change the owner.
    await tx`update review set user_id = ${to} where user_id = ${from}`;
    await tx`update user_word set user_id = ${to} where user_id = ${from}`;
    await tx`update user_sentence set user_id = ${to} where user_id = ${from}`;
    // Rows with a natural key: the newer one wins.
    await tx`insert into word_state (user_id, word_id, status, queued_at, updated_at)
      select ${to}, word_id, status, queued_at, updated_at from word_state where user_id = ${from}
      on conflict (user_id, word_id) do update set status = excluded.status, queued_at = excluded.queued_at, updated_at = excluded.updated_at
      where excluded.updated_at > word_state.updated_at`;
    // A course the real account already has keeps its settings.
    await tx`insert into course (user_id, lang, minutes, retention, created_at)
      select ${to}, lang, minutes, retention, created_at from course where user_id = ${from}
      on conflict (user_id, lang) do nothing`;
    await tx`insert into ai_usage (user_id, period, used)
      select ${to}, period, used from ai_usage where user_id = ${from}
      on conflict (user_id, period) do update set used = ai_usage.used + excluded.used`;
  });
}

export function createAuth(config: Config, sql: SQL, mailer: Mailer) {
  // Better Auth has no adapter for Bun's Postgres client; it gets a small pg pool.
  const pool = new Pool({ connectionString: config.databaseUrl, max: 4 });
  const auth = betterAuth({
    database: pool,
    baseURL: config.appUrl,
    secret: config.secret,
    session: {
      expiresIn: 60 * 60 * 24 * 90, // 90 days, renewed while in use
      updateAge: 60 * 60 * 24,
      // No cookie cache: a signed-out or deleted user must lose access at once,
      // and one session lookup per request is cheap at our scale.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: !config.dev,
      window: 60,
      max: 100,
      storage: "database",
      // Codes by email are the main abuse target (email bombing).
      customRules: { "/email-otp/send-verification-otp": { window: 300, max: 3 }, "/sign-in/anonymous": { window: 3600, max: 20 } },
    },
    // Better Auth's own messages go through our structured log (with the
    // request id). Of the extra arguments only errors are kept: the rest can
    // be anything, users and request bodies included.
    logger: {
      log(level, message, ...args) {
        log[level](`auth: ${message}`, { err: args.find((a) => a instanceof Error) });
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: config.clientIpHeaders },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        async sendVerificationOTP({ email, otp }) {
          // The response is the same either way, so a capped address learns nothing.
          if (!(await mayMail(sql, config, email))) return log.warn("sign-in code not sent: per-email limit", {});
          await mailer.send(email, `${otp} is your Perennial code`, `Your sign-in code is ${otp}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.`);
        },
      }),
      anonymous({
        async onLinkAccount({ anonymousUser, newUser }) {
          await mergeUsers(sql, anonymousUser.user.id, newUser.user.id);
          log.info("anonymous user linked", { from: anonymousUser.user.id, to: newUser.user.id });
        },
      }),
      // Bot check where accounts and emails are created (the client sends the
      // token in x-captcha-response).
      ...(config.turnstile.secretKey
        ? [captcha({ provider: "cloudflare-turnstile", secretKey: config.turnstile.secretKey, endpoints: CAPTCHA_ENDPOINTS })]
        : []),
    ],
  });
  return { auth, pool };
}

export const CAPTCHA_ENDPOINTS = ["/sign-in/anonymous", "/email-otp/send-verification-otp"];

/** Records a code for this address, unless it already had its share (per 15 minutes and per day). */
async function mayMail(sql: SQL, config: Config, email: string) {
  const hash = new Bun.CryptoHasher("sha256").update(email.trim().toLowerCase()).digest("hex");
  const [{ short, day }] = await sql`select
      count(*) filter (where sent_at > now() - interval '15 minutes')::int as short,
      count(*)::int as day
    from mail_log where email_hash = ${hash} and sent_at > now() - interval '1 day'`;
  if (short >= config.codesPerEmail.short || day >= config.codesPerEmail.day) return false;
  await sql`insert into mail_log (email_hash) values (${hash})`;
  return true;
}

export type Auth = ReturnType<typeof createAuth>["auth"];
