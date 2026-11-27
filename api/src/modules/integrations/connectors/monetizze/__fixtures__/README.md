# Fixtures da Monetizze

Montados a partir do exemplo oficial da Monetizze (github.com/Monetizze/ExemploPOSTCallback, `exemplo.php`; "exemplo da documentação"), **não** de uma captura real: os nomes de campo e os códigos vêm de lá, os valores são inventados.

- `sale-approved.json` e `sale-refunded.json`: o mesmo aviso em JSON. `sale-approved.form`: o mesmo aviso em formulário (`application/x-www-form-urlencoded`, com colchetes ao estilo PHP, `venda[valor]=97.90`), que é como o exemplo oficial lê (`$_POST`).
- Códigos de `venda.codigo_status`: 1 Aguardando pagamento, 2 Finalizada/Aprovada, 3 Cancelada, 4 Devolvida, 5 Bloqueada, 6 Completa. `tipoPostback.codigo`: 1 Sistema, 2 Produtor, 3 Co-Produtor, 4 Afiliado, 5 Afiliado Premium, 6 Gerente de Afiliado, 7 Co-Afiliado.

**A confirmar com um aviso real** (uma venda de teste) antes de produção:

- Se o aviso chega em JSON ou em formulário (aceitamos os dois) e se `valor`/`valorRecebido` vêm com ponto (`97.90`) ou em outro formato.
- `comprador.cnpj_cpf`: a doc diz "número inteiro, sem pontos" (perde zeros à esquerda; completamos para 11/14 dígitos), mas um exemplo de terceiros mostra `111.111.111-11`. Aceitamos os dois. `cep` idem.
- Se o código 6 (Completa) também chega e se existe aviso de chargeback (a doc não lista um código): hoje 3 Cancelada, 5 Bloqueada e os demais são ignorados.
- Autenticação: `chave_unica` no corpo (Ferramentas > Postback) mais o segredo na URL da conexão. Os valores dos testes são inventados.
- Dados do comprador só chegam para produtor e coprodutor (ou afiliado, se o produtor liberar).
