# QR Code v3 da NFC-e em contingência off-line (tpEmis 9)

Fonte: Manual de Padrões Técnicos do DANFE NFC-e e QR Code, v6.0 (março/2025), seção 4.4.2 e
Tabela 7 (Portal NF-e, `exibirArquivo.aspx?conteudo=k/IuuaW4YiY=`), e a NT 2025.001 v1.03 (seção 04,
rejeições 445, 474 e 583). O padrão do `infNFeSupl/qrCode` vem do XSD que o repositório já traz
(`leiauteNFe_v4.00.xsd`, `PL_010h_v1.03`).

## Formato

```
<urlQrCode>?p=<chave>|3|<tpAmb>|<dia>|<vNF>|<tipoId>|<idDest>|<assinatura>
```

| # | Campo | Regra |
|---|---|---|
| 1 | chave | 44 caracteres |
| 2 | versão | `3` |
| 3 | tpAmb | `1` produção, `2` homologação |
| 4 | dia | dia de `dhEmi`, exatamente 2 dígitos (`01`..`31`) |
| 5 | vNF | `W16`, ponto decimal, sem separador de milhar (`0`, `0.50`, `10.00`) |
| 6 | tipoId | `1` CNPJ, `2` CPF, `3` idEstrangeiro; vazio se o destinatário não foi identificado |
| 7 | idDest | CPF (11) ou CNPJ (14); vazio se estrangeiro ou não identificado |
| 8 | assinatura | base64 da assinatura RSA SHA-1 dos campos 1 a 7 |

## Assinatura (Tabela 7)

"Assinatura digital da concatenação dos parâmetros de 1 a 7, mantendo os separadores (`|`).
Assinatura no padrão RSA SHA-1 (Base64), com o mesmo certificado digital que assina a NFC-e."

Implementação: `crypto.sign('RSA-SHA1', Buffer.from(payload, 'utf8'), chavePrivada)` (PKCS#1 v1.5),
saída em base64. O texto assinado é `chave|3|tpAmb|dia|vNF|tipoId|idDest`, sem a assinatura. Sem
destinatário fica `chave|3|tpAmb|dia|vNF||` (campos 6 e 7 vazios, com os separadores), e a URL fica
`...|vNF|||assinatura` (o padrão do XSD aceita os dois campos vazios).

## O que está confirmado e o que não está

- Confirmado em fonte oficial: ordem e formato dos campos, RSA SHA-1 + Base64, mesmo certificado da NFC-e.
- **Não confirmado:** se o `|` entre os campos 6 e 7 vazios entra no texto assinado (a leitura literal
  de "concatenação dos parâmetros de 1 a 7, mantendo os separadores" é que sim, e é o que o código faz).
  Também não há vetor de teste oficial: o manual mostra um exemplo hipotético sem a chave que o gerou.
- Os testes do repositório usam um vetor gerado por nós (certificado de teste, assinatura verificada
  com a chave pública). **Validar na homologação da SEFAZ (rejeição 583 = assinatura diferente) antes
  de liberar a contingência off-line em produção.**
