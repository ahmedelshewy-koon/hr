// Register only for node --test, never for Vite/Cloudflare production builds.
import { register } from "node:module";
register("./workers-loader.mjs", import.meta.url);
