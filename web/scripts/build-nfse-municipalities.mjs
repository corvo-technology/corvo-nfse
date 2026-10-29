#!/usr/bin/env node
/**
 * Builds web/lib/docs/data/nfse-municipios.json, the data behind the docs page "Municípios no padrão nacional".
 *
 * Sources (both public):
 *  - Receita Federal, Portal da NFS-e, "Monitoramento das Adesões" (spreadsheet of the municipalities):
 *    https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes
 *  - IBGE localities (the 7-digit code that the Corvo API takes as `municipalityCode`):
 *    https://servicodados.ibge.gov.br/api/v1/localidades/municipios
 *
 * Usage (download the two files first):
 *   node scripts/build-nfse-municipalities.mjs --xlsx municipios-aderentes-AAAAMMDD.xlsx --ibge municipios.json --date AAAA-MM-DD
 *
 * The spreadsheet has no IBGE code, so each row is matched by state + name. A few names differ from the
 * IBGE spelling (or the municipality was renamed); those are listed in RENAMED below.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []));
for (const key of ["xlsx", "ibge", "date"]) if (!args[key]) throw new Error(`Missing --${key}`);
const OUT = resolve(import.meta.dirname, "../lib/docs/data/nfse-municipios.json");

/** Same municipality, different name in the spreadsheet: [state, spreadsheet name (normalized)] -> IBGE code. */
const RENAMED = new Map([
  ["GO|BOM JESUS", 5203500], // Bom Jesus de Goiás
  ["MT|SANTO ANTONIO DO LEVERGER", 5107800], // Santo Antônio de Leverger
  ["BA|LAGEDO DO TABOCAL", 2919058], // Lajedo do Tabocal
  ["BA|SANTA TERESINHA", 2928505], // Santa Terezinha
  ["RN|ARES", 2401206], // Arez
  ["RN|BOA SAUDE", 2405306], // Januário Cicco (renamed)
  ["SE|AMPARO DE SAO FRANCISCO", 2800100], // Amparo do São Francisco
  ["RR|SAO LUIZ", 1400605], // São Luiz do Anauá
  ["TO|FORTALEZA DO TABOCAO", 1708254], // Tabocão (renamed)
  ["TO|SAO VALERIO DA NATIVIDADE", 1720499], // São Valério (renamed)
  ["MG|SAO THOME DAS LETRAS", 3165206], // São Tomé das Letras
  ["PR|MUNHOZ DE MELLO", 4116307], // Munhoz de Melo
]);

const normalize = (text) =>
  text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// --- minimal .xlsx reader (zip + two XML parts), so the script needs no dependency ---
function unzip(buffer) {
  const files = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("Not a zip file");
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0, total = buffer.readUInt16LE(end + 10); i < total; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const size = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    const data = buffer.subarray(local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28));
    files.set(name, () => (method === 0 ? data.subarray(0, size) : inflateRawSync(data.subarray(0, size))).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
const unescapeXml = (text) =>
  text.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_, entity) => {
    if (entity[0] === "#") return String.fromCodePoint(entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[entity.toLowerCase()];
  });

function readSheet(path) {
  const files = unzip(readFileSync(path));
  const shared = [...files.get("xl/sharedStrings.xml")().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unescapeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  const sheet = files.get("xl/worksheets/sheet1.xml")();
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => {
    const cells = {};
    for (const cell of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const value = cell[3]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = cell[3]?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      cells[cell[1]] = /t="s"/.test(cell[2]) && value !== undefined ? shared[Number(value)] : inline !== undefined ? unescapeXml(inline) : value !== undefined ? unescapeXml(value) : "";
    }
    return cells;
  });
}

const ibge = JSON.parse(readFileSync(args.ibge, "utf8"));
const stateOf = (m) => (m.microrregiao ? m.microrregiao.mesorregiao.UF.sigla : m["regiao-imediata"]["regiao-intermediaria"].UF.sigla);
const byKey = new Map(ibge.map((m) => [`${stateOf(m)}|${normalize(m.nome)}`, m]));
const byCode = new Map(ibge.map((m) => [m.id, m]));

const [header, ...sheet] = readSheet(args.xlsx);
const expected = ["Regiao", "UF", "NomeMunicipio", "CNPJ", "StatusConvenioSEFIN", "AderenteAmbienteNacional", "AderenteEmissorNacional"];
expected.forEach((name, i) => {
  if (header["ABCDEFG"[i]] !== name) throw new Error(`Spreadsheet column ${"ABCDEFG"[i]} is "${header["ABCDEFG"[i]]}", expected "${name}"`);
});

/** 2 = Emissor Nacional, 1 = only shares notes with the national environment, 0 = agreement not active yet. */
const statusOf = (row) => (row.E === "Conveniado Ativo" && row.F === "Sim" ? (row.G === "Sim" ? 2 : 1) : 0);
const isoDate = (text) => {
  const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(text ?? "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
};

const rows = sheet.map((row) => {
  const key = `${row.B}|${normalize(row.C)}`;
  const match = RENAMED.has(key) ? byCode.get(RENAMED.get(key)) : byKey.get(key);
  if (!match) throw new Error(`No IBGE municipality for ${key}`);
  return [match.id, match.nome, row.B, statusOf(row), isoDate(row.N)];
});
rows.sort((a, b) => a[2].localeCompare(b[2]) || a[1].localeCompare(b[1], "pt-BR"));

if (new Set(rows.map((r) => r[0])).size !== rows.length) throw new Error("An IBGE code was matched twice");
if (rows.length !== ibge.length) throw new Error(`Spreadsheet has ${rows.length} rows, IBGE has ${ibge.length}`);

const counts = { total: rows.length, emissorNacional: 0, ambienteNacional: 0, naoAtivo: 0 };
for (const row of rows) counts[["naoAtivo", "ambienteNacional", "emissorNacional"][row[3]]]++;

const lines = rows.map((r) => `  ${JSON.stringify(r)}`).join(",\n");
const source = { name: "Receita Federal, Portal da NFS-e: Monitoramento das Adesões", url: "https://www.gov.br/nfse/pt-br/municipios/monitoramento-adesoes", date: args.date };
writeFileSync(OUT, `{\n"source": ${JSON.stringify(source)},\n"counts": ${JSON.stringify(counts)},\n"rows": [\n${lines}\n]\n}\n`);
console.log(`Wrote ${rows.length} municipalities to ${OUT}`, counts);
