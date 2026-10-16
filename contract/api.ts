// The server's answers about the learner and about itself.

import { Schema } from "effect";
import { UserId } from "./ids";

/** AI words this month: one credit per word. */
export const Credits = Schema.Struct({ used: Schema.Number, limit: Schema.Number, left: Schema.Number, period: Schema.String });
export type Credits = typeof Credits.Type;

/** GET /api/me: the signed-in learner. */
export const Me = Schema.Struct({ id: UserId, email: Schema.NullOr(Schema.String), anonymous: Schema.Boolean, credits: Credits, ai: Schema.Boolean });
export type Me = typeof Me.Type;

/** GET /api/server: this server's release, the oldest app version it accepts writes from, and what it can do now. Public. */
export const ServerInfo = Schema.Struct({ release: Schema.String, minClientVersion: Schema.String, features: Schema.Struct({ ai: Schema.Boolean }) });
export type ServerInfo = typeof ServerInfo.Type;
