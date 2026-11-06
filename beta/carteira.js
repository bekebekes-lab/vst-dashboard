// Visão "Carteira" do Beta2 = a aba Carteira do Dash atual (planilha separada, ~40 mil clientes):
// totais, quadros de Voz e Banda Larga (aptos a renovar, classificação, TM, faixa de linhas), busca de
// clientes, detalhe do cliente e extração em CSV. Reproduz renderCarteiraOverview/carteiraBlocoProduto/
// renderCarteiraBusca/carteiraExportarCsv do index.html (~14060-15230).
//
// Não migrado ainda: o "Comparativo (churn entre carteiras)". A trava do servidor (api/sheets.js: a
// Carteira só vai para admin/admin_beta ou quem tem acesso extra, e por unidade para gestor/supervisão)
// continua valendo; a exportação CSV segue bloqueada para gestor e supervisão.

import * as C from './carteira-dados.js';
import { esc, icone, fmtInt, criarMultiSelect, prefs } from './ui.js';
import { abrirDetalheRegistro } from './detalhe.js';

const CORES_CLASSE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948', '#94a3b8'];
const LIMITE = 200;
const pct = (v, t) => (t ? Math.round((v / t) * 100) : 0);

// ctx() => { perfil }
export function criarCarteira(host, ctx) {
  const st = { dados: [], base: null, bases: [], visao12: false, iniciou: false, req: 0, f: { revenda: '', uf: '', associada: '', tmVoz: [], tmBL: [], cnae: [] }, busca: '', resultados: [] };

  host.innerHTML = `
    <section class="painel prod-ctl-painel"><div class="prod-ctl">
      <label class="chip chip-sel"><span>Base (mês)</span><select id="c-base" aria-label="Base"></select></label>
      <label class="busca"><input type="search" id="c-busca" placeholder="Buscar CNPJ ou razão social" autocomplete="off" aria-label="Buscar CNPJ ou razão social"></label>
      <label class="chip chip-sel"><span>Tag da Unidade</span><select id="c-revenda" aria-label="Tag da unidade"></select></label>
      <label class="chip chip-sel"><span>UF</span><select id="c-uf" aria-label="UF"></select></label>
      <label class="chip chip-sel"><span>Carteira associada</span><select id="c-assoc" aria-label="Carteira associada"></select></label>
      <div id="c-tmvoz"></div><div id="c-tmbl"></div><div id="c-cnae"></div>
      <label class="chip chip-chk" title="Piloto: considera apto a renovar a partir de 12 meses de contrato, para qualquer classificação"><input type="checkbox" id="c-12m"><span>Visão piloto (12 meses)</span></label>
      <button type="button" class="btn btn-fantasma" id="c-csv" title="Baixa em CSV todos os clientes que batem com os filtros e a busca">Extrair CSV</button>
    </div></section>
    <div id="c-status"></div><div class="est-topo"><div class="est-stats" id="c-stats"></div></div>
    <div id="c-graficos"></div><div id="c-tabela"></div>`;
  const $ = s => host.querySelector(s);
  const msTmVoz = criarMultiSelect({ rotulo: 'TM Voz', onChange: v => { st.f.tmVoz = v; aoFiltrar(); } });
  const msTmBl = criarMultiSelect({ rotulo: 'TM BL', onChange: v => { st.f.tmBL = v; aoFiltrar(); } });
  const msCnae = criarMultiSelect({ rotulo: 'CNAE', onChange: v => { st.f.cnae = v; aoFiltrar(); } });
  $('#c-tmvoz').replaceWith(msTmVoz.el); $('#c-tmbl').replaceWith(msTmBl.el); $('#c-cnae').replaceWith(msCnae.el);
  const bloqueiaCsv = () => ['gestor', 'supervisao'].includes(ctx().perfil);
  $('#c-csv').hidden = bloqueiaCsv();

  // ── filtros ────────────────────────────────────────────────────────────────
  const passaFiltros = (r, f, ign) => {
    if (ign !== 'revenda' && f.revenda && C.unidade(r) !== f.revenda) return false;
    if (ign !== 'uf' && f.uf && C.ufDe(r) !== f.uf) return false;
    if (ign !== 'associada' && f.associada && C.associada(r) !== f.associada) return false;
    if (ign !== 'tmVoz' && f.tmVoz.length && !f.tmVoz.includes(C.linhas(r) > 0 ? String(C.tm(r)) : C.TM_VAZIO)) return false;
    if (ign !== 'tmBL' && f.tmBL.length && !f.tmBL.includes(C.linhasBL(r) > 0 ? String(C.tmBL(r)) : C.TM_VAZIO)) return false;
    if (ign !== 'cnae' && f.cnae.length && !f.cnae.includes(C.cnaeChave(r))) return false;
    return true;
  };
  const algumFiltro = f => !!(f.revenda || f.uf || f.associada || f.tmVoz.length || f.tmBL.length || f.cnae.length);
  const passaBusca = (r, termo, dig) => { if (!termo) return true; return (r['Razão Social'] || '').toLowerCase().includes(termo) || !!(dig && (r['CNPJ'] || '').replace(/\D/g, '').includes(dig)); };

  // opções de cada filtro restringidas pelos OUTROS (cascata nos dois sentidos)
  function atualizarOpcoes() {
    const f = st.f, ord = (a, b) => (a === C.TM_VAZIO) - (b === C.TM_VAZIO) || a.localeCompare(b, 'pt-BR', { numeric: true });
    const de = (ign, fn) => { const s = new Set(); for (const r of st.dados) if (passaFiltros(r, f, ign)) { const v = fn(r); if (v) s.add(v); } return [...s]; };
    const cnaeOrd = (a, b) => (a === C.CNAE_VAZIO) - (b === C.CNAE_VAZIO) || a.localeCompare(b, 'pt-BR');
    const fill = (id, itens, atual, todos) => { const sel = $(id); const l = [...itens].sort((a, b) => a.localeCompare(b, 'pt-BR')); if (atual && !l.includes(atual)) l.push(atual); sel.innerHTML = `<option value="">${todos}</option>` + l.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join(''); sel.value = atual; };
    fill('#c-revenda', de('revenda', r => { const u = C.unidade(r); return u !== '—' ? u : null; }), f.revenda, 'Todas as tags');
    fill('#c-uf', de('uf', C.ufDe), f.uf, 'Todas');
    fill('#c-assoc', de('associada', C.associada), f.associada, 'Todas');
    msTmVoz.atualizar(de('tmVoz', r => (C.linhas(r) > 0 ? String(C.tm(r)) : C.TM_VAZIO)).sort(ord), f.tmVoz);
    msTmBl.atualizar(de('tmBL', r => (C.linhasBL(r) > 0 ? String(C.tmBL(r)) : C.TM_VAZIO)).sort(ord), f.tmBL);
    const cn = de('cnae', C.cnaeChave).sort(cnaeOrd);
    msCnae.atualizar(cn, f.cnae);
    msCnae.el.querySelector('.ms-btn').title = cn.length ? '' : 'O robô ainda não preencheu o CNAE desta base na planilha';
  }
  const aoFiltrar = () => { atualizarOpcoes(); desenhar(); };

  // ── carga de base ──────────────────────────────────────────────────────────
  async function carregar(titulo) {
    const eu = ++st.req;
    $('#c-status').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando carteira (base grande, pode levar um pouco)…</div>';
    $('#c-stats').innerHTML = ''; $('#c-graficos').innerHTML = ''; $('#c-tabela').innerHTML = '';
    try {
      if (!st.bases.length) {
        st.bases = await C.listarBases();
        $('#c-base').innerHTML = st.bases.map(b => `<option value="${esc(b.titulo)}">${esc(C.rotuloBase(b, st.bases))}</option>`).join('');
      }
      const chave = titulo || st.base || (C.escolherBasePadrao(st.bases) || {}).titulo;
      if (!chave) throw new Error('Nenhuma base de carteira encontrada na planilha.');
      const dados = await C.baixarBase(chave);
      if (eu !== st.req) return;
      st.dados = dados; st.base = chave; $('#c-base').value = chave;
      st.f = { revenda: '', uf: '', associada: '', tmVoz: [], tmBL: [], cnae: [] };
      $('#c-status').innerHTML = '';
      atualizarOpcoes(); desenhar();
    } catch (e) {
      if (eu !== st.req) return;
      $('#c-status').innerHTML = `<div class="alerta alerta-erro"><b>Erro ao carregar carteira</b> ${esc(e.message)}</div>`;
    }
  }

  // ── desenho ────────────────────────────────────────────────────────────────
  const rosca = itens => {
    const total = itens.reduce((s, i) => s + i.value, 0) || 1; let acc = 0;
    const stops = itens.map(i => { const de = (acc / total * 100).toFixed(2); acc += i.value; return `${i.color} ${de}% ${(acc / total * 100).toFixed(2)}%`; }).join(', ');
    return { total, stops };
  };
  const pizza = (titulo, itens) => {
    const { total, stops } = rosca(itens);
    return `<div class="c-card"><h4>${esc(titulo)}</h4><div class="c-pizza"><div class="c-disco" style="background:conic-gradient(${stops || 'var(--cinza-200) 0 100%'})"></div>
      <div class="c-leg">${itens.map(i => `<div><span class="ponto" style="background:${i.color}"></span><span class="c-leg-n">${esc(i.label)}</span><b>${fmtInt(i.value)} <small>(${pct(i.value, total)}%)</small></b></div>`).join('')}</div></div></div>`;
  };
  const barras = (titulo, itens) => {
    const total = itens.reduce((s, i) => s + i.value, 0) || 1, max = Math.max(...itens.map(i => i.value), 1);
    return `<div class="c-card"><h4>${esc(titulo)}</h4>${itens.map(i => `<div class="c-barra"><span class="c-rot">${esc(i.label)}</span><div class="hb-trilho"><div class="hb-barra" style="width:${Math.max(Math.round(i.value / max * 100), i.value > 0 ? 2 : 0)}%"></div></div><b>${fmtInt(i.value)} <small>(${pct(i.value, total)}%)</small></b></div>`).join('')}</div>`;
  };
  function blocoProduto(titulo, fnLinhas, fnTM, dados) {
    const apto = r => C.aptoBase(fnTM(r), r['Classificação'], st.visao12);
    let lA = 0, lN = 0, cA = 0, cN = 0; const clL = {}, clC = {}, ftL = {}, ftC = {}, flL = {}, flC = {};
    C.FAIXAS_TM.forEach(f => { ftL[f.label] = 0; ftC[f.label] = 0; }); C.FAIXAS_LINHAS.forEach(f => { flL[f.label] = 0; flC[f.label] = 0; });
    for (const r of dados) {
      const l = fnLinhas(r); if (l <= 0) continue;
      if (apto(r)) { lA += l; cA++; } else { lN += l; cN++; }
      const cls = (r['Classificação'] || '').trim().toUpperCase() || 'Sem classificação'; clL[cls] = (clL[cls] || 0) + l; clC[cls] = (clC[cls] || 0) + 1;
      const ft = C.faixaDe(fnTM(r), C.FAIXAS_TM); if (ft) { ftL[ft] += l; ftC[ft]++; }
      const fl = C.faixaDe(l, C.FAIXAS_LINHAS); if (fl) { flL[fl] += l; flC[fl]++; }
    }
    const cls = Object.keys(clL).sort(), cor = c => CORES_CLASSE[cls.indexOf(c) % CORES_CLASSE.length];
    return `<h3 class="c-titulo">${esc(titulo)}</h3>
      <h5>Aptas a Renovar</h5><div class="c-grade">${pizza('Linhas', [{ label: 'Aptas', value: lA, color: '#16a34a' }, { label: 'Não aptas', value: lN, color: '#dc2626' }])}${pizza('CNPJs', [{ label: 'Aptos', value: cA, color: '#16a34a' }, { label: 'Não aptos', value: cN, color: '#dc2626' }])}</div>
      <h5>Por Classificação (TM)</h5><div class="c-grade">${pizza('Linhas', cls.map(c => ({ label: c, value: clL[c], color: cor(c) })))}${pizza('Clientes', cls.map(c => ({ label: c, value: clC[c], color: cor(c) })))}</div>
      <h5>Por Tempo de Contrato (TM)</h5><div class="c-grade c-grade-l">${barras('CNPJs', C.FAIXAS_TM.map(f => ({ label: f.label, value: ftC[f.label] })))}${barras('Linhas', C.FAIXAS_TM.map(f => ({ label: f.label, value: ftL[f.label] })))}</div>
      <h5>Por Faixa de Linhas</h5><div class="c-grade c-grade-l">${barras('CNPJs', C.FAIXAS_LINHAS.map(f => ({ label: f.label, value: flC[f.label] })))}${barras('Linhas', C.FAIXAS_LINHAS.map(f => ({ label: f.label, value: flL[f.label] })))}</div>`;
  }

  function desenhar() {
    if (!st.dados.length) return;
    const f = st.f, dados = st.dados.filter(r => passaFiltros(r, f));
    const tClientes = dados.filter(C.temAtividade).length, tVoz = dados.reduce((s, r) => s + C.linhas(r), 0), tBL = dados.reduce((s, r) => s + C.linhasBL(r), 0), tLinhas = tVoz + tBL;
    const gClientes = st.dados.filter(C.temAtividade).length, gVoz = st.dados.reduce((s, r) => s + C.linhas(r), 0), gBL = st.dados.reduce((s, r) => s + C.linhasBL(r), 0);
    // % sempre sobre a base inteira (sem filtro): quanto esse recorte representa do total da empresa
    $('#c-stats').innerHTML = [[tLinhas, 'linhas no total', pct(tLinhas, gVoz + gBL)], [tClientes, 'clientes', pct(tClientes, gClientes)], [tVoz, 'linhas (voz)', pct(tVoz, gVoz)], [tBL, 'linhas (banda larga)', pct(tBL, gBL)]]
      .map(([v, t, p]) => `<span class="stat"><b>${fmtInt(v)}</b> ${t} <span class="prod-dica">(${p}%)</span></span>`).join('');
    $('#c-graficos').innerHTML = blocoProduto('Voz', C.linhas, C.tm, dados) + blocoProduto('Banda Larga', C.linhasBL, C.tmBL, dados);
    desenharBusca();
  }

  function desenharBusca() {
    const termo = ($('#c-busca').value || '').trim().toLowerCase(), f = st.f;
    if (!termo && !algumFiltro(f)) { $('#c-tabela').innerHTML = ''; return; }
    const dig = termo.replace(/\D/g, ''), todos = st.dados.filter(r => passaFiltros(r, f) && passaBusca(r, termo, dig)), res = todos.slice(0, LIMITE);
    st.resultados = res;
    if (!res.length) { $('#c-tabela').innerHTML = '<section class="painel"><div class="vazio">Nenhum cliente encontrado.</div></section>'; return; }
    const sn = v => (v ? '<span class="txt-pos">Sim</span>' : '<span class="prod-dica">Não</span>');
    $('#c-tabela').innerHTML = `<section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Resultados</h2><p>${fmtInt(todos.length)} cliente(s)${todos.length > LIMITE ? (bloqueiaCsv() ? ` · mostrando os ${LIMITE} primeiros — refine a busca/filtros` : ` · mostrando os ${LIMITE} primeiros — use "Extrair CSV" para a lista completa`) : ''}</p></div></header>
      <div class="painel-corpo"><div class="tab-wrap"><table class="tab"><thead><tr><th>CNPJ</th><th>Razão Social</th><th>Unidade</th><th>Cidade/UF</th><th>CNAE</th><th class="num">Linhas Voz</th><th class="num">TM Voz</th><th>Apto Voz</th><th class="num">Linhas BL</th><th class="num">TM BL</th><th>Apto BL</th><th>Classe</th></tr></thead>
      <tbody>${res.map((r, i) => `<tr><td style="font-family:monospace;font-size:12px">${esc(r['CNPJ'] || '—')}</td><td><button type="button" class="lnk" data-det="${i}">${esc(r['Razão Social'] || '—')}</button></td><td>${esc(C.unidade(r))}</td><td>${esc(r['DSC_MUNICIPIO'] || '—')}/${esc(r['UF'] || '—')}</td>
        <td style="white-space:nowrap" title="${esc(C.cnaeDescricao(r))}">${esc(C.cnaeFormatado(C.cnaeCodigo(r)) || '—')}</td><td class="num">${C.linhas(r)}</td><td class="num">${C.tm(r)}</td><td>${sn(C.linhas(r) > 0 && C.aptoBase(C.tm(r), r['Classificação'], st.visao12))}</td>
        <td class="num">${C.linhasBL(r)}</td><td class="num">${C.tmBL(r)}</td><td>${sn(C.linhasBL(r) > 0 && C.aptoBase(C.tmBL(r), r['Classificação'], st.visao12))}</td><td>${esc(r['Classificação'] || '—')}</td></tr>`).join('')}</tbody></table></div></div></section>`;
  }

  function detalhe(i) {
    const r = st.resultados[i]; if (!r) return;
    const DEST = ['Telefone de Contato', 'Nome do ADM'], ruim = v => !v || v === '#N/A' || v === '#N/D' || v === '#NOME?';
    const destacados = DEST.filter(k => r[k] !== undefined).map(k => [k, ruim(r[k]) ? '—' : r[k]]);
    const campos = [...destacados, ...Object.entries(r).filter(([k, v]) => !DEST.includes(k) && !C.CAMPOS_IGNORADOS.has(k) && v !== '' && !ruim(v))];
    abrirDetalheRegistro(r, { titulo: r['Razão Social'] || 'Cliente da Carteira', campos });
  }

  function exportarCsv() {
    if (bloqueiaCsv()) { alert('Seu acesso à Carteira não inclui extração em CSV.'); return; }
    const f = st.f, termo = ($('#c-busca').value || '').trim().toLowerCase(), dig = termo.replace(/\D/g, '');
    const ls = st.dados.filter(r => passaFiltros(r, f) && passaBusca(r, termo, dig));
    if (!ls.length) { alert('Nenhum cliente para os filtros atuais.'); return; }
    const cab = ['CNPJ', 'Razão Social', 'Unidade', 'Carteira Associada', 'Cidade', 'UF', 'Classificação', 'Linhas Voz', 'TM Voz (meses)', 'Faixa TM Voz', 'Apto Voz', 'Linhas BL', 'TM BL (meses)', 'Faixa TM BL', 'Apto BL', 'Telefone de Contato', 'Nome do ADM', 'CNAE', 'Descrição CNAE'];
    const sn = v => (v ? 'Sim' : 'Não'), ap = (t, r) => C.aptoBase(t, r['Classificação'], st.visao12);
    const dados = ls.map(r => [r['CNPJ'] || '', r['Razão Social'] || '', C.unidade(r), C.associada(r) || '', r['DSC_MUNICIPIO'] || '', r['UF'] || '', r['Classificação'] || '',
      C.linhas(r), C.tm(r), C.linhas(r) > 0 ? (C.faixaDe(C.tm(r), C.FAIXAS_TM) || '') : '', sn(C.linhas(r) > 0 && ap(C.tm(r), r)),
      C.linhasBL(r), C.tmBL(r), C.linhasBL(r) > 0 ? (C.faixaDe(C.tmBL(r), C.FAIXAS_TM) || '') : '', sn(C.linhasBL(r) > 0 && ap(C.tmBL(r), r)),
      C.valor(r['Telefone de Contato']), C.valor(r['Nome do ADM']), C.cnaeFormatado(C.cnaeCodigo(r)), C.cnaeDescricao(r)]);
    const e = v => '"' + String(v).replace(/"/g, '""') + '"';
    const csv = '﻿' + [cab, ...dados].map(l => l.map(e).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const t = new Date().toISOString().slice(0, 16).replace(/[-T:]/g, '').replace(/(\d{8})(\d{4})/, '$1_$2');
    a.download = `carteira_${(st.base || 'base').replace(/\s+/g, '_')}_${t}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  }

  $('#c-base').addEventListener('change', e => { if (e.target.value && e.target.value !== st.base) carregar(e.target.value); });
  $('#c-revenda').addEventListener('change', e => { st.f.revenda = e.target.value; aoFiltrar(); });
  $('#c-uf').addEventListener('change', e => { st.f.uf = e.target.value; aoFiltrar(); });
  $('#c-assoc').addEventListener('change', e => { st.f.associada = e.target.value; aoFiltrar(); });
  $('#c-12m').addEventListener('change', e => { st.visao12 = e.target.checked; desenhar(); });
  let t; $('#c-busca').addEventListener('input', () => { clearTimeout(t); t = setTimeout(desenharBusca, 250); });
  $('#c-csv').addEventListener('click', exportarCsv);
  host.addEventListener('click', e => { const d = e.target.closest('[data-det]'); if (d) detalhe(Number(d.dataset.det)); });

  return { mostrar() { if (!st.iniciou) { st.iniciou = true; carregar(); } } };
}
