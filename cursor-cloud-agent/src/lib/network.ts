import { networkInterfaces } from "os";

export function getLanIp(): string | null {
  const interfaces = networkInterfaces();

  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;

    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }

  return null;
}

export function getNetworkInfo(port: number = 3100) {
  const lanIp = getLanIp();
  return {
    lanIp: lanIp || "localhost",
    port,
    url: lanIp ? `http://${lanIp}:${port}` : `http://localhost:${port}`,
  };
}
