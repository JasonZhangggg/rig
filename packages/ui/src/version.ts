// The product version, put in at build time by each app's Vite config from
// the root package.json (pnpm version:set changes it).
declare const __RIG_VERSION__: string | undefined;

export const rigVersion: string = typeof __RIG_VERSION__ === "string" ? __RIG_VERSION__ : "dev";
