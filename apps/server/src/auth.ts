// Accounts, with Better Auth: email and password on the website, Google when
// it's configured, and a code-in-the-browser sign-in for the desktop app
// (the OAuth device flow). The desktop then keeps a bearer token.

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { desktopClientId } from "@rig/core";
import type { Env } from "./env";

/** Where requests from the Tauri desktop app come from (Windows uses the http one). */
export const desktopOrigins = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420"];

export function authOptions(env: Env, database: BetterAuthOptions["database"]): BetterAuthOptions {
  const google = env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
    : undefined;
  return {
    appName: "Rig",
    database,
    baseURL: env.WEB_ORIGIN,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.WEB_ORIGIN, ...desktopOrigins],
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    socialProviders: google,
    session: { expiresIn: 60 * 60 * 24 * 90, updateAge: 60 * 60 * 24 },
    // Kept in the database so the limits hold across Worker instances.
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60 },
    telemetry: { enabled: false },
    plugins: [
      bearer(),
      deviceAuthorization({
        // The desktop opens /app/?user_code=XXXX, where the website asks the person to approve.
        verificationUri: `${env.WEB_ORIGIN}/app/`,
        validateClient: (id) => id === desktopClientId,
        expiresIn: "15m",
        interval: "5s",
        userCodeLength: 8,
      }),
    ],
  };
}

export const makeAuth = (env: Env, database: BetterAuthOptions["database"]) => betterAuth(authOptions(env, database));
export type Auth = ReturnType<typeof makeAuth>;
