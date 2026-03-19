import https from "https";
import { URL } from "url";

/**
 * Force IPv4 for HTTPS requests (e.g. JWKS to AWS).
 * Use when networks have IPv6 connectivity issues to AWS.
 */
function ipv4HttpsRequest(options, callback) {
  const agent = new https.Agent({ family: 4, keepAlive: true });
  return https.request({ ...options, agent }, callback);
}

/**
 * Fetcher that uses IPv4-only HTTPS (aws-jwt-verify Fetcher interface).
 * fetch(uri, requestOptions?, data?) => Promise<ArrayBuffer>
 */
export class IPv4Fetcher {
  async fetch(uri, _requestOptions, _data) {
    const url = new URL(uri);
    const timeout = 10000;
    return new Promise((resolve, reject) => {
      const options = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "GET",
        timeout,
      };
      const req = ipv4HttpsRequest(options, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buffer = Buffer.concat(chunks);
          const arrayBuffer = buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength
          );
          resolve(arrayBuffer);
        });
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Request timeout"));
      });
      req.end();
    });
  }
}
