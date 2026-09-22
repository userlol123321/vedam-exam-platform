const https = require("https");
const http = require("http");
const dns = require("dns").promises;

const MAX_DATASET_BYTES = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min
const cache = new Map();

const PRIVATE_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/,
  /^fc/,
  /^fd/,
];

function isPrivateIp(ip) {
  return PRIVATE_RANGES.some((re) => re.test(ip));
}

function normalizeUrl(url) {
  const u = new URL(url);
  if (u.protocol !== "https:") {
    throw new Error("Dataset URL must be https");
  }
  return u;
}

async function resolveHost(u) {
  const { address } = await dns.lookup(u.hostname);
  if (isPrivateIp(address)) {
    throw new Error("Dataset URL resolves to a private address");
  }
  return address;
}

function fetchBody(u, address, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = (u.protocol === "https:" ? https : http).request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "GET",
        headers: { "User-Agent": "vedam-exam-platform", Accept: "*/*" },
        timeout: timeoutMs,
        // Connect to the pre-verified address while keeping the real hostname
        // so the TLS SNI + cert match stays intact.
        lookup: (hostname, opts, cb) => {
          if (opts?.all) return cb(null, [{ address, family: 4 }]);
          return cb(null, address, 4);
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirect = new URL(res.headers.location, u.href);
          if (redirect.protocol !== "https:") {
            reject(new Error("Dataset redirect must be https"));
          }
          res.resume();
          resolve({ redirect });
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Dataset fetch failed with HTTP ${res.statusCode}`));
          return;
        }
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_DATASET_BYTES) {
            res.destroy(new Error(`Dataset exceeds ${MAX_DATASET_BYTES} bytes limit`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        res.on("error", reject);
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Dataset fetch timed out"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fetchDataset(url) {
  if (!url) throw new Error("No dataset URL provided");
  const u = normalizeUrl(String(url).trim());
  const key = u.href;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { content: cached.content, cached: true };
  }

  const base = await fetchBodyResolved(u, FETCH_TIMEOUT_MS);
  cache.set(key, { content: base, at: Date.now() });
  return { content: base, cached: false };
}

async function fetchBodyResolved(u, timeoutMs) {
  const address = await resolveHost(u);
  const attempt = await fetchBody(u, address, timeoutMs);
  if (attempt.redirect) {
    return fetchBodyResolved(attempt.redirect, timeoutMs);
  }
  return attempt;
}

module.exports = { fetchDataset, MAX_DATASET_BYTES };