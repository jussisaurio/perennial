// The app version (package.json), sent with writes so the server can ask
// stale clients to reload. Bump it with every release that changes data.
declare const __APP_VERSION__: string;
// Vite defines it (vite.config.ts); unit tests run without Vite.
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

/**
 * The commit this app was built from, named as the server names its release
 * ("dev" locally). `||`, not `??`: the Docker build passes an unset var as "".
 */
export const RELEASE: string = (import.meta.env.VITE_RELEASE as string | undefined) || "dev";
