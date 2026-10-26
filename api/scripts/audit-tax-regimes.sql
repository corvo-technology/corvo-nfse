-- Empresas cujo perfil fiscal vigente hoje NÃO é MEI nem Simples Nacional.
-- Lucro Presumido/Real não são mais aceitos. Rodar antes de subir esta versão:
--   psql "$DATABASE_URL" -v app_schema=corvo -f api/scripts/audit-tax-regimes.sql
-- Cada linha precisa ser corrigida (perfil fiscal) ou a empresa desativada.
SELECT p.tenant_id,
       p.company_id,
       c.legal_name,
       c.tax_id,
       c.environment,
       p.tax_regime,
       p.valid_from,
       p.review_status
  FROM :"app_schema".company_fiscal_profiles p
  JOIN :"app_schema".nfse_companies c ON c.id = p.company_id
 WHERE p.valid_from <= CURRENT_DATE
   AND (p.valid_until IS NULL OR p.valid_until > CURRENT_DATE)
   AND p.tax_regime NOT IN ('MEI', 'SIMPLES_NACIONAL')
 ORDER BY p.tenant_id, c.legal_name;
