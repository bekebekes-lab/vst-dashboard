-- admin_gestao (Richielle) deixa de ser "quase admin" no banco: ela fica travada na gestão dela.
-- Desfaz o que supabase/admin_gestao.sql tinha acrescentado: tira 'admin_gestao' de is_admin() e das
-- políticas de config_simulador2, churn_alertas, conectividade_propostas e conectividade_estudos_viabilidade.
-- Efeito: nessas tabelas ela passa a ver/alterar só o que é dela (Conectividade: só as próprias propostas e EVs).
-- Gerencial, Produção, Painel e Acessos dela vêm de /api/sheets e /api/acessos, já travados por gestão no servidor.
BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $f$ select coalesce((select perfil = 'admin' from public.usuarios_dashboard where id = auth.uid()),(select perfil = 'admin' from public.usuarios where id = auth.uid()),false); $f$;

ALTER POLICY "Admins podem ler" ON public.config_simulador2
  USING (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "Admins podem inserir" ON public.config_simulador2
  WITH CHECK (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "Admins podem atualizar" ON public.config_simulador2
  USING (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));

ALTER POLICY "churn_select_admin" ON public.churn_alertas
  USING (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))));
ALTER POLICY "churn_update_admin" ON public.churn_alertas
  USING (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))))
  WITH CHECK (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))));

ALTER POLICY "conectividade_select" ON public.conectividade_propostas
  USING (((consultor_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_beta'::text]))))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "conectividade_update" ON public.conectividade_propostas
  USING (((consultor_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_beta'::text]))))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))))
  WITH CHECK (true);
ALTER POLICY "conectividade_delete" ON public.conectividade_propostas
  USING (((EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_beta'::text]))))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "ev_select" ON public.conectividade_estudos_viabilidade
  USING (((consultor_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM usuarios_dashboard WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_beta'::text]))))) OR (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));

COMMIT;
