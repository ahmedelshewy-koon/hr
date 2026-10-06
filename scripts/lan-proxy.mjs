// Exposes the local dev server (127.0.0.1:3000) on the LAN without restarting it.
// Usage: node scripts/lan-proxy.mjs [lanHost] [port]
import net from "node:net";
import os from "node:os";

const port = Number(process.argv[3] || 3000);
const lanHost = process.argv[2] || Object.values(os.networkInterfaces()).flat()
  .find((a) => a && a.family === "IPv4" && a.address.startsWith("192.168.1."))?.address;
if (!lanHost) throw new Error("No 192.168.1.x address found; pass one as the first argument");

net.createServer((client) => {
  const upstream = net.connect(port, "localhost");
  client.pipe(upstream).pipe(client);
  const close = () => { client.destroy(); upstream.destroy(); };
  client.on("error", close);
  upstream.on("error", close);
}).listen(port, lanHost, () => console.log(`LAN proxy: http://${lanHost}:${port} -> 127.0.0.1:${port}`));
