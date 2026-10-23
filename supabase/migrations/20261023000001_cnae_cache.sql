-- Cache de CNAE por CNPJ (preenchido pelo carteira_cnae.py, que consulta a BrasilAPI).
-- Evita reconsultar a API a cada base nova de Carteira: CNPJ já conhecido vem daqui.
-- RLS ligada e SEM policies de propósito: só a chave de serviço (robô) lê/escreve;
-- nenhum usuário do Dash precisa acessar esta tabela direto (o Dash lê as colunas
-- CNAE/Descrição CNAE que o robô escreve na própria planilha da Carteira).
CREATE TABLE IF NOT EXISTS public.cnae_cache (
  cnpj           text PRIMARY KEY,                 -- só dígitos, 14 posições
  encontrado     boolean NOT NULL DEFAULT true,    -- false = a Receita/BrasilAPI não achou o CNPJ
  cnae_codigo    text,                             -- 7 dígitos, com zero à esquerda (ex.: 0600001)
  cnae_descricao text,
  situacao       text,                             -- situação cadastral (ATIVA, BAIXADA...)
  consultado_em  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.cnae_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cnae_cache FROM anon, authenticated;
