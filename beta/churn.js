// Visão "Churn" do Beta2 = a aba Churn do Dash atual: alertas de PORT-OUT recebidos por e-mail
// (tabela churn_alertas), com atribuição de responsável e feedback para a Claro. Reproduz
// initChurn/renderChurn/churnAbrirDetalhe/churnSalvarFeedback do index.html (~13108-13547).
//
// Escreve em churn_alertas (atribuido_a, feedback, respondido) pelo cliente Supabase com a sessão do
// usuário — o RLS do banco decide quem pode ler/alterar, como no Dash atual. O cruzamento com a
// Carteira (consultor/equipe do cliente, por CNPJ) é "melhor esforço": se a Carteira não carregar,
// o Churn funciona igual, só sem essas colunas.

import { supa } from './sessao.js';
import * as C from './carteira-dados.js';
import { MAPEAMENTO_TAGS } from './regras.js';
import { esc, icone, fmtInt, criarMultiSelect } from './ui.js';

const MES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const SEM_ATRIB = '__ninguem__';
const mesChave = (ano, mes) => `${ano}-${String(mes).padStart(2, '0')}`;
const mesRotulo = ch => (ch ? `${MES_ABREV[parseInt(ch.slice(5), 10) - 1]}/${ch.slice(0, 4)}` : '');
const rotuloParaChave = r => { const m = (r || '').match(/^(\S+)\/(\d{4})$/); return m ? mesChave(m[2], MES_ABREV.indexOf(m[1]) + 1) : ''; };
function chaveRecebido(r) { const d = r.recebido_em ? new Date(r.recebido_em) : null; return d && !isNaN(d) ? mesChave(d.getFullYear(), d.getMonth() + 1) : ''; }
function chaveJanela(r) {
  const t = (r.data_janela || '').toString().trim();
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return mesChave(m[3], parseInt(m[2], 10));
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? mesChave(m[1], parseInt(m[2], 10)) : '';
}
// Unidade: código no fim do texto "PS - VST_AGENCIAMENTO_E_SERV - YI8F" -> nome da cidade (MAPEAMENTO_TAGS)
function unidade(r) {
  const partes = (r.carteira_aace || '').trim().split('-').map(s => s.trim()).filter(Boolean), cod = partes[partes.length - 1];
  return cod ? (MAPEAMENTO_TAGS['#' + cod.toUpperCase()] || cod) : '—';
}

