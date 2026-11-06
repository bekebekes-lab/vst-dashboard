// Visão "Qualidade" do Beta2 = a aba Qualidade do Dash atual: acompanhamento das 9 parcelas (270 dias)
// de cada contratação, para controle de estorno. Reproduz qualApi/qualCarregar/qualRender*/qualAbrirMarcacao
// do index.html (~14675-14930).
//
// A regra, as datas e a situação são calculadas no servidor (api/qualidade.js, só admin, chave de
// serviço); esta tela só pede e mostra. As MARCAÇÕES de pagamento (pago/atrasado/cancelado) são
// gravadas por essa mesma API — afetam estorno e valores financeiros, então os formatos de chamada
// são idênticos aos do Dash atual (marcar, marcar_lote).

import { authHeaders } from './sessao.js';
import { esc } from './ui.js';

const SIT_ROTULO = { em_dia: 'Em dia', atrasado: 'Atrasado', cancelado: 'Cancelado', concluido: 'Concluído' };
const ST_ROTULO = { pago: 'Pago', atrasado: 'Atrasado', cancelado: 'Cancelado', pendente: 'Pendente' };
const fmtData = iso => (iso ? iso.split('-').reverse().join('/') : '');
const fmtMoeda = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDH = iso => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const chave = c => c.pedido + '|' + c.data_ref;

