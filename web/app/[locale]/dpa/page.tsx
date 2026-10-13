import { LegalDocument, legalMetadata } from "@/components/legal/legal-document";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return legalMetadata(locale, "Dpa");
}

export default async function DpaPage({ params }: Props) {
  const { locale } = await params;
  return <LegalDocument locale={locale} namespace="Dpa" />;
}
