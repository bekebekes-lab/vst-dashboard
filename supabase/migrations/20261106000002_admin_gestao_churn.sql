-- Churn liberado para admin_gestao (Richielle) a pedido do usuário, em 06/11/2026.
-- Só as políticas de churn_alertas voltam a citar admin_gestao (ler e atualizar alertas).
-- Simulador 2.0, Conectividade de terceiros e metas continuam fechados para ela.
BEGIN;
ALTER POLICY "churn_select_admin" ON public.churn_alertas
  USING (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))));
ALTER POLICY "churn_update_admin" ON public.churn_alertas
  USING (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))))
  WITH CHECK (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))));
COMMIT;
