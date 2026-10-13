export const onlyDigits = (value: string) => value.replace(/\D/g, "");

/** Alphanumeric tax id chars (CNPJ may contain A-Z since 2026), uppercased. */
export const cleanTaxId = (value: string) => value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

/** CNPJ body is 12 alphanumeric chars followed by 2 numeric check digits. */
const cleanCnpj = (value: string) => {
  const c = cleanTaxId(value).slice(0, 14);
  return c.slice(0, 12) + c.slice(12).replace(/\D/g, "");
};
const formatCnpj = (c: string) => {
  const parts = [c.slice(0, 2), c.slice(2, 5), c.slice(5, 8), c.slice(8, 12), c.slice(12, 14)];
  const seps = ["", ".", ".", "/", "-"];
  return parts.reduce((out, p, i) => (p ? out + seps[i] + p : out), "");
};

/** CPF (<=11 digits) or CNPJ (numeric or alphanumeric), formatted progressively while typing. */
export function maskTaxId(value: string): string {
  const c = cleanTaxId(value);
  if (c.length <= 11 && !/[A-Z]/.test(c)) {
    return c.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return formatCnpj(cleanCnpj(c));
}

export const maskZip = (value: string) => onlyDigits(value).slice(0, 8).replace(/^(\d{5})(\d)/, "$1-$2");
export const maskState = (value: string) => value.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
export const maskDigits = (max: number) => (value: string) => onlyDigits(value).slice(0, max);

/** Currency input kept as typed digits → "1.234,56". */
export function maskCurrency(value: string): string {
  const cents = onlyDigits(value).replace(/^0+/, "").slice(0, 12);
  if (!cents) return "";
  const padded = cents.padStart(3, "0");
  const int = padded.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${int},${padded.slice(-2)}`;
}
export const parseCurrency = (value: string) => Number(value.replace(/\./g, "").replace(",", "."));

/** CNPJ check digits (14 chars, alphanumeric-aware: value = charCode - 48). */
export function isValidCnpj(value: string): boolean {
  const c = cleanTaxId(value);
  if (!/^[A-Z0-9]{12}\d{2}$/.test(c) || /^(.)\1+$/.test(c)) return false;
  const digit = (len: number) => {
    let sum = 0, pos = len - 7;
    for (let i = len; i >= 1; i--) { sum += (c.charCodeAt(len - i) - 48) * pos--; if (pos < 2) pos = 9; }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(c[12]) && digit(13) === Number(c[13]);
}

/** CNPJ only: XX.XXX.XXX/XXXX-DD (alphanumeric), formatted progressively. */
export const maskCnpj = (value: string): string => formatCnpj(cleanCnpj(value));

/** CPF check digits (11 digits). */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}
