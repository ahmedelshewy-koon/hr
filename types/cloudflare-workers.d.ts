// Minimal ambient declaration for the Cloudflare Workers runtime module.
// The `@cloudflare/vite-plugin` runtime provides `cloudflare:workers` at build/run
// time but ships no type declarations, so `tsc` cannot resolve the import.
// Only the bindings/secrets bag (`env`) is consumed by this app.
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
