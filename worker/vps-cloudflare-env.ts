import path from "node:path";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { Readable } from "node:stream";

function storageRoot() {
  const configured =
    String(process.env.HR_FILE_STORAGE_DIR || "").trim();

  if (!configured) return null;

  return path.resolve(configured);
}

function safeObjectPath(key: string) {
  const root = storageRoot();

  if (!root) {
    throw new Error(
      "HR_FILE_STORAGE_DIR is not configured",
    );
  }

  const target =
    path.resolve(root, key);

  if (
    target !== root &&
    !target.startsWith(root + path.sep)
  ) {
    throw new Error("Invalid storage object key");
  }

  return target;
}

async function bodyToBuffer(body: unknown) {
  if (Buffer.isBuffer(body)) {
    return body;
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body instanceof ArrayBuffer) {
    return Buffer.from(body);
  }

  const response =
    new Response(body as BodyInit);

  return Buffer.from(
    await response.arrayBuffer(),
  );
}

const localFiles = {

  async put(
    key: string,
    body: unknown,
    options: any = {},
  ) {
    const target =
      safeObjectPath(key);

    await mkdir(
      path.dirname(target),
      { recursive: true },
    );

    const bytes =
      await bodyToBuffer(body);

    await writeFile(
      target,
      bytes,
      { mode: 0o640 },
    );

    const metadata = {
      httpMetadata:
        options?.httpMetadata || {},
      customMetadata:
        options?.customMetadata || {},
    };

    await writeFile(
      `${target}.meta.json`,
      JSON.stringify(metadata),
      { mode: 0o640 },
    );

    return {};
  },

  async get(key: string) {
    const target =
      safeObjectPath(key);

    try {
      const bytes =
        await readFile(target);

      let metadata: any = {};

      try {
        metadata =
          JSON.parse(
            await readFile(
              `${target}.meta.json`,
              "utf8",
            ),
          );
      } catch {
        metadata = {};
      }

      return {
        body:
          Readable.toWeb(
            Readable.from(bytes),
          ),
        size: bytes.length,
        httpMetadata:
          metadata.httpMetadata || {},
        customMetadata:
          metadata.customMetadata || {},
      };

    } catch (error: any) {

      if (error?.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  },

  async delete(key: string) {
    const target =
      safeObjectPath(key);

    await rm(
      target,
      { force: true },
    );

    await rm(
      `${target}.meta.json`,
      { force: true },
    );
  },
};

export const env =
  new Proxy(
    {} as Record<string, unknown>,
    {
      get(_target, property) {

        const key =
          String(property);

        if (key === "FILES") {
          return storageRoot()
            ? localFiles
            : undefined;
        }

        return process.env[key];
      },
    },
  );

export class WorkerEntrypoint {}
export class DurableObject {}
export class WorkflowEntrypoint {}
