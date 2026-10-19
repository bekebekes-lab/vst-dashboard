-- Status Online/Offline (aba Acessos > Status, só perfil 'admin').
-- Já aplicado em produção; fica aqui como registro.
--
-- Cada navegador chama registrar_presenca() a cada 60s, mas só enquanto a aba
-- está visível e houve atividade nos últimos 5 min. Online = sinal há <= 150s.
-- Funções SECURITY DEFINER: o usuário só consegue mexer no PRÓPRIO sinal
-- (auth.uid()), sem depender da policy de UPDATE da tabela.
ALTER TABLE public.usuarios_dashboard ADD COLUMN IF NOT EXISTS ultimo_sinal timestamptz;

CREATE OR REPLACE FUNCTION public.registrar_presenca(p_online boolean DEFAULT true)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  UPDATE public.usuarios_dashboard
     SET ultimo_sinal = CASE WHEN p_online THEN now() ELSE NULL END
   WHERE id = auth.uid();
$f$;
REVOKE ALL ON FUNCTION public.registrar_presenca(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_presenca(boolean) TO authenticated;

-- Só devolve linhas se quem chama for perfil 'admin' (outros perfis recebem vazio).
CREATE OR REPLACE FUNCTION public.listar_presenca()
RETURNS TABLE(id uuid, nome text, email text, perfil text, gestor_ref text, ultimo_sinal timestamptz, segundos integer, online boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  SELECT u.id, u.nome, u.email, u.perfil, u.gestor_ref, u.ultimo_sinal,
         CASE WHEN u.ultimo_sinal IS NULL THEN NULL ELSE extract(epoch FROM (now() - u.ultimo_sinal))::int END,
         coalesce(u.ultimo_sinal > now() - interval '150 seconds', false)
    FROM public.usuarios_dashboard u
   WHERE coalesce(u.ativo, true)
     AND EXISTS (SELECT 1 FROM public.usuarios_dashboard a WHERE a.id = auth.uid() AND a.perfil = 'admin');
$f$;
REVOKE ALL ON FUNCTION public.listar_presenca() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_presenca() TO authenticated;
