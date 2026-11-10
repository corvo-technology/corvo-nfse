import Link from "next/link";

/** Closing call to action, shared by the index and every post. */
export function CtaBand() {
  return (
    <section
      aria-labelledby="blog-cta"
      className="mt-16 rounded-2xl border border-accent-border bg-accent-surface px-6 py-9 sm:px-10 sm:py-11"
    >
      <p className="eyebrow !text-accent">Comece pela homologação</p>
      <h2 id="blog-cta" className="mt-3 max-w-[22ch] text-[28px] font-semibold leading-[1.1] tracking-[-0.02em] text-text sm:text-[34px]">
        Emita a primeira NFS-e por API.
      </h2>
      <p className="mt-3 max-w-[56ch] text-[15.5px] leading-[1.65] text-text-2">
        Crie a conta, gere uma chave <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.86em] text-accent">corvo_test_</code>{" "}
        e emita no ambiente de teste, sem certificado e sem cartão de crédito.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link
          href="/login?mode=signup"
          className="inline-flex items-center justify-center rounded-[7px] bg-[#ededec] px-4 py-2.5 text-[14px] font-medium text-[#0a0a0a] transition-[opacity,transform] hover:scale-[1.02] hover:opacity-90 active:scale-[0.98]"
        >
          Começar grátis
        </Link>
        <Link
          href="/pt/docs"
          className="inline-flex items-center justify-center rounded-[7px] border border-border-strong px-4 py-2.5 text-[14px] font-medium text-text-2 transition-colors hover:bg-hover hover:text-text"
        >
          Ver a documentação
        </Link>
      </div>
    </section>
  );
}
