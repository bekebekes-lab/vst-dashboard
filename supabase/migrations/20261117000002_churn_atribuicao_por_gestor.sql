-- Churn: cada gestor/supervisor que recebe o alerta tem a PRÓPRIA pendência (um responder não fecha pro outro),
-- e o responsável (aba Churn completa) pode atribuir/mover o alerta a quem quiser.
--
-- · O estado de cada gestor sai da conversa: última mensagem dele em churn_tratativas
--   (nenhuma = pendente · 'gestor' = tratado · 'devolucao' = devolvido). Por isso as colunas de estado único que
--   a migração 20261117000001 pôs em churn_alertas (motivo/status/devolvido) saem — nada as usava ainda.
-- · churn_tratativas.destinatario_id = de qual gestor é a mensagem (a dele, ou a devolução feita pra ele).
-- · churn_atribuicoes = atribuição MANUAL: se um alerta tem linhas aqui, só essas pessoas recebem (vale no lugar da
--   regra automática por equipe). a_partir_de = só mensagens a partir dessa data contam no estado da pessoa
--   (quem já era destinatário mantém o histórico: epoch; quem entra agora começa pendente).
-- Leitura só pra quem tem a aba Churn; toda escrita passa por /api/acessos?recurso=churn (chave de serviço).
BEGIN;

ALTER TABLE public.churn_alertas
  DROP COLUMN IF EXISTS motivo_gestor,
  DROP COLUMN IF EXISTS status_gestor,
  DROP COLUMN IF EXISTS devolvido,
  DROP COLUMN IF EXISTS devolvido_em,
  DROP COLUMN IF EXISTS devolvido_por_nome;

-- churn_tratativas acabou de ser criada (sem linhas): dá pra exigir o destinatário.
ALTER TABLE public.churn_tratativas ADD COLUMN IF NOT EXISTS destinatario_id uuid;
ALTER TABLE public.churn_tratativas ADD COLUMN IF NOT EXISTS destinatario_nome text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.churn_tratativas WHERE destinatario_id IS NULL) THEN
    ALTER TABLE public.churn_tratativas ALTER COLUMN destinatario_id SET NOT NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS churn_tratativas_dest_idx ON public.churn_tratativas (alerta_id, destinatario_id, criado_em);

CREATE TABLE IF NOT EXISTS public.churn_atribuicoes (
  alerta_id          bigint NOT NULL REFERENCES public.churn_alertas(id) ON DELETE CASCADE,
  usuario_id         uuid   NOT NULL,
  atribuido_por      uuid,
  atribuido_por_nome text,
  atribuido_em       timestamptz NOT NULL DEFAULT now(),
  a_partir_de        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (alerta_id, usuario_id)
);

ALTER TABLE public.churn_atribuicoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS churn_atribuicoes_select ON public.churn_atribuicoes;
CREATE POLICY churn_atribuicoes_select ON public.churn_atribuicoes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.usuarios_dashboard u WHERE u.id = auth.uid() AND u.perfil = ANY (ARRAY['admin', 'admin_gestao']))
  OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.perfil = 'admin')
  OR EXISTS (SELECT 1 FROM public.usuarios_dashboard u WHERE u.id = auth.uid() AND 'churn' = ANY (u.acesso_extra_abas))
);

COMMIT;
