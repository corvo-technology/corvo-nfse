#!/usr/bin/env bash
# Atualiza a cadeia ICP-Brasil usada no mTLS com a SEFAZ.
# Baixa o pacote oficial do ITI, confere o SHA-256 (impresso e, se informado, comparado),
# converte cada certificado para PEM, descarta os vencidos e grava
# api/src/infra/external/nfe/sefaz/certs/icp-brasil-chain.pem.
#
# Uso: scripts/update-icp-brasil-chain.sh [--expect-sha256 <hash>]
# Precisa de: bash, curl, unzip, openssl, shasum.
set -euo pipefail

url="https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip"
expect=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-sha256) shift; expect="${1:?--expect-sha256 precisa do hash}" ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."
out="api/src/infra/external/nfe/sefaz/certs/icp-brasil-chain.pem"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --max-time 120 -o "$work/ac.zip" "$url"
sha="$(shasum -a 256 "$work/ac.zip" | cut -d' ' -f1)"
echo "SHA-256 do pacote: $sha"
if [ -n "$expect" ] && [ "$expect" != "$sha" ]; then
  echo "SHA-256 diferente do esperado ($expect). Nada foi gravado." >&2
  exit 1
fi

mkdir "$work/certs"
unzip -q -o "$work/ac.zip" -d "$work/certs"

count=0
skipped=0
: > "$work/chain.pem"
while IFS= read -r -d '' f; do
  pem=""
  if pem="$(openssl x509 -in "$f" -outform PEM 2>/dev/null)"; then :;
  elif pem="$(openssl x509 -inform DER -in "$f" -outform PEM 2>/dev/null)"; then :;
  else skipped=$((skipped + 1)); continue; fi
  if ! printf '%s\n' "$pem" | openssl x509 -noout -checkend 0 >/dev/null 2>&1; then
    skipped=$((skipped + 1)); continue
  fi
  printf '%s\n' "$pem" >> "$work/chain.pem"
  count=$((count + 1))
done < <(find "$work/certs" -type f \( -iname '*.crt' -o -iname '*.cer' -o -iname '*.pem' \) -print0 | sort -z)

if [ "$count" -eq 0 ]; then
  echo "Nenhum certificado valido encontrado. Nada foi gravado." >&2
  exit 1
fi

mkdir -p "$(dirname "$out")"
mv "$work/chain.pem" "$out"
echo "Gravados $count certificados em $out ($skipped ignorados: vencidos ou ilegiveis)."
echo "Atualize o SHA-256 e a data em api/src/infra/external/nfe/sefaz/certs/README.md."
