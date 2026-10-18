# MVP para MEI e Simples Nacional — pendências e decisões em aberto

Data: 2026-10-15 · Status: **rascunho para discussão** (nenhuma decisão aqui está tomada) · Prazo-chave: **01/01/2027**

Este documento reúne o que foi descoberto depois de planejarmos a FiscalEngine e que afeta a meta do MVP: **emitir NFS-e corretamente para MEI e Simples Nacional, de vários municípios**. Ele não é um plano de implementação. É a lista do que falta saber, decidir ou testar, para a gente voltar a ela com calma (ainda há tempo até 2027).

Convenção de confiança usada abaixo:
- **Verificado** — conferido por mim no código, numa chamada real ou num documento oficial lido.
- **Fonte secundária** — veio de blog, notícia ou resumo; precisa de confirmação oficial.
- **Não verificado** — hipótese ou lacuna.

---

## 1. Onde estamos

| Peça | Estado |
|---|---|
| Plano 1 — outbox na entrada + `SCHEDULE` (limite de 15 dias) | Implementado e mergeado (PR #1) |
| Plano 2 — núcleo da FiscalEngine (perfil fiscal, classificação, aplicabilidade, ISS, snapshot, handler na outbox) | Implementado, PR #2 aberto. Flag `FISCAL_ENGINE_ENABLED` nasce **desligada** |
| Plano 3 — Calculadora RTC real, DpsBuilder, conciliação | Spec e plano escritos e atualizados com o contrato real da Calculadora; **não implementado** |
| Plano 4 — preview, observabilidade, docs | Spec e plano escritos; não implementado |
| Teste de emissão real (Produção Restrita da Sefin) com MEI/Simples | **Nunca executado** |

Primeiros clientes previstos: o próprio dono do produto e empresas em **São Paulo** e **Uberlândia** (a confirmar, ver §4).

Para MEI e Simples em 2026 o plano 2 deixa a emissão seguir sem IBS/CBS (a ausência é tolerada até 31/12/2026). O plano 3 não é necessário para esse caso.

---

## 2. Marcos de data (fonte secundária, exceto onde indicado)

| Data | O que acontece |
|---|---|
| 01/09/2023 | NFS-e Nacional obrigatória para o MEI (tomador PJ, ou PF que solicite a nota) |
| 01/10/2026 | Início do preenchimento de IBS/CBS na NFS-e pela regra geral (Ato Conjunto RFB/CGIBS nº 4/2026) |
| 01/11/2026 | Emissor Nacional obrigatório para ME/EPP do Simples (Resolução CGSN nº 191; houve adiamento de setembro) |
| 01/12/2026 | Categorias específicas do Ato Conjunto nº 4/2026 |
| 31/12/2026 | Fim da tolerância: até aqui a ausência dos campos de IBS/CBS não impede a autorização da nota |
| **01/01/2027** | Campos de IBS/CBS passam a ser obrigatórios para optantes do Simples (e, segundo um blog, para o MEI) |

---

## 3. Pendências, em ordem de prioridade

### P1. Teste real na Produção Restrita da Sefin — **bloqueia o lançamento**
- **Problema:** só existem testes unitários e de integração com fakes. Nada provou que a Sefin aceita a DPS gerada pela Corvo para MEI e Simples.
- **Falta:** certificado A1 de teste (ou de empresa real em homologação) e acesso à Produção Restrita.
- **Proposta:** roteiro com o CNPJ do dono como piloto: MEI e ME/EPP; tomador PF, PJ e sem tomador; pelo menos 2 ou 3 municípios; registrar o resultado em `docs/fiscal/homologation.md`.
- **Dependência:** é pessoa, não código. Sem isso nada pode ser chamado de "homologado".

### P2. Regra de MEI e Simples a partir de 01/01/2027 — **prazo duro**
- **Situação atual do código (verificado):** as estratégias de MEI e Simples tratam IBS/CBS de 2027 como `UNSUPPORTED`. Isso **bloqueia a emissão** em 01/01/2027 se ninguém trocar essa regra. Foi um bloqueio conservador que eu deixei como marcador, não uma exigência legal.
- **O que se sabe (fonte secundária):**
  - o Ato Conjunto RFB/CGIBS nº 4/2026 (30/07/2026) fixa 01/01/2027 para optantes do Simples preencherem os campos de IBS/CBS;
  - quem fez a opção pelo destaque antecipado em setembro/2026 também entra nessa data;
  - depois do início da obrigação, a falta dos campos gera desconformidade sujeita a sanção;
  - para o MEI, só um blog afirma a obrigação em 2027.
- **O que falta saber:**
  - a **lista exata de campos** que MEI e Simples preenchem;
  - o texto da **opção** do Simples pelo regime regular de IBS/CBS (Resolução CGSN) e o prazo dessa opção;
  - se o MEI está mesmo obrigado em 2027;
  - se a Sefin calcula e consolida os valores (a DPS só declara a classificação), como no restante do leiaute.
- **Indícios técnicos (verificado):** o grupo `IBSCBS` da DPS no `open-nfse` é declaratório (`finNFSe`, `cIndOp`, `indDest`, `gIBSCBS` com CST e cClassTrib). Para barbearia (NBS `126021000`) a Calculadora devolveu CST `000` e cClassTrib `000001`, em 10/12/2026. Isso **não** foi validado para o Simples em 2027.
- **Proposta:** (1) ler o texto oficial do Ato Conjunto e da resolução da CGSN; (2) confirmar com um contador; (3) trocar o bloqueio por uma regra baseada no perfil (a empresa declara se está obrigada ao destaque; se sim, a engine monta o grupo; se não, a nota segue sem ele).
- **Consequência para o plano 3:** a parte "declarar o grupo IBSCBS na DPS + validar a classificação" deixa de ser opcional para o MVP. A parte de **calcular valores** e a **conciliação** continuam opcionais.

### P3. Adesão do município ao Emissor Nacional
- **Problema (verificado):** a Corvo não consulta a adesão do município. O `open-nfse` tem essa consulta (`aderenteEmissorNacional`, `aderenteAmbienteNacional`, `tipoConvenio`), mas nenhum código da Corvo a usa. Em cidade fora do padrão, o cliente receberia erro confuso ou rejeição.
- **Números (fonte secundária, com datas diferentes — não comparáveis entre si):**

| Medida | Número | Data |
|---|---|---|
| Municípios que formalizaram o convênio | 5.465 (cerca de 98% de ~5.570, conta minha) | jan/2026 |
| Desses, com a plataforma em operação ativa | 1.898 (34,7%) | jan/2026 |
| Municípios no Emissor Nacional | mais de 2.000 | mai/2026 |
| Ainda fora do padrão | 501 | dez/2025 |

  Cobertura da população entre os aderentes: cerca de 97%; todas as capitais assinaram o convênio. "Assinar o convênio" não significa desligar o sistema municipal.
- **Cidades de interesse (fonte secundária, a confirmar):**

| Cidade | Situação encontrada |
|---|---|
| São Paulo | Manteve o emissor próprio (Nota Paulistana) com layout nacional; quem está obrigado ao Emissor Nacional passa a emitir nele |
| Uberlândia | Anunciou o Emissor Nacional a partir de 01/01/2026; cronograma oficial não encontrado |
| Rio de Janeiro | Padrão nacional para todos os contribuintes de ISS a partir de 01/01/2026 |
| Belo Horizonte | Emissores nacionais desde out/2025 |
| Curitiba | Migração em etapas: out/2025, nov/2025 (Simples), jan/2026 (demais) |
| Porto Alegre | Emissão exclusiva no nacional desde 01/11/2025 |
| Salvador, Brasília | Sem informação encontrada |

- **Pergunta em aberto:** como a obrigação do Simples (01/11/2026) se aplica em cidades que mantêm sistema próprio, como São Paulo.
- **Proposta:** consultar o convênio do município antes de emitir (com cache) e devolver erro claro. Se a consulta exigir certificado, usar o do dono do produto para validar.

### P4. `regApTribSN` fixo em `1`
- **Verificado:** `NfseWorkflowService.payload()` envia sempre `regApTribSN: 1` (tributos federais e municipais pelo Simples). Para ME/EPP que ultrapassaram o sublimite o valor correto pode ser outro.
- **Proposta:** guardar o regime de apuração no perfil fiscal (campo que eu tinha cortado do modelo como "especulativo") e usar na DPS. Padrão continua `1`.

### P5. Pontos a validar com um contador
- **Totais aproximados de tributos:** a Corvo envia `vTotTrib` zerado para todos os regimes. Para o MEI a lib sugere `indTotTrib`; para ME/EPP, `pTotTribSN`. Não está claro o que a Sefin exige ou aceita.
- **Retenção de ISS pelo tomador (Simples):** resolvido — `simplesIssRate` no perfil fiscal carrega a alíquota efetiva do Simples do mês anterior (LC 123/2006, art. 21, §4º, I) e o `DpsBuilder` preenche `pAliq` quando `tpRetISSQN` indica retenção; sem a alíquota configurada a emissão é bloqueada (`MISSING_CONFIGURATION`).
- **Serviços permitidos ao MEI:** a Sefin rejeita atividades que o MEI não pode prestar; a Corvo hoje só repassa a mensagem.
- **MEI sem tomador:** quando a nota é obrigatória (tomador PJ, ou PF que solicite) e como a Corvo deve tratar o caso sem tomador.

### P6. Municípios com sistema próprio — decisão de produto
- **Contexto:** a Corvo fala só com o sistema nacional. Intermediários como a NFE.io têm integrações separadas com cada prefeitura que mantém protocolo próprio (não consegui confirmar o detalhe da cobertura deles).
- **Open source (fonte secundária):** o ACBr (biblioteca `ACBrLib`) trata o padrão nacional como mais um provedor e cobre muitos sistemas municipais. Um relato antigo fala em ~59% das cidades (3.303 de 5.571); pode estar desatualizado. Não encontrei open source que garanta emissão correta em todas as cidades.
- **Opções:** (a) MVP só no nacional e erro claro fora dele; (b) integrar ACBr para as cidades fora do padrão; (c) parceria com um intermediário.
- **Recomendação provisória:** (a), medindo de onde vêm os clientes antes de decidir (b) ou (c).

### P7. Calculadora RTC — o que ficou decidido e o que não
- **Verificado em 2026-10-15** (app `1.6.0`, dados `V0059`; detalhes em `docs/fiscal/rtc/`): programa oficial distribuído como zip com jar Java 21 e banco SQLite; roda offline na porta 8080; partida ~4 min; ~714 MiB; 25–440 ms por cálculo; Simples é um campo do pedido, não outro componente.
- **Competências de 2027 em diante:** o motor exige alíquotas nominais que a base dele ainda não tem. Sem elas ⇒ erro 422; com alíquotas informadas ⇒ calcula, mas marca `calculoSimulado: true`. A Corvo não pode estimar alíquotas, então 2027+ fica bloqueado para **cálculo de valores** até o governo publicar as alíquotas. Isso é separado de P2 (declarar o grupo não exige calcular).
- **Uso:** para o MVP de MEI/Simples a Calculadora serve sobretudo para **validar/descobrir a classificação** (CST, cClassTrib, cIndOp). O cálculo de valores só funciona de verdade em 2026.
- **Em aberto:** licença de uso em produção (o pacote não traz arquivo de licença; o governo descreve a ferramenta como gratuita e de código aberto), quem opera a atualização de versão, e se vale hospedar a Calculadora já no MVP.

### P8. Decisões pendentes herdadas do plano 2 (`docs/fiscal/limitations.md`)
- **D1:** modo `block` ou `warn` para IBS/CBS obrigatório enquanto o adaptador real não existir. Não afeta MEI/Simples em 2026.
- **D2:** quem pode aprovar um perfil fiscal em `live`.
- **D3:** lista das categorias específicas do Ato Conjunto nº 4/2026 (subitens da LC 116).

---

## 4. Perguntas para responder antes de planejar

1. A empresa do dono do produto é **MEI ou Simples**? Em qual **cidade**?
2. Quais cidades terão os primeiros clientes além de São Paulo e Uberlândia?
3. Há **certificado A1 de teste** e acesso à Produção Restrita?
4. Quem será o **contador/consultor** que confirma P2 e P5?
5. O MVP aceita **só o sistema nacional** (P6, opção a)?

---

## 5. Sugestão de ordem (sem compromisso)

1. Responder a §4 e obter o certificado (P1).
2. Ler o texto oficial e confirmar P2 e P5 com um contador.
3. Escrever um "Plano 2B" curto: regra de 2027 baseada no perfil, `regApTribSN`, consulta de município, roteiro de teste.
4. Implementar o plano 3 já com o gancho de declaração do grupo IBSCBS para MEI/Simples; cálculo de valores e conciliação ficam para depois.
5. Rodar o roteiro de homologação (P1) antes de qualquer cliente real.

---

## 6. Fontes

Fonte secundária, a confirmar nos documentos oficiais:
- [Fenacon / CRC-MS — NFS-e Nacional obrigatória para ME e EPP em 01/11/2026](https://crcms.org.br/?p=37798)
- [Contábeis — novas datas de IBS/CBS nas notas](https://www.contabeis.com.br/artigos/78468/novas-datas-ibs-e-cbs-nas-notas-fiscais-entenda-o-cronograma/)
- [Machado Meyer — cronograma oficial de IBS/CBS (Ato Conjunto 4/2026)](https://www.machadomeyer.com.br/pt/inteligencia-juridica/publicacoes-ij/tributario-ij/rfb-e-cgibs-definem-cronograma-oficial-de-obrigatoriedade-dos-documentos-fiscais-eletronicos-com-ibs-e-cbs)
- [Sigcorp — Ato Conjunto nº 4/2026](https://sigcorp.com.br/atencao-rfb-cgibs-publicaram-novo-cronograma-oficial-do-ibs-cbs-para-os-documentos-fiscais-eletronicos-ato-conjunto-no-4-2026/)
- [Meu Contador Online — MEI e IBS/CBS em 2027 (fonte única para o MEI)](https://www.meucontadoronline.com.br/blog/mei-sera-obrigado-a-preencher-ibs-cbs/)
- [Portal da Reforma Tributária — 5.465 municípios aderentes](https://www.reformatributaria.com/tecnologia/lista-de-municipios-aderentes-a-nfs-e-nacional-chega-a-5-465-so-347-estao-com-a-plataforma-em-operacao-ativa/)
- [Projeto ACBr — panorama da adesão](https://www.projetoacbr.com.br/forum/topic/92571-panorama-da-ades%C3%A3o-ao-padr%C3%A3o-nacional)
- [AMDJUS — São Paulo e Brasília fora do padrão](https://amdjus.com.br/exclusao-de-sao-paulo-e-brasilia-da-nfs-e-nacional-surpreende-contribuintes/)
- [Trivium Contábil — NFS-e em São Paulo 2026](https://triviumcontabil.com.br/?p=17450)
- [Nota Gateway — Uberlândia](https://notagateway.com.br/?p=8028)
- [NFE.io — desafio de emitir em diferentes prefeituras](https://nfe.io/blog/integracao/api-de-nfs-e-o-desafio-de-emitir-notas-em-diferentes-prefeituras-e-como-resolver/)
- [TabNews — cobertura do ACBr (relato antigo)](https://www.tabnews.com.br/valterpatrick/emissao-de-nfse-para-59-por-cento-das-cidades-brasileiras)

Verificado diretamente: `docs/fiscal/rtc/` (contrato, OpenAPI e fixtures da Calculadora), `docs/fiscal/limitations.md`, `docs/fiscal/rules-verification.md`, README e tipos do `open-nfse` 0.11.0, e o código de `NfseWorkflowService`.
