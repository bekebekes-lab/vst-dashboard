-- Perfil admin_gestao: quase admin (Gerencial Financeiro e Painel Analítico travados na gestão dela, via front).
-- Só ACRESCENTA permissão; não muda nada pra quem já existe. is_admin_user() fica de fora de propósito
-- (editar perfis de outros usuários continua só do 'admin').
BEGIN;
ALTER TABLE usuarios_dashboard DROP CONSTRAINT usuarios_dashboard_perfil_check;
ALTER TABLE usuarios_dashboard ADD CONSTRAINT usuarios_dashboard_perfil_check CHECK (perfil = ANY (ARRAY['admin','admin_gestao','admin_beta','gestor_macro','gestor_macro2','gestor_macro3','gestor','gestor_beta','supervisao','supervisao_beta','consultor','suporte']));
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $f$ select coalesce((select perfil in ('admin','admin_gestao') from public.usuarios_dashboard where id = auth.uid()),(select perfil = 'admin' from public.usuarios where id = auth.uid()),false); $f$;
ALTER POLICY "Admins podem ler" ON public.config_simulador2
  USING (((EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "Admins podem inserir" ON public.config_simulador2
  WITH CHECK (((EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "Admins podem atualizar" ON public.config_simulador2
  USING (((EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "churn_update_admin" ON public.churn_alertas
  USING (((EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))));
ALTER POLICY "conectividade_update" ON public.conectividade_propostas
  USING (((consultor_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text, 'admin_beta'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))))
  WITH CHECK (true);
ALTER POLICY "churn_select_admin" ON public.churn_alertas
  USING (((EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND ('churn'::text = ANY (usuarios_dashboard.acesso_extra_abas)))))));
ALTER POLICY "ev_select" ON public.conectividade_estudos_viabilidade
  USING (((consultor_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text, 'admin_beta'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "conectividade_select" ON public.conectividade_propostas
  USING (((consultor_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text, 'admin_beta'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
ALTER POLICY "conectividade_delete" ON public.conectividade_propostas
  USING (((EXISTS ( SELECT 1
   FROM usuarios_dashboard
  WHERE ((usuarios_dashboard.id = auth.uid()) AND (usuarios_dashboard.perfil = ANY (ARRAY['admin'::text, 'admin_gestao'::text, 'admin_beta'::text]))))) OR (EXISTS ( SELECT 1
   FROM usuarios
  WHERE ((usuarios.id = auth.uid()) AND (usuarios.perfil = 'admin'::text))))));
COMMIT;

-- Depois, pra aplicar na Richielle:
-- UPDATE usuarios_dashboard SET perfil='admin_gestao', gestor_ref='RICHIELLE MORAIS' WHERE id='da44a79d-df17-49c8-99fa-0d63e6ce5e07';
