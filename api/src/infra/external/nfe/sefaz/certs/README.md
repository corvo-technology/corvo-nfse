# Cadeia ICP-Brasil (mTLS com a SEFAZ)

`icp-brasil-chain.pem` reúne os certificados das autoridades certificadoras da ICP-Brasil. O
cliente SOAP da SEFAZ confia neles além das raízes padrão do Node, porque os servidores das SEFAZ
usam certificados dessa cadeia. `rejectUnauthorized: false` nunca é usado.

- Fonte oficial (ITI): https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip
- Baixado em: 2026-11-26
- SHA-256 do pacote: `391420ce15fa59ce9d78b7a077f6622510505de877fe6ff234a2cdf53c561b03`
- Certificados no arquivo: 186 (vencidos são descartados pelo script)

## Como atualizar

```bash
scripts/update-icp-brasil-chain.sh                      # baixa, imprime o SHA-256 e grava o .pem
scripts/update-icp-brasil-chain.sh --expect-sha256 <h>  # para o script se o hash for outro
```

Depois: conferir o `git diff`, atualizar a data e o SHA-256 acima e abrir PR. O lembrete trimestral
está em `docs/fiscal/fiscal-dates.json`.

O arquivo contém só certificados públicos de autoridades certificadoras. Nenhum certificado de
cliente (A1) e nenhuma chave privada entram no repositório.
