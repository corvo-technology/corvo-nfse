// lib/sdks.ts
// Single source of truth for the official SDKs: the landing section and the docs page both read this.

export interface Sdk {
  /** Stable id, also the tab id on the landing page. */
  id: "node" | "python" | "go" | "php" | "ruby" | "rust" | "java" | "elixir" | "dotnet";
  /** Display name of the language. */
  name: string;
  /** The package as it is known in its registry. */
  pkg: string;
  /** The registry it is published to. */
  registry: string;
  /** One line to add the dependency. */
  install: string;
  /** GitHub repository name inside the corvo-technology organization. */
  repo: string;
  /** Issues an invoice, authenticating with the CORVO_API_KEY environment variable. */
  snippet: string;
}

const SAMPLE = {
  company: "11222333000181",
  description: "Consultoria",
  amount: "450",
  date: "2026-10-16",
  key: "order-42",
};

export const SDKS: readonly Sdk[] = [
  {
    id: "node",
    name: "Node.js / TypeScript",
    pkg: "corvo-nfse-node",
    registry: "npm",
    install: "npm install corvo-nfse-node",
    repo: "corvo-nfse-node",
    snippet: `import { Corvo } from "corvo-nfse-node";

const corvo = new Corvo(); // reads CORVO_API_KEY

const { data: invoice, error } = await corvo.invoices.create(
  {
    companyTaxId: "${SAMPLE.company}",
    service: { description: "${SAMPLE.description}" },
    amount: ${SAMPLE.amount},
    competenceDate: "${SAMPLE.date}",
  },
  { idempotencyKey: "${SAMPLE.key}" },
);`,
  },
  {
    id: "python",
    name: "Python",
    pkg: "corvo-nfse",
    registry: "PyPI",
    install: "pip install corvo-nfse",
    repo: "corvo-nfse-python",
    snippet: `from corvo_nfse import Corvo

async with Corvo() as corvo:  # reads CORVO_API_KEY
    invoice, error = await corvo.invoices.create(
        {
            "companyTaxId": "${SAMPLE.company}",
            "service": {"description": "${SAMPLE.description}"},
            "amount": ${SAMPLE.amount},
            "competenceDate": "${SAMPLE.date}",
        },
        idempotency_key="${SAMPLE.key}",
    )`,
  },
  {
    id: "go",
    name: "Go",
    pkg: "github.com/corvo-technology/corvo-nfse-go",
    registry: "Go modules",
    install: "go get github.com/corvo-technology/corvo-nfse-go",
    repo: "corvo-nfse-go",
    snippet: `client := corvonfse.NewClient(corvonfse.Options{}) // reads CORVO_API_KEY

invoice, err := client.Invoices.Create(ctx, corvonfse.InvoiceCreateParams{
	CompanyTaxID:   "${SAMPLE.company}",
	Service:        corvonfse.InvoiceServiceInput{Description: "${SAMPLE.description}"},
	Amount:         ${SAMPLE.amount},
	CompetenceDate: "${SAMPLE.date}",
}, "${SAMPLE.key}")`,
  },
  {
    id: "php",
    name: "PHP",
    pkg: "corvo-technology/corvo-nfse",
    registry: "Packagist",
    install: "composer require corvo-technology/corvo-nfse",
    repo: "corvo-nfse-php",
    snippet: `$corvo = new \\CorvoNfse\\Client(); // reads CORVO_API_KEY

$result = $corvo->invoices->create([
    'companyTaxId' => '${SAMPLE.company}',
    'service' => ['description' => '${SAMPLE.description}'],
    'amount' => ${SAMPLE.amount},
    'competenceDate' => '${SAMPLE.date}',
], idempotencyKey: '${SAMPLE.key}');`,
  },
  {
    id: "ruby",
    name: "Ruby",
    pkg: "corvo-nfse",
    registry: "RubyGems",
    install: "gem install corvo-nfse",
    repo: "corvo-nfse-ruby",
    snippet: `client = CorvoNfse::Client.new # reads CORVO_API_KEY

invoice, error = client.invoices.create(
  {
    companyTaxId: "${SAMPLE.company}",
    service: { description: "${SAMPLE.description}" },
    amount: ${SAMPLE.amount},
    competenceDate: "${SAMPLE.date}"
  },
  idempotency_key: "${SAMPLE.key}"
)`,
  },
  {
    id: "rust",
    name: "Rust",
    pkg: "corvo-nfse",
    registry: "crates.io",
    install: "cargo add corvo-nfse",
    repo: "corvo-nfse-rust",
    snippet: `let corvo = Corvo::from_env()?; // reads CORVO_API_KEY

let invoice = corvo
    .invoices()
    .create(
        &InvoiceCreateParams {
            company_tax_id: Some("${SAMPLE.company}".into()),
            service: InvoiceServiceInput {
                description: Some("${SAMPLE.description}".into()),
                ..Default::default()
            },
            amount: ${SAMPLE.amount}.0,
            competence_date: "${SAMPLE.date}".into(),
            ..Default::default()
        },
        Some("${SAMPLE.key}"),
    )
    .await?;`,
  },
  {
    id: "java",
    name: "Java",
    pkg: "tech.corvo:corvo-nfse",
    registry: "Maven Central",
    install: 'implementation("tech.corvo:corvo-nfse:0.1.1")',
    repo: "corvo-nfse-java",
    snippet: `Corvo corvo = Corvo.builder().build(); // reads CORVO_API_KEY

InvoiceCreateParams params = InvoiceCreateParams.of(
        null,
        InvoiceCreateParams.Service.ofDescription("${SAMPLE.description}"),
        ${SAMPLE.amount}.0,
        "${SAMPLE.date}")
    .withCompanyTaxId("${SAMPLE.company}");

Result<Invoice> invoice = corvo.invoices().create(params, "${SAMPLE.key}").join();`,
  },
  {
    id: "elixir",
    name: "Elixir",
    pkg: "corvo_nfse",
    registry: "Hex",
    install: '{:corvo_nfse, "~> 0.1.1"}',
    repo: "corvo-nfse-elixir",
    snippet: `client = CorvoNfse.new() # reads CORVO_API_KEY

{:ok, invoice} =
  CorvoNfse.Resources.Invoices.create(
    client,
    %{
      "companyTaxId" => "${SAMPLE.company}",
      "service" => %{"description" => "${SAMPLE.description}"},
      "amount" => ${SAMPLE.amount},
      "competenceDate" => "${SAMPLE.date}"
    },
    idempotency_key: "${SAMPLE.key}"
  )`,
  },
  {
    id: "dotnet",
    name: ".NET",
    pkg: "Corvo.Nfse",
    registry: "NuGet",
    install: "dotnet add package Corvo.Nfse",
    repo: "corvo-nfse-dotnet",
    snippet: `using var client = new CorvoClient(); // reads CORVO_API_KEY

var invoice = await client.Invoices.CreateAsync(
    new InvoiceCreateParams
    {
        CompanyTaxId = "${SAMPLE.company}",
        Service = new InvoiceServiceInput { Description = "${SAMPLE.description}" },
        Amount = ${SAMPLE.amount}m,
        CompetenceDate = "${SAMPLE.date}",
    },
    idempotencyKey: "${SAMPLE.key}");`,
  },
];

export const SDK_ORG_URL = "https://github.com/corvo-technology";

export function sdkRepoUrl(sdk: Sdk): string {
  return `${SDK_ORG_URL}/${sdk.repo}`;
}
