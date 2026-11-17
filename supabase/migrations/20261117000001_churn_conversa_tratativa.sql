-- Tratativa do churn como conversa: o gestor responde com Motivo + Status, o responsável (quem tem a
-- aba Churn completa) pode DEVOLVER com uma pergunta, e a conversa fica registrada rodada a rodada.
--
-- · churn_alertas ganha o estado atual (motivo/status da última resposta do gestor e se está devolvido).
-- · churn_tratativas guarda cada mensagem (do gestor ou do responsável). Só LEITURA direta pra quem tem a
--   aba Churn; toda escrita passa por /api/acessos?recurso=churn (chave de serviço), que confere a visão do
--   gestor ou o acesso do responsável. Nada de insert/update por policy: o gestor não consegue alterar o que enviou.
-- · feedback_por/feedback_por_nome: quem escreveu o "Feedback pra Claro" (só quem escreveu edita, pelo lápis).
BEGIN;

ALTER TABLE public.churn_alertas
  ADD COLUMN IF NOT EXISTS motivo_gestor text,
  ADD COLUMN IF NOT EXISTS status_gestor text,
  ADD COLUMN IF NOT EXISTS devolvido boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS devolvido_em timestamptz,
  ADD COLUMN IF NOT EXISTS devolvido_por_nome text,
  ADD COLUMN IF NOT EXISTS feedback_por uuid,
  ADD COLUMN IF NOT EXISTS feedback_por_nome text;

CREATE TABLE IF NOT EXISTS public.churn_tratativas (
  id         bigserial PRIMARY KEY,
  alerta_id  bigint NOT NULL REFERENCES public.churn_alertas(id) ON DELETE CASCADE,
  tipo       text   NOT NULL CHECK (tipo IN ('gestor', 'devolucao')),
  autor_id   uuid   NOT NULL,
  autor_nome text,
  motivo     text,
  status     text,
  texto      text   NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  editado_em timestamptz
);
CREATE INDEX IF NOT EXISTS churn_tratativas_alerta_idx ON public.churn_tratativas (alerta_id, criado_em);

ALTER TABLE public.churn_tratativas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS churn_tratativas_select ON public.churn_tratativas;
CREATE POLICY churn_tratativas_select ON public.churn_tratativas FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.usuarios_dashboard u WHERE u.id = auth.uid() AND u.perfil = ANY (ARRAY['admin', 'admin_gestao']))
  OR EXISTS (SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.perfil = 'admin')
  OR EXISTS (SELECT 1 FROM public.usuarios_dashboard u WHERE u.id = auth.uid() AND 'churn' = ANY (u.acesso_extra_abas))
);

COMMIT;
