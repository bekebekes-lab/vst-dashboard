// Visão "Acessos" do Beta2 = a aba Acessos do Dash atual: criar/bloquear/reativar/excluir contas de
// consultor e redefinir senha, mais a sub-aba "Status" (online/offline) só para admin.
// Reproduz acessosApi/acessosCriar/acessosAcao/acessosStatus* do index.html (~14369-14680).
//
// IMPORTANTE: toda a autorização continua no servidor (api/acessos.js, chave de serviço do Supabase,
// escopo de quem chama). Esta tela só pede e mostra — nenhuma regra de segurança foi movida para cá.
// A senha temporária aparece uma única vez, como no Dash atual.

import { authHeaders, supa } from './sessao.js';
import { esc } from './ui.js';

// ctx() => { perfil }
export function criarAcessos(host, ctx) {
  const st = { candidatos: [], contas: [], sub: 'contas', status: { dados: [], filtro: 'todos', timer: null }, iniciou: false };

  async function api(action, body) {
    const res = await fetch('/api/acessos?action=' + encodeURIComponent(action), {
      method: body ? 'POST' : 'GET',
      headers: { ...(await authHeaders()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = {};
    try { json = await res.json(); } catch (e) { /* corpo vazio */ }
    if (!res.ok) throw new Error(json.error || ('Erro ' + res.status));
    return json;
  }
  const podeStatus = () => ctx().perfil === 'admin';     // o servidor também só devolve linhas para 'admin'

  host.innerHTML = `
    <div class="seg" id="ac-sub" role="group" aria-label="Seção" hidden>
      <button type="button" class="seg-btn" data-sub="contas"><span>Acessos</span></button><button type="button" class="seg-btn" data-sub="status"><span>Status</span></button></div>
    <div id="ac-contas" class="ac-bloco">
      <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Criar acesso de consultor</h2><p>Só aparecem consultores que estão dentro da sua visão e ainda não têm acesso. A conta criada vê apenas os próprios pedidos.</p></div></header>
        <div class="painel-corpo">
          <div class="ac-form">
            <label class="ac-campo ac-g">Consultor (nome no CRM)<input type="text" id="ac-consultor" list="ac-consultores" placeholder="Digite para buscar…" autocomplete="off"><datalist id="ac-consultores"></datalist></label>
            <label class="ac-campo">Nome de exibição<input type="text" id="ac-nome" maxlength="80" autocomplete="off"></label>
            <label class="ac-campo ac-g">E-mail de login<input type="email" id="ac-email" maxlength="120" autocomplete="off"></label>
            <button type="button" class="btn btn-marca" id="ac-criar">Criar acesso</button>
          </div>
          <div class="prod-dica" id="ac-info"></div><div id="ac-msg"></div><div id="ac-senha"></div>
        </div></section>
      <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Consultores com acesso na sua visão</h2><p id="ac-contador"></p></div></header>
        <div class="painel-corpo" id="ac-lista"></div></section>
    </div>
    <div id="ac-status" class="ac-bloco" hidden>
      <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Status dos usuários</h2><p id="ac-status-contador"></p></div>
        <div class="painel-ctl"><span class="prod-dica" id="ac-status-atualizado"></span><button type="button" class="btn btn-fantasma" id="ac-status-atualizar">Atualizar</button></div></header>
        <div class="painel-corpo"><p class="prod-dica">Online = com a plataforma aberta e em uso agora (aba visível e atividade nos últimos 5 minutos). Quem só fez login há dias aparece como offline.</p>
          <div class="prod-ctl"><label class="busca"><input type="search" id="ac-status-busca" placeholder="Buscar nome, e-mail ou gestão" autocomplete="off"></label>
            <div class="seg" role="group" aria-label="Filtro"><button type="button" class="seg-btn ativo" data-sf="todos"><span>Todos</span></button><button type="button" class="seg-btn" data-sf="online"><span>Online</span></button><button type="button" class="seg-btn" data-sf="offline"><span>Offline</span></button></div></div>
          <div id="ac-status-area" style="margin-top:12px"></div></div></section>
    </div>`;
  const $ = s => host.querySelector(s);
  const msg = (t, erro) => { $('#ac-msg').innerHTML = t ? `<div class="${erro ? 'txt-neg' : 'txt-pos'} ac-msg">${esc(t)}</div>` : ''; };

  function mostrarSenha(titulo, email, senha) {
    $('#ac-senha').innerHTML = `<div class="ac-senha"><b>${esc(titulo)}</b><div>Login: <strong>${esc(email)}</strong></div>
      <div>Senha temporária: <code>${esc(senha)}</code> <button type="button" class="btn btn-fantasma" data-copiar="${esc(senha)}">Copiar</button></div>
      <small>Anote agora: essa senha aparece só esta vez. Repasse ao consultor e peça para trocar em "Esqueci minha senha".</small>
      <div><button type="button" class="btn btn-fantasma" data-fechar-senha>Fechar</button></div></div>`;
  }

  async function recarregar() {
    $('#ac-lista').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando…</div>';
    try {
      const [cand, lst] = await Promise.all([api('candidatos'), api('listar')]);
      st.candidatos = cand.candidatos || []; st.contas = lst.contas || [];
      $('#ac-consultores').innerHTML = st.candidatos.map(c => `<option value="${esc(c.nome)}">${esc([c.equipe, c.gestor].filter(Boolean).join(' · '))}</option>`).join('');
      $('#ac-info').textContent = `${st.candidatos.length} consultor(es) da sua visão ainda sem acesso.`;
      desenharLista();
    } catch (e) { $('#ac-lista').innerHTML = `<div class="alerta alerta-erro"><b>Erro ao carregar acessos</b> ${esc(e.message)}</div>`; }
  }

  const fmtAcesso = iso => (iso ? esc(new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })) : '<span class="prod-dica">nunca</span>');
  function desenharLista() {
    $('#ac-contador').textContent = `${st.contas.length} conta(s)`;
    if (!st.contas.length) { $('#ac-lista').innerHTML = '<div class="vazio">Nenhum consultor com acesso na sua visão ainda.</div>'; return; }
    const situacao = c => c.ativo ? '<span class="txt-pos">Ativo</span>' : (c.bloqueado_por === 'gestor' ? '<span class="txt-neg">Bloqueado</span>' : '<span class="txt-neg">Bloqueado por administrador</span>');
    const bt = (acao, id, r, perigo) => `<button type="button" class="btn btn-fantasma${perigo ? ' btn-perigo' : ''}" data-acao="${acao}" data-id="${esc(id)}">${r}</button>`;
    const excluir = c => (c.pode_excluir ? bt('excluir', c.id, 'Excluir login', true) : '');
    const acoes = c => c.ativo ? bt('redefinir_senha', c.id, 'Redefinir senha') + bt('bloquear', c.id, 'Bloquear') + excluir(c)
      : (c.pode_reativar ? bt('reativar', c.id, 'Reativar') : '<span class="prod-dica">Só um administrador pode reativar</span>') + excluir(c);
    $('#ac-lista').innerHTML = `<div class="tab-wrap"><table class="tab"><thead><tr><th>Consultor</th><th>E-mail</th><th>Equipe</th><th>Criado por</th><th>Último acesso</th><th>Situação</th><th>Ações</th></tr></thead>
      <tbody>${st.contas.map(c => `<tr><td><div class="cel-nome">${esc(c.nome || '—')}<small>${esc(c.consultor_ref || '')}</small></div></td><td>${esc(c.email || '')}</td><td>${esc(c.equipe || '—')}</td>
        <td${c.criado_por_email ? ` title="${esc(c.criado_por_email)}"` : ''}>${c.criado_por ? esc(c.criado_por) : '<span class="prod-dica" title="Conta criada antes do registro de autoria">—</span>'}</td>
        <td style="white-space:nowrap">${fmtAcesso(c.ultimo_acesso)}</td><td style="white-space:nowrap">${situacao(c)}</td><td style="white-space:nowrap">${acoes(c)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  async function criar() {
    const consultor = $('#ac-consultor').value.trim(), nome = $('#ac-nome').value.trim(), email = $('#ac-email').value.trim(), btn = $('#ac-criar');
    msg('');
    if (!st.candidatos.some(c => c.nome.toUpperCase() === consultor.toUpperCase())) return msg('Escolha um consultor da lista.', true);
    if (!nome) return msg('Informe o nome.', true);
    if (!email) return msg('Informe o e-mail de login.', true);
    btn.disabled = true;
    try {
      const r = await api('criar', { consultor_ref: consultor, nome, email });
      mostrarSenha('Acesso criado', r.conta.email, r.senha_temporaria);
      ['#ac-consultor', '#ac-nome', '#ac-email'].forEach(s => { $(s).value = ''; });
      await recarregar();
    } catch (e) { msg(e.message, true); } finally { btn.disabled = false; }
  }

  async function acao(a, id) {
    const conta = st.contas.find(c => c.id === id); if (!conta) return;
    const confirmacao = {
      bloquear: `Bloquear o acesso de ${conta.nome}? Ele deixa de entrar e de ver dados agora.`,
      reativar: `Reativar o acesso de ${conta.nome}?`,
      redefinir_senha: `Gerar uma nova senha temporária para ${conta.nome}? A senha atual deixa de valer.`,
      excluir: `EXCLUIR o login de ${conta.nome} (${conta.email})?\n\nIsso apaga o acesso de forma definitiva e não dá para desfazer (para voltar a entrar, será preciso criar o acesso de novo).\n\nPara confirmar, digite o e-mail do login:`,
    }[a];
    if (a === 'excluir') {
      const digitado = (prompt(confirmacao) || '').trim().toLowerCase();
      if (!digitado) return;
      if (digitado !== (conta.email || '').toLowerCase()) return msg('E-mail não confere — o login NÃO foi excluído.', true);
    } else if (!confirm(confirmacao)) return;
    msg('');
    try {
      const r = await api(a, { id });
      if (a === 'redefinir_senha') mostrarSenha('Nova senha gerada', conta.email, r.senha_temporaria);
      else if (a === 'excluir') msg(r.aviso || `Login de ${conta.nome} excluído.`, !!r.aviso);
      else msg(a === 'bloquear' ? 'Acesso bloqueado.' : 'Acesso reativado.', false);
      await recarregar();
    } catch (e) { msg(e.message, true); }
  }

  // ── status (presença) ──
  const fmtTempo = seg => (seg == null ? 'sem registro' : seg < 60 ? 'agora há pouco' : seg < 3600 ? `há ${Math.floor(seg / 60)} min` : seg < 86400 ? `há ${Math.floor(seg / 3600)} h` : `há ${Math.floor(seg / 86400)} dia(s)`);
  async function statusCarregar() {
    if (!podeStatus()) return;
    if (!st.status.dados.length) $('#ac-status-area').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando…</div>';
    const { data, error } = await supa.rpc('listar_presenca');
    if (error) { $('#ac-status-area').innerHTML = `<div class="alerta alerta-erro"><b>Erro ao carregar status</b> ${esc(error.message)}</div>`; return; }
    st.status.dados = data || [];
    $('#ac-status-atualizado').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR');
    statusDesenhar();
  }
  function statusDesenhar() {
    const todos = st.status.dados, nOn = todos.filter(u => u.online).length;
    $('#ac-status-contador').textContent = `${nOn} online · ${todos.length - nOn} offline`;
    const busca = ($('#ac-status-busca').value || '').trim().toLowerCase();
    const lista = todos.filter(u => {
      if (st.status.filtro === 'online' && !u.online) return false;
      if (st.status.filtro === 'offline' && u.online) return false;
      return !busca || [u.nome, u.email, u.gestor_ref, u.perfil].some(v => (v || '').toLowerCase().includes(busca));
    }).sort((a, b) => (b.online - a.online) || ((a.segundos ?? 1e12) - (b.segundos ?? 1e12)) || (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
    $('#ac-status-area').innerHTML = !lista.length ? '<div class="vazio">Nenhum usuário nesse filtro.</div>'
      : `<div class="tab-wrap"><table class="tab"><thead><tr><th>Status</th><th>Usuário</th><th>E-mail</th><th>Perfil</th><th>Gestão</th><th>Último sinal</th></tr></thead>
        <tbody>${lista.map(u => `<tr><td style="white-space:nowrap" class="${u.online ? 'txt-pos' : 'prod-dica'}"><span class="ponto" style="background:${u.online ? 'var(--ok-600)' : 'var(--cinza-300)'}"></span> ${u.online ? 'Online' : 'Offline'}</td>
          <td class="cel-nome">${esc(u.nome || '—')}</td><td>${esc(u.email || '')}</td><td>${esc(u.perfil || '')}</td><td>${esc(u.gestor_ref || '—')}</td><td style="white-space:nowrap" class="prod-dica">${u.online ? 'agora' : fmtTempo(u.segundos)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function trocarSub(qual) {
    if (qual === 'status' && !podeStatus()) qual = 'contas';
    st.sub = qual;
    $('#ac-contas').hidden = qual !== 'contas'; $('#ac-status').hidden = qual !== 'status';
    host.querySelectorAll('#ac-sub [data-sub]').forEach(b => { const on = b.dataset.sub === qual; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    clearInterval(st.status.timer); st.status.timer = null;
    if (qual === 'status') {
      statusCarregar();
      st.status.timer = setInterval(() => { if (host.hidden || st.sub !== 'status') { clearInterval(st.status.timer); st.status.timer = null; return; } statusCarregar(); }, 20000);
    }
  }

  host.addEventListener('click', e => {
    const s = e.target.closest('[data-sub]'); if (s) return trocarSub(s.dataset.sub);
    const sf = e.target.closest('[data-sf]'); if (sf) { st.status.filtro = sf.dataset.sf; host.querySelectorAll('[data-sf]').forEach(b => b.classList.toggle('ativo', b === sf)); return statusDesenhar(); }
    const a = e.target.closest('[data-acao]'); if (a) return acao(a.dataset.acao, a.dataset.id);
    const cp = e.target.closest('[data-copiar]'); if (cp) { if (navigator.clipboard?.writeText) navigator.clipboard.writeText(cp.dataset.copiar).then(() => { cp.textContent = 'Copiado'; }).catch(() => {}); return; }
    if (e.target.closest('[data-fechar-senha]')) { $('#ac-senha').innerHTML = ''; }
  });
  $('#ac-criar').addEventListener('click', criar);
  $('#ac-status-atualizar').addEventListener('click', async e => { const b = e.currentTarget; if (b.disabled) return; b.disabled = true; try { await statusCarregar(); } finally { b.disabled = false; } });
  $('#ac-status-busca').addEventListener('input', statusDesenhar);
  $('#ac-consultor').addEventListener('input', () => {
    const v = $('#ac-consultor').value.trim().toUpperCase(), c = st.candidatos.find(x => x.nome.toUpperCase() === v), info = $('#ac-info');
    if (!c) { info.textContent = `${st.candidatos.length} consultor(es) da sua visão ainda sem acesso.`; return; }
    if (!$('#ac-nome').value.trim()) $('#ac-nome').value = c.nome.toLowerCase().replace(/(^|\s)\p{L}/gu, m => m.toUpperCase());
    info.textContent = `Equipe: ${c.equipe || '—'} · Gestor: ${c.gestor || '—'} · ${c.linhas} registro(s) na base atual`;
  });

  return {
    mostrar() {
      $('#ac-sub').hidden = !podeStatus();
      if (!st.iniciou) { st.iniciou = true; msg(''); trocarSub('contas'); recarregar(); }
    },
  };
}
