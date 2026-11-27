# Caminho reserva para o governo (proxy)

Em 26/11 a nossa hospedagem (Guara) tinha um IP de saída que a Serpro bloqueava. Durante horas
nenhuma nota saiu, mesmo com o governo no ar. Este caminho reserva resolve só esse tipo de
problema: **o governo está bem, mas a nossa rede não chega nele**.

## Em uma frase

Se a variável `FISCAL_HTTPS_PROXY` estiver preenchida **e** o monitor de conexão disser
"os servidores não alcançam o governo", as chamadas ao governo passam por uma máquina nossa que
fica **fora da Guara**. Fora disso, tudo vai direto, como sempre.

## Como funciona

- **Quando liga:** só no incidente `gov_unreachable_from_us` (nenhum site do governo responde, mas
  um site fora do governo responde). Não liga quando o portal está fora do ar (`portal_down`),
  quando estamos sem internet (`no_internet`) nem quando só as notas falham
  (`emission_failures`). Nesses casos o proxy não ajudaria.
- **Quando desliga:** sozinho. O monitor continua testando a rota direta (nunca pelo proxy). Quando
  ela volta (2 testes bons seguidos), as chamadas voltam para a rota direta em até 15 segundos.
- **O que passa por ele:** NFS-e (Sefin e ADN), NF-e e NFC-e (SEFAZ e SVC). A consulta de CNPJ, a
  calculadora RTC e qualquer outro site **não** passam.
- **Segurança:** o proxy só faz um túnel (`CONNECT`). O certificado A1 da empresa e as notas
  continuam cifrados de ponta a ponta entre a Corvo e o governo; o proxy só vê bytes cifrados.
  A senha do proxy nunca vai para log nem para e-mail (aparece como `http://***@host:porta`).
- **Lista de hosts:** exata, nada de `*.gov.br`. A API e o proxy usam a mesma lista (um teste
  confere que são iguais).

## Quando o dono é avisado

O e-mail vai para os endereços de `OPS_ALERT_EMAILS`.

| Situação | E-mail |
|---|---|
| O incidente abriu e o proxy está configurado | "Chamadas ao governo passando pelo proxy de reserva" (diz se o teste pelo proxy funcionou) |
| O incidente fechou | "Chamadas ao governo voltaram para a rota direta" |
| O teste pelo proxy falha 3 vezes seguidas (mesmo sem incidente) | "O proxy de reserva não está respondendo" |
| O teste pelo proxy volta | "O proxy de reserva voltou a responder" |

A cada minuto o worker abre um túnel de teste até `sefin.nfse.gov.br` pelo proxy (só abre e
fecha, sem certificado e sem nota). Assim sabemos que a reserva funciona **antes** de precisar
dela.

## 1. Subir o proxy fora da Guara

Precisa ser em **outro provedor** (uma VM pequena, qualquer uma com IP fixo). Se estiver na Guara,
não adianta.

Precisa só de Node 18 ou mais novo, sem instalar pacotes. Copie `scripts/gov-proxy/gov-proxy.mjs`
para a máquina e rode:

```sh
PROXY_USER=corvo PROXY_PASS='senha-longa-aleatoria' PORT=3128 node gov-proxy.mjs
```

- Aceita só `CONNECT`, com usuário e senha, só porta 443 e só os hosts da lista abaixo.
- O log tem só data, host e resultado (200, 403, 407, 502). Nunca senha nem conteúdo.
- Deixe rodando com `systemd`, `pm2` ou Docker, para voltar sozinho se a máquina reiniciar.
- Libere a porta no firewall **só para os IPs de saída da Guara**. Com `http://` a senha do proxy
  viaja sem cifra entre a Guara e a máquina; o firewall por IP (ou uma VPN) cobre esse risco.

### Hosts liberados

Gerados da mesma tabela de endereços que a API usa (`ENDPOINTS`). Se um endereço da SEFAZ mudar
no código, atualize aqui e na lista padrão do `gov-proxy.mjs` (o teste
`gov-proxy.script.spec.ts` falha se estiverem diferentes).

