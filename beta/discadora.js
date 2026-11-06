// Visão "Discadora" do Beta2 = a aba Discadora do Dash atual: produtividade de ligações dos consultores
// (MakeSystem + histórico sincronizado no Supabase). Reproduz discadoraCarregar/discadoraRender/
// discDrillDown/discExportarProdutivas do index.html (~11808-13120).
//
// Mesmas fontes e mesma regra de recorte do Dash atual:
//   · hoje  -> /api/discadora (proxy da API ao vivo da MakeSystem, GraphQL)
//   · dias fechados -> /api/discadora-historico (tabela discadora_ligacoes, sincronizada todo dia)
//   · antes de 01/07/2026 (sem sincronização) -> API ao vivo, mais lento
// A trava por Grupo (gestor/supervisão com grupo_ref) é refeita aqui como defesa, mas a que vale é a do
// servidor (api/discadora*.js) — nada de segurança foi movido para esta tela.
//
// NÃO migrado ainda: o "Centro de Custos" (uso de VoIP por grupo/dia, só admin) — segue no Dash atual.

import { authHeaders } from './sessao.js';
import { esc, icone, fmtInt, criarMultiSelect } from './ui.js';

const API = '/api/discadora';
const GRAVACAO_BASE = 'https://vipsul.gvctelecom.com.br';
const SYNC_INICIO = '2026-07-01';
// (igual ao Dash atual: datas "de hoje/ontem" em UTC)
const hojeStr = () => new Date().toISOString().split('T')[0];
const ontemStr = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().split('T')[0]; };
const fmtSeg = seg => { if (!seg && seg !== 0) return '-'; return String(Math.floor(seg / 60)).padStart(2, '0') + ':' + String(seg % 60).padStart(2, '0'); };
const corProd = p => (p >= 15 ? '#16a34a' : p >= 8 ? '#ca8a04' : '#dc2626');
const norm = s => (s || '').toString().trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const corrigirFuso = lote => { lote.forEach(r => { if (r.dataRegistro && r.dataRegistro.endsWith('Z')) r.dataRegistro = r.dataRegistro.replace('Z', '-03:00'); }); return lote; };
const FAIXAS = [
  { label: '0–3s', desc: 'Falha de conexão', cor: '#EF4444', min: 0, max: 3 }, { label: '4–15s', desc: 'Barreira / Gatekeeper', cor: '#F97316', min: 4, max: 15 },
  { label: '16–59s', desc: 'Apresentação falha', cor: '#EAB308', min: 16, max: 59 }, { label: '+1 min', desc: 'Ligação produtiva', cor: '#22C55E', min: 61, max: 180 },
  { label: '+3 min', desc: 'Negociação real', cor: '#16A34A', min: 181, max: 99999 },
];

