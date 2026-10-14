// Node.js test-only loader: the Cloudflare virtual module is absent outside Workers.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") {
    return {
      url: new URL("../worker/vps-cloudflare-env.ts", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
