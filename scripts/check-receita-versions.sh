#!/usr/bin/env bash
# Avisa (via issue) quando um repo da Receita que acompanhamos ganha versão nova.
# Uso: scripts/check-receita-versions.sh [--dry-run]
# Precisa de: bash, gh (autenticado), jq.
set -euo pipefail

dry_run=false
[ "${1:-}" = "--dry-run" ] && dry_run=true

cd "$(dirname "$0")/.."
org="ReceitaFederal"
versions_file="docs/fiscal/receita-versions.json"

# regime-regular: a fonte da verdade é o Dockerfile.rtc
rtc_ours="$(sed -n 's/^ARG RTC_TAG=//p' deploy/Dockerfile.rtc | tr -d '[:space:]')"
[ -n "$rtc_ours" ] || { echo "Não achei RTC_TAG em deploy/Dockerfile.rtc" >&2; exit 1; }

latest_version() {
  # maior versão (ordem semver) entre tags e releases; ignora nomes fora do padrão (ex.: pré-lançamentos)
  {
    gh api --paginate "repos/$org/$1/tags" --jq '.[].name'
    gh api --paginate "repos/$org/$1/releases" --jq '.[] | select(.draft | not) | .tag_name'
  } | grep -E '^v?[0-9]+(\.[0-9]+)*$' | sort -V | tail -n 1
}

action_for() {
  case "$1" in
    calculadora-rtc-regime-regular)
      printf '%s\n' \
        "1. Siga o passo a passo em docs/fiscal/runbooks/rtc-update.md." \
        "2. Atualize RTC_TAG e RTC_COMMIT em deploy/Dockerfile.rtc." \
        "3. Capture os fixtures de novo." \
        "4. Atualize RTC_EXPECTED_VERSION na API (Guara) e no worker." ;;
    calculadora-rtc-gerador-danfse)
      printf '%s\n' \
        "Compare o layout novo com o nosso renderizador de DANFSe (api/src/modules/invoice/infra/danfse/) e ajuste se houver diferença." \
        "Depois atualize docs/fiscal/receita-versions.json." ;;
    calculadora-rtc-simples-nacional)
      printf '%s\n' \
        "Ainda não usamos esta calculadora. Releia os gatilhos de \"quando rever\" em docs/fiscal/limitations.md e veja se algum mudou." \
        "Depois atualize docs/fiscal/receita-versions.json." ;;
  esac
}

check() {
  local repo="$1" ours="$2" new title body
  new="$(latest_version "$repo" || true)"
  if [ -z "$new" ]; then
    echo "AVISO: sem versões lidas para $repo, pulando." >&2
    return 0
  fi
  if [ "$(printf '%s\n%s\n' "${ours#v}" "${new#v}" | sort -V | tail -n 1)" = "${ours#v}" ]; then
    echo "ok: $repo em $ours (última: $new)"
    return 0
  fi
  title="Receita: $repo $new disponível (usamos $ours)"
  body="A Receita publicou a versão $new de $repo. Nós usamos a $ours.

- Mudanças: https://github.com/$org/$repo/compare/$ours...$new
- Changelog: https://github.com/$org/$repo/blob/$new/CHANGELOG.md

O que fazer:

$(action_for "$repo")"

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

# regime-regular: avisa se a Receita moveu a nossa tag para outro commit (o build do Docker pararia)
check_tag_moved() {
  local commit_ours remote title body
  commit_ours="$(sed -n 's/^ARG RTC_COMMIT=//p' deploy/Dockerfile.rtc | tr -d '[:space:]')"
  [ -n "$commit_ours" ] || { echo "AVISO: sem RTC_COMMIT, pulando checagem de tag movida." >&2; return 0; }
  # tag anotada aparece também como refs/tags/X^{} (o commit real, listado por último)
  remote="$(git ls-remote "https://github.com/$org/calculadora-rtc-regime-regular" "refs/tags/$rtc_ours" "refs/tags/$rtc_ours^{}" | awk '{c=$1} END{print c}')"
  if [ -z "$remote" ]; then
    echo "AVISO: não li a tag $rtc_ours, pulando checagem de tag movida." >&2
    return 0
  fi
  if [ "$remote" = "$commit_ours" ]; then
    echo "ok: tag $rtc_ours ainda aponta para $commit_ours"
    return 0
  fi
  title="Receita: tag $rtc_ours de calculadora-rtc-regime-regular foi movida"
  body="A tag $rtc_ours de calculadora-rtc-regime-regular agora aponta para $remote, mas o RTC_COMMIT em deploy/Dockerfile.rtc é $commit_ours. O build do Docker vai falhar.

- Diferença: https://github.com/$org/calculadora-rtc-regime-regular/compare/$commit_ours...$remote

O que fazer:

1. Veja a diferença e procure se o que mudou é usado no resto do código (seção \"Tag movida pela Receita\" em docs/fiscal/runbooks/rtc-update.md).
2. Se for seguro, atualize RTC_COMMIT em deploy/Dockerfile.rtc. Se mudar cálculo, é decisão fiscal: avise antes."
  if $dry_run; then
    printf 'DRY-RUN: abriria o issue:\n  %s\n%s\n\n' "$title" "$body"
    return 0
  fi
  if gh issue list --state all --search "in:title \"$title\"" --json title --jq '.[].title' | grep -qxF -- "$title"; then
    echo "já existe: $title"
    return 0
  fi
  gh issue create --title "$title" --body "$body"
}

check calculadora-rtc-regime-regular "$rtc_ours"
check_tag_moved
for repo in calculadora-rtc-gerador-danfse calculadora-rtc-simples-nacional; do
  check "$repo" "$(jq -er --arg r "$repo" '.[$r]' "$versions_file")"
done
