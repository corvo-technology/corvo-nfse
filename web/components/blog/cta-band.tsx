import Link from "next/link";

/** Closing call to action, shared by the index and every post. A rule and plain type, no filled box. */
export function CtaBand() {
  return (
    <section aria-labelledby="blog-cta" className="mt-24 border-t border-border pt-14">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:gap-16">
        <h2
          id="blog-cta"
          className="max-w-[18ch] text-[clamp(30px,4.6vw,44px)] font-semibold leading-[1.05] tracking-[-0.03em] text-text text-balance"
        >
          A primeira nota é grátis, e o teste também.
        </h2>
        <div>
          <p className="text-[16px] leading-[1.7] text-text-2 text-pretty">
            Crie a conta e emita uma nota de teste. Não pede cartão, não pede certificado e a nota não tem valor fiscal.
            Quando você se sentir seguro, a primeira nota de verdade sai sem custo.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/login?mode=signup"
              className="inline-flex items-center justify-center rounded-[7px] bg-[#ededec] px-4 py-2.5 text-[14px] font-medium text-[#0a0a0a] transition-[opacity,transform] hover:opacity-90 active:scale-[0.98]"
            >
              Criar conta e testar
            </Link>
            <Link
              href="/pt/blog/como-emitir-nota-fiscal-de-servico-nfse"
              className="text-[14px] text-text-2 underline decoration-border-strong underline-offset-[5px] transition-colors hover:text-text hover:decoration-accent"
            >
              Ler o guia de como emitir
            </Link>
          </div>
          <p className="mt-6 text-[13.5px] leading-[1.6] text-text-4">
            Programa? A{" "}
            <Link href="/pt/docs" className="text-text-3 underline decoration-border-strong underline-offset-[3px] hover:text-accent">
              documentação da API
            </Link>{" "}
            tem a parte técnica.
          </p>
        </div>
      </div>
    </section>
  );
}
