# Onboarding de quem acabou de criar a conta

Data: 2026-11-07. Status: aguardando aprovação.

## Intenção

Quem cria a conta cai hoje direto no painel (`/app`), sem saber por onde começar. O objetivo é levar essa pessoa, o mais rápido possível, a **ver uma nota fiscal de teste dela mesma**, entendendo o que está vendo, e a perceber que testar não custa nada. Esse é o momento que convence.

O critério de sucesso, nas palavras do dono do produto: **simplicidade e fluidez**. Tudo é opcional: a pessoa pode ignorar o onboarding inteiro e usar o sistema.

## Metas

- Um **cartão de boas-vindas no painel** com 5 passos, que ela faz na ordem que quiser.
- Cada passo abre uma **janela pequena por cima do painel** (sem trocar de página) e reaproveita o que já existe.
- Ao emitir a nota de teste, ela cai na **página da nota**, com uma explicação curta e o aviso de que pode testar à vontade, sem consumir créditos.
- O progresso é o **estado real dos dados**, sem depender de a pessoa "marcar" nada.

## Fora do escopo

- Tela cheia ou assistente em várias páginas (descartado: a escolha foi o checklist no painel).
- Botão que leva a pessoa a emitir em produção, copiar empresa de teste para produção ou pedir pagamento durante o onboarding. Ao terminar, ela só vê o seletor de ambiente.
- Importar o histórico de notas antigas (só o "último número", que já existe no PR #129).
- Tour guiado com balões sobre a interface.
- E-mails de lembrete.

## Anti-metas

- O onboarding **nunca bloqueia** o painel nem esconde funções.
- Não mostrar passo que a pessoa não consegue fazer por falta de permissão.
- Não prometer "ilimitado": dizer "sem consumir créditos".

## O cartão (no topo de `/app`)

Título "Bem-vindo ao Corvo", subtítulo curto ("Faça na ordem que quiser. Dá para emitir sem terminar."), a lista de passos, o contador ("2 de 5") e o botão **Ocultar**.

| # | Passo | Abre | Concluído quando |
|---|---|---|---|
| 1 | Conheça o Corvo e os planos | Janela com 3 frases sobre o produto e os planos lado a lado, só informativo | A janela foi aberta |
| 2 | Cadastre sua empresa | O formulário de empresa que já existe | Existe empresa no ambiente atual |
| 3 | Envie o certificado digital | O envio de certificado que já existe | A empresa tem certificado ativo |
| 4 | Informe a última nota emitida | O cartão "Numeração das notas" (PR #129) | O contador é maior que zero, ou a pessoa escolheu "Não emiti antes" |
| 5 | Emita sua primeira nota de teste | O formulário de nota que já existe | Existe alguma nota no ambiente de teste |

Regras:

- O passo 5 fica **bloqueado** enquanto faltar empresa ou certificado, com o texto "Cadastre a empresa e envie o certificado para liberar". Os outros passos nunca ficam bloqueados.
- O passo 4 tem o link "Nunca emiti notas antes" (marca como feito).
- Quando todos estão feitos, o cartão vira uma linha de "Tudo pronto" com o aviso do ambiente (abaixo) e some ao ser ocultado.
- **Ocultar** some o cartão; ele não volta sozinho.

### Quem vê e quando

- Só quem tem permissão de gerenciar empresas (`nfse.companies.manage`) vê o cartão, porque os passos exigem isso.
- Aparece apenas com o ambiente **teste** selecionado, e só enquanto não foi ocultado. Em produção ele não aparece.
- Empresas cadastradas e certificados são por ambiente, então o progresso é calculado para o ambiente atual.

## A página da nota de teste

Na página da nota emitida no onboarding (primeira nota de teste da conta), uma faixa explicativa, dispensável:

1. **Status**: o que "autorizada", "processando" e "rejeitada" querem dizer, em uma frase cada.
2. **PDF e XML**: o que cada um é e onde baixar.
3. **Ambiente**: "Esta é uma nota de **teste**: não tem validade legal e **não consome créditos**. Teste quantas quiser. Quando for emitir de verdade, troque para **Produção** no seletor aqui em cima."

O seletor de ambiente (no `topbar`) recebe um destaque visual (anel pulsando por alguns segundos) na primeira vez em que essa faixa aparece.

## Estado guardado

- O progresso dos passos 2, 3, 5 e, em parte, 4, **vem dos dados** (empresa, certificado, notas, contador). Não há nada para guardar.
- Guardado no navegador (`localStorage`, por conta e por workspace): "cartão oculto", "janela de planos aberta", "nunca emiti notas antes", "faixa da nota dispensada". Se a pessoa trocar de aparelho, o cartão pode reaparecer uma vez; isso é aceitável.
- Nenhuma tabela nem endpoint novo na API. Tudo usa o que existe (`GET /companies`, certificados, `GET /invoices`, `GET /companies/{id}/dps-sequence`).

## Decisões que são minhas (marcadas para revisão)

1. O estado fica no navegador, e não no servidor, para não criar tabela por causa de um cartão dispensável.
2. O cartão só aparece em `test` e só para quem gerencia empresas.
3. O passo 1 se conclui só por ser aberto (não há como "provar" que foi lido).
4. A faixa da nota aparece só para a **primeira** nota de teste da conta.
5. O texto dos planos vem dos planos reais da API (nome, preço, créditos), sem números escritos à mão.

## Decisões da revisão (minhas, para conferir)

6. **Janelas e formulários.** Empresa, certificado e numeração já são componentes de janela ou cartão e são reaproveitados em janelas. O formulário de nota é uma **página** (`/app/invoices/new`) e não será extraído: o passo 5 navega até ela, e ao emitir a pessoa já cai na página da nota, que é o objetivo. Nada de refatorar formulário grande por causa do cartão.
7. **Várias empresas.** Os passos 3, 4 e 5 olham a **primeira empresa do ambiente** (a mais antiga). O passo 2 se conclui com qualquer empresa. Não há seletor de empresa dentro das janelas; quem tem várias usa o painel normalmente.
8. **Permissões por passo.** Cada passo aparece só se a pessoa tem a permissão dele (empresas: `nfse.companies.manage`; certificado: `nfse.certificates.manage`; nota: `nfse.invoices.issue`). O contador ("2 de 5") conta só os passos visíveis, e "Tudo pronto" vale para os visíveis. Se nenhum passo for visível, o cartão não aparece.
9. **Faixa da nota.** Aparece na primeira nota de teste da conta **como quer que tenha sido emitida** (cartão, tela de nota, API), quando alguém a abre, e só até ser dispensada naquele navegador. Em outro aparelho ela pode aparecer de novo uma vez.
10. **Planos.** `GET /plans` já é usado pelo painel (`plans.list` em `lib/api.ts`) e traz nome, preço e créditos: a janela lista esses planos, sem endpoint novo.
11. **"Nunca emiti notas antes"** fica no navegador, por conta e workspace. O passo 5 não depende do 4.

## Restrições técnicas

- Web em Next.js (app router) com `next-intl`: todo texto em `messages/pt.json` e `messages/en.json`, com paridade entre os dois.
- Reaproveitar `Modal`, `Card`, `Button`, `Field` e os formulários existentes de empresa, certificado, numeração e nota. Não duplicar formulário.
- A nota de teste exige certificado da empresa (PR #126): por isso o passo 5 depende do passo 3.
- Erros da API sempre pelo catálogo (`useApiErrorText`), nunca texto cru em inglês.
- Testes no padrão do web: Vitest + Testing Library, com `fiscalEnvironment`, `can()` e a API mockados.

## Fica para quem constrói

- A forma exata dos 3 textos de boas-vindas e dos planos (pode seguir a copy da página de planos já existente).
- O visual do cartão e do destaque no seletor, dentro do que o painel já usa.
- Como detectar "primeira nota de teste da conta" da forma mais barata (por exemplo, a lista de notas do ambiente de teste com `limit=1`).
