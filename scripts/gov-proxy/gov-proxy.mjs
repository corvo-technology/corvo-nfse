#!/usr/bin/env node
// Minimal authenticated HTTP CONNECT proxy, restricted to an exact list of government hosts
// (NFS-e Sefin/ADN and the SEFAZ/SVC of NF-e/NFC-e) on port 443.
// No dependencies. Needs Node 18+. It never reads the traffic: it only opens a TCP pipe.
//
//   PROXY_USER=corvo PROXY_PASS='long-random' node scripts/gov-proxy/gov-proxy.mjs
//
// Env: PROXY_USER, PROXY_PASS (required), PORT (default 3128), HOST (default 0.0.0.0),
//      ALLOWED_HOSTS (comma list of exact hosts; default: the list below, kept equal to the API allowlist by a test).
// Logs only: timestamp, target host and status. Never credentials, never payloads.
import http from "node:http";
import net from "node:net";
import { createHash, timingSafeEqual } from "node:crypto";

const user = process.env.PROXY_USER;
const pass = process.env.PROXY_PASS;
if (!user || !pass) {
  console.error("Set PROXY_USER and PROXY_PASS.");
  process.exit(1);
}
const port = Number(process.env.PORT ?? 3128);
const listenHost = process.env.HOST ?? "0.0.0.0";
const DEFAULT_HOSTS = [
  "adn.nfse.gov.br",
  "adn.producaorestrita.nfse.gov.br",
  "hnfe.fazenda.mg.gov.br",
  "hnfe.sefaz.ba.gov.br",
  "hom.nfe.sefaz.ms.gov.br",
  "hom.sefazvirtual.fazenda.gov.br",
  "hom.svc.fazenda.gov.br",
  "homnfe.sefaz.am.gov.br",
  "homolog.sefaz.go.gov.br",
  "homologacao.nfce.fazenda.sp.gov.br",
  "homologacao.nfe.fazenda.sp.gov.br",
  "homologacao.nfe.sefa.pr.gov.br",
  "homologacao.sefaz.mt.gov.br",
  "nfce.fazenda.sp.gov.br",
  "nfe-homologacao.sefazrs.rs.gov.br",
  "nfe-homologacao.svrs.rs.gov.br",
  "nfe.fazenda.mg.gov.br",
  "nfe.fazenda.sp.gov.br",
  "nfe.sefa.pr.gov.br",
  "nfe.sefaz.am.gov.br",
  "nfe.sefaz.ba.gov.br",
  "nfe.sefaz.go.gov.br",
  "nfe.sefaz.ms.gov.br",
  "nfe.sefaz.mt.gov.br",
  "nfe.sefaz.pe.gov.br",
  "nfe.sefazrs.rs.gov.br",
  "nfe.svrs.rs.gov.br",
  "nfehomolog.sefaz.pe.gov.br",
  "sefin.nfse.gov.br",
  "sefin.producaorestrita.nfse.gov.br",
  "www.sefazvirtual.fazenda.gov.br",
  "www.svc.fazenda.gov.br",
].join(",");
const allowed = (process.env.ALLOWED_HOSTS ?? DEFAULT_HOSTS)
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

const digest = (v) => createHash("sha256").update(v).digest();
const expected = digest(
  `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
);

const hostAllowed = (h) => allowed.includes(h);
const log = (host, status) =>
  console.log(`${new Date().toISOString()} ${host} ${status}`);

const server = http.createServer((_req, res) => {
  res.writeHead(405).end(); // only CONNECT is supported
});

server.on("connect", (req, client, head) => {
  const [host = "", p = ""] = (req.url ?? "").split(":");
  const target = host.toLowerCase();
  const refuse = (code, text, extra = "") => {
    client.end(`HTTP/1.1 ${code} ${text}\r\n${extra}\r\n`);
    log(target || "-", code);
  };
  const auth = digest(req.headers["proxy-authorization"] ?? "");
  if (!timingSafeEqual(auth, expected)) {
    return refuse(
      407,
      "Proxy Authentication Required",
      'Proxy-Authenticate: Basic realm="gov-proxy"\r\n',
    );
  }
  if (p !== "443" || !hostAllowed(target)) return refuse(403, "Forbidden");

  let connected = false;
  const upstream = net.connect(443, target, () => {
    connected = true;
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
    log(target, 200);
  });
  upstream.setTimeout(60_000, () => upstream.destroy());
  upstream.on("error", () => {
    if (!connected) refuse(502, "Bad Gateway");
    client.destroy();
  });
  client.on("error", () => upstream.destroy());
  client.on("close", () => upstream.destroy());
});

server.listen(port, listenHost, () =>
  console.log(
    `gov-proxy listening on ${listenHost}:${port} (allowed: ${allowed.join(", ")})`,
  ),
);
