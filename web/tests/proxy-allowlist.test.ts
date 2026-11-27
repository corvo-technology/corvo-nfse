import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { proxyRoutes } from "@/lib/proxy-routes";

/**
 * Every call the dashboard makes goes through `request("/path", options)` and then the proxy,
 * which answers 404 "Route unavailable" to anything not in the allowlist. This reads the call
 * sites and fails when one is not allowed (the "Tentar de novo" button once broke this way).
 */
/** Every source file that can call `request(...)`: new call sites are picked up without editing this test. */
const ROOTS = ["lib", "components", "app"];
const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? sources(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
});
/** Path pieces that are one of a few fixed words rather than an id. */
const WORDS: Record<string, string[]> = { direction: ["upgrade", "downgrade"], kind: ["xml", "pdf"], "idPath(uf)": ["SP"], tpAmb: ["1", "2"] };
const ID = "12345678901234"; // satisfies [^/]+, \d+ and the 14-character CNPJ pattern alike

/** The text between the call's parentheses, skipping strings and `${...}` so nested brackets balance. */
function callArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'") {
      for (i++; source[i] !== c; i++) if (source[i] === "\\") i++;
    } else if (c === "`") {
      for (i++; source[i] !== "`"; i++) {
        if (source[i] === "\\") i++;
        else if (source[i] === "$" && source[i + 1] === "{") {
          let braces = 0;
          for (i++; ; i++) {
            if (source[i] === "{") braces++;
            else if (source[i] === "}" && --braces === 0) break;
          }
        }
      }
    } else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error("unbalanced call");
}

/** `${expr}` becomes one id (or each fixed word of WORDS); `${query(...)}` is dropped. */
function expand(path: string): string[] {
  let outs = [""];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === "$" && path[i + 1] === "{") {
      let braces = 0;
      let j = i + 1;
      for (; ; j++) {
        if (path[j] === "{") braces++;
        else if (path[j] === "}" && --braces === 0) break;
      }
      const expr = path.slice(i + 2, j).trim();
      const options = expr.startsWith("query(") ? [""] : WORDS[expr] ?? [ID];
      outs = outs.flatMap((out) => options.map((option) => out + option));
      i = j;
    } else outs = outs.map((out) => out + path[i]);
  }
  return outs;
}

function calls(source: string): { method: string; route: string }[] {
  const found: { method: string; route: string }[] = [];
  for (const match of source.matchAll(/\brequest(?:<[^(]*?>)?\(/g)) {
    const args = callArgs(source, match.index! + match[0].length - 1);
    const first = args.match(/^\s*([`"'])(\/(?:[^`"'\\]|\\.)*)\1/s);
    if (!first) continue; // the declaration `request<T>(path: string, ...)`
    const rest = args.slice(first[0].length);
    const method = rest.match(/method:\s*"([A-Z]+)"/)?.[1] ?? rest.match(/\b(?:json|body|withKey)\([\s\S]*,\s*"([A-Z]+)"\s*\)/)?.[1] ?? (/\b(?:json|body|withKey)\(/.test(rest) ? "POST" : "GET");
    for (const path of expand(first[2])) found.push({ method, route: path.replace(/\?.*$/, "").slice(1) });
  }
  return found;
}

const allowed = (method: string, route: string) => proxyRoutes.some(([pattern, methods]) => pattern.test(route) && methods.includes(method));

describe("proxy allowlist covers the dashboard calls", () => {
  const all = ROOTS.flatMap((root) => sources(join(process.cwd(), root))).flatMap((file) => calls(readFileSync(file, "utf8")));
  it("finds the call sites (the scan is not silently empty)", () => {
    expect(all.length).toBeGreaterThan(100);
  });
  it("includes the routes that broke before", () => {
    const seen = all.map((c) => `${c.method} ${c.route.replaceAll(ID, ":id")}`);
    expect(seen).toEqual(expect.arrayContaining(["POST invoices/review", "GET fiscal-portal/status", "PUT companies/:id/dps-sequence", "POST billing/upgrade"]));
  });
  it.each([...new Set(all.map((c) => `${c.method} /${c.route.replaceAll(ID, ":id")}`))])("%s is allowed", (label) => {
    const [method, route] = label.split(" ");
    expect(allowed(method, route.slice(1).replaceAll(":id", ID))).toBe(true);
  });
});
