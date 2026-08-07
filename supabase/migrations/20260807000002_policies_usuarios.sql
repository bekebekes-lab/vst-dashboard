-- usuarios: remove a policy de INSERT existente (usuarios_insert), que
-- permitia qualquer usuário autenticado inserir sua própria linha com
-- QUALQUER valor de "perfil" (inclusive 'admin') — brecha de escalação de
-- privilégio, já que carregarPerfil() no front-end usa "usuarios" como
-- fallback quando não há linha em usuarios_dashboard, e o cadastro público
-- (auth signup) está habilitado no projeto. O client nunca insere em
-- "usuarios" hoje, então remover não quebra nada.
-- A policy "usuarios_select" (SELECT, auth.uid() = id) já está correta e
-- é mantida como está — não recriada aqui.
drop policy if exists "usuarios_insert" on public.usuarios;

-- usuarios_dashboard e config_simulador2 já estão corretamente protegidas
-- (própria linha + admin via is_admin_user / checagem de perfil admin) —
-- nenhuma alteração necessária nelas.