export function criarQualidade(host) {
  const st = { dados: null, pagina: 1, timer: null, selecao: new Map(), carregou: false, situacao: 'todas', req: 0 };

  host.innerHTML = `
    <section class="painel prod-ctl-painel"><div class="prod-ctl">
      <label class="busca"><input type="search" id="q-busca" placeholder="Buscar pedido, CNPJ, cliente ou vendedor" autocomplete="off" aria-label="Buscar"></label>
      <label class="chip chip-sel"><span>Janela</span><select id="q-janela"><option value="andamento">Em acompanhamento (até 270d)</option><option value="encerrado">Encerradas (+270d)</option><option value="todos">Todas</option></select></label>
      <label class="chip chip-sel"><span>Tipo</span><select id="q-tipo"><option value="">Todos</option><option value="NOVO">NOVO</option><option value="BASE">BASE</option></select></label>
      <label class="chip chip-sel"><span>Equipe</span><select id="q-equipe"><option value="">Todas</option></select></label>
      <label class="chip chip-data"><span class="ate">DATA REF</span><input type="date" id="q-de" aria-label="DATA REF de"><span class="ate">até</span><input type="date" id="q-ate" aria-label="DATA REF até"></label>
      <button type="button" class="btn btn-fantasma" id="q-atualizar" title="Relê as planilhas do CRM (a base é guardada por 5 minutos)">↻ Atualizar base</button>
    </div></section>
    <div id="q-kpis" class="q-kpis"></div><div id="q-msg"></div><div id="q-bulk"></div>
    <section class="painel"><div class="painel-corpo" id="q-lista" style="padding-top:var(--e4)"></div></section>
    <div id="q-pag" class="q-pag"></div>
    <div class="modal-fundo" id="q-modal" hidden><div class="modal" id="q-modal-corpo" role="dialog" aria-modal="true" aria-label="Marcação de parcela"></div></div>`;
  const $ = s => host.querySelector(s);

  async function api(action, params, body) {
    const qs = new URLSearchParams({ action, ...(params || {}) });
    const res = await fetch('/api/qualidade?' + qs.toString(), {
      method: body ? 'POST' : 'GET',
      headers: { ...(await authHeaders()), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = {};
    try { json = await res.json(); } catch (e) { /* corpo vazio */ }
    if (!res.ok) { const err = new Error(json.error || ('Erro ' + res.status)); err.setup = !!json.setup; throw err; }
    return json;
  }
  const msg = (t, erro) => { $('#q-msg').innerHTML = t ? `<div class="${erro ? 'txt-neg' : 'txt-pos'} ac-msg">${esc(t)}</div>` : ''; };
  // mantém a escolha atual visível (marcada como sem registro) se não existir mais na lista
  function aplicarSelect(id, lista, vazio) {
    const sel = $(id), atual = sel.value, itens = [...lista];
    sel.innerHTML = `<option value="">${vazio}</option>` + itens.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('') + (atual && !itens.includes(atual) ? `<option value="${esc(atual)}">${esc(atual)} (sem registro)</option>` : '');
    sel.value = atual;
  }

  async function carregar(pagina, refresh) {
    st.pagina = pagina || 1; const eu = ++st.req;
    $('#q-lista').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando contratações (lê as planilhas do CRM na primeira vez, pode levar alguns segundos)…</div>';
    msg('');
    const params = { pagina: String(st.pagina), janela: $('#q-janela').value, situacao: st.situacao, tipo: $('#q-tipo').value, equipe: $('#q-equipe').value, de: $('#q-de').value, ate: $('#q-ate').value, busca: $('#q-busca').value.trim() };
    Object.keys(params).forEach(k => { if (!params[k]) delete params[k]; });
    if (refresh) params.refresh = '1';
    try {
      const d = await api('lista', params);
      if (eu !== st.req) return;               // chegou uma consulta mais nova
      st.dados = d; st.carregou = true;
      aplicarSelect('#q-equipe', d.equipes || [], 'Todas');
      if (Array.isArray(d.tipos)) aplicarSelect('#q-tipo', d.tipos, 'Todos');
      desenharKpis(); desenharLista();
    } catch (e) {
      if (eu !== st.req) return;
      $('#q-kpis').innerHTML = ''; $('#q-pag').innerHTML = '';
      $('#q-lista').innerHTML = e.setup
        ? '<div class="alerta alerta-erro"><b>Falta criar as tabelas da aba Qualidade no Supabase</b> Rode o arquivo supabase/migrations/20261016000001_qualidade_parcelas.sql no SQL Editor do Supabase e recarregue esta aba.</div>'
        : `<div class="alerta alerta-erro"><b>Erro ao carregar a Qualidade</b> ${esc(e.message)}</div>`;
    }
  }

  function desenharKpis() {
    const r = st.dados.resumo;
    const chip = (sit, titulo) => {
      const n = sit === 'todas' ? r.total : (r.por_situacao[sit] || 0), v = sit === 'todas' ? r.valor_total : (r.valor_por_situacao[sit] || 0);
      return `<button type="button" class="q-kpi${st.situacao === sit ? ' ativo' : ''}" data-sit="${sit}"><span class="k-t">${titulo}</span><b class="k-n">${n.toLocaleString('pt-BR')}</b><span class="k-v">${fmtMoeda(v)}</span></button>`;
    };
    $('#q-kpis').innerHTML = chip('todas', 'Contratações') + chip('em_dia', 'Em dia') + chip('atrasado', 'Atrasadas / sem marcação') + chip('cancelado', 'Canceladas') + chip('concluido', 'Concluídas (9/9)') +
      (r.fora_de_ativo ? `<div class="q-kpi q-kpi-aviso"><span class="k-t">⚠ Não estão mais ativas no CRM</span><b class="k-n">${r.fora_de_ativo.toLocaleString('pt-BR')}</b><span class="k-v">etapa atual diferente de Ativo/Instalado</span></div>` : '');
  }

  function desenharLista() {
    const d = st.dados;
    if (!d.contratos.length) { $('#q-lista').innerHTML = '<div class="vazio">Nenhuma contratação para esses filtros.</div>'; $('#q-pag').innerHTML = ''; desenharBulk(); return; }
    const linhas = d.contratos.map((c, i) => {
      const pills = c.parcelas.map(p => {
        const dica = `Parcela ${p.n} — vence ${fmtData(p.venc)} — ${ST_ROTULO[p.status]}${p.vencida && p.status === 'pendente' ? ' (vencida sem marcação)' : ''}${p.por ? ' — por ' + p.por : ''}`;
        return `<button type="button" class="q-p st-${p.status}${p.vencida && p.status === 'pendente' ? ' venc' : ''}" title="${esc(dica)}" data-marcar="${i}:${p.n}">${p.n}</button>`;
      }).join('');
      const pct = Math.max(0, Math.min(100, Math.round(c.dia / 270 * 100)));
      const diaTxt = c.dia > 270 ? `${c.dia}d · encerrada` : `Dia ${Math.max(c.dia, 0)}/270`;
      const alerta = c.ainda_ativo ? '' : `<div class="txt-aviso" title="Etapa atual no CRM">⚠ ${esc(c.etapa_atual || 'sem etapa')}</div>`;
      const itens = c.itens.map(it => `<div>${esc(it.p || '—')} <span class="prod-dica">· ${esc(it.n || 'sem número')}</span> <strong style="float:right">${fmtMoeda(it.v)}</strong></div>`).join('');
      return `<tr><td><input type="checkbox" data-sel="${i}" ${st.selecao.has(chave(c)) ? 'checked' : ''} aria-label="Selecionar ${esc(c.pedido)}"></td>
        <td style="white-space:nowrap"><strong>${esc(c.pedido)}</strong><small class="sub">${esc(c.tipo)}</small></td>
        <td style="min-width:200px"><div class="cel-nome">${esc(c.cliente || '—')}<small>${esc(c.cnpj)}</small></div>${alerta}</td>
        <td><div>${esc(c.proprietario || '—')}</div><small class="sub">${esc(c.equipe)}</small></td>
        <td style="white-space:nowrap">${fmtData(c.data_ref)}<small class="sub">${diaTxt}</small><div class="q-barra"><i style="width:${pct}%"></i></div></td>
        <td style="white-space:nowrap;text-align:right">${fmtMoeda(c.valor)}<div><a href="#" class="lnk lnk-sec" data-itens="${i}">${c.itens.length} item(ns) ▾</a></div></td>
        <td style="white-space:nowrap">${pills}</td><td><span class="q-sit ${c.situacao}">${SIT_ROTULO[c.situacao]}</span></td></tr>
        <tr id="q-itens-${i}" hidden><td></td><td colspan="7" class="q-itens">${itens}</td></tr>`;
    }).join('');
    const todas = d.contratos.every(c => st.selecao.has(chave(c)));
    $('#q-lista').innerHTML = `<div class="tab-wrap"><table class="tab"><thead><tr><th><input type="checkbox" data-sel-todos ${todas ? 'checked' : ''} title="Selecionar a página" aria-label="Selecionar a página"></th><th>Pedido</th><th>Cliente</th><th>Vendedor / Equipe</th><th>Data ref.</th><th style="text-align:right">Valor</th><th>Parcelas (1–9)</th><th>Situação</th></tr></thead><tbody>${linhas}</tbody></table></div>`;
    const totalPag = Math.max(1, Math.ceil(d.total_filtrado / d.por_pagina));
    $('#q-pag').innerHTML = `<button type="button" class="btn btn-fantasma" data-pag="${d.pagina - 1}" ${d.pagina <= 1 ? 'disabled' : ''}>← Anterior</button><span>Página ${d.pagina} de ${totalPag} · ${d.total_filtrado.toLocaleString('pt-BR')} contratações</span><button type="button" class="btn btn-fantasma" data-pag="${d.pagina + 1}" ${d.pagina >= totalPag ? 'disabled' : ''}>Próxima →</button><span class="prod-dica" style="margin-left:auto">Base lida em ${fmtDH(d.base_atualizada_em)}</span>`;
    desenharBulk();
  }

  function desenharBulk() {
    const n = st.selecao.size;
    if (!n) { $('#q-bulk').innerHTML = ''; return; }
    $('#q-bulk').innerHTML = `<div class="q-bulk"><strong>${n} selecionada(s)</strong><span>Marcar da parcela 1 até a</span>
      <select id="q-bulk-ate" class="sel">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(k => `<option value="${k}" ${k === 9 ? 'selected' : ''}>${k}</option>`).join('')}</select><span>como</span>
      <select id="q-bulk-status" class="sel"><option value="pago">Pago</option><option value="atrasado">Atrasado</option><option value="cancelado">Cancelado</option></select>
      <span class="prod-dica">(só parcelas já vencidas e ainda sem marcação — nunca sobrescreve)</span>
      <button type="button" class="btn btn-marca" data-lote>Aplicar</button><button type="button" class="btn btn-fantasma" data-limpar-sel>Limpar seleção</button></div>`;
  }

  async function aplicarLote() {
    const ate = Number($('#q-bulk-ate').value), status = $('#q-bulk-status').value, itens = [...st.selecao.values()];
    if (itens.length > 200) return msg('Selecione no máximo 200 contratações por vez.', true);
    if (!confirm(`Marcar como "${ST_ROTULO[status]}" as parcelas 1 a ${ate} (já vencidas e sem marcação) de ${itens.length} contratação(ões)?`)) return;
    try {
      const r = await api('marcar_lote', {}, { itens, ate_parcela: ate, status });
      st.selecao.clear(); await carregar(st.pagina); msg(`${r.parcelas_marcadas} parcela(s) marcada(s).`, false);
    } catch (e) { msg(e.message, true); }
  }

  function abrirMarcacao(i, n) {
    const c = st.dados.contratos[i], p = c.parcelas[n - 1];
    const opc = ['pago', 'atrasado', 'cancelado', 'pendente'].map(s => `<label class="q-opc"><input type="radio" name="q-st" value="${s}" ${p.status === s ? 'checked' : ''}> ${ST_ROTULO[s]}${s === 'pendente' ? ' (remove a marcação)' : ''}</label>`).join('');
    $('#q-modal-corpo').innerHTML = `<header><h3>Parcela ${n} de 9</h3><button type="button" class="btn-icone" data-fechar-modal aria-label="Fechar">✕</button></header>
      <div class="q-modal-in"><div class="prod-dica">Pedido ${esc(c.pedido)} · ${esc(c.cliente || '')}<br>Vence em ${fmtData(p.venc)} (${n * 30} dias após ${fmtData(c.data_ref)})${p.vencida ? '' : ' — ainda não venceu'}</div>
      ${opc}<input type="text" id="q-obs" maxlength="300" placeholder="Observação (opcional)" value="${esc(p.obs || '')}">
      ${p.por ? `<div class="prod-dica">Última marcação: ${esc(p.por)} em ${fmtDH(p.em)}</div>` : ''}
      <div id="q-modal-erro" class="txt-neg"></div>
      <div class="q-modal-acoes"><button type="button" class="btn btn-fantasma" data-fechar-modal>Cancelar</button><button type="button" class="btn btn-marca" id="q-salvar" data-salvar="${esc(c.pedido)}|${esc(c.data_ref)}|${n}">Salvar</button></div></div>`;
    $('#q-modal').hidden = false;
  }
  const fecharModal = () => { $('#q-modal').hidden = true; };
  async function salvarMarcacao(pedido, dataRef, n) {
    const status = (host.querySelector('input[name="q-st"]:checked') || {}).value, btn = $('#q-salvar');
    btn.disabled = true;
    try { await api('marcar', {}, { pedido, data_ref: dataRef, parcela: n, status, observacao: $('#q-obs').value }); fecharModal(); await carregar(st.pagina); }
    catch (e) { $('#q-modal-erro').textContent = e.message; btn.disabled = false; }
  }

  host.addEventListener('click', e => {
    const k = e.target.closest('[data-sit]'); if (k) { st.situacao = st.situacao === k.dataset.sit ? 'todas' : k.dataset.sit; return carregar(1); }
    const m = e.target.closest('[data-marcar]'); if (m) { const [i, n] = m.dataset.marcar.split(':').map(Number); return abrirMarcacao(i, n); }
    const it = e.target.closest('[data-itens]'); if (it) { e.preventDefault(); const tr = $('#q-itens-' + it.dataset.itens); if (tr) tr.hidden = !tr.hidden; return; }
    const pg = e.target.closest('[data-pag]'); if (pg && !pg.disabled) return carregar(Number(pg.dataset.pag));
    if (e.target.closest('[data-lote]')) return aplicarLote();
    if (e.target.closest('[data-limpar-sel]')) { st.selecao.clear(); return desenharLista(); }
    if (e.target.closest('[data-fechar-modal]') || e.target === $('#q-modal')) return fecharModal();
    const sv = e.target.closest('[data-salvar]'); if (sv) { const [pedido, dr, n] = sv.dataset.salvar.split('|'); salvarMarcacao(pedido, dr, Number(n)); }
  });
  host.addEventListener('change', e => {
    const s = e.target.closest('[data-sel]');
    if (s) { const c = st.dados.contratos[Number(s.dataset.sel)]; if (s.checked) st.selecao.set(chave(c), { pedido: c.pedido, data_ref: c.data_ref }); else st.selecao.delete(chave(c)); return desenharBulk(); }
    if (e.target.matches('[data-sel-todos]')) { st.dados.contratos.forEach(c => { if (e.target.checked) st.selecao.set(chave(c), { pedido: c.pedido, data_ref: c.data_ref }); else st.selecao.delete(chave(c)); }); return desenharLista(); }
    if (e.target.matches('#q-janela, #q-tipo, #q-equipe, #q-de, #q-ate')) carregar(1);
  });
  $('#q-busca').addEventListener('input', () => { clearTimeout(st.timer); st.timer = setTimeout(() => carregar(1), 400); });
  $('#q-atualizar').addEventListener('click', () => carregar(1, true));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#q-modal').hidden) fecharModal(); });

  return { mostrar() { if (!st.carregou) carregar(1); } };
}
