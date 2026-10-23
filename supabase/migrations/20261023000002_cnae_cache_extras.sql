-- Campos extras da consulta de CNPJ (BrasilAPI) guardados no cache, além do CNAE.
-- Tudo opcional (NULL = ainda não coletado). extras_em marca quando os extras foram
-- coletados: linha com CNAE mas extras_em NULL é "pendente de backfill" no robô.
ALTER TABLE public.cnae_cache
  ADD COLUMN IF NOT EXISTS nome_fantasia          text,
  ADD COLUMN IF NOT EXISTS porte                  text,          -- ME, EPP, DEMAIS...
  ADD COLUMN IF NOT EXISTS capital_social         numeric,
  ADD COLUMN IF NOT EXISTS data_inicio_atividade  date,
  ADD COLUMN IF NOT EXISTS situacao_data          date,
  ADD COLUMN IF NOT EXISTS situacao_motivo        text,
  ADD COLUMN IF NOT EXISTS matriz_filial          text,          -- MATRIZ | FILIAL
  ADD COLUMN IF NOT EXISTS natureza_juridica      text,
  ADD COLUMN IF NOT EXISTS opcao_simples          boolean,
  ADD COLUMN IF NOT EXISTS opcao_mei              boolean,
  ADD COLUMN IF NOT EXISTS municipio              text,
  ADD COLUMN IF NOT EXISTS uf                     text,
  ADD COLUMN IF NOT EXISTS cep                    text,
  ADD COLUMN IF NOT EXISTS endereco               text,
  ADD COLUMN IF NOT EXISTS telefone1              text,
  ADD COLUMN IF NOT EXISTS telefone2              text,
  ADD COLUMN IF NOT EXISTS email                  text,
  ADD COLUMN IF NOT EXISTS socios                 text,          -- "NOME (qualificação); ..." sem CPF
  ADD COLUMN IF NOT EXISTS cnaes_secundarios      text,          -- só os códigos, separados por ";"
  ADD COLUMN IF NOT EXISTS extras_em              timestamptz;

-- Saídas pequenas dos robôs (ex.: dimensões da planilha da Carteira) pra consulta pelo banco.
-- RLS ligada e sem policies: só a chave de serviço lê/escreve.
CREATE TABLE IF NOT EXISTS public.robo_status (
  chave         text PRIMARY KEY,
  valor         jsonb NOT NULL,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.robo_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.robo_status FROM anon, authenticated;
