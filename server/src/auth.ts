// Accounts with Better Auth: email one-time codes now, social login later
// (one `account` row per sign-in method), and anonymous users.
//
// Anonymous learners: the app creates an anonymous user on the first write
// ("Start learning"). Signing in with email from that session links the
// accounts: Better Auth creates (or finds) the real user, calls onLinkAccount,
// then deletes the anonymous user. We move the learner's data first, in one
// transaction, merging with what the real account already has.

import { PgClient } from "@effect/sql-pg";
import { betterAuth } from "better-auth";
import { anonymous, captcha, emailOTP } from "better-auth/plugins";
import { Effect } from "effect";
import { Pool } from "pg";
import type { Config } from "./config";
import { CLIENT_IP_HEADER } from "./clientIp";
import type { GardenLeft, GardenPot } from "perennial-contract";
import { theRow } from "./db";
import { mergeLeft, mergePot } from "./garden";
import { event, log } from "./log";
import type { Mailer } from "./mail";

const mergeUsers = Effect.fn("Auth.mergeUsers")(function* (from: string, to: string) {
  if (from === to) return;
  const sql = yield* PgClient.PgClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      // Better Auth deletes the anonymous user after this transaction, and its
      // rows go with it. So: wait for writes already in progress (they lock the
      // row too, sync.ts applyWrites) and move their rows, and end the anonymous
      // sessions so a write arriving later is refused, not lost.
      yield* sql`select id from "user" where id = ${from} for update`;
      yield* sql`delete from session where "userId" = ${from}`;
      // Rows with a globally unique id (made on the client): just change the owner.
      yield* sql`update review set user_id = ${to} where user_id = ${from}`;
      yield* sql`update user_word set user_id = ${to} where user_id = ${from}`;
      yield* sql`update user_sentence set user_id = ${to} where user_id = ${from}`;
      // Rows with a natural key: the newer one wins.
      yield* sql`insert into word_state (user_id, word_id, status, queued_at, updated_at)
        select ${to}, word_id, status, queued_at, updated_at from word_state where user_id = ${from}
        on conflict (user_id, word_id) do update set status = excluded.status, queued_at = excluded.queued_at, updated_at = excluded.updated_at
        where excluded.updated_at > word_state.updated_at`;
      // A course on both: the garden's bowl and shelf (#351) and its pot (#387) merge as two devices' writes do (garden.ts
      // mergeLeft, mergePot), with the anonymous one as the write: the newer thing left wins, and on a tie the account's. The
      // account's row is locked as it is read, so a write from its other device waits and is merged, not overwritten.
      const both = yield* sql<{ lang: string; account: GardenLeft; anon: GardenLeft; account_pot: GardenPot; anon_pot: GardenPot }>`select f.lang,
        t.garden_left as account, f.garden_left as anon, t.garden_pot as account_pot, f.garden_pot as anon_pot
        from course f join course t on t.user_id = ${to} and t.lang = f.lang where f.user_id = ${from} for update of t`;
      // A course the real account already has keeps its settings; a door opened on either stays open.
      yield* sql`insert into course (user_id, lang, minutes, retention, door_open, garden_left, garden_pot, created_at)
        select ${to}, lang, minutes, retention, door_open, garden_left, garden_pot, created_at from course where user_id = ${from}
        on conflict (user_id, lang) do update set door_open = course.door_open or excluded.door_open`;
      for (const c of both)
        yield* sql`update course set garden_left = ${sql.json(mergeLeft(c.account, c.anon))}, garden_pot = ${sql.json(mergePot(c.account_pot, c.anon_pot))}
          where user_id = ${to} and lang = ${c.lang}`;
      yield* sql`insert into ai_usage (user_id, period, used)
        select ${to}, period, used from ai_usage where user_id = ${from}
        on conflict (user_id, period) do update set used = ai_usage.used + excluded.used`;
    }),
  );
});

export function createAuth(config: Config, sql: PgClient.PgClient, mailer: Mailer) {
  /** Our queries, from Better Auth's Promise callbacks; a failure rejects, as a throw did. */
  const run = <A, E>(effect: Effect.Effect<A, E, PgClient.PgClient>) => Effect.runPromise(Effect.provideService(effect, PgClient.PgClient, sql));
  // Better Auth has no adapter for sql-pg (and sql-pg cannot share a pg pool); it gets a small pg pool of its own.
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
    // Wide-event facts for the request's log line (log.ts): who signed up, and how they signed in.
    databaseHooks: {
      user: { create: { after: async (user) => event({ signup: user.isAnonymous ? "anonymous" : "email" }) } },
      session: {
        create: {
          after: async (session, ctx) => event({ userId: session.userId, signin: ctx?.path === "/sign-in/anonymous" ? "anonymous" : ctx?.path === "/sign-in/email-otp" ? "email" : (ctx?.path ?? "other") }),
        },
      },
    },
    advanced: {
      database: { generateId: "uuid" },
      // Worked out from CLIENT_IP_HEADERS by clientIp.ts (cf-connecting-ip only via Cloudflare).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * 60,
        allowedAttempts: 5,
        // Asking again sends the same code while it is valid, so the code in
        // any of the emails works (a new code per request made older emails fail).
        resendStrategy: "reuse",
        async sendVerificationOTP({ email, otp }) {
          // The response is the same either way, so a capped address learns nothing.
          if (!(await run(mayMail(config, email)))) {
            event({ otp: "capped" });
            return log.warn("sign-in code not sent: per-email limit", {});
          }
          event({ otp: "sent" });
          await Effect.runPromise(mailer.send(email, `${otp} is your Perennial code`, `Your sign-in code is ${otp}.\n\nIt works for 10 minutes. If you did not ask for it, you can ignore this email.`));
        },
      }),
      anonymous({
        async onLinkAccount({ anonymousUser, newUser }) {
          await run(mergeUsers(anonymousUser.user.id, newUser.user.id));
          event({ linkedFrom: anonymousUser.user.id });
        },
      }),
      // Bot check where accounts and emails are created (the client sends the
      // token in x-captcha-response).
      ...(config.turnstile.secretKey
        ? [captcha({ provider: "cloudflare-turnstile", secretKey: config.turnstile.secretKey, endpoints: ["/sign-in/anonymous", "/email-otp/send-verification-otp"] })]
        : []),
    ],
  });
  return { auth, pool };
}

/** Records a code for this address, unless it already had its share (per 15 minutes and per day). */
const mayMail = Effect.fn("Auth.mayMail")(function* (config: Config, email: string) {
  const sql = yield* PgClient.PgClient;
  // Keyed with the server secret: without it, a guessed address can't be checked against the log.
  const hash = new Bun.CryptoHasher("sha256", config.secret).update(email.trim().toLowerCase()).digest("hex");
  const { short, day } = yield* theRow(sql<{ short: number; day: number }>`select
      count(*) filter (where sent_at > now() - interval '15 minutes')::int as short,
      count(*)::int as day
    from mail_log where email_hash = ${hash} and sent_at > now() - interval '1 day'`);
  if (short >= config.codesPerEmail.short || day >= config.codesPerEmail.day) return false;
  yield* sql`insert into mail_log (email_hash) values (${hash})`;
  return true;
});