// ctx() => {}
export function criarChurn(host) {
  const st = { dados: [], usuarios: [], carteira: null, mapaCnpj: null, sortCol: 'recebido_em', sortAsc: false, iniciou: false, req: 0, sel: { unidade: [], equipe: [], recebido: [], janela: [] } };

  host.innerHTML = `
    <section class="painel prod-ctl-painel"><div class="prod-ctl">
      <label class="chip chip-sel"><span>Status</span><select id="ch-status"><option value="pendentes">Pendentes</option><option value="respondidos">Respondidos</option><option value="todos">Todos</option></select></label>
      <label class="chip chip-sel"><span>Linhas</span><select id="ch-linhas"><option value="todos">Todos</option><option value="10+">A partir de 10 (resposta obrigatória)</option></select></label>
      <label class="chip chip-sel"><span>Atribuído a</span><select id="ch-atrib"><option value="todos">Todos</option></select></label>
      <div id="ch-unidade"></div><div id="ch-equipe"></div><div id="ch-recebido"></div><div id="ch-janela"></div>
    </div></section>
    <div class="est-topo"><div class="est-stats" id="ch-stats"></div></div>
    <section class="painel"><div class="painel-corpo" id="ch-tabela" style="padding-top:var(--e4)"></div></section>`;
  const $ = s => host.querySelector(s);
  const ms = {};
  [['unidade', 'Tag da Unidade'], ['equipe', 'Equipe'], ['recebido', 'Recebido (mês)'], ['janela', 'Janela (mês)']].forEach(([k, r]) => {
    ms[k] = criarMultiSelect({ rotulo: r, onChange: v => { st.sel[k] = v; aoFiltrar(); } });
    $('#ch-' + k).replaceWith(ms[k].el);
  });

  // dono do cliente na Carteira, pelo CNPJ (index.html churnDonoCliente)
  function dono(r) {
    const dig = (r.cnpj || '').replace(/\D/g, '');
    if (!dig || !st.mapaCnpj) return null;
    const linha = st.mapaCnpj.get(dig); if (!linha) return null;
    const consultor = C.valor(linha['NEO VST (CONSULTOR)']); let equipe = C.valor(linha['NEO VST (EQUIPE)']);
    if (!consultor && !equipe) for (const col of C.CAMPOS_IGNORADOS) { const v = C.valor(linha[col]); if (v) { equipe = v; break; } }
    const telefone = C.valor(linha['Telefone de Contato']), nomeAdm = C.valor(linha['Nome do ADM']);
    return (!consultor && !equipe && !telefone && !nomeAdm) ? null : { consultor, equipe, telefone, nomeAdm };
  }

  const visao = () => ({ status: $('#ch-status').value, linhas: $('#ch-linhas').value, atrib: $('#ch-atrib').value });
  const passa = (r, v, ign) => {
    if (v.status === 'pendentes' && r.respondido) return false;
    if (v.status === 'respondidos' && !r.respondido) return false;
    if (v.linhas === '10+' && !(r.qtd_linhas >= 10)) return false;
    if (ign !== 'atrib') { if (v.atrib === 'ninguem' && r.atribuido_a) return false; if (v.atrib !== 'todos' && v.atrib !== 'ninguem' && String(r.atribuido_a) !== v.atrib) return false; }
    if (ign !== 'unidade' && st.sel.unidade.length && !st.sel.unidade.includes(unidade(r))) return false;
    if (ign !== 'equipe' && st.sel.equipe.length && !st.sel.equipe.includes(dono(r)?.equipe || '')) return false;
    if (ign !== 'recebido' && st.sel.recebido.length && !st.sel.recebido.includes(mesRotulo(chaveRecebido(r)))) return false;
    if (ign !== 'janela' && st.sel.janela.length && !st.sel.janela.includes(mesRotulo(chaveJanela(r)))) return false;
    return true;
  };

  // cascata: cada lista vem só dos alertas que passam pelos OUTROS filtros
  function atualizarOpcoes() {
    const v = visao();
    const de = (ign, fn) => { const s = new Set(); for (const r of st.dados) if (passa(r, v, ign)) { const x = fn(r); if (x) s.add(x); } return [...s]; };
    const ordMes = (a, b) => rotuloParaChave(b).localeCompare(rotuloParaChave(a));
    ms.unidade.atualizar(de('unidade', r => { const u = unidade(r); return u !== '—' ? u : null; }).sort((a, b) => a.localeCompare(b, 'pt-BR')), st.sel.unidade);
    ms.equipe.atualizar(de('equipe', r => dono(r)?.equipe || null).sort((a, b) => a.localeCompare(b, 'pt-BR')), st.sel.equipe);
    ms.recebido.atualizar(de('recebido', r => mesRotulo(chaveRecebido(r)) || null).sort(ordMes), st.sel.recebido);
    ms.janela.atualizar(de('janela', r => mesRotulo(chaveJanela(r)) || null).sort(ordMes), st.sel.janela);
    // Atribuído: só quem aparece nos alertas filtrados (a escolha atual nunca some)
    const presentes = new Set(st.dados.filter(r => passa(r, v, 'atrib')).map(r => (r.atribuido_a ? String(r.atribuido_a) : SEM_ATRIB)));
    const atual = v.atrib, nomes = {}; st.usuarios.forEach(u => { nomes[String(u.id)] = u.nome; });
    const opts = [['todos', 'Todos']];
    if (presentes.has(SEM_ATRIB) || atual === 'ninguem') opts.push(['ninguem', 'Sem atribuição' + (presentes.has(SEM_ATRIB) ? '' : ' (sem registro)')]);
    st.usuarios.filter(u => presentes.has(String(u.id)) || atual === String(u.id)).forEach(u => opts.push([String(u.id), u.nome + (presentes.has(String(u.id)) ? '' : ' (sem registro)')]));
    $('#ch-atrib').innerHTML = opts.map(([val, t]) => `<option value="${esc(val)}">${esc(t)}</option>`).join(''); $('#ch-atrib').value = atual;
  }
  const aoFiltrar = () => { atualizarOpcoes(); desenhar(); };

  const valorOrd = (r, c) => ({
    recebido_em: r.recebido_em ? new Date(r.recebido_em).getTime() : -Infinity, nome_cliente: (r.nome_cliente || '').toLowerCase(), cnpj: r.cnpj || '', qtd_linhas: r.qtd_linhas || 0,
    receptora: (r.receptora || '').toLowerCase(), unidade: unidade(r).toLowerCase(), consultor: (dono(r)?.consultor || '').toLowerCase(), equipe: (dono(r)?.equipe || '').toLowerCase(),
    cidade: (r.municipio_cliente || '').toLowerCase(), uf: (r.uf_cliente || '').toLowerCase(), data_janela: r.data_janela || '', status: r.respondido ? 1 : 0,
  }[c] ?? '');

  function desenhar() {
    const v = visao();
    const linhas = st.dados.filter(r => passa(r, v)).sort((a, b) => { const x = valorOrd(a, st.sortCol), y = valorOrd(b, st.sortCol); return x < y ? (st.sortAsc ? -1 : 1) : x > y ? (st.sortAsc ? 1 : -1) : 0; });
    const pend = st.dados.filter(r => !r.respondido).length, obrig = st.dados.filter(r => !r.respondido && r.qtd_linhas >= 10).length;
    host.dispatchEvent(new CustomEvent('churn-obrigatorios', { detail: obrig, bubbles: true }));
    $('#ch-stats').innerHTML = [[fmtInt(st.dados.length), 'alertas no total'], [fmtInt(st.dados.reduce((s, r) => s + (parseInt(r.qtd_linhas) || 0), 0)), 'linhas no total'], [fmtInt(pend), 'pendentes'], [fmtInt(obrig), 'com resposta obrigatória (10+ linhas)']]
      .map(([n, t], i) => `<span class="stat${i === 3 && obrig > 0 ? ' stat-alerta' : ''}"><b>${n}</b> ${t}</span>`).join('');
    if (!linhas.length) { $('#ch-tabela').innerHTML = '<div class="vazio">Nenhum alerta para os filtros selecionados.</div>'; return; }
    const COLS = [['recebido_em', 'Recebido'], ['nome_cliente', 'Cliente'], ['cnpj', 'CNPJ'], ['qtd_linhas', 'Linhas'], ['receptora', 'Receptora'], ['unidade', 'Unidade'], ['consultor', 'Consultor'], ['equipe', 'Equipe'], ['cidade', 'Cidade'], ['uf', 'UF'], ['data_janela', 'Data Janela'], ['status', 'Status']];
    const th = ([k, r]) => `<th><button type="button" class="th-ord${st.sortCol === k ? ' ativo' : ''}" data-ord="${k}">${r}<span class="seta">${st.sortCol === k ? (st.sortAsc ? '↑' : '↓') : '↕'}</span></button></th>`;
    $('#ch-tabela').innerHTML = `<div class="tab-wrap"><table class="tab"><thead><tr>${COLS.map(th).join('')}<th></th></tr></thead><tbody>${linhas.map(r => {
      const d = dono(r), obg = r.qtd_linhas >= 10, dt = r.recebido_em ? new Date(r.recebido_em) : null;
      const rec = dt && !isNaN(dt) ? dt.toLocaleDateString('pt-BR') + ' ' + dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
      const dup = r.qtd_emails_recebidos > 1 ? `<span class="prod-dica" title="Recebido ${r.qtd_emails_recebidos} vezes (reenvio/encaminhamento)"><b>${r.qtd_emails_recebidos}x </b></span>` : '';
      return `<tr><td class="prod-dica" style="white-space:nowrap">${rec}</td><td class="cel-nome">${dup}${esc(r.nome_cliente || '—')}${obg ? ' <span class="txt-neg" title="Resposta obrigatória (10+ linhas)">●</span>' : ''}</td>
        <td style="font-family:monospace;font-size:12px">${esc(r.cnpj || '—')}</td><td class="num">${r.qtd_linhas ?? '—'}</td><td>${esc(r.receptora || '—')}</td><td>${esc(unidade(r))}</td>
        <td>${esc(d?.consultor || '—')}</td><td>${esc(d?.equipe || '—')}</td><td>${esc(r.municipio_cliente || '—')}</td><td>${esc(r.uf_cliente || '—')}</td><td>${esc(r.data_janela || '—')}</td>
        <td><span class="q-sit ${r.respondido ? 'em_dia' : ''}">${r.respondido ? 'Respondido' : 'Pendente'}</span></td><td><button type="button" class="btn btn-fantasma" data-ver="${r.id}">Ver / Responder</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function abrirDetalhe(id) {
    const r = st.dados.find(x => x.id === id); if (!r) return;
    const d = dono(r);
    const campos = [['Nome do Cliente', r.nome_cliente], ['CNPJ', r.cnpj], ['Número de linhas', r.qtd_linhas], ['Cidade', r.municipio_cliente], ['UF', r.uf_cliente], ['Unidade', unidade(r)],
      ['Consultor (Carteira)', d?.consultor], ['Equipe (Carteira)', d?.equipe], ['Contato (Carteira)', d?.telefone], ['Nome do ADM (Carteira)', d?.nomeAdm], ['Receptora', r.receptora], ['Promoção Atual', r.promocao_atual],
      ['Classificação', r.classificacao], ['Tempo Médio', r.tempo_medio], ['Carteira AACE', r.carteira_aace], ['Gerente de Canal', r.gerente_canal], ['Coordenador', r.coordenador], ['Data da Janela', r.data_janela],
      ['Multa estimada', r.multa_estimada], ['Oferta de Retenção MKT', r.oferta_retencao_mkt], ['Oferta Pós', r.oferta_pos]].filter(([, x]) => x !== null && x !== undefined && x !== '' && x !== '—');
    const ov = document.createElement('div'); ov.className = 'modal-fundo';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Alerta de PORT-OUT"><header><h3>${esc(r.nome_cliente || '—')}</h3><button type="button" class="btn-icone" data-x aria-label="Fechar">${icone('close')}</button></header>
      <dl>${campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>
      <div class="ch-form"><label>Atribuído a<select id="ch-m-atrib"><option value="">Sem atribuição</option>${st.usuarios.map(u => `<option value="${u.id}" ${String(r.atribuido_a) === String(u.id) ? 'selected' : ''}>${esc(u.nome)}</option>`).join('')}</select></label>
        <label>Feedback / resposta pra Claro<textarea id="ch-m-fb" rows="5">${esc(r.feedback || '')}</textarea></label>
        <div class="ch-form-pe"><label class="chip chip-chk"><input type="checkbox" id="ch-m-resp" ${r.respondido ? 'checked' : ''}><span>Marcar como respondido</span></label><button type="button" class="btn btn-marca" id="ch-m-salvar">Salvar</button></div><div class="txt-neg" id="ch-m-erro"></div></div></div>`;
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', tecla); }; const tecla = e => { if (e.key === 'Escape') fechar(); };
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) fechar(); }); document.addEventListener('keydown', tecla);
    ov.querySelector('#ch-m-atrib').addEventListener('change', async e => {
      const val = e.target.value || null;
      const { error } = await supa.from('churn_alertas').update({ atribuido_a: val, atualizado_em: new Date().toISOString() }).eq('id', id);
      if (error) { ov.querySelector('#ch-m-erro').textContent = 'Erro ao atribuir: ' + error.message; return; }
      r.atribuido_a = val; ov.querySelector('#ch-m-erro').textContent = '';
    });
    ov.querySelector('#ch-m-salvar').addEventListener('click', async () => {
      const feedback = ov.querySelector('#ch-m-fb').value, respondido = ov.querySelector('#ch-m-resp').checked;
      const { error } = await supa.from('churn_alertas').update({ feedback, respondido, atualizado_em: new Date().toISOString() }).eq('id', id);
      if (error) { ov.querySelector('#ch-m-erro').textContent = 'Erro ao salvar: ' + error.message; return; }
      r.feedback = feedback; r.respondido = respondido; fechar(); atualizarOpcoes(); desenhar();
    });
    document.body.append(ov);
  }

  async function carregar() {
    const eu = ++st.req;
    $('#ch-tabela').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando alertas…</div>';
    const { data: usuarios } = await supa.from('usuarios_dashboard').select('id,nome').eq('ativo', true).order('nome');
    st.usuarios = usuarios || [];
    const { data, error } = await supa.from('churn_alertas').select('*').order('recebido_em', { ascending: false });
    if (error) { $('#ch-tabela').innerHTML = `<div class="alerta alerta-erro"><b>Erro ao carregar alertas</b> ${esc(error.message)}</div>`; return; }
    st.dados = data || [];
    // cruza com a Carteira (base padrão = mês atual ou a mais recente); se falhar, segue sem consultor/equipe
    try {
      const bases = await C.listarBases(), padrao = C.escolherBasePadrao(bases);
      if (padrao) { const dados = await C.baixarBase(padrao.titulo); st.mapaCnpj = new Map(); dados.forEach(r => { const dig = (r['CNPJ'] || '').replace(/\D/g, ''); if (dig) st.mapaCnpj.set(dig, r); }); }
    } catch (e) { console.warn('Não consegui cruzar o Churn com a Carteira:', e.message); }
    if (eu !== st.req) return;
    atualizarOpcoes(); desenhar();
  }

  host.addEventListener('click', e => {
    const o = e.target.closest('[data-ord]'); if (o) { const k = o.dataset.ord; st.sortAsc = st.sortCol === k ? !st.sortAsc : false; st.sortCol = k; return desenhar(); }
    const v = e.target.closest('[data-ver]'); if (v) abrirDetalhe(Number(v.dataset.ver));
  });
  host.addEventListener('change', e => { if (e.target.matches('#ch-status, #ch-linhas, #ch-atrib')) aoFiltrar(); });

  return {
    mostrar() { if (!st.iniciou) { st.iniciou = true; carregar(); } },
    // "sino": alertas pendentes com resposta obrigatória (10+ linhas), consulta leve independente da aba
    async contarObrigatorios() { const { count } = await supa.from('churn_alertas').select('id', { count: 'exact', head: true }).eq('respondido', false).gte('qtd_linhas', 10); return count || 0; },
    // abre já em "pendentes + 10+" (clique no sino/badge)
    filtrarObrigatorios() { $('#ch-status').value = 'pendentes'; $('#ch-linhas').value = '10+'; if (st.iniciou) aoFiltrar(); },
  };
}
