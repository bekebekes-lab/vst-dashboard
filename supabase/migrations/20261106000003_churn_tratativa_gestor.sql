-- Tratativa do gestor/supervisão sobre um alerta de PORT-OUT (churn).
-- Só acrescenta colunas em churn_alertas: nenhuma política muda. Gestor e supervisão NÃO leem nem
-- gravam essa tabela direto — passam por /api/acessos?recurso=churn (chave de serviço, que confere
-- a visão de quem pede). Estas colunas são separadas de feedback/respondido (resposta do admin pra Claro).
BEGIN;

ALTER TABLE public.churn_alertas
  ADD COLUMN IF NOT EXISTS tratado_gestor boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tratado_gestor_por uuid,
  ADD COLUMN IF NOT EXISTS tratado_gestor_nome text,
  ADD COLUMN IF NOT EXISTS tratado_gestor_em timestamptz,
  ADD COLUMN IF NOT EXISTS resposta_gestor text;

COMMIT;
