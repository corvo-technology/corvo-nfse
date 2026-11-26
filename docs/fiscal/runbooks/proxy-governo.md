# Proxy opcional para chamadas ao governo

Use quando a rede da hospedagem (hoje a Guara Cloud) não consegue abrir conexão com
`*.nfse.gov.br` (sefin/adn, produção e restrita). As chamadas ao governo passam por um
servidor fora da hospedagem. Sem a variável, tudo continua direto, como sempre foi.

## Como funciona

- Variável opcional `FISCAL_HTTPS_PROXY`, por exemplo `http://usuario:senha@host:3128`.
- Só as chamadas do cliente NFS-e (todas para `*.nfse.gov.br`) usam o proxy. A calculadora
  RTC e a consulta de CNPJ **não** passam por ele.
- O proxy faz um túnel `CONNECT`. O certificado A1 da empresa continua sendo usado de ponta a
  ponta (mTLS) com o governo: o proxy só vê tráfego cifrado.
- A senha do proxy nunca vai para o log (o log mostra `http://***@host:porta`).

## Ligar na Guara

```sh
guara env set -p corvo -s worker-d74b62 -y FISCAL_HTTPS_PROXY='http://usuario:senha@host:3128'
guara env set -p corvo -s api-b71de3    -y FISCAL_HTTPS_PROXY='http://usuario:senha@host:3128'
```

Reinicie/redeploy os dois serviços. Para desligar, remova a variável e reinicie.
Confira no log de partida: `FISCAL_HTTPS_PROXY set: calls to *.nfse.gov.br go through http://***@host:3128`.

## Subir o proxy numa máquina fora da Guara

Precisa só de Node 18+ (sem dependências). Copie `scripts/gov-proxy/gov-proxy.mjs` e rode:

```sh
PROXY_USER=corvo PROXY_PASS='senha-longa-aleatoria' PORT=3128 node gov-proxy.mjs
```

- Aceita só `CONNECT` com Basic auth, só porta 443, só hosts `*.nfse.gov.br`
  (mude com `ALLOWED_HOSTS=a.exemplo,*.outro`).
- O log tem só data, host e status (200, 403, 407, 502). Nunca credenciais nem conteúdo.
- Deixe rodando com `systemd`/`pm2`/Docker e libere a porta só para o IP de saída da Guara
  quando possível. Se usar `http://`, a senha do proxy trafega sem cifra entre a Guara e o
  proxy: prefira firewall por IP ou uma VPN/túnel privado.

## Testar

```sh
curl -v -x http://usuario:senha@host:3128 https://sefin.nfse.gov.br/ -o /dev/null
```

Um erro de certificado do governo (pedindo cert de cliente) já prova que o túnel abriu.
