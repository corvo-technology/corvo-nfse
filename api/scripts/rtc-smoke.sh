#!/bin/sh
# Smoke test for the internal RTC calculator (Calculadora de Tributos).
# Runs only against an instance you control — never against the public government site.
#
# Usage (from api/): RTC_URL=http://localhost:18080/api sh scripts/rtc-smoke.sh
#
# Prints GET .../versao, then runs the base -> calculation flow from
# docs/fiscal/rtc/fixtures/ok-consultoria-2026.json and fails unless the engine
# returns vCBS=9.00 and vIBS=1.00 (the values captured for version 1.6.0/V0059).
set -eu

RTC_URL="${RTC_URL:?Set RTC_URL to the calculator base, e.g. RTC_URL=http://localhost:18080/api}"
FIXTURE="$(cd "$(dirname "$0")/../.." && pwd)/docs/fiscal/rtc/fixtures/ok-consultoria-2026.json"

[ -f "$FIXTURE" ] || { echo "Fixture not found: $FIXTURE" >&2; exit 1; }

echo "GET ${RTC_URL}/calculadora/dados-abertos/versao"
VERSION_RESPONSE="$(curl -fsS "${RTC_URL}/calculadora/dados-abertos/versao")"
echo "$VERSION_RESPONSE"

# Build the base-calculo body from the fixture's calc request (year of the fact
# generator date, service value equal to the captured base).
REQUEST_JSON="$(FIXTURE="$FIXTURE" node -e '
const fs = require("node:fs");
const fixture = JSON.parse(fs.readFileSync(process.env.FIXTURE, "utf8"));
const calcRequest = fixture.steps[0].request;
const baseRequest = {
  anoFatoGerador: Number(calcRequest.dhFatoGerador.slice(0, 4)),
  valorServico: calcRequest.itens[0].baseCalculo,
};
process.stdout.write(JSON.stringify({ baseRequest, calcRequest }));
')"
BASE_BODY="$(printf '%s' "$REQUEST_JSON" | node -e '
let data = "";
process.stdin.on("data", (chunk) => (data += chunk));
process.stdin.on("end", () =>
  process.stdout.write(JSON.stringify(JSON.parse(data).baseRequest)),
);')"

echo "POST ${RTC_URL}/calculadora/nfse/base-calculo"
BASE_RESPONSE="$(curl -fsS -H 'Content-Type: application/json' \
  -d "$BASE_BODY" "${RTC_URL}/calculadora/nfse/base-calculo")"
echo "$BASE_RESPONSE"

CALC_BODY="$(BASE_RESPONSE="$BASE_RESPONSE" REQUEST_JSON="$REQUEST_JSON" node -e '
const baseCalculo = JSON.parse(process.env.BASE_RESPONSE).baseCalculo;
const calcRequest = JSON.parse(process.env.REQUEST_JSON).calcRequest;
calcRequest.itens[0].baseCalculo = baseCalculo;
process.stdout.write(JSON.stringify(calcRequest));
')"

echo "POST ${RTC_URL}/calculadora/regime-geral"
CALC_RESPONSE="$(curl -fsS -H 'Content-Type: application/json' \
  -d "$CALC_BODY" "${RTC_URL}/calculadora/regime-geral")"
echo "$CALC_RESPONSE"

VCBS="$(CALC_RESPONSE="$CALC_RESPONSE" node -e '
const body = JSON.parse(process.env.CALC_RESPONSE);
process.stdout.write(String(body.objetos[0].tribCalc.IBSCBS.gIBSCBS.gCBS.vCBS));
')"
VIBS="$(CALC_RESPONSE="$CALC_RESPONSE" node -e '
const body = JSON.parse(process.env.CALC_RESPONSE);
process.stdout.write(String(body.objetos[0].tribCalc.IBSCBS.gIBSCBS.vIBS));
')"

if [ "$VCBS" != "9.00" ]; then
  echo "FAIL: vCBS=${VCBS}, expected 9.00" >&2
  exit 1
fi
if [ "$VIBS" != "1.00" ]; then
  echo "FAIL: vIBS=${VIBS}, expected 1.00" >&2
  exit 1
fi

echo "OK: vCBS=${VCBS} vIBS=${VIBS}"
