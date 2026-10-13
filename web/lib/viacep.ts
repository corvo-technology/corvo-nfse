export interface CepResult {
  street: string; district: string; city: string; state: string; ibge: string;
}

/** Looks up a Brazilian CEP on ViaCEP. Returns null when the CEP does not exist. */
export async function lookupCep(cep: string, signal?: AbortSignal): Promise<CepResult | null> {
  const digits = cep.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, { signal });
  if (!res.ok) throw new Error(`viacep ${res.status}`);
  const data = (await res.json()) as { erro?: boolean | string; logradouro?: string; bairro?: string; localidade?: string; uf?: string; ibge?: string };
  if (data.erro) return null;
  return { street: data.logradouro ?? "", district: data.bairro ?? "", city: data.localidade ?? "", state: data.uf ?? "", ibge: data.ibge ?? "" };
}
