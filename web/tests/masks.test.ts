import { describe, expect, it } from "vitest";
import { isValidCnpj, isValidCpf, maskCnpj, maskCurrency, maskTaxId, maskZip, parseCurrency } from "@/lib/masks";

describe("masks", () => {
  it("formats CPF and CNPJ progressively", () => {
    expect(maskTaxId("52998224725")).toBe("529.982.247-25");
    expect(maskTaxId("11222333000181")).toBe("11.222.333/0001-81");
    expect(maskTaxId("1122")).toBe("112.2");
    expect(maskCnpj("1122")).toBe("11.22");
    expect(maskCnpj("112223330001")).toBe("11.222.333/0001");
  });
  it("validates CNPJ check digits", () => {
    expect(isValidCnpj("11.222.333/0001-81")).toBe(true);
    expect(isValidCnpj("11222333000182")).toBe(false);
    expect(isValidCnpj("11111111111111")).toBe(false);
  });
  it("supports alphanumeric CNPJ", () => {
    expect(maskTaxId("MAJBQ3OH000114")).toBe("MA.JBQ.3OH/0001-14");
    expect(maskCnpj("majbq3oh0001")).toBe("MA.JBQ.3OH/0001");
    expect(isValidCnpj("MA.JBQ.3OH/0001-14")).toBe(true);
    expect(isValidCnpj("MA.JBQ.3OH/0001-15")).toBe(false);
  });
  it("validates CPF check digits", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
  });
  it("formats ZIP and currency", () => {
    expect(maskZip("01310100")).toBe("01310-100");
    expect(maskCurrency("150")).toBe("1,50");
    expect(maskCurrency("123456789")).toBe("1.234.567,89");
    expect(parseCurrency("1.234,56")).toBe(1234.56);
    expect(parseCurrency("")).toBe(0);
  });
});