```
adn.nfse.gov.br
adn.producaorestrita.nfse.gov.br
hnfe.fazenda.mg.gov.br
hnfe.sefaz.ba.gov.br
hom.nfe.sefaz.ms.gov.br
hom.sefazvirtual.fazenda.gov.br
hom.svc.fazenda.gov.br
homnfe.sefaz.am.gov.br
homolog.sefaz.go.gov.br
homologacao.nfce.fazenda.sp.gov.br
homologacao.nfe.fazenda.sp.gov.br
homologacao.nfe.sefa.pr.gov.br
homologacao.sefaz.mt.gov.br
nfce.fazenda.sp.gov.br
nfe-homologacao.sefazrs.rs.gov.br
nfe-homologacao.svrs.rs.gov.br
nfe.fazenda.mg.gov.br
nfe.fazenda.sp.gov.br
nfe.sefa.pr.gov.br
nfe.sefaz.am.gov.br
nfe.sefaz.ba.gov.br
nfe.sefaz.go.gov.br
nfe.sefaz.ms.gov.br
nfe.sefaz.mt.gov.br
nfe.sefaz.pe.gov.br
nfe.sefazrs.rs.gov.br
nfe.svrs.rs.gov.br
nfehomolog.sefaz.pe.gov.br
sefin.nfse.gov.br
sefin.producaorestrita.nfse.gov.br
www.sefazvirtual.fazenda.gov.br
www.svc.fazenda.gov.br
```

## 2. Testar o proxy antes de ligar

Da sua máquina (ou de qualquer lugar liberado no firewall):

```sh
curl -v -x http://corvo:SENHA@IP-DO-PROXY:3128 https://sefin.nfse.gov.br/ -o /dev/null
```

Um erro de certificado do governo (pedindo certificado de cliente) **já prova que o túnel abriu**.
Um pedido para um site fora da lista tem que dar `403`:

```sh
curl -v -x http://corvo:SENHA@IP-DO-PROXY:3128 https://example.com/ -o /dev/null
```

## 3. Ligar na Guara

Nos dois serviços (API e worker):

```sh
guara env set -p corvo -s worker-d74b62 -y FISCAL_HTTPS_PROXY='http://corvo:SENHA@IP-DO-PROXY:3128'
guara env set -p corvo -s api-b71de3    -y FISCAL_HTTPS_PROXY='http://corvo:SENHA@IP-DO-PROXY:3128'
```

Faça o redeploy dos dois. Para desligar de vez, remova a variável e faça o redeploy.

Ligar a variável **não muda nada no dia a dia**: o proxy fica parado até o incidente. O que
muda na hora é o teste a cada minuto pelo proxy; em até 3 minutos você sabe se a reserva
funciona (e recebe e-mail se não funcionar).

## 4. Como saber que entrou em ação

- E-mail "Chamadas ao governo passando pelo proxy de reserva".
- Log da API ou do worker: `Government calls now go through http://***@host:3128` (e, quando
  volta, `Government calls go direct again`).
- No painel, o aviso de conexão com o governo continua aparecendo, porque a rota direta ainda
  está fora. Isso é esperado.
- No log do proxy aparecem linhas `... sefin.nfse.gov.br 200`.

## Custo e cuidados

- Uma VM pequena (a menor do provedor basta) e um segredo (a senha). O tráfego é de notas, bem
  pequeno.
- O proxy é um ponto único de falha **só** durante o incidente; fora dele ninguém o usa. Mesmo
  assim, monitore a máquina (uptime) por fora, além do teste que o worker já faz.
- Troque a senha de vez em quando: mude `PROXY_PASS` na máquina, depois a variável na Guara.
- Se o IP de saída da Guara mudar, atualize o firewall do proxy.
- O proxy **não** resolve o governo fora do ar. Para isso valem a fila, a SVC da NF-e e a NFC-e
  off-line (ver `nfe-svc.md` e `nfce-homologacao.md`).
