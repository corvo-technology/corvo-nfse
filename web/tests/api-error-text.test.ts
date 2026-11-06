import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api";
import { apiErrorMessage, errorCodeKey, mapIssues } from "@/lib/api-errors";
import pt from "@/messages/pt.json";
import en from "@/messages/en.json";

const table = (messages: Record<string, string>) => ({ has: (key: string) => key in messages, text: (key: string) => messages[key] });
const validation = (details: { field: string; code: string; message: string }[]) => new ApiError(422, "Request validation failed", "ERROR_VALIDATION", undefined, details);

describe("API error codes", () => {
  it("the API sends ERROR_REQUIRED, the tables are keyed by required", () => {
    expect(errorCodeKey("ERROR_REQUIRED")).toBe("required");
    expect(errorCodeKey("ERROR_SCHEDULE_HORIZON_EXCEEDED")).toBe("schedule_horizon_exceeded");
    expect(errorCodeKey("required")).toBe("required");
  });

  it("mapIssues hands the translator the normalized code, so the translation is found", () => {
    const error = validation([{ field: "simplesRate", code: "ERROR_SIMPLES_RATE_REQUIRED", message: "The company's Simples Nacional rate is required" }]);
    const seen: string[] = [];
    mapIssues(error, { simplesRate: "simplesRate" }, (code, fallback) => { seen.push(code); return fallback; });
    expect(seen).toEqual(["simples_rate_required"]);
  });
});

describe("apiErrorMessage", () => {
  const messages = { simples_rate_required: "Informe a alíquota.", schedule_not_found: "Agenda não encontrada." };
  const { has, text } = table(messages);

  it("uses the translation of the first detail that has one", () => {
    const error = validation([{ field: "x", code: "ERROR_UNKNOWN_THING", message: "English" }, { field: "simplesRate", code: "ERROR_SIMPLES_RATE_REQUIRED", message: "English" }]);
    expect(apiErrorMessage(error, has, text, "Falhou")).toBe("Informe a alíquota.");
  });

  it("falls back to the translation of the top-level code", () => {
    expect(apiErrorMessage(new ApiError(404, "Schedule not found", "ERROR_SCHEDULE_NOT_FOUND"), has, text, "Falhou")).toBe("Agenda não encontrada.");
  });

  it("never shows the API's English text: with no translation it says the fallback", () => {
    expect(apiErrorMessage(new ApiError(422, "Something odd in English", "ERROR_WHATEVER"), has, text, "Falhou")).toBe("Falhou");
    expect(apiErrorMessage(new Error("boom"), has, text, "Falhou")).toBe("Falhou");
  });
});

describe("every code the API validates has a Portuguese and an English text", () => {
  const codes = ["required", "blank", "too_long", "too_short", "invalid_cnpj", "invalid_cpf", "invalid_tax_id", "invalid_cep", "invalid_ibge_code", "invalid_uf", "invalid_service_code", "invalid_email", "invalid_decimal_places", "out_of_range", "future_date", "schedule_horizon_exceeded", "invalid_date", "incomplete_address", "invalid_type", "invalid_option", "invalid_uuid", "unknown_field", "deduction_not_allowed_for_regime", "simples_sublimit_not_supported", "first_date_too_soon", "ends_before_start", "not_allowed", "simples_rate_required", "invalid", "validation", "schedule_not_found", "schedule_limit", "schedule_state", "quota_exceeded", "insufficient_credits", "company_not_ready", "company_not_found", "certificate_not_found", "certificate_invalid", "certificate_expired", "certificate_tax_id_mismatch", "idempotency_conflict", "rate_limit_exceeded", "tax_regime_not_supported", "permission_denied"];
  it.each(codes)("%s", (code) => {
    expect((pt.ApiErrors as Record<string, string>)[code]).toBeTruthy();
    expect((en.ApiErrors as Record<string, string>)[code]).toBeTruthy();
  });
});
