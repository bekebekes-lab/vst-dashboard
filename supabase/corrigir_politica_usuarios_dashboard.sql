-- CORREÇÃO DE SEGURANÇA — já aplicada em produção; fica aqui como registro.
-- Problema: a policy admin_tudo (ALL, USING id = auth.uid() OR is_admin_user) deixava QUALQUER
-- usuário logado atualizar a própria linha em usuarios_dashboard, inclusive perfil/ativo/
-- acesso_extra_abas (auto-promoção a admin direto pela API do Supabase).
-- Correção: só admin escreve na tabela; cada usuário só pode alterar telefone/cargo da PRÓPRIA linha
-- (privilégio por coluna). O servidor usa a chave de serviço (ignora RLS), então não é afetado.
BEGIN;
DROP POLICY IF EXISTS admin_tudo ON public.usuarios_dashboard;
CREATE POLICY admin_tudo ON public.usuarios_dashboard FOR ALL TO authenticated
  USING (public.is_admin_user(auth.uid())) WITH CHECK (public.is_admin_user(auth.uid()));
CREATE POLICY proprio_update ON public.usuarios_dashboard FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.usuarios_dashboard FROM anon, authenticated;
GRANT UPDATE (telefone, cargo, atualizado_em) ON public.usuarios_dashboard TO authenticated;
COMMIT;