// ctx() => { perfil, grupoRef, statusPorCnpj(): Map cnpj -> fila (CRM) }
export function criarDiscadora(host, ctx) {
  const st = { dados: [], iniciou: false, carregando: false, timer: null, sortCol: 'produtivas', sortAsc: false, hdrGrupos: [], hdrConsultores: [], gravBuscando: false };
  const perfil = () => ctx().perfil;
  const grupoTravado = () => ((perfil() === 'gestor' || perfil() === 'supervisao') && ctx().grupoRef ? ctx().grupoRef : null);
  const podeCsv = () => perfil() === 'admin' || perfil() === 'gestor_macro';

  host.innerHTML = `
    <section class="painel prod-ctl-painel"><div class="prod-ctl">
      <label class="chip chip-sel"><span>Início</span><input type="date" id="d-dt-ini" class="inp-data"><input type="time" id="d-hr-ini" value="08:00" class="inp-data"></label>
      <label class="chip chip-sel"><span>Fim</span><input type="date" id="d-dt-fim" class="inp-data"><input type="time" id="d-hr-fim" value="22:00" class="inp-data"></label>
      <label class="chip chip-sel"><span>Grupo</span><select id="d-grupo"><option value="">Todos</option></select></label>
      <label class="chip chip-sel"><span>Fila</span><select id="d-fila"><option value="">Todas</option></select></label>
      <label class="chip chip-sel"><span>Consultor</span><select id="d-consultor"><option value="">Todos</option></select></label>
      <div id="d-hdr-grupo"></div><div id="d-hdr-consultor"></div>
      <button type="button" class="btn btn-marca" id="d-buscar">Buscar</button>
      <span class="prod-dica" id="d-atualizacao"></span><span class="txt-neg" id="d-status"></span>
    </div></section>
    <div id="d-progresso" hidden><div class="prod-dica" id="d-prog-txt">Carregando…</div><div class="d-trilho"><i id="d-prog-barra"></i></div></div>
    <div class="d-kpis" id="d-kpis"></div>
    <h3 class="c-titulo">Eficiência Operacional</h3><div class="d-kpis2" id="d-kpis2"></div>
    <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Funil de Duração de Chamada</h2><p>Diagnóstico da qualidade da operação</p></div></header><div class="painel-corpo"><div class="d-funil" id="d-funil"></div></div></section>
    <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Por consultor</h2><p>Clique no consultor ou nas produtivas para ver o raio-x</p></div></header><div class="painel-corpo" id="d-tabela"></div></section>
    <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Mapa de Calor — Produção por Hora</h2><p>Volume · % produtividade · <span style="color:#F59E0B;font-weight:700">★</span> Golden Hour</p></div></header><div class="painel-corpo" id="d-calor"></div></section>
    <p class="prod-dica">Centro de Custos (uso de VoIP por grupo/dia) ainda abre no Dash atual.</p>`;
  const $ = s => host.querySelector(s);
  const msGrupo = criarMultiSelect({ rotulo: 'Grupo (várias)', onChange: v => { st.hdrGrupos = v; renderizar(); } });
  const msCons = criarMultiSelect({ rotulo: 'Consultor (vários)', onChange: v => { st.hdrConsultores = v; renderizar(); } });
  $('#d-hdr-grupo').replaceWith(msGrupo.el); $('#d-hdr-consultor').replaceWith(msCons.el);

  // ── dados ──────────────────────────────────────────────────────────────────
  const progresso = (pct, txt) => { const w = $('#d-progresso'); if (pct === null) { w.hidden = true; return; } w.hidden = false; $('#d-prog-barra').style.width = pct + '%'; $('#d-prog-txt').textContent = txt || 'Carregando…'; };
  async function gql(query) {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify({ query }) });
    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);
    return json.data || {};
  }
  const buscarPagina = async pagina => (await gql(`{ listar_historico_contato( contem_usuarios: true limite: 1000 pagina: ${pagina} ) { dataRegistro duracao telefonia localizado dddTelefone documento urlLigacao lead { nome } usuario { nome } grupo { nome } fila { nome } } }`)).listar_historico_contato || [];
  async function buscarHistorico(desde, ate) {
    const res = await fetch(`/api/discadora-historico?desde=${desde}&ate=${ate}`, { headers: await authHeaders() });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Falha ao buscar histórico da discadora');
    return json.registros || [];
  }
  async function aoVivoComLimite(tsLimInf, tsFim, rotulo) {
    const todos = []; let pagina = 1; const MAX = 200;
    while (pagina <= MAX) {
      progresso(Math.min(55 + (pagina / MAX) * 40, 95), `Buscando ${rotulo}… página ${pagina} (${todos.length} registros)`);
      const lote = corrigirFuso(await buscarPagina(pagina));
      if (!lote.length) break;
      if (new Date(lote[0].dataRegistro).getTime() < tsLimInf) break;
      todos.push(...lote.filter(r => { const ts = new Date(r.dataRegistro).getTime(); return ts >= tsLimInf && ts <= tsFim; }));
      if (new Date(lote[lote.length - 1].dataRegistro).getTime() < tsLimInf) break;
      if (lote.length < 1000) break;
      pagina++;
    }
    return todos;
  }
  async function carregar() {
    if (st.carregando) return; st.carregando = true;
    const dtIni = $('#d-dt-ini').value, hrIni = $('#d-hr-ini').value || '00:00', dtFim = $('#d-dt-fim').value, hrFim = $('#d-hr-fim').value || '23:59';
    const tsIni = new Date(`${dtIni}T${hrIni}:00-03:00`).getTime(), tsFim = new Date(`${dtFim}T${hrFim}:59-03:00`).getTime(), hoje = hojeStr();
    $('#d-status').textContent = ''; progresso(5, 'Iniciando busca…');
    try {
      let todos = [];
      if (dtIni < SYNC_INICIO) {                                  // anterior à sincronização: API ao vivo
        const tsSync = new Date(`${SYNC_INICIO}T00:00:00-03:00`).getTime(), fimPre = Math.min(tsFim, tsSync - 1);
        if (tsIni <= fimPre) { progresso(10, `Buscando período anterior a ${SYNC_INICIO.split('-').reverse().join('/')} (sem sincronização, pode demorar)…`); todos = todos.concat(await aoVivoComLimite(tsIni, fimPre, 'período antigo')); }
      }
      const desde = dtIni < SYNC_INICIO ? SYNC_INICIO : dtIni;     // parte sincronizada (Supabase)
      if (desde < hoje && dtFim >= SYNC_INICIO) {
        const ate = dtFim < hoje ? dtFim : ontemStr();
        if (desde <= ate) { progresso(50, 'Buscando histórico sincronizado…'); const h = corrigirFuso(await buscarHistorico(desde, ate)); todos = todos.concat(h.filter(r => { const ts = new Date(r.dataRegistro).getTime(); return ts >= tsIni && ts <= tsFim; })); }
      }
      if (dtFim >= hoje) { const tsHoje = new Date(`${hoje}T00:00:00-03:00`).getTime(); todos = todos.concat(await aoVivoComLimite(Math.max(tsIni, tsHoje), tsFim, 'hoje')); }
      st.dados = todos;
      $('#d-atualizacao').textContent = `Atualizado às ${new Date().toLocaleTimeString('pt-BR')} · ${fmtInt(todos.length)} registros`;
      progresso(null); renderizar();
    } catch (e) { $('#d-status').textContent = 'Erro: ' + e.message; progresso(null); } finally { st.carregando = false; }
  }

  // ── filtros em cascata (Grupo, Fila, Consultor; barra e cabeçalho) ───────────
  const nomeG = r => r.grupo && r.grupo.nome, nomeF = r => r.fila && r.fila.nome, nomeU = r => r.usuario && r.usuario.nome;
  function filtros() { const gT = grupoTravado(); return { grupo: gT || $('#d-grupo').value, fila: $('#d-fila').value, cons: $('#d-consultor').value, hg: st.hdrGrupos, hc: st.hdrConsultores }; }
  function passa(r, f, ign) {
    if (ign !== 'grupoTop' && f.grupo && norm(nomeG(r)) !== norm(f.grupo)) return false;
    if (ign !== 'fila' && f.fila && nomeF(r) !== f.fila) return false;
    if (ign !== 'consTop' && f.cons && nomeU(r) !== f.cons) return false;
    if (ign !== 'grupoHdr' && f.hg.length && !f.hg.map(norm).includes(norm(nomeG(r)))) return false;
    if (ign !== 'consHdr' && f.hc.length && !f.hc.includes(nomeU(r))) return false;
    return true;
  }
  function atualizarOpcoes() {
    const gT = grupoTravado(), base = gT ? st.dados.filter(r => nomeG(r) && norm(nomeG(r)) === norm(gT)) : st.dados, f = filtros();
    const de = (ign, fn) => { const m = new Map(); base.filter(r => passa(r, f, ign)).forEach(r => { const v = fn(r); if (v && !m.has(norm(v))) m.set(norm(v), v); }); return [...m.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')); };
    const fill = (id, lista, atual, todos) => { const sel = $(id), l = [...lista]; if (atual && !l.some(x => norm(x) === norm(atual))) l.push(atual); sel.innerHTML = `<option value="">${todos}</option>` + l.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); sel.value = atual; };
    if (!gT) fill('#d-grupo', de('grupoTop', nomeG), $('#d-grupo').value, 'Todos'); else { $('#d-grupo').innerHTML = `<option value="${esc(gT)}">${esc(gT)}</option>`; $('#d-grupo').disabled = true; }
    fill('#d-fila', de('fila', nomeF), $('#d-fila').value, 'Todas'); fill('#d-consultor', de('consTop', nomeU), $('#d-consultor').value, 'Todos');
    msGrupo.atualizar(de('grupoHdr', nomeG), st.hdrGrupos); msCons.atualizar(de('consHdr', nomeU), st.hdrConsultores);
  }

  // ── render ─────────────────────────────────────────────────────────────────
  function renderizar() {
    atualizarOpcoes();
    const f = filtros(), dados = st.dados.filter(r => passa(r, f));
    const atend = r => r.duracao !== null && r.duracao !== undefined;
    // por consultor
    const por = {};
    dados.forEach(r => {
      const nome = nomeU(r) || 'Desconhecido', p = por[nome] || (por[nome] = { nome, grupo: nomeG(r) || '-', fila: nomeF(r) || '-', total: 0, atendidas: 0, produtivas: 0, durTotal: 0, durProd: 0 });
      p.total++; if (atend(r)) { p.atendidas++; p.durTotal += r.duracao; } if ((r.duracao || 0) > 60) { p.produtivas++; p.durProd += r.duracao; }
    });
    const total = dados.length, totAt = dados.filter(atend).length, prod = dados.filter(r => (r.duracao || 0) > 60), totProd = prod.length;
    const durTotal = dados.reduce((s, r) => s + (r.duracao || 0), 0), durProd = prod.reduce((s, r) => s + r.duracao, 0);
    const tma = totAt ? Math.round(durTotal / totAt) : 0, tmaP = totProd ? Math.round(durProd / totProd) : 0, pct = totAt ? Math.round(totProd / totAt * 100) : 0;
    const k = (rot, v, extra = '') => `<div class="d-kpi${extra}"><span>${rot}</span><b>${v}</b></div>`;
    $('#d-kpis').innerHTML = k('Total ligações', fmtInt(total)) + k('Atendidas', fmtInt(totAt)) +
      `<div class="d-kpi d-dest${podeCsv() ? ' d-clic' : ''}" ${podeCsv() ? 'data-csv title="Clique para exportar CSV"' : ''}><span>Produtivas +1 min${podeCsv() ? ' <small>↓ CSV</small>' : ''}</span><b>${fmtInt(totProd)}</b></div>` +
      `<div class="d-kpi d-dest"><span>% Produtividade</span><b style="color:${corProd(pct)}">${pct}%</b></div>` + k('TMA geral', fmtSeg(tma)) + k('TMA +1 min', fmtSeg(tmaP));
    // eficiência
    const conect = dados.filter(r => (r.duracao || 0) > 3).length, cr = total ? Math.round(conect / total * 100) : 0;
    const temporal = {}; dados.forEach(r => { const n = nomeU(r) || ''; (temporal[n] = temporal[n] || []).push(new Date(r.dataRegistro).getTime()); });
    let gaps = 0, gn = 0; Object.values(temporal).forEach(ts => { ts.sort((a, b) => a - b); for (let i = 1; i < ts.length; i++) { const g = (ts[i] - ts[i - 1]) / 1000; if (g > 0 && g < 600) { gaps += g; gn++; } } });
    const oci = gn ? Math.round(gaps / gn) : 0;
    const freq = {}; dados.forEach(r => { const c = (r.documento || '').replace(/[^0-9]/g, ''); if (c) freq[c] = (freq[c] || 0) + 1; });
    const reap = Object.values(freq).filter(v => v > 1).length, reapPct = Object.keys(freq).length ? Math.round(reap / Object.keys(freq).length * 100) : 0;
    const top = Object.entries(freq).filter(e => e[1] > 1).sort((a, b) => b[1] - a[1]).slice(0, 5), nAtivos = Object.keys(temporal).length;
    const cls = (v, bom, med) => (v >= bom ? 'bom' : v >= med ? 'med' : 'ruim');
    const crC = cls(cr, 70, 50), ociC = oci < 30 ? 'bom' : oci < 90 ? 'med' : 'ruim';
    $('#d-kpis2').innerHTML = `<div class="d-k2"><em class="d-b ${crC}">${cr >= 70 ? 'Boa' : cr >= 50 ? 'Regular' : 'Baixa'}</em><span>Connect Rate</span><b class="${crC}">${cr}%</b><small>${conect} de ${total} ligações conectaram</small></div>` +
      `<div class="d-k2"><em class="d-b ${ociC}">${oci < 30 ? 'Ótimo' : oci < 90 ? 'Regular' : 'Alto'}</em><span>Ociosidade Estimada</span><b class="${ociC}">${fmtSeg(oci)}</b><small>Gap médio entre ligações consecutivas</small></div>` +
      `<div class="d-k2"><span>Reaproveitamento de Mailing</span><b class="${reapPct > 20 ? 'med' : ''}">${reapPct}%</b><small>${reap} CNPJs discados mais de 1x</small>${top.length ? `<div class="d-reap">${top.map(e => `<div><span>${e[0]}</span><b>${e[1]}x</b></div>`).join('')}</div>` : ''}</div>` +
      `<div class="d-k2"><span>Pace — Lig. por Consultor</span><b>${nAtivos ? Math.round(total / nAtivos) : 0}</b><small>${nAtivos} consultor(es) ativo(s) no período</small></div>`;
    // tabela
    const rows = Object.values(por).map(r => { r.pctProd = r.atendidas ? Math.round(r.produtivas / r.atendidas * 100) : 0; r.tmaGeral = r.atendidas ? Math.round(r.durTotal / r.atendidas) : 0; r.tmaProd = r.produtivas ? Math.round(r.durProd / r.produtivas) : 0; return r; });
    rows.sort((a, b) => { const va = a[st.sortCol], vb = b[st.sortCol]; return typeof va === 'string' ? (st.sortAsc ? va.localeCompare(vb) : vb.localeCompare(va)) : (st.sortAsc ? va - vb : vb - va); });
    const COLS = [['nome', 'Consultor'], ['grupo', 'Grupo'], ['fila', 'Fila'], ['total', 'Total ligações'], ['atendidas', 'Atendidas'], ['produtivas', 'Produtivas (+1min)'], ['pctProd', '% Produtividade'], ['tmaGeral', 'TMA geral'], ['tmaProd', 'TMA +1min']];
    const th = ([c, r]) => `<th class="${['nome', 'grupo', 'fila'].includes(c) ? '' : 'num'}"><button type="button" class="th-ord${st.sortCol === c ? ' ativo' : ''}" data-ord="${c}">${r}<span class="seta">${st.sortCol === c ? (st.sortAsc ? '↑' : '↓') : '↕'}</span></button></th>`;
    $('#d-tabela').innerHTML = rows.length ? `<div class="tab-wrap"><table class="tab"><thead><tr><th>#</th>${COLS.map(th).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr><td class="prod-dica">${i + 1}</td>
      <td class="cel-nome">${r.produtivas > 0 ? `<button type="button" class="lnk" data-raiox="${esc(r.nome)}" title="Ver ligações produtivas">${esc(r.nome)}</button>` : esc(r.nome)}</td><td>${esc(r.grupo)}</td><td>${esc(r.fila)}</td>
      <td class="num">${r.total}</td><td class="num">${r.atendidas}</td><td class="num">${r.produtivas > 0 ? `<button type="button" class="lnk" data-raiox="${esc(r.nome)}">${r.produtivas}</button>` : 0}</td>
      <td class="num" style="color:${corProd(r.pctProd)};font-weight:600">${r.pctProd}%</td><td class="num">${fmtSeg(r.tmaGeral)}</td><td class="num">${r.produtivas > 0 ? fmtSeg(r.tmaProd) : '-'}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td colspan="3">TOTAL</td><td class="num">${total}</td><td class="num">${totAt}</td><td class="num">${totProd}</td><td class="num" style="color:${corProd(pct)}">${pct}%</td><td class="num">${fmtSeg(tma)}</td><td class="num">${fmtSeg(tmaP)}</td></tr></tfoot></table></div>` : '<div class="vazio">Sem ligações para os filtros.</div>';
    // funil
    const cnts = FAIXAS.map(fx => dados.filter(r => atend(r) && r.duracao >= fx.min && r.duracao <= fx.max).length), mx = Math.max(...cnts) || 1;
    $('#d-funil').innerHTML = FAIXAS.map((fx, i) => `<div class="d-fcol"><div class="d-fbar-w"><div class="d-fbar" style="height:${Math.max(Math.round(cnts[i] / mx * 76), cnts[i] > 0 ? 4 : 0)}px;background:${fx.cor}"></div></div><b style="color:${fx.cor}">${totAt ? Math.round(cnts[i] / totAt * 100) : 0}%</b><span>${cnts[i]} lig.</span><em style="color:${fx.cor}">${fx.label}</em><small>${fx.desc}</small></div>`).join('');
    // mapa de calor
    const hI = parseInt(($('#d-hr-ini').value || '08:00').split(':')[0]), hF = parseInt(($('#d-hr-fim').value || '22:00').split(':')[0]), horas = []; for (let h = hI; h <= hF; h++) horas.push(h);
    const filas = [...new Set(dados.map(nomeF).filter(Boolean))].sort(), vol = {}, pr = {};
    dados.forEach(r => { const h = new Date(r.dataRegistro).getHours(), fl = nomeF(r) || '–'; (vol[h] = vol[h] || {}); (pr[h] = pr[h] || {}); if (atend(r)) vol[h][fl] = (vol[h][fl] || 0) + 1; if ((r.duracao || 0) > 60) pr[h][fl] = (pr[h][fl] || 0) + 1; });
    const soma = (o, h) => filas.reduce((s, fl) => s + ((o[h] && o[h][fl]) || 0), 0), pctH = {}; let golden = null, maxP = 0;
    horas.forEach(h => { const v = soma(vol, h); pctH[h] = v ? Math.round(soma(pr, h) / v * 100) : 0; if (v >= 5 && pctH[h] > maxP) { maxP = pctH[h]; golden = h; } });
    const bg = (p, v) => (v === 0 ? '' : p === 0 ? 'background:#F1F5F9;' : p < 5 ? 'background:#FEF9C3;' : p < 10 ? 'background:#FED7AA;' : p < 15 ? 'background:#BBF7D0;' : 'background:#86EFAC;');
    $('#d-calor').innerHTML = `<div class="tab-wrap"><table class="tab d-hm"><thead><tr><th>Hora</th>${filas.map(fl => `<th class="num">${esc(fl)}</th>`).join('')}<th class="num">Total</th><th class="num">% Prod.</th></tr></thead><tbody>${horas.map(h => {
      const tv = soma(vol, h), g = h === golden;
      return `<tr${g ? ' class="d-golden"' : ''}><td>${String(h).padStart(2, '0')}h${g ? ' <span style="color:#F59E0B" title="Golden Hour">★</span>' : ''}</td>${filas.map(fl => { const v = (vol[h] && vol[h][fl]) || 0, p = (pr[h] && pr[h][fl]) || 0, pc = v ? Math.round(p / v * 100) : 0; return v ? `<td class="num" style="${bg(pc, v)}"><b>${v}</b> <small style="color:${pc >= 10 ? '#16a34a' : pc >= 5 ? '#ca8a04' : '#94a3b8'}">${p > 0 ? pc + '%' : ''}</small></td>` : '<td></td>'; }).join('')}<td class="num"><b>${tv || ''}</b></td><td class="num" style="font-weight:700;color:${pctH[h] >= 10 ? '#16a34a' : pctH[h] >= 5 ? '#ca8a04' : '#64748b'}">${tv ? pctH[h] + '%' : '–'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  // ── raio-x do consultor ────────────────────────────────────────────────────
  async function gravacoesDoDia(dia, nome) {
    let idU = null;
    try { const lista = (await gql(`{ listar_usuarios(texto_a_pesquisar: "${nome.replace(/"/g, '\\"')}", limite: 10) { id nome } }`)).listar_usuarios || []; const m = lista.find(u => (u.nome || '').toLowerCase() === nome.toLowerCase()); idU = m ? m.id : null; } catch (e) { /* sem id: busca geral */ }
    const filtro = idU !== null ? `ids_de_usuarios: [${idU}]` : 'contem_usuarios: true';
    let todos = [], pagina = 1;
    while (pagina <= 20) {
      const lote = (await gql(`{ listar_historico_contato( ${filtro} limite: 1000 pagina: ${pagina} data_hora_minima: "${dia}T00:00:00-03:00" data_hora_maxima: "${dia}T23:59:59-03:00" ) { dataRegistro duracao telefonia urlLigacao usuario { nome } } }`)).listar_historico_contato || [];
      if (!lote.length) break; todos = todos.concat(lote); if (lote.length < 1000) break; pagina++;
    }
    return corrigirFuso(todos);
  }
  function abrirRaioX(nome) {
    const f = filtros(), crm = ctx().statusPorCnpj();
    const todos = st.dados.filter(r => nomeU(r) === nome && (!f.grupo || nomeG(r) === f.grupo) && (!f.fila || nomeF(r) === f.fila));
    const prod = todos.filter(r => (r.duracao || 0) > 60).sort((a, b) => new Date(b.dataRegistro) - new Date(a.dataRegistro));
    // gravações de dias arquivados (o Supabase não guarda a URL): busca sob demanda e reabre
    const chave = r => new Date(r.dataRegistro).getTime() + '|' + (nomeU(r) || ''), diaBRT = s => new Date(new Date(s).getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
    const faltando = new Set(); prod.forEach(r => { if (!r.urlLigacao) faltando.add(diaBRT(r.dataRegistro)); });
    if (faltando.size && !st.gravBuscando) {
      st.gravBuscando = true;
      Promise.all([...faltando].map(d => gravacoesDoDia(d, nome).catch(() => []))).then(res => {
        const mapa = {}; res.flat().forEach(r => { if (r.urlLigacao) mapa[chave(r)] = r.urlLigacao; });
        let mudou = false; st.dados.forEach(r => { if (!r.urlLigacao && mapa[chave(r)]) { r.urlLigacao = mapa[chave(r)]; mudou = true; } });
        st.gravBuscando = false; if (mudou && document.getElementById('d-raiox')) abrirRaioX(nome);
      }).catch(() => { st.gravBuscando = false; });
    }
    const tC = todos.length, aC = todos.filter(r => r.duracao !== null && r.duracao !== undefined).length, pC = prod.length, pctC = aC ? Math.round(pC / aC * 100) : 0;
    const tmaP = pC ? Math.round(prod.reduce((s, r) => s + (r.duracao || 0), 0) / pC) : 0, crC = tC ? Math.round(todos.filter(r => (r.duracao || 0) > 3).length / tC * 100) : 0;
    const hv = {}, hp = {}; todos.forEach(r => { const h = new Date(r.dataRegistro).getHours(); if (r.duracao !== null && r.duracao !== undefined) hv[h] = (hv[h] || 0) + 1; if ((r.duracao || 0) > 60) hp[h] = (hp[h] || 0) + 1; });
    const hs = Array.from({ length: 14 }, (_, i) => i + 8); let gH = null, mxP = 0; hs.forEach(h => { const v = hv[h] || 0, p = hp[h] || 0, pc = v >= 3 ? Math.round(p / v * 100) : 0; if (pc > mxP) { mxP = pc; gH = h; } });
    const corStatus = s => { const l = s.toLowerCase(); return l.includes('ativo') || l.includes('instalado') ? '#16a34a' : l.includes('aguardando') || l.includes('aprovado') ? '#d97706' : l.includes('cancelad') || l.includes('inativo') ? '#dc2626' : 'var(--texto-2)'; };
    const grav = prod.map(r => {
      const dt = new Date(r.dataRegistro), cliente = (r.lead && r.lead.nome) ? r.lead.nome.replace(/^\d+\s*/, '') : '-', cnpj = r.documento || '-', fone = r.dddTelefone ? String(r.dddTelefone) : '-', foneF = fone.length >= 10 ? `(${fone.slice(0, 2)}) ${fone.slice(2)}` : fone;
      const s = crm.get((cnpj || '').replace(/[^0-9]/g, '')) || '';
      return `<tr><td style="white-space:nowrap">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR')}</td><td title="${esc(cliente)}">${esc(cliente)}</td><td style="font-family:monospace;font-size:11px">${esc(cnpj)}</td><td style="font-family:monospace">${esc(foneF)}</td><td>${esc(nomeF(r) || '-')}</td><td class="num" style="color:#16a34a;font-weight:600">${fmtSeg(r.duracao)}</td>
        <td>${r.urlLigacao ? `<a class="d-play" href="${esc(GRAVACAO_BASE + r.urlLigacao)}" target="_blank" rel="noopener noreferrer" aria-label="Ouvir gravação">▶</a>` : '–'}</td><td>${s ? `<span style="color:${corStatus(s)};font-weight:600;text-transform:uppercase;font-size:11px">${esc(s)}</span>` : '–'}</td></tr>`;
    }).join('');
    const golden = hs.filter(h => (hv[h] || 0) > 0).map(h => { const v = hv[h] || 0, p = hp[h] || 0, pc = v ? Math.round(p / v * 100) : 0; return `<tr${h === gH ? ' class="d-golden"' : ''}><td>${String(h).padStart(2, '0')}h${h === gH ? ' <span style="color:#F59E0B">★</span>' : ''}</td><td class="num">${v}</td><td class="num" style="color:#16a34a">${p}</td><td class="num" style="font-weight:700;color:${pc >= 10 ? '#16a34a' : pc >= 5 ? '#ca8a04' : '#94a3b8'}">${pc}%</td></tr>`; }).join('');
    const eq = st.dados.filter(r => (!f.grupo || nomeG(r) === f.grupo) && (!f.fila || nomeF(r) === f.fila) && r.duracao !== null && r.duracao !== undefined), tE = eq.length || 1, tCn = aC || 1;
    const funil = FAIXAS.map(fx => { const c = todos.filter(r => r.duracao !== null && r.duracao !== undefined && r.duracao >= fx.min && r.duracao <= fx.max).length, e = eq.filter(r => r.duracao >= fx.min && r.duracao <= fx.max).length, pc = Math.round(c / tCn * 100), pe = Math.round(e / tE * 100), diff = pc - pe, ruim = fx.min < 60; return `<div class="d-fcol"><b style="color:${fx.cor}">${pc}%</b><span>${c} lig.</span><em style="color:${fx.cor}">${fx.label}</em><small style="color:${diff === 0 ? 'var(--texto-3)' : (diff > 0) !== ruim ? '#16a34a' : '#dc2626'}">${diff === 0 ? '= média' : (diff > 0 ? '+' : '') + diff + 'pp vs equipe'}</small></div>`; }).join('');
    const pace = {}; todos.forEach(r => { const h = new Date(r.dataRegistro).getHours(); pace[h] = (pace[h] || 0) + 1; }); const mxPace = Math.max(1, ...Object.values(pace));
    const paceHtml = hs.filter(h => (pace[h] || 0) > 0).map(h => { const v = pace[h]; return `<div class="d-fcol"><div class="d-fbar-w"><div class="d-fbar" style="height:${Math.max(Math.round(v / mxPace * 56), 2)}px;background:${v >= mxPace * .8 ? '#16a34a' : v >= mxPace * .5 ? '#ca8a04' : '#94a3b8'}"></div></div><b>${v}</b><small>${String(h).padStart(2, '0')}h</small></div>`; }).join('');
    document.getElementById('d-raiox')?.remove();
    const ov = document.createElement('div'); ov.className = 'modal-fundo'; ov.id = 'd-raiox';
    ov.innerHTML = `<div class="modal d-modal" role="dialog" aria-modal="true" aria-label="Raio-X do consultor"><header><div><small class="prod-dica">Raio-X do Consultor</small><h3>${esc(nome)}</h3></div><button type="button" class="btn-icone" data-x aria-label="Fechar">${icone('close')}</button></header>
      <div class="est-stats" style="padding:var(--e3) var(--e5)">${[['Total', tC], ['Atendidas', aC], ['Produtivas', pC], ['% Prod.', pctC + '%'], ['TMA +1min', fmtSeg(tmaP)], ['Connect Rate', crC + '%']].map(([a, b]) => `<span class="stat">${a}: <b>${b}</b></span>`).join('')}${gH !== null ? `<span class="stat">★ Golden Hour: <b>${String(gH).padStart(2, '0')}h</b></span>` : ''}</div>
      <div class="seg" style="margin:0 var(--e5)" id="d-abas"><button type="button" class="seg-btn ativo" data-pane="0"><span>Gravações (${pC})</span></button><button type="button" class="seg-btn" data-pane="1"><span>Golden Hours</span></button><button type="button" class="seg-btn" data-pane="2"><span>Funil individual</span></button><button type="button" class="seg-btn" data-pane="3"><span>Ritmo (pace)</span></button></div>
      <div class="d-pane" data-p="0"><div class="tab-wrap"><table class="tab"><thead><tr><th>Data/Hora</th><th>Cliente</th><th>CNPJ</th><th>Telefone</th><th>Fila</th><th class="num">Duração</th><th>▶</th><th>Status CRM</th></tr></thead><tbody>${grav || '<tr><td colspan="8" class="vazio">Nenhuma ligação produtiva</td></tr>'}</tbody></table></div></div>
      <div class="d-pane" data-p="1" hidden><table class="tab"><thead><tr><th>Hora</th><th class="num">Ligações</th><th class="num">Produtivas</th><th class="num">% Prod.</th></tr></thead><tbody>${golden || '<tr><td colspan="4" class="vazio">Sem dados</td></tr>'}</tbody></table></div>
      <div class="d-pane" data-p="2" hidden><div class="d-funil">${funil}</div><p class="prod-dica" style="text-align:center">Comparativo com a média da equipe no mesmo período</p></div>
      <div class="d-pane" data-p="3" hidden><p class="prod-dica" style="text-align:center">Ligações realizadas por hora — ritmo e consistência ao longo do dia</p><div class="d-funil">${paceHtml}</div></div></div>`;
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', tecla); }, tecla = e => { if (e.key === 'Escape') fechar(); };
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) return fechar(); const b = e.target.closest('[data-pane]'); if (b) { ov.querySelectorAll('[data-pane]').forEach(x => x.classList.toggle('ativo', x === b)); ov.querySelectorAll('.d-pane').forEach(p => { p.hidden = p.dataset.p !== b.dataset.pane; }); } });
    document.addEventListener('keydown', tecla); document.body.append(ov);
  }

  function exportarCsv() {
    if (!podeCsv()) { alert('Apenas Admin e Gestor Macro podem exportar o CSV da Discadora.'); return; }
    // igual ao Dash atual: só os selects da barra (Grupo/Fila/Consultor), igualdade exata
    const gSel = $('#d-grupo').value, fSel = $('#d-fila').value, cSel = $('#d-consultor').value;
    const dados = st.dados.filter(r => (r.duracao || 0) > 60 && (!gSel || nomeG(r) === gSel) && (!fSel || nomeF(r) === fSel) && (!cSel || nomeU(r) === cSel));
    if (!dados.length) { alert('Nenhuma ligação produtiva no período selecionado.'); return; }
    dados.sort((a, b) => new Date(b.dataRegistro) - new Date(a.dataRegistro));
    const header = ['Data/Hora', 'Consultor', 'Grupo', 'Fila', 'Cliente', 'CNPJ', 'Telefone', 'Duração (seg)', 'Duração (mm:ss)', 'URL Gravação'];
    const rows = dados.map(r => { const dt = new Date(r.dataRegistro); return [dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR'), nomeU(r) || '', nomeG(r) || '', nomeF(r) || '', (r.lead && r.lead.nome) ? r.lead.nome.replace(/^\d+\s*/, '') : '', r.documento || '', r.dddTelefone ? String(r.dddTelefone) : '', r.duracao || 0, fmtSeg(r.duracao || 0), r.urlLigacao ? GRAVACAO_BASE + r.urlLigacao : ''].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(','); });
    const csv = '﻿' + header.map(h => '"' + h + '"').join(',') + '\n' + rows.join('\n'), a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const di = $('#d-dt-ini').value || 'hoje', dfm = $('#d-dt-fim').value || 'hoje'; a.download = 'produtivas_' + di + (di !== dfm ? '_a_' + dfm : '') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }

  host.addEventListener('click', e => {
    if (e.target.closest('#d-buscar')) return carregar();
    const o = e.target.closest('[data-ord]'); if (o) { const c = o.dataset.ord; st.sortAsc = st.sortCol === c ? !st.sortAsc : false; st.sortCol = c; return renderizar(); }
    const r = e.target.closest('[data-raiox]'); if (r) return abrirRaioX(r.dataset.raiox);
    if (e.target.closest('[data-csv]')) exportarCsv();
  });
  host.addEventListener('change', e => { if (e.target.matches('#d-grupo, #d-fila, #d-consultor')) renderizar(); if (e.target.matches('#d-hr-ini, #d-hr-fim')) renderizar(); });

  return {
    mostrar() {
      if (st.iniciou) return; st.iniciou = true;
      const hoje = hojeStr(); $('#d-dt-ini').value = hoje; $('#d-dt-fim').value = hoje; carregar();
      st.timer = setInterval(() => { if (host.hidden) return; if ($('#d-dt-fim').value === hojeStr()) carregar(); }, 30000);   // atualiza a cada 30 s quando termina hoje
    },
  };
}
