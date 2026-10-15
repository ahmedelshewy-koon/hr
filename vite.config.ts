import {
  fileURLToPath,
} from "node:url";

import vinext from "vinext";
import {
  defineConfig,
} from "vite";

import hostingConfig
  from "./.openai/hosting.json";

import {
  sites,
} from "./build/sites-vite-plugin";

const { r2 } =
  hostingConfig;

const isCodexSeatbeltSandbox =
  process.env.CODEX_SANDBOX === "seatbelt";

const isVpsSelfHost =
  process.env.VPS_SELF_HOST === "1";

const cloudflareWorkersShim =
  fileURLToPath(
    new URL(
      "./worker/vps-cloudflare-env.ts",
      import.meta.url,
    ),
  );

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: [
    "nodejs_compat",
  ],
  d1_databases: [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name:
            "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(
  async () => {

    process.env.WRANGLER_WRITE_LOGS
      ??= "false";

    process.env.WRANGLER_LOG_PATH
      ??= ".wrangler/logs";

    process.env.MINIFLARE_REGISTRY_PATH
      ??= ".wrangler/registry";

    const plugins: any[] = [
      vinext(),
      sites(),
    ];

    if (!isVpsSelfHost) {

      const {
        cloudflare,
      } = await import(
        "@cloudflare/vite-plugin"
      );

      plugins.push(
        cloudflare({
          viteEnvironment: {
            name: "rsc",
            childEnvironments: [
              "ssr",
            ],
          },
          config:
            localBindingConfig,
        }),
      );
    }

    return {

      resolve:
        isVpsSelfHost
          ? {
              alias: {
                "cloudflare:workers":
                  cloudflareWorkersShim,
              },
            }
          : undefined,

      server:
        isCodexSeatbeltSandbox
          ? {
              watch: {
                useFsEvents: false,
                usePolling: true,
              },
            }
          : undefined,

      plugins,
    };
  },
);
