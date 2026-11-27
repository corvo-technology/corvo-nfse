# NFC-e (Fase 3) e contingência (Fase 4) no Corvo: desenho

Data: 2026-11-26. Status: proposta, só documento (nenhum código). Vem depois da NF-e (PR #311 e a pilha `feat/nfe-0x-*`) e do desenho `2026-11-26-nfe-fase-0-1-design.md`.

Legenda, a mesma do desenho da NF-e:
- **[verificado]**: li a fonte citada (às vezes numa cópia fiel do texto oficial; quando for cópia, digo).
- **[não verificado]**: vem de memória ou de fonte secundária. Conferir antes de implementar.
- **[verificar na homologação]**: só dá para ter certeza testando contra a SEFAZ.

## 1. Intenção

A NF-e já tem portas, registro, pipeline, cliente SOAP com mTLS, assinatura, XSD, numeração por série, eventos, DANFE e as rotas `/v1/invoices` com `type`. A NFC-e (modelo 65) é a nota do varejo para o consumidor final. O layout é quase o mesmo da NF-e. Mudam o QR Code, o DANFCE, algumas regras e os prazos.

Este documento mostra:
1. como a NFC-e entra como **mais um adaptador** (`type: 'nfce'`), sem mexer no que funciona;
2. como fica a **contingência** da NF-e e da NFC-e (Fase 4);
3. o que fazer quando o problema é **a nossa rede**, e não a SEFAZ (o incidente da Guara).

## 2. Fatos que mudam o desenho

1. **O QR Code v3 dispensa o CSC.** A NT 2025.001 (v1.02, set/2025) criou o QR Code v3 da NFC-e **[verificado]**:
   - Online: `?p=<chave>|<versao>|<tpAmb>`, sem CSC e sem hash.
   - Contingência off-line: `?p=<chave>|<versao>|<tpAmb>|<dia>|<vNF>|<tp_idDest>|<idDest>|<assinatura>`. A "assinatura" é feita com o certificado A1, não com o CSC.
   - A NT diz que "não será mais necessário o controle do CSC". A rejeição 407 ("UF não aceita v3") foi retirada na v1.01, porque todas as UFs passaram a aceitar o v3.
   - O v2 (com CSC) ainda é aceito e não achei data de fim **[não verificado]**. A NT 2026.002 diz que o CSC será eliminado "futuramente, sem data".
   - Fonte: cópia da NT 2025.001 v1.02, https://inventti.com.br/wp-content/uploads/2025/09/NT2025.001_v1.02-NFCe_qrCode_v3.pdf. O original fica no Portal NF-e (https://www.nfe.fazenda.gov.br/portal), que bloqueia fetch automático.
   - O algoritmo exato da `assinatura` do QR off-line (quais campos, qual hash, em que formato) está no "Manual de Padrões Técnicos do DANFE NFC-e e QR Code", e não na NT **[não verificado]**.
2. **SP: NFC-e obrigatória desde 01/01/2026.** O CF-e-SAT emitido depois dessa data é rejeitado (erro 1001). Fontes **[verificado]**: https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/Sobre.aspx e https://portal.fazenda.sp.gov.br/servicos/sat/Paginas/Sobre.aspx. Todo varejista de SP que usava SAT precisa de NFC-e agora.
3. **Cancelamento em até 30 minutos.** Ajuste SINIEF 19/2016, cláusula 15ª **[verificado em cópia do texto: https://www.normasbrasil.com.br/norma/ajuste-19-2016_333457.html]**. A cláusula 15ª-A permite o cancelamento por substituição em até 168 horas. O código do evento (110112) só aparece em fonte secundária **[não verificado]**.
4. **Sem carta de correção na NFC-e.** Cláusula 8ª, §1º do mesmo ajuste **[verificado]**.
5. **Contingência off-line (tpEmis 9).** O ajuste manda transmitir "até o primeiro dia útil subsequente" **[verificado]**. A NT 2026.002 (regra B09-40) dá cStat 150, "autorizado fora de prazo", para quem transmite depois de 24 horas **[verificado; cópia em https://www.reformatributaria.com/wp-content/uploads/2026/05/NT_2026.002_v1.00.pdf]**. A regra prática é **24 horas**.
6. **Consumidor.** O CPF/CNPJ é obrigatório a partir de R$ 10.000,00; abaixo disso é opcional (cláusula 4ª, VII) **[verificado]**. Pela NT 2026.002 (regra W16-40, rejeição 750), cada UF pode fixar seu próprio limite, e o padrão é R$ 10.000 **[verificado]**.
7. **indPres na NFC-e** só aceita 1 (presencial), 4 (entrega em domicílio) ou 5 (presencial fora do estabelecimento) (rejeição 717). Com 4, o destinatário é obrigatório (rejeição 787) **[verificado, NT 2026.002]**. Há notícia de que o Ajuste SINIEF 09/2026 exige endereço em toda venda não presencial a partir de 03/08/2026 **[não verificado]**.
8. **SP deixa de exigir pedido de inutilização em 01/11/2026**, citando os Ajustes SINIEF 38/2026 e 40/2026 (aviso na página da NFC-e de SP) **[verificado só o aviso; o texto dos ajustes, não]**. Isso pode mudar a regra "todo número perdido precisa ser inutilizado" da NF-e. Ver a pergunta 4.
9. **SVC da NF-e** (Ato COTEPE/ICMS 39/2012, redação do Ato 110/22) **[verificado: https://www.confaz.fazenda.gov.br/legislacao/atos/2012/ac039_12]**:
   - SVC-AN (tpEmis 6): AC, AL, AP, CE, ES, MG, PA, PB, PI, RJ, RS, RN, RO, RR, SC, SE, SP, TO, DF.
   - SVC-RS (tpEmis 7): AM, BA, GO, MA, MT, MS, PE, PR.
   - Quem liga e desliga a SVC é a SEFAZ de origem, não o emissor. O emissor consulta o status do serviço da SVC e só usa a SVC quando vier 107.
   - Na SVC, o XML é gerado de novo com tpEmis 6/7, `dhCont` e `xJust`. A nota autorizada na SVC **não** volta para a SEFAZ de origem.
   - Fonte: MOC 7.0 Anexo III, https://www.confaz.fazenda.gov.br/legislacao/arquivo-manuais/moc7-anexo-iii-manual-contingencia-nf-e.pdf **[verificado]**.
10. **EPEC** (tpEmis 4):
    - Na NF-e, o evento vai para o Ambiente Nacional, e a NF-e com a mesma chave segue depois para a SEFAZ de origem (Anexo III) **[verificado]**. O prazo de 168 h para a NF-e **[não verificado]**; o 168 h que achei é da NFC-e.
    - Na NFC-e, o EPEC existe "a critério da UF" (NT 2026.002). SP tem endpoint próprio: https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx **[verificado]**.
11. **NFS-e Nacional: não achei contingência oficial.** Li o Manual de Contribuintes da API (v1.2) e boa parte do FAQ (https://www.gov.br/nfse/pt-br/perguntas-frequentes).
    - Não há DPS "em contingência" nem emissão off-line.
    - O FAQ diz que a falha da plataforma nacional não isenta de multa e juros (seção 13.6).
    - A única "contingência" citada é de numeração (seção 18.5): se a Sefin reservar o número e a gravação no ADN falhar, o número é descartado e o contribuinte retransmite.
    - **[verificado no que li; o FAQ não foi lido inteiro]**.

## 3. NFC-e como novo adaptador

### 3.1 O que é reaproveitado sem mudança

| Peça | Onde está hoje | Na NFC-e |
|---|---|---|
| Portas e `GatewayOutcome` | `fiscal-core/domain/ports/*` | iguais; `DocumentType` já tem `nfce` |
| `FiscalDocumentRegistry`, `EmissionPipeline` | `fiscal-core/application/` | `NfceModule` registra o próprio gateway |
| `InvoiceTypeRouter` e `/v1/invoices` | `fiscal-core/application/invoice-type.router.ts` | `INVOICE_TYPES` ganha `nfce`; a rota recebe `type: 'nfce'` |
| SOAP 1.2 com mTLS, cadeia ICP-Brasil | `infra/external/nfe/sefaz/soap-client.ts` | igual; as URLs do modelo 65 são outras |
| Assinatura XMLDSig, XSD (pacote PL) | `xml-signer.ts`, `schema-validator.ts` | iguais; o XSD do `enviNFe` 4.00 já cobre o modelo 65 e o `infNFeSupl` **[verificar na homologação]** |
| Chave de acesso, `cNF`, DV | `modules/nfe/domain/access-key.ts` | igual, com `mod=65` |
| Numeração por (empresa, modelo, série) | `nfe_number_sequences` | a chave já inclui `model`; o 65 ganha série própria |
| Grupos `ide`, `emit`, `det`, `total`, `pag`, `infAdic`, `infRespTec` | `modules/nfe/domain/builder/*` | reaproveitados, com variações por modelo (3.3) |
| Cancelamento, inutilização, consulta pela chave, conciliação | `nfe-*.service.ts`, `nfe-reconcile.handler.ts` | o mesmo código, parametrizado por modelo |
| Disjuntor por autoridade | `FiscalPortalBreaker` (`nfeBreakerAuthority`) | chave nova por autoridade do 65 (ex.: `nfce-sp-2`) |
| Créditos | `document_credit_prices` | a semente `nfce=1` já existe |
| Liberação | `nfe_enabled_authorities (uf, model, tp_amb)` | linhas com `model=65`; a flag do tenant ganha `nfce` |

### 3.2 Modelo de dados: mesma tabela, coluna `model`

**Recomendação:** guardar a NFC-e em `nfe_documents`, com `model = 65`, e não criar tabelas novas.
- O agregado, os itens, os eventos, a numeração e a inutilização já têm `model`.
- A NFC-e é um subconjunto da NF-e. O que muda cabe em colunas novas e opcionais: `qr_code`, `url_chave`, `tp_emis` (já existe), `contingency_at`, `contingency_reason`.
- A API responde `type: 'nfce'` quando `model = 65`. O `InvoiceTypeRouter` decide pelo documento, como hoje.
- A alternativa, tabelas `nfce_*` próprias, duplicaria serviços inteiros sem ganho. Fica descartada.

### 3.3 O que é específico da NFC-e

1. **`ide`:**
   - `mod=65`, `tpImp=4` (DANFCE) e `indFinal=1`.
   - `indPres` só 1, 4 ou 5. O padrão é 1; com 4, o destinatário é exigido.
   - Na NF-e o `idDest` é derivado; na NFC-e ele é sempre `1` (operação interna) **[não verificado]**.
2. **`dest` opcional:**
   - Sem `recipient`, não sai o grupo `dest`. Com CPF só, sai só o CPF; o nome é opcional.
   - O validador exige identificação a partir do limite da UF. É uma tabela `{ uf -> limite }` com padrão de R$ 10.000.
   - Em homologação, a regra do nome fixo vale só quando existe `dest` **[verificar na homologação]**.
3. **`pag`:** a mesma entrada da NF-e (`payments[]`), com o grupo `card` quando `t_pag` for 03, 04 ou 17. Regras da NT 2025.001 **[verificado]**:
   - Com `tpIntegra=1`, o CNPJ da credenciadora e o `cAut` são obrigatórios (rejeição 392). Um CNPJ de credenciadora inválido dá a 437.
   - `tBand` precisa existir na tabela oficial (rejeição 443).
   - A soma dos `vPag` não pode ficar abaixo do `vNF` (rejeição 865). Acima do `vNF`, só com `vTroco` (rejeição 866).
   - Com `tPag=90` (sem pagamento), o `vPag` é 0.

   O Corvo não integra TEF. O padrão é `tpIntegra=2` (pagamento não integrado), e o cliente informa os dados do cartão quando tiver. A lista completa de `tPag` e as regras novas do PIX ficam **[não verificado]**.
4. **`infNFeSupl`** (depois de `infNFe` e antes da `Signature`) **[verificado, NT 2025.001]**:
   - `qrCode`: o QR v3, de 60 a 1000 caracteres, sem CDATA.
   - `urlChave`: a URL de consulta da UF, de 21 a 85 caracteres.

   As duas URLs vêm de uma tabela por UF e ambiente, ao lado de `endpoints.ts`. Os valores vêm das páginas oficiais da UF e do ENCAT (http://nfce.encat.org/desenvolvedor/qrcode/). Essa página não abriu na pesquisa por erro de certificado **[não verificado]**. Um teste confere que toda UF liberada tem as duas URLs.
5. **Só QR v3. O CSC não é usado.**
   - O online não leva segredo. O off-line usa a assinatura com o A1, que já temos.
   - As colunas `nfce_csc_id` e `nfce_csc_encrypted` de `company_nfe_settings` ficam como estão, vazias. Só serão usadas se alguma UF ainda exigir v2 na homologação.
   - Se for preciso, o CSC entra cifrado como o certificado (`ApplicationCertificateDecryptor`) e nunca vai para log.
   - Isso evita pedir ao cliente um segredo a mais por UF.
6. **DANFCE** (`DocumentRenderer` novo, `type: 'nfce'`):
   - Faz um PDF de 80 mm de largura com altura variável, usando o `pdfkit` como o DANFE. O conteúdo segue o Manual do DANFE NFC-e:
     - emitente;
     - itens (podem ir resumidos);
     - totais e formas de pagamento;
     - consulta pela chave (`urlChave` e a chave em grupos de 4);
     - consumidor, ou "CONSUMIDOR NÃO IDENTIFICADO";
     - número, série, emissão e protocolo;
     - QR Code;
     - mensagens de homologação e de contingência.
   - Uma opção `?layout=a4` gera o mesmo conteúdo numa página A4, para quem não tem impressora térmica.
   - O QR é gerado por uma biblioteca pura em JS (por exemplo, `qrcode`), sem módulo nativo.
   - ESC/POS (mandar direto para a impressora) fica fora. Quem imprime é o PDV do cliente.
7. **Cancelamento:** é o mesmo evento 110111. O Corvo não bloqueia antes do prazo de 30 min; a SEFAZ responde e o Corvo mostra a rejeição com uma dica clara. O cancelamento por substituição fica fora da Fase 3.
8. **CC-e:** a capacidade `correct` não existe no gateway da NFC-e. A rota responde `422 INVOICE_OPERATION_NOT_SUPPORTED`, que já existe no roteador.
9. **Inutilização:** a mesma da NF-e, com `mod=65`. Ver o fato 8 e a pergunta 4 para SP.
10. **Endpoints do modelo 65:**
    - `EndpointRow.model` passa a aceitar `55 | 65`.
    - `UfInfo` ganha `authorizer65`, porque o autorizador da NFC-e nem sempre é o mesmo da NF-e. Há notícia de que o CE migrou para a SVRS em 2025.
    - Com fonte oficial confirmada, só temos SP **[verificado: página de web services da NFC-e de SP]**.
    - A tabela completa das UFs atendidas pela SVRS no modelo 65 **[não verificado]**: o portal https://dfe-portal.svrs.rs.gov.br/Nfce/Servicos lista as URLs, não as UFs. Têm ambiente próprio, segundo fonte secundária, SP, PR, MG, GO, MT, MS e AM.
    - Cada UF entra na tabela só com fonte oficial e passa pelo roteiro de homologação antes da linha em `nfe_enabled_authorities`.
11. **Entrada da API:**
    - Mesmo `POST /v1/invoices` com `type: 'nfce'`.
    - Campos: `recipient` opcional, `ind_pres` (1/4/5), `payments[].card` opcional.
    - Rejeitados na entrada: transporte, `fin_nfe` diferente de 1 e `idDest` interestadual.
    - `Idempotency-Key` obrigatório, como na NF-e.
12. **MCP e web:**
    - As ferramentas existentes passam a aceitar `type: 'nfce'`. Não precisa de ferramenta nova; `nfe_correct` recusa NFC-e.
    - Na web, a lista e o detalhe da NF-e ganham um filtro por modelo.
    - O formulário de emissão tem um modo "venda ao consumidor": sem destinatário, com pagamento e botão para baixar o DANFCE.

### 3.4 Credenciamento: o que o cliente (e o dono) fazem

- **Credenciar a IE como emissora de NFC-e** na SEFAZ da UF.
  - Em SP, pelo portal da NFC-e (https://www.nfce.fazenda.sp.gov.br), menu "Credenciamento". A página oficial confirma o menu de código de segurança; o de credenciamento vem de material da SEFAZ-SP/ENAT **[não verificado]**.
  - Em SC, o credenciamento passou a vir pela autorização do desenvolvedor do sistema emissor (PAF-NFC-e) **[não verificado]**. Se isso valer em outras UFs, o **Corvo** pode precisar se cadastrar como desenvolvedor em cada UF (`infRespTec`). Ver a pergunta 3.
- **CSC:** não é preciso com o v3. Se uma UF exigir o v2 na homologação, o cliente gera o CSC no portal da UF ("Gerenciar Cód. Segurança" em SP) e cadastra no Corvo.
- **Certificado A1** da empresa: já existe.

### 3.5 Por qual UF começar

**SP primeiro.** A NFC-e é obrigatória lá desde 01/01/2026, o mercado que saiu do SAT é grande, SP tem endpoint próprio confirmado e já é a UF da homologação da NF-e. Em seguida, uma UF da SVRS, mesma lógica da NF-e.

## 4. Contingência (Fase 4)

### 4.1 Primeiro, de quem é o problema

O monitor de alcance do portal (`modules/portal-reachability`) já classifica o problema: `ok`, `portal_down`, `gov_unreachable_from_us`, `no_internet` ou `emission_failures`. A sonda hoje olha só a Sefin e o ADN.

Na Fase 4, cada autoridade da NF-e/NFC-e liberada (SEFAZ-SP, SVRS, SVC-AN, SVC-RS) ganha uma sonda TCP, e o resultado fica guardado **por autoridade**. A regra que decide tudo:

| Situação | Exemplo | O que ajuda |
|---|---|---|
| Uma autoridade fora, o resto do governo responde | SEFAZ-SP fora do ar | SVC (NF-e), EPEC, off-line (NFC-e) |
| **Nenhum host do governo responde, a internet responde** (`gov_unreachable_from_us`) | incidente da Guara | **SVC e EPEC não ajudam** (também são hosts do governo). Só ajudam a NFC-e off-line e uma saída de rede alternativa |
| Sem internet | queda total | NFC-e off-line; o resto espera na fila |

### 4.2 NF-e: SVC automática, EPEC como opção

1. **Quando entrar na SVC.** Juntam-se três sinais:
   - o disjuntor da autoridade de origem (`nfe-sp-2` etc.) está aberto;
   - o monitor diz que o resto do governo responde (não é `gov_unreachable_from_us`);
   - o `NfeStatusServico` da SVC da UF responde 107.

   A SVC só funciona se a SEFAZ de origem tiver ativado; o 107 da SVC é a prova disso. Quando os três sinais valem, o Corvo grava `contingency_mode = 'svc'` por (UF, ambiente), com `dhCont` e `xJust` (por exemplo, "SEFAZ de origem indisponível"), e avisa o dono e o cliente por webhook (`nfe.contingency.entered`).
2. **Quais notas vão para a SVC:** só as que **ainda não foram enviadas**. Uma nota já enviada e sem resposta (`reconciliation_required`) **nunca** vai para a SVC: ela pode estar autorizada na origem. Essa nota espera a origem voltar e segue a conciliação pela chave de hoje. É a regra que evita nota em dobro.
3. **Numeração e chave:**
   - O número reservado continua o mesmo. Como o `tpEmis` faz parte da chave, sai um XML novo, com chave nova, `tpEmis` 6/7, `dhCont` e `xJust`. É o mesmo mecanismo de "nova tentativa, chave nova" que a NF-e já usa no `attempt`.
   - Se o documento já tinha sido assinado com `tpEmis=1` mas **comprovadamente não chegou** (o disjuntor bloqueou antes do envio), a chave antiga vai para o histórico.
   - **[verificar na homologação]** se a SVC aceita o mesmo `nNF` de uma chave tpEmis=1 nunca transmitida.
4. **Endpoints:** linhas novas em `endpoints.ts` com `tpEmis` 6/7. O `UfInfo` ganha `svc: 'SVC-AN' | 'SVC-RS'`, conforme o Ato COTEPE 39/2012.
5. **Voltar ao normal:** quando o disjuntor da origem fecha e a origem responde 107, sai `contingency_mode = 'none'` e o webhook `nfe.contingency.exited`.
   - As notas autorizadas na SVC **não** são reenviadas à origem (Anexo III).
   - Os eventos (cancelamento) de uma nota da SVC vão para onde o MOC mandar **[verificar na homologação]**.
6. **EPEC:**
   - Fica como opção para a UF sem SVC disponível. A NF-e sai com `tpEmis=4`, o evento 110140 vai ao Ambiente Nacional, o DANFE é impresso com o aviso de EPEC e a NF-e vai à origem quando ela voltar, com a mesma chave.
   - É mais complexo (dois passos e um prazo para enviar depois), e a SVC cobre todas as UFs. **Recomendo deixar o EPEC fora da Fase 4.0** e só fazer se aparecer demanda.

### 4.3 NFC-e: contingência off-line (tpEmis 9)

A NFC-e é feita no caixa: o consumidor não pode esperar a SEFAZ.
1. **Quando:** o PDV do cliente pede, com `contingency: 'offline'` no corpo, **ou** o Corvo decide sozinho.
   - O Corvo decide sozinho quando o disjuntor da autoridade está aberto ou o monitor diz `gov_unreachable_from_us`/`no_internet`, e a empresa ligou a opção `auto_offline` (padrão desligado).
   - Atenção: se a **API do Corvo** estiver fora do ar, nada disso ajuda. Ver o anti-objetivo 4.
2. **Emissão:** o Corvo numera e monta a nota com `tpEmis=9`, `dhCont` e `xJust`, assina com o A1, gera o QR v3 off-line com a assinatura e devolve **na hora** (`201`) o XML e o DANFCE com o aviso "EMITIDA EM CONTINGÊNCIA". O status é `contingency_pending`, um estado novo.
3. **Transmissão:** o job tenta enviar assim que a autoridade volta. O prazo legal é de 24 horas (fato 5).
   - Passadas **20 horas** sem conseguir, o Corvo manda um alerta (e-mail + webhook `nfce.contingency.deadline_near`).
   - Depois de 24 horas, ainda transmite e mostra o cStat 150 ("fora de prazo").
4. **Rejeitada depois:** ela já foi entregue ao consumidor. O MOC (Anexo III, §2.3.2, para a NF-e) manda corrigir e reenviar **com o mesmo número e a mesma série, sem mudar imposto, destinatário nem data de emissão** **[verificado para NF-e; não verificado se vale igual para NFC-e]**.
   - O Corvo vai para `rejected` com o motivo e o webhook `nfce.document.rejected`, e aceita a correção só nos campos que não mudam o valor fiscal.
   - Se não houver correção possível, o caso vai para revisão manual com orientação (procurar o contador).
5. **Duplicidade:** se a autoridade já tinha a nota (cStat 204, porque um envio anterior chegou), vale a conciliação pela chave que já existe.
6. **Por que dá para emitir off-line:** a chave, o XML assinado e o QR v3 saem só do A1 e dos dados da nota, sem precisar do governo. É exatamente o write-ahead que a NF-e já faz.

### 4.4 Quando o problema é a nossa rede (`gov_unreachable_from_us`)

No incidente da Guara, todos os `*.gov.br` deram timeout. SVC, EPEC, SEFAZ e Sefin são todos hosts do governo: **nenhuma contingência fiscal resolve**.

O que fazer:
1. **NFC-e:** off-line (4.3). É a única que continua saindo para o consumidor.
2. **NF-e e NFS-e:** ficam na fila. O disjuntor aberto segura o envio e a nota fica `retry_pending`, sem gastar tentativa nem cair em revisão manual. Ao voltar, a conciliação pela chave resolve o que ficou incerto.
3. **Saída de rede alternativa (PR #321, fechado):** o proxy HTTP CONNECT opcional (`FISCAL_HTTPS_PROXY`) mantém o mTLS de ponta a ponta. O proxy só vê tráfego cifrado e tem allowlist de host.

   **Recomendação: reviver, como reserva automática.**
   - O proxy só é usado enquanto o monitor diz `gov_unreachable_from_us`, e volta à rota direta quando o monitor volta a `ok`.
   - Estender a allowlist para os hosts da SEFAZ/SVRS/SVC liberados.
   - O proxy precisa rodar **em outro provedor**, fora da Guara; senão, não adianta.
   - O PR antigo ligava o proxy sempre, por variável. Com o gatilho do monitor, ele fica parado no dia a dia e só entra no incidente. Isso reduz o risco de o proxy virar ponto único de falha.
   - Custo: uma VM pequena e um segredo. Ver a pergunta 1.

### 4.5 NFS-e Nacional

Não há contingência oficial (fato 11). A estratégia continua a de hoje: fila, disjuntor e conciliação pela chave/DPS. Na queda da nossa rede, vale também o proxy de reserva (4.4). Não inventamos "NFS-e off-line".

## 5. Abordagens consideradas

| Tema | Opção A | Opção B | Escolha |
|---|---|---|---|
| Dados da NFC-e | tabelas `nfce_*` próprias | `nfe_documents` com `model=65` | **B**: o mesmo agregado, menos código |
| QR Code | v2 com CSC (o "clássico") | **só v3**, sem CSC | **v3**: menos segredo para guardar e menos passo para o cliente; v2 só se a homologação mostrar que precisa |
| Contingência NF-e | SVC automática | EPEC | **SVC** primeiro; EPEC só sob demanda |
| Entrar na SVC | manual (botão do dono) | automático com 3 sinais (4.2) | **automático**, com botão para forçar a saída |
| Queda da nossa rede | só fila | fila + proxy de reserva por gatilho | **fila + proxy por gatilho** |
| DANFCE | ESC/POS | PDF 80 mm + A4 | **PDF**; ESC/POS fora |

## 6. Anti-objetivos

1. Não quebrar NF-e nem NFS-e: nenhuma rota, estado ou webhook existente muda de nome ou formato. A coluna `model` e os estados novos são acréscimos.
2. Não calcular imposto (mesma regra da NF-e).
3. Homologação primeiro: `NFE_PRODUCTION_ENABLED` também trava o modelo 65.
4. Não ser PDV nem PAF: sem TEF, sem ESC/POS e sem emissão quando a API do Corvo está fora do ar. Um SDK off-line que assina no caixa é outro projeto.
5. Sem EPEC, cancelamento por substituição e FS-DA na primeira entrega.

## 7. O que o dono precisa providenciar

1. Uma empresa com **IE em SP**, de varejo, com A1, para homologar a NFC-e (pode ser a mesma da NF-e).
2. O **credenciamento** dessa IE para a NFC-e no portal de SP e, se SP pedir, o cadastro do Corvo como desenvolvedor/responsável técnico.
3. Uma IE numa UF da **SVRS** (ou um parceiro) para a segunda UF.
4. O **CSC** dessa IE, só se a homologação mostrar que a UF ainda exige QR v2.
5. Para o proxy de reserva: uma VM pequena **fora da Guara**.

## 8. Riscos

- **O algoritmo da assinatura do QR off-line** está num manual que não li. Se ele exigir algo que o A1 em memória não faz, o off-line atrasa. Mitigação: ler o manual e testar na homologação antes do PR da contingência.
- **Diferenças por UF** (limite sem identificação, endereço na não presencial, entrega vetada, regra de inutilização em SP): ficam em tabelas por UF, não em `if`.
- **SVC com nota em dobro:** mitigado pela regra "só vai para a SVC o que não foi enviado" (4.2).
- **NFC-e off-line rejeitada depois de entregue:** é risco fiscal do cliente. O Corvo alerta cedo (20 h) e explica o que fazer.
- **O proxy de reserva vira caminho dos dados:** o mTLS é de ponta a ponta e o proxy fica parado fora do incidente. Mesmo assim, ele precisa de monitoramento próprio.
- **NTs em movimento** (NT 2026.002, reforma tributária): fixar a versão no XSD e acompanhar o portal.

## 9. Pilha de PRs proposta

Base: `feat/nfe-07-dashboard-mcp-docs`, ou `main` depois da NF-e. Cada PR é pequeno e passa nos testes da NF-e e da NFS-e sem alteração.

**NFC-e (Fase 3)**
1. `feat/nfce-01-model-65`: `INVOICE_TYPES` com `nfce`; `model=65` aceito no agregado, na numeração e em `nfe_enabled_authorities`; `authorizer65` em `UfInfo`; endpoints do modelo 65 para SP (homologação); flag `nfce` por tenant. Sem emissão ainda.
2. `feat/nfce-02-builder-qr`: variações do builder (`ide`, `dest` opcional, `pag` com `card`), `infNFeSupl` com QR v3 online e `urlChave` por UF; validadores (indPres, limite do consumidor, pagamento); XSD no CI; `POST /v1/invoices/validate` com `type: 'nfce'`.
3. `feat/nfce-03-emit`: gateway NFC-e registrado (reusa o SOAP), emissão, consulta, conciliação, cancelamento (dica dos 30 min), inutilização e CC-e recusada; fake gateway e suíte de contrato; webhooks `nfce.document.*`.
4. `feat/nfce-04-danfce`: renderer 80 mm + A4, QR em JS puro, fixtures comparadas por texto.
5. `feat/nfce-05-web-mcp-docs`: filtro na lista, modo "venda ao consumidor", MCP com `type: 'nfce'`, docs públicas e o runbook `docs/fiscal/runbooks/nfce-homologacao.md` (SP e uma UF da SVRS).

**Contingência (Fase 4)**

6. `feat/contingencia-01-sondas`: sondas por autoridade SEFAZ/SVC no monitor; estado por autoridade; `GET /v1/fiscal-portal/status` mostra a classificação.
7. `feat/contingencia-02-nfce-offline`: `tpEmis=9`, QR v3 off-line, `contingency_pending`, transmissão com prazo, alerta de 20 h e tratamento da rejeição posterior.
8. `feat/contingencia-03-svc`: linhas SVC-AN/RS, `contingency_mode` por (UF, ambiente), os 3 sinais, regra "só o não enviado", volta ao normal e webhooks.
9. `fix/proxy-reserva-governo`: revive o #321 com o gatilho do monitor e a allowlist estendida, mais o runbook.
10. (opcional, sob demanda) `feat/contingencia-04-epec`.

## 10. Perguntas em aberto (só o dono responde)

1. **Proxy de reserva:** topa manter uma VM pequena fora da Guara só para isso? Se não, a queda da nossa rede continua sendo "fila e espera" para NF-e e NFS-e.
2. **NFC-e off-line automática:** pode vir ligada por padrão para quem emite NFC-e, ou cada cliente liga a sua? (A recomendação é desligada por padrão, porque a rejeição posterior é risco do cliente.)
3. **Responsável técnico:** o Corvo (CNPJ da Corvo) aparece como desenvolvedor no `infRespTec` e se cadastra nas UFs que pedirem (como SC)? Isso tem custo de cadastro por UF.
4. **Inutilização em SP:** se a regra de SP mudou em 01/11/2026, quer que o Corvo pare de sugerir inutilização em SP (NF-e e NFC-e) depois que o contador confirmar?
5. **Qual empresa de varejo com IE em SP** homologa a NFC-e, e existe parceiro numa UF da SVRS?
