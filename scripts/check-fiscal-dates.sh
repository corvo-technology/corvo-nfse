#!/usr/bin/env bash
# Abre issues de lembrete 30 e 7 dias antes de cada data de docs/fiscal/fiscal-dates.json.
# Uso: scripts/check-fiscal-dates.sh [--dry-run] [--today AAAA-MM-DD]
# Precisa de: bash, gh (autenticado), jq.
set -euo pipefail

dry_run=false
today=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=true ;;
    --today) shift; today="${1:?--today precisa de AAAA-MM-DD}" ;;
    *) echo "Argumento desconhecido: $1" >&2; exit 1 ;;
  esac
  shift
done

cd "$(dirname "$0")/.."
file="docs/fiscal/fiscal-dates.json"
repo_url="https://github.com/corvo-technology/corvo-nfse/blob/main"
[ -n "$today" ] || today="$(date -u +%F)"

# dias desde 1970 (funciona no GNU date e no BSD date)
to_days() {
  local s
  s="$(date -u -d "$1" +%s 2>/dev/null || date -u -j -f %F "$1" +%s)"
  echo $(( s / 86400 ))
}
today_days="$(to_days "$today")"

open_issue() {
  local title="$1" body="$2"
  if $dry_run; then
    printf 'DRY-RUN: abriria o issue:\n  %s\n%s\n\n' "$title" "$body"
    return 0
  fi
  # só abre se não existe issue (aberto ou fechado) com esse título exato
  if gh issue list --state all --search "in:title \"$title\"" --json title --jq '.[].title' | grep -qxF -- "$title"; then
    echo "já existe: $title"
    return 0
  fi
  gh issue create --title "$title" --body "$body"
}

while IFS= read -r item; do
  date="$(jq -r '.date' <<<"$item")"
  days_left=$(( $(to_days "$date") - today_days ))
  [ "$days_left" -ge 0 ] || continue   # data já passou
  [ "$days_left" -le 30 ] || continue  # ainda longe

  br_date="${date:8:2}/${date:5:2}/${date:0:4}"
  name="$(jq -r '.title' <<<"$item")"
  sources="$(jq -r --arg u "$repo_url" '.sources[] | "- \($u)/\(.)"' <<<"$item")"
  body="Faltam $days_left dias para $br_date: $name.

O que muda: $(jq -r '.what' <<<"$item")

Quem é afetado: $(jq -r '.who' <<<"$item")

O que conferir: $(jq -r '.check' <<<"$item")

Fontes:
$sources

Lista de datas: $repo_url/$file"

  # faltando 7 dias ou menos, só o lembrete de 7 dias vale (o de 30 já passou)
  if [ "$days_left" -le 7 ]; then
    open_issue "Lembrete fiscal: $name em $br_date (7 dias)" "$body"
  else
    open_issue "Lembrete fiscal: $name em $br_date (30 dias)" "$body"
  fi
done < <(jq -c '.[]' "$file")
