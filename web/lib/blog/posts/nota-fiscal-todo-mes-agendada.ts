import type { BlogPost } from "../types";

export const post: BlogPost = {
  slug: "nota-fiscal-todo-mes-agendada",
  title: "Nota fiscal todo mês para o mesmo cliente: como agendar e esquecer",
  seoTitle: "Nota fiscal recorrente: agende a NFS-e todo mês",
  description:
    "Cobra o mesmo valor do mesmo cliente todo mês? Veja como agendar a nota fiscal de serviço na Corvo para ela ser emitida sozinha, sem você lembrar.",
  publishedAt: "2026-11-10",
  updatedAt: "2026-11-10",
  cluster: "rotina",
  keywords: [
    "nota fiscal recorrente",
    "agendar nota fiscal",
    "nota fiscal mensal",
    "emitir nota fiscal automática",
    "NFS-e recorrente",
    "nota fiscal todo mês",
  ],
  answer:
    "Na Corvo, você cria uma agenda com a empresa, o valor, a descrição do serviço e o cliente, e escolhe se a nota é única ou recorrente (semanal, quinzenal ou mensal). A nota é emitida sozinha, às 9h (horário de Brasília), em dia útil. Você pode pausar, editar ou cancelar a agenda quando quiser.",
  blocks: [
    {
      kind: "p",
      text: "Mensalidades, contratos de manutenção, assessorias, planos de acompanhamento: quando o serviço é o mesmo e o cliente também, repetir o formulário da nota todo mês é um trabalho que ninguém merece. A agenda faz isso por você.",
    },
    { kind: "h2", text: "Como funciona" },
    {
      kind: "p",
      text: "Você cria uma **agenda** com os dados da nota uma única vez. Depois, a Corvo emite a nota nas datas combinadas. Há dois tipos:",
    },
    {
      kind: "ul",
      items: [
        "**Única:** a nota é emitida uma vez, numa data futura. Boa para um serviço que você já sabe que vai prestar.",
        "**Recorrente:** a nota se repete toda semana, a cada duas semanas (quinzenal) ou todo mês.",
      ],
    },
    {
      kind: "p",
      text: "Na prática, a agenda serve bem para mensalidades, contratos de manutenção, assessorias e planos de acompanhamento: tudo que se repete com o mesmo cliente, o mesmo serviço e o mesmo valor.",
    },
    { kind: "h2", text: "Passo a passo" },
    {
      kind: "ol",
      items: [
        "No painel, abra **Agendadas e recorrentes** e clique em **Nova agenda**.",
        "Escolha a **empresa** que emite e o **tipo** (única ou recorrente).",
        "Se for recorrente, escolha a **frequência**: semanal, quinzenal ou mensal.",
        "Informe a **data da primeira execução**. Ela precisa ser de amanhã em diante.",
        "Se quiser, defina o **último dia**. Sem ele, a agenda continua até você pausar ou cancelar.",
        "Preencha o **valor**, a **descrição do serviço** e os dados do **cliente**.",
        "Marque **Enviar a nota por e-mail ao cliente**, se quiser que ele receba a nota automaticamente.",
        "Clique em **Criar agenda**.",
      ],
    },
    { kind: "h2", text: "Quando a nota é emitida" },
    {
      kind: "p",
      text: "As notas são emitidas às **9h, no horário de Brasília**, em **dias úteis**. Se a data cair em um sábado ou domingo, a nota é emitida na segunda-feira. A nota leva a data do dia em que foi emitida.",
    },
    { kind: "h2", text: "E se der algum problema?" },
    {
      kind: "p",
      text: "Se a Corvo não conseguir emitir (por exemplo, porque as notas do plano acabaram), ela tenta de novo no dia útil seguinte e avisa você por e-mail. Depois de **3 tentativas que falharam**, a agenda é **pausada** e você recebe outro e-mail. Resolva a causa e clique em **Retomar**: a agenda continua a partir da próxima data, sem recuperar as notas que ficaram para trás.",
    },
    { kind: "h2", text: "Mudou o valor ou o cliente?" },
    {
      kind: "p",
      text: "Clique em **Editar** na agenda. As mudanças valem para as **próximas** notas. As notas que já foram emitidas não mudam. Se o contrato acabou, use **Cancelar**: o cancelamento é definitivo, e as notas já emitidas continuam valendo. Para recomeçar, você cria uma nova agenda.",
    },
    {
      kind: "callout",
      tone: "warn",
      text: "Confira os dados da agenda antes de criar, principalmente o valor e a descrição do serviço. Em caso de dúvida sobre a descrição correta, pergunte ao seu contador.",
    },
    { kind: "h2", text: "Quando a agenda não é a melhor saída" },
    {
      kind: "p",
      text: "Se cada cliente tem um valor diferente a cada mês, a [planilha](/pt/blog/emitir-varias-notas-fiscais-com-planilha) costuma ser mais prática. E, para a primeira nota, vale seguir o [guia básico de emissão](/pt/blog/como-emitir-nota-fiscal-de-servico-nfse).",
    },
  ],
  faq: [
    {
      q: "A nota fiscal recorrente é emitida em que horário?",
      a: "Às 9h, no horário de Brasília, em dias úteis. Se a data cair no fim de semana, a nota é emitida na segunda-feira.",
    },
    {
      q: "Posso agendar uma nota para uma data só?",
      a: "Sim. Escolha o tipo Única e a data. A nota é emitida uma vez, na data indicada, a partir de amanhã.",
    },
    {
      q: "O cliente recebe a nota automaticamente?",
      a: "Se você marcar a opção de enviar a nota por e-mail ao cliente e informar o e-mail dele, sim. O cliente é opcional na agenda.",
    },
    {
      q: "O que acontece se a emissão falhar?",
      a: "A Corvo tenta de novo no próximo dia útil e avisa você por e-mail. Depois de 3 falhas seguidas, a agenda é pausada. Resolva a causa e use Retomar.",
    },
    {
      q: "Posso mudar o valor de uma agenda que já está ativa?",
      a: "Pode, com Editar. A mudança vale para as próximas notas, e as que já foram emitidas não mudam.",
    },
  ],
  readNext: ["emitir-varias-notas-fiscais-com-planilha", "como-emitir-nota-fiscal-de-servico-nfse"],
};
