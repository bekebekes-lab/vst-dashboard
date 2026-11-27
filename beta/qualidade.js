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
  // SD › Blip GO ativos, mês a mês (uma linha por cliente em cada mês). Mantenha igual a qualidade* de index.html (sdCarregar/sdRender).
  const sd = { dados: null, carregou: false, req: 0, ord: { col: 'mes', asc: false }, aberto: null, sub: 'estorno' };
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesRotulo = m => { const [a, mm] = (m || '').split('-'); return MESES[(+mm || 1) - 1] + '/' + a; };

  host.innerHTML = `
    <div class="seg" id="q-sub" role="group" aria-label="Seção">
      <button type="button" class="seg-btn ativo" data-qsub="estorno" aria-pressed="true"><span>Estorno (9 parcelas)</span></button><button type="button" class="seg-btn" data-qsub="sd" aria-pressed="false"><span>SD</span></button></div>
    <div id="q-estorno">
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
    <div class="modal-fundo" id="q-modal" hidden><div class="modal" id="q-modal-corpo" role="dialog" aria-modal="true" aria-label="Marcação de parcela"></div></div>
    </div>
    <div id="q-sd" hidden>
      <section class="painel prod-ctl-painel"><div class="prod-ctl">
        <label class="busca"><input type="search" id="sd-busca" placeholder="Buscar cliente, CNPJ, consultor ou pedido" autocomplete="off" aria-label="Buscar"></label>
        <label class="chip chip-sel"><span>Mês</span><select id="sd-mes"><option value="">Todos</option></select></label>
        <label class="chip chip-sel"><span>Consultor</span><select id="sd-consultor"><option value="">Todos</option></select></label>
        <label class="chip chip-sel"><span>Equipe</span><select id="sd-equipe"><option value="">Todas</option></select></label>
        <label class="chip chip-sel"><span>Gestor</span><select id="sd-gestor"><option value="">Todos</option></select></label>
        <label class="chip chip-sel"><span>Faturas pagas</span><select id="sd-pgto"><option value="">Todas</option><option value="pendente">Com fatura pendente (1ª–5ª)</option><option value="ok">1ª a 5ª pagas</option></select></label>
        <button type="button" class="btn btn-fantasma" id="sd-csv">⬇ CSV</button>
        <button type="button" class="btn btn-fantasma" id="sd-atualizar" title="Relê as planilhas do CRM (a base é guardada por 5 minutos)">↻ Atualizar base</button>
      </div></section>
      <div class="prod-dica" style="margin:var(--e2) 0">Pedidos de <b>Blip GO</b> ativos (ATIVO/CONECTADO no CRM), mês a mês, uma linha por cliente em cada mês. Clique no título da coluna para classificar e na linha para ver os pedidos.</div>
      <div id="sd-msg"></div><div id="sd-kpis" class="q-kpis"></div>
      <section class="painel"><div class="painel-corpo" id="sd-lista" style="padding-top:var(--e4)"></div></section>
    </div>`;
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

  // ── SD › Blip GO ──
  const sdFiltros = () => ({ busca: $('#sd-busca').value.trim(), mes: $('#sd-mes').value, consultor: $('#sd-consultor').value, equipe: $('#sd-equipe').value, gestor: $('#sd-gestor').value, pgto: $('#sd-pgto').value });
  const norm = t => (t || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  // Faturas pagas (1ª–5ª): cada pedido da linha guarda p.f = [faturas pagas]. Estado da fatura n na linha: 0 nenhum pedido, 1 alguns, 2 todos.
  const estadoFatura = (l, n) => { const c = l.pedidos.filter(p => (p.f || []).includes(n)).length; return c === 0 ? 0 : (c === l.pedidos.length ? 2 : 1); };
  const pagasDe = l => [1, 2, 3, 4, 5].filter(n => estadoFatura(l, n) === 2).length;
  function sdPassa(l, f, ign) {
    if (ign !== 'mes' && f.mes && l.mes !== f.mes) return false;
    if (ign !== 'consultor' && f.consultor && l.consultor !== f.consultor) return false;
    if (ign !== 'equipe' && f.equipe && l.equipe !== f.equipe) return false;
    if (ign !== 'gestor' && f.gestor && l.gestor !== f.gestor) return false;
    if (f.pgto === 'ok' && pagasDe(l) < 5) return false;
    if (f.pgto === 'pendente' && pagasDe(l) >= 5) return false;
    if (f.busca) {
      const alvo = norm(`${l.cliente} ${l.cnpj} ${l.consultor} ${l.pedidos.map(p => p.pedido).join(' ')}`), dig = f.busca.replace(/\D/g, '');
      if (!alvo.includes(norm(f.busca)) && !(dig.length >= 4 && l.cnpj.replace(/\D/g, '').includes(dig))) return false;
    }
    return true;
  }
  // listas dos filtros em cascata: cada uma considera os OUTROS filtros (não o próprio)
  function sdSelect(id, f, campo, vazio, fmt) {
    const sel = $(id), atual = sel.value;
    const vals = [...new Set(sd.dados.linhas.filter(l => sdPassa(l, f, campo)).map(l => l[campo]).filter(Boolean))];
    vals.sort(campo === 'mes' ? (a, b) => (a < b ? 1 : -1) : (a, b) => a.localeCompare(b, 'pt-BR'));
    if (atual && !vals.includes(atual)) vals.push(atual);
    sel.innerHTML = `<option value="">${vazio}</option>` + vals.map(v => `<option value="${esc(v)}">${esc(fmt ? fmt(v) : v)}</option>`).join('');
    sel.value = atual;
  }
  function sdVisiveis() {
    const f = sdFiltros(), { col, asc } = sd.ord, dir = asc ? 1 : -1;
    sd.dados.linhas.forEach(l => { l.pagas = pagasDe(l); });
    const v = sd.dados.linhas.filter(l => sdPassa(l, f));
    v.sort((a, b) => { const x = a[col], y = b[col]; const c = typeof x === 'number' ? x - y : String(x || '').localeCompare(String(y || ''), 'pt-BR'); return (c * dir) || a.cliente.localeCompare(b.cliente, 'pt-BR') || (a.mes < b.mes ? 1 : -1); });
    return v;
  }
  const sdMsg = (t, erro) => { $('#sd-msg').innerHTML = t ? `<div class="${erro ? 'txt-neg' : 'txt-pos'} ac-msg">${esc(t)}</div>` : ''; };
  // Marca/desmarca a fatura n (1–5, ou 'todas') como paga em todos os pedidos da linha. Grava no servidor e só então atualiza a tela.
  async function sdMarcar(i, n, marcado) {
    const l = sdVisiveis()[i]; if (!l) return;
    sdMsg('');
    try {
      await api('sd_marcar', {}, { mes: l.mes, chave: l.chave, fatura: n, marcado });
      const alvo = n === 'todas' ? [1, 2, 3, 4, 5] : [n];
      l.pedidos.forEach(p => { const set = new Set(p.f || []); alvo.forEach(x => (marcado ? set.add(x) : set.delete(x))); p.f = [...set].sort(); });
    } catch (e) { sdMsg(e.message, true); }
    sdDesenhar();
  }
  function sdDesenhar() {
    if (!sd.dados) return;
    const f = sdFiltros(), ok = sd.dados.pagamentos_ok;
    sdSelect('#sd-mes', f, 'mes', 'Todos', mesRotulo); sdSelect('#sd-consultor', f, 'consultor', 'Todos'); sdSelect('#sd-equipe', f, 'equipe', 'Todas'); sdSelect('#sd-gestor', f, 'gestor', 'Todos');
    const linhas = sdVisiveis();
    const qtd = linhas.reduce((a, l) => a + l.quantidade, 0), val = linhas.reduce((a, l) => a + l.valor, 0);
    const clientes = new Set(linhas.map(l => l.cnpj.replace(/\D/g, '') || l.cliente)).size, completas = linhas.filter(l => l.pagas >= 5).length;
    const kpi = (t, n, s) => `<div class="q-kpi"><span class="k-t">${t}</span><b class="k-n">${n}</b><span class="k-v">${s}</span></div>`;
    $('#sd-kpis').innerHTML = kpi('Clientes', clientes.toLocaleString('pt-BR'), `${linhas.length.toLocaleString('pt-BR')} linha(s) cliente × mês`) + kpi('Quantidade', qtd.toLocaleString('pt-BR'), 'licenças / planos Blip GO') + kpi('Valor', fmtMoeda(val), 'soma da receita das linhas') + kpi('1ª a 5ª fatura paga', completas.toLocaleString('pt-BR'), `de ${linhas.length.toLocaleString('pt-BR')} linha(s)`);
    if (!ok) sdMsg('As caixinhas de fatura estão desativadas: falta criar a tabela sd_pagamentos no Supabase (arquivo supabase/migrations/20261127000001_sd_pagamentos.sql).', true);
    if (!linhas.length) { $('#sd-lista').innerHTML = '<div class="vazio">Nenhum Blip GO ativo para esses filtros.</div>'; return; }
    const LIM = 1000;
    const thO = (col, rot, cls) => `<th class="${cls || ''}"><button type="button" class="th-ord${sd.ord.col === col ? ' ativo' : ''}" data-sdord="${col}">${rot}<span class="seta">${sd.ord.col === col ? (sd.ord.asc ? '↑' : '↓') : '↕'}</span></button></th>`;
    const corpo = linhas.slice(0, LIM).map((l, i) => {
      const det = sd.aberto === i ? `<tr><td colspan="11" class="q-itens">${l.pedidos.map(p => `<div>Pedido <b>${esc(p.pedido)}</b> · ${esc(p.produto || '—')}${p.numero ? ` <span class="prod-dica">· ${esc(p.numero)}</span>` : ''} <span class="prod-dica">· qtd ${p.qtd}${p.data_ref ? ' · ativação ' + fmtData(p.data_ref) : ''} · faturas pagas: ${(p.f || []).length ? p.f.map(n => n + 'ª').join(', ') : 'nenhuma'}</span> <strong style="float:right">${fmtMoeda(p.valor)}</strong></div>`).join('')}</td></tr>` : '';
      const caixas = [1, 2, 3, 4, 5].map(n => { const e = estadoFatura(l, n); return `<label class="sd-fat" title="${n}ª fatura${e === 1 ? ' (paga só em parte dos pedidos)' : ''}"><input type="checkbox" data-sdfat="${i}:${n}" ${e === 2 ? 'checked' : ''} ${e === 1 ? 'data-parcial="1"' : ''} ${ok ? '' : 'disabled'}><span>${n}ª</span></label>`; }).join('');
      const todas = ok ? `<a href="#" class="lnk lnk-sec" data-sdtodas="${i}:${l.pagas < 5 ? 1 : 0}" title="${l.pagas < 5 ? 'Marcar a 1ª a 5ª como pagas' : 'Desmarcar as cinco'}">${l.pagas < 5 ? '✓ até a 5ª' : '✗ limpar'}</a>` : '';
      return `<tr data-sdlinha="${i}" style="cursor:pointer" title="Ver os pedidos"><td style="white-space:nowrap">${mesRotulo(l.mes)}</td><td style="white-space:nowrap">${l.data_ativacao ? fmtData(l.data_ativacao) : '—'}</td><td style="white-space:nowrap">${esc(l.cnpj)}</td><td class="cel-nome">${esc(l.cliente || '—')}</td><td>${esc(l.consultor || '—')}</td><td>${esc(l.equipe || '—')}</td><td>${esc(l.gestor || '—')}</td><td class="num">${l.quantidade.toLocaleString('pt-BR')}</td><td class="num" style="white-space:nowrap">${fmtMoeda(l.valor)}</td><td style="white-space:nowrap" data-sdfatcel>${caixas} ${todas}</td><td class="num">${l.pagas}/5</td></tr>${det}`;
    }).join('');
    $('#sd-lista').innerHTML = `<div class="tab-wrap"><table class="tab"><thead><tr>${thO('mes', 'Mês')}${thO('data_ativacao', 'Data de ativação')}${thO('cnpj', 'CNPJ')}${thO('cliente', 'Razão social')}${thO('consultor', 'Consultor')}${thO('equipe', 'Equipe')}${thO('gestor', 'Gestor')}${thO('quantidade', 'Qtd', 'num')}${thO('valor', 'Valor', 'num')}<th>Faturas pagas (1ª–5ª)</th>${thO('pagas', 'Pagas', 'num')}</tr></thead><tbody>${corpo}</tbody></table></div>
      <div class="prod-dica" style="margin-top:var(--e3)">${linhas.length > LIM ? `Mostrando as primeiras ${LIM} de ${linhas.length.toLocaleString('pt-BR')} linhas — use os filtros ou o CSV para ver tudo. ` : ''}Data de ativação = DATA REF (a mais antiga entre os pedidos da linha). Base lida em ${fmtDH(sd.dados.base_atualizada_em)}</div>`;
    $('#sd-lista').querySelectorAll('input[data-parcial]').forEach(x => { x.indeterminate = true; });
  }
  async function sdCarregar(refresh) {
    const eu = ++sd.req;
    $('#sd-lista').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando Blip GO (lê as planilhas do CRM na primeira vez, pode levar alguns segundos)…</div>';
    try {
      const d = await api('sd', refresh ? { refresh: '1' } : {});
      if (eu !== sd.req) return;
      sd.dados = d; sd.carregou = true; sd.aberto = null; sdDesenhar();
    } catch (e) {
      if (eu !== sd.req) return;
      $('#sd-kpis').innerHTML = ''; $('#sd-lista').innerHTML = `<div class="alerta alerta-erro"><b>Erro ao carregar o SD</b> ${esc(e.message)}</div>`;
    }
  }
  function sdCsv() {
    if (!sd.dados) return;
    const cab = ['Mês', 'Data de ativação', 'CNPJ', 'Razão social', 'Consultor', 'Equipe', 'Gestor', 'Quantidade', 'Valor', 'Faturas pagas', 'Pedidos'];
    const dados = sdVisiveis().map(l => [mesRotulo(l.mes), l.data_ativacao ? fmtData(l.data_ativacao) : '', l.cnpj, l.cliente, l.consultor, l.equipe, l.gestor, l.quantidade, String(l.valor).replace('.', ','),
      [1, 2, 3, 4, 5].filter(n => estadoFatura(l, n) === 2).map(n => n + 'ª').join(' '), l.pedidos.map(p => p.pedido).join(' / ')]);
    const q = v => '"' + String(v).replace(/"/g, '""') + '"';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff' + [cab, ...dados].map(l => l.map(q).join(';')).join('\n')], { type: 'text/csv;charset=utf-8;' }));
    a.download = `sd_blip_go_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }
  function trocarSub(qual) {
    sd.sub = qual;
    $('#q-estorno').hidden = qual !== 'estorno'; $('#q-sd').hidden = qual !== 'sd';
    host.querySelectorAll('#q-sub [data-qsub]').forEach(b => { const on = b.dataset.qsub === qual; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    if (qual === 'sd') { if (!sd.carregou) sdCarregar(); } else if (!st.carregou) carregar(1);
  }

  host.addEventListener('click', e => {
    const qs = e.target.closest('[data-qsub]'); if (qs) return trocarSub(qs.dataset.qsub);
    const so = e.target.closest('[data-sdord]');
    if (so) { const col = so.dataset.sdord, texto = !['quantidade', 'valor', 'pagas'].includes(col); sd.ord = sd.ord.col === col ? { col, asc: !sd.ord.asc } : { col, asc: texto && col !== 'mes' && col !== 'data_ativacao' }; sd.aberto = null; return sdDesenhar(); }
    if (e.target.closest('[data-sdfatcel]')) {   // caixinhas de fatura / "até a 5ª": não abre o detalhe da linha
      const t = e.target.closest('[data-sdtodas]');
      if (t) { e.preventDefault(); const [i, m] = t.dataset.sdtodas.split(':'); return sdMarcar(Number(i), 'todas', m === '1'); }
      const c = e.target.closest('input[data-sdfat]');
      if (c) { const [i, n] = c.dataset.sdfat.split(':').map(Number); return sdMarcar(i, n, c.checked); }
      return;
    }
    const sl = e.target.closest('[data-sdlinha]'); if (sl) { const i = Number(sl.dataset.sdlinha); sd.aberto = sd.aberto === i ? null : i; return sdDesenhar(); }
    if (e.target.closest('#sd-csv')) return sdCsv();
    if (e.target.closest('#sd-atualizar')) return sdCarregar(true);
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
    if (e.target.matches('#sd-mes, #sd-consultor, #sd-equipe, #sd-gestor, #sd-pgto')) sdDesenhar();
  });
  $('#sd-busca').addEventListener('input', sdDesenhar);
  $('#q-busca').addEventListener('input', () => { clearTimeout(st.timer); st.timer = setTimeout(() => carregar(1), 400); });
  $('#q-atualizar').addEventListener('click', () => carregar(1, true));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#q-modal').hidden) fecharModal(); });

  return { mostrar() { if (sd.sub === 'sd') { if (!sd.carregou) sdCarregar(); } else if (!st.carregou) carregar(1); } };
}
