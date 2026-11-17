// Visão "Churn" do Beta2 = a aba Churn do Dash atual: alertas de PORT-OUT recebidos por e-mail
// (tabela churn_alertas), com atribuição de responsável e feedback para a Claro. Reproduz
// initChurn/renderChurn/churnAbrirDetalhe/churnSalvarFeedback do index.html (~13108-13547).
//
// Escreve em churn_alertas (atribuido_a, feedback, respondido) pelo cliente Supabase com a sessão do
// usuário — o RLS do banco decide quem pode ler/alterar, como no Dash atual. O cruzamento com a
// Carteira (consultor/equipe do cliente, por CNPJ) é "melhor esforço": se a Carteira não carregar,
// o Churn funciona igual, só sem essas colunas.
//
// Tratativa como conversa (espelha o index.html): o gestor responde com Motivo + Status; quem tem a aba Churn
// completa (o "responsável") pode DEVOLVER o alerta ao gestor com uma pergunta (volta pendente pra ele, quantas
// vezes precisar). Devolver e editar passam por /api/acessos?recurso=churn; a conversa (churn_tratativas) é lida
// direto pela policy. Texto do gestor nunca muda; o responsável só edita a PRÓPRIA mensagem (lápis).
// A conversa é uma só por alerta; a PENDÊNCIA é de cada gestor (quem recebe: regra automática pela equipe do dono do
// cliente, ou atribuição manual do responsável — /api/acessos?recurso=churn&action=painel|atribuir). Tem também o
// relatório por período (copiar pro WhatsApp / imprimir).

import { supa, authHeaders } from './sessao.js';
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

// Aba 'baseneo' da planilha da Carteira (index.html carregarBaseNeo / baseneoDono / baseneoUltimosConsultores): de onde as abas dos
// meses puxam o cliente. Várias linhas por CNPJ (um pedido por linha, com a etapa). CNPJ (só dígitos) -> [{ consultor, equipe, etapa, ts }].
const BASENEO_ETAPAS_ATIVAS = new Set(['ATIVO', 'CONECTADO']);
async function carregarBaseNeo() {
  const dados = await C.baixarBase('baseneo');
  const mapa = new Map();
  dados.forEach(l => {
    const cnpj = (l['CPF-CNPJ'] || '').replace(/\D/g, '');
    const consultor = C.valor(l['USUARIO']), equipe = C.valor(l['EQUIPE']);
    if (!cnpj || (!consultor && !equipe)) return;
    const m = (l['ÚLTIMA'] || l['ULTIMA'] || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const ts = m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : 0;
    const etapa = (l['ETAPA'] || '').trim().toUpperCase();
    if (!mapa.has(cnpj)) mapa.set(cnpj, []);
    mapa.get(cnpj).push({ consultor, equipe, etapa, ts });
  });
  return mapa;
}
// último pedido ATIVO/CONECTADO (por data ÚLTIMA; empate: o que aparece depois); sem nenhum ativo, o mais recente de qualquer etapa
function baseneoDono(mapa, cnpjDigitos) {
  const hist = mapa?.get(cnpjDigitos);
  if (!hist) return null;
  const maisRecente = lista => lista.reduce((a, h) => (!a || h.ts >= a.ts) ? h : a, null);
  return maisRecente(hist.filter(h => BASENEO_ETAPAS_ATIVAS.has(h.etapa))) || maisRecente(hist);
}
// últimos consultores que atenderam o cliente (detalhe do alerta): um por consultor, do mais novo ao mais antigo
function baseneoUltimosConsultores(mapa, cnpjDigitos, max = 3) {
  const porConsultor = new Map();
  (mapa?.get(cnpjDigitos) || []).forEach(h => {
    if (!h.consultor) return;
    const k = h.consultor.toUpperCase(), a = porConsultor.get(k);
    if (!a || h.ts >= a.ts) porConsultor.set(k, h);
  });
  return [...porConsultor.values()].sort((a, b) => b.ts - a.ts).slice(0, max);
}
const fmtDH = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'; };

// ctx() => {}
export function criarChurn(host) {
  const st = { dados: [], usuarios: [], carteira: null, mapaCnpj: null, baseneo: null, sortCol: 'recebido_em', sortAsc: false, iniciou: false, req: 0, sel: { unidade: [], equipe: [], recebido: [], janela: [] } };

  host.innerHTML = `
    <section class="painel prod-ctl-painel"><div class="prod-ctl">
      <label class="chip chip-sel"><span>Status</span><select id="ch-status"><option value="pendentes">Pendentes</option><option value="respondidos">Respondidos</option><option value="todos">Todos</option></select></label>
      <label class="chip chip-sel"><span>Tratativa do gestor</span><select id="ch-gestor"><option value="todos">Todos</option><option value="tratados">Já tratado por algum gestor</option><option value="nao_tratados">Nenhum gestor tratou ainda</option><option value="pendencia">Com pendência em algum gestor</option><option value="devolvidos">Devolvidos (aguardando réplica)</option><option value="sem_gestor">Sem gestor atribuído</option></select></label>
      <label class="chip chip-sel"><span>Linhas</span><select id="ch-linhas"><option value="todos">Todos</option><option value="10+">A partir de 10 (resposta obrigatória)</option></select></label>
      <label class="chip chip-sel"><span>Gestor atribuído</span><select id="ch-atrib"><option value="todos">Todos</option></select></label>
      <button type="button" class="btn btn-fantasma" id="ch-relatorio" title="Relatório das tratativas por período, para enviar no grupo">📋 Relatório</button>
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

  // dono do cliente (index.html churnDonoCliente): Carteira do mês pelo CNPJ; sem consultor/equipe nela (ou CNPJ fora dela),
  // vale a aba "baseneo" (último pedido ATIVO/CONECTADO); por fim as colunas de gestor da Carteira.
  function dono(r) {
    const dig = (r.cnpj || '').replace(/\D/g, '');
    if (!dig) return null;
    const linha = st.mapaCnpj ? st.mapaCnpj.get(dig) : null;
    let consultor = '', equipe = '', telefone = '', nomeAdm = '';
    if (linha) {
      consultor = C.valor(linha['NEO VST (CONSULTOR)']); equipe = C.valor(linha['NEO VST (EQUIPE)']);
      telefone = C.valor(linha['Telefone de Contato']); nomeAdm = C.valor(linha['Nome do ADM']);
    }
    if (!consultor && !equipe) { const b = baseneoDono(st.baseneo, dig); if (b) { consultor = b.consultor; equipe = b.equipe; } }
    if (linha && !consultor && !equipe) for (const col of C.CAMPOS_IGNORADOS) { const v = C.valor(linha[col]); if (v) { equipe = v; break; } }
    return (!consultor && !equipe && !telefone && !nomeAdm) ? null : { consultor, equipe, telefone, nomeAdm };
  }

  // Painel (servidor): pra cada alerta, quem recebe e o estado de cada gestor (pendente / tratado / devolvido)
  st.painel = { usuarios: [], alertas: {}, erro: false };
  const destino = r => st.painel.alertas[r.id] || null;
  const nomeU = id => (st.painel.usuarios.find(u => u.id === id) || {}).nome || '—';
  const primeiro = n => String(n || '').trim().split(/\s+/)[0] || '—';
  async function carregarPainel() {
    try {
      const res = await fetch('/api/acessos?recurso=churn&action=painel', { headers: await authHeaders() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Falha ao ler as atribuições');
      st.painel = { usuarios: j.usuarios || [], alertas: j.alertas || {}, erro: false };
    } catch (e) { console.warn('Painel de atribuição do Churn indisponível:', e.message); st.painel = { usuarios: [], alertas: {}, erro: true }; }
  }
  function tratativaPassa(r, f) {
    if (!f || f === 'todos') return true;
    const d = destino(r);
    if (!d) return f === 'tratados' ? !!r.tratado_gestor : f === 'nao_tratados' ? !r.tratado_gestor : false;   // painel indisponível: marca antiga
    const ds = d.d || [], t = ds.filter(x => x.e === 'tratado').length, dv = ds.filter(x => x.e === 'devolvido').length, p = ds.filter(x => x.e === 'pendente').length;
    if (f === 'sem_gestor') return ds.length === 0;
    if (f === 'tratados') return t > 0;
    if (f === 'nao_tratados') return ds.length > 0 && t === 0 && dv === 0;
    if (f === 'pendencia') return p > 0 || dv > 0;
    if (f === 'devolvidos') return dv > 0;
    return true;
  }
  function gestorAtribPassa(r, v) {
    if (!v || v === 'todos') return true;
    const d = destino(r); if (!d) return false;
    return v === 'ninguem' ? !(d.d || []).length : (d.d || []).some(x => x.u === v);
  }
  const ICONE = { tratado: ['✓', 'ch-selo-ok'], devolvido: ['↩', 'ch-selo-dev'], pendente: ['⏳', 'ch-selo-pend'] };
  function selo(r) {
    const d = destino(r);
    if (!d) return r.tratado_gestor ? '<div class="ch-selo ch-selo-ok">✓ Tratado pelo gestor</div>' : '';
    if (!(d.d || []).length) return '<div class="ch-selo ch-selo-sem">⚠ Sem gestor atribuído</div>';
    return d.d.slice(0, 3).map(x => { const [ic, cl] = ICONE[x.e] || ICONE.pendente; return `<div class="ch-selo ${cl}">${ic} ${esc(primeiro(nomeU(x.u)))}${x.s ? ' · ' + esc(x.s) : ''}</div>`; }).join('') + (d.d.length > 3 ? `<div class="ch-selo ch-selo-pend">+${d.d.length - 3}</div>` : '');
  }

  const visao = () => ({ status: $('#ch-status').value, linhas: $('#ch-linhas').value, atrib: $('#ch-atrib').value, gestor: $('#ch-gestor').value });
  const passa = (r, v, ign) => {
    if (v.status === 'pendentes' && r.respondido) return false;
    if (v.status === 'respondidos' && !r.respondido) return false;
    if (v.linhas === '10+' && !(r.qtd_linhas >= 10)) return false;
    if (!tratativaPassa(r, v.gestor)) return false;
    if (ign !== 'atrib' && !gestorAtribPassa(r, v.atrib)) return false;
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
    // Gestor atribuído: só quem aparece nos alertas filtrados (a escolha atual nunca some)
    const presentes = new Set(), semGestor = st.dados.filter(r => passa(r, v, 'atrib')).some(r => { const d = destino(r); (d?.d || []).forEach(x => presentes.add(x.u)); return d && !(d.d || []).length; });
    const atual = v.atrib;
    const opts = [['todos', 'Todos']];
    if (semGestor || atual === 'ninguem') opts.push(['ninguem', 'Sem gestor atribuído' + (semGestor ? '' : ' (sem registro)')]);
    st.painel.usuarios.filter(u => presentes.has(u.id) || atual === u.id).forEach(u => opts.push([u.id, u.nome + (presentes.has(u.id) ? '' : ' (sem registro)')]));
    $('#ch-atrib').innerHTML = opts.map(([val, t]) => `<option value="${esc(val)}">${esc(t)}</option>`).join(''); $('#ch-atrib').value = opts.some(([val]) => val === atual) ? atual : 'todos';
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
    // o sino/badge conta sempre os obrigatórios de TODOS os alertas; a faixa de números segue os filtros
    const obrigGlobal = st.dados.filter(r => !r.respondido && r.qtd_linhas >= 10).length;
    host.dispatchEvent(new CustomEvent('churn-obrigatorios', { detail: obrigGlobal, bubbles: true }));
    const pend = linhas.filter(r => !r.respondido).length, obrig = linhas.filter(r => !r.respondido && r.qtd_linhas >= 10).length, filtrado = linhas.length !== st.dados.length;
    $('#ch-stats').innerHTML = [[fmtInt(linhas.length), filtrado ? `alertas (de ${fmtInt(st.dados.length)} no total)` : 'alertas no total'], [fmtInt(linhas.reduce((s, r) => s + (parseInt(r.qtd_linhas) || 0), 0)), filtrado ? 'linhas' : 'linhas no total'], [fmtInt(pend), 'pendentes'], [fmtInt(obrig), 'com resposta obrigatória (10+ linhas)']]
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
        <td><span class="q-sit ${r.respondido ? 'em_dia' : ''}">${r.respondido ? 'Respondido' : 'Pendente'}</span>${selo(r)}</td><td><button type="button" class="btn btn-fantasma" data-ver="${r.id}">Ver / Responder</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  }

  function abrirDetalhe(id) {
    const r = st.dados.find(x => x.id === id); if (!r) return;
    const d = dono(r);
    const campos = [['Nome do Cliente', r.nome_cliente], ['CNPJ', r.cnpj], ['Número de linhas', r.qtd_linhas], ['Cidade', r.municipio_cliente], ['UF', r.uf_cliente], ['Unidade', unidade(r)],
      ['Consultor (Carteira)', d?.consultor], ['Equipe (Carteira)', d?.equipe], ['Contato (Carteira)', d?.telefone], ['Nome do ADM (Carteira)', d?.nomeAdm], ['Receptora', r.receptora], ['Promoção Atual', r.promocao_atual],
      ['Classificação', r.classificacao], ['Tempo Médio', r.tempo_medio], ['Carteira AACE', r.carteira_aace], ['Gerente de Canal', r.gerente_canal], ['Coordenador', r.coordenador], ['Data da Janela', r.data_janela],
      ['Multa estimada', r.multa_estimada], ['Oferta de Retenção MKT', r.oferta_retencao_mkt], ['Oferta Pós', r.oferta_pos],
].filter(([, x]) => x !== null && x !== undefined && x !== '' && x !== '—');
    const ultimos = baseneoUltimosConsultores(st.baseneo, (r.cnpj || '').replace(/\D/g, ''));
    const ultimosHtml = ultimos.length ? `<div class="ch-form"><label>Últimos consultores que atenderam o cliente (baseneo)</label>${ultimos.map(h => `<div class="prod-dica"><b>${esc(h.consultor)}</b> — ${esc(h.equipe || 'sem equipe')} · ${esc(h.etapa || '—')}${h.ts ? ' · ' + new Date(h.ts).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : ''}</div>`).join('')}</div>` : '';
    const fbTravado = !!(r.feedback || '').trim();   // texto já enviado fica travado; o lápis destrava (só pra quem escreveu)
    const ov = document.createElement('div'); ov.className = 'modal-fundo';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Alerta de PORT-OUT"><header><h3>${esc(r.nome_cliente || '—')}</h3><button type="button" class="btn-icone" data-x aria-label="Fechar">${icone('close')}</button></header>
      <dl>${campos.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>${ultimosHtml}
      <div class="ch-form" id="ch-m-conversa"></div>
      <div class="ch-form">
        <label>Feedback / resposta pra Claro${fbTravado && r.feedback_por_nome ? ` <small style="text-transform:none;font-weight:400">por ${esc(r.feedback_por_nome)}</small>` : ''}<textarea id="ch-m-fb" rows="5" ${fbTravado ? 'readonly' : ''}>${esc(r.feedback || '')}</textarea></label>
        ${fbTravado && (!r.feedback_por || r.feedback_por === st.meuId) ? '<button type="button" class="btn btn-fantasma" id="ch-m-fb-lapis" title="Editar meu texto">✏️ Editar meu texto</button>' : ''}
        <div class="ch-form-pe"><label class="chip chip-chk"><input type="checkbox" id="ch-m-resp" ${r.respondido ? 'checked' : ''}><span>Marcar como respondido</span></label><button type="button" class="btn btn-marca" id="ch-m-salvar">Salvar</button></div><div class="txt-neg" id="ch-m-erro"></div></div></div>`;
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', tecla); }; const tecla = e => { if (e.key === 'Escape') fechar(); };
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) fechar(); }); document.addEventListener('keydown', tecla);
    ov.querySelector('#ch-m-salvar').addEventListener('click', async () => {
      const feedback = ov.querySelector('#ch-m-fb').value, respondido = ov.querySelector('#ch-m-resp').checked;
      const upd = { respondido, atualizado_em: new Date().toISOString() };
      // só registra autoria (e grava o texto) quando o texto mudou: marcar "respondido" não troca o autor
      if (feedback !== (r.feedback || '')) { upd.feedback = feedback; upd.feedback_por = st.meuId || null; upd.feedback_por_nome = st.usuarios.find(u => u.id === st.meuId)?.nome || null; }
      const { error } = await supa.from('churn_alertas').update(upd).eq('id', id);
      if (error) { ov.querySelector('#ch-m-erro').textContent = 'Erro ao salvar: ' + error.message; return; }
      Object.assign(r, upd); fechar(); atualizarOpcoes(); desenhar();
    });
    ov.querySelector('#ch-m-fb-lapis')?.addEventListener('click', e => { const ta = ov.querySelector('#ch-m-fb'); ta.readOnly = false; ta.focus(); e.currentTarget.remove(); });

    // ── gestores atribuídos, conversa única, devolver e lápis ──
    let msgs = [], pickerAberto = false;
    const post = async (action, corpo) => {
      const res = await fetch('/api/acessos?recurso=churn&action=' + action, { method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || 'Falha na operação');
      return j;
    };
    const erro = t => { ov.querySelector('#ch-m-erro').textContent = t; };
    const desenharConversa = () => {
      const alvo = ov.querySelector('#ch-m-conversa');
      const guardado = alvo.querySelector('#ch-m-dev')?.value || '';
      const d = destino(r);
      let lista = msgs;
      // alerta tratado antes da tabulação não tem histórico: mostra a resposta antiga como 1ª mensagem
      if (!lista.length && r.tratado_gestor && r.resposta_gestor) lista = [{ tipo: 'gestor', autor_nome: r.tratado_gestor_nome, texto: r.resposta_gestor, criado_em: r.tratado_gestor_em }];
      const atualIds = new Set((d?.d || []).map(x => x.u));
      const recebe = !d ? '<span class="prod-dica">Atribuição indisponível no momento.</span>'
        : !(d.d || []).length ? '<span class="txt-neg"><b>⚠ Sem gestor atribuído — escolha quem recebe.</b></span>'
        : d.d.map(x => { const [ic, cl] = ICONE[x.e] || ICONE.pendente; return `<span class="ch-chip-g ${cl}">${ic} ${esc(nomeU(x.u))}${x.s ? ' · ' + esc(x.s) + (x.m ? ' (' + esc(x.m) + ')' : '') : ''}</span>`; }).join(' ');
      const origem = d ? (d.o === 'manual' ? 'atribuição manual' : d.o === 'auto' ? 'automático, pela equipe do dono do cliente' : '') : '';
      const picker = pickerAberto ? `<div class="ch-picker"><input type="search" id="ch-m-busca" placeholder="Buscar gestor ou supervisor…" aria-label="Buscar gestor ou supervisor">
        <div class="ch-picker-lista">${st.painel.usuarios.map(u => `<label data-txt="${esc((u.nome + ' ' + u.perfil + ' ' + (u.visao || '')).toLowerCase())}"><input type="checkbox" name="ch-pick" value="${esc(u.id)}" ${atualIds.has(u.id) ? 'checked' : ''}><span><b>${esc(u.nome)}</b> <small>· ${esc(u.perfil)}${u.visao ? ' · ' + esc(u.visao) : ''}</small></span></label>`).join('')}</div>
        <div class="ch-form-pe"><span></span><span>${d && d.o === 'manual' ? '<button type="button" class="btn btn-fantasma" data-pick-auto title="Descarta a atribuição manual e volta pra regra por equipe">Voltar ao automático</button> ' : ''}<button type="button" class="btn btn-fantasma" data-pick-toggle>Cancelar</button> <button type="button" class="btn btn-marca" data-pick-salvar>Salvar atribuição</button></span></div></div>` : '';
      const corpo = lista.map(m => {
        const dev = m.tipo === 'devolucao', meu = dev && m.id && m.autor_id === st.meuId;
        return `<div class="ch-msg ${dev ? 'ch-msg-dev' : 'ch-msg-ges'}" data-msg="${m.id || ''}"><div class="ch-msg-topo"><b>${dev ? '↩ Devolvido por' : '✓ Tratado por'}</b> ${esc(m.autor_nome || '—')}${dev && m.destinatario_nome ? ` <span class="prod-dica">→ para ${esc(m.destinatario_nome)}</span>` : ''} · ${fmtDH(m.criado_em)}${m.editado_em ? ` · <em title="Editado em ${esc(fmtDH(m.editado_em))}">editado</em>` : ''}${meu ? `<button type="button" class="btn-icone ch-msg-lapis" data-edit="${m.id}" title="Editar minha mensagem" aria-label="Editar minha mensagem">✏️</button>` : ''}</div>
          ${!dev && (m.status || m.motivo) ? `<div class="ch-msg-tags">${[m.status, m.motivo].filter(Boolean).map(t => `<span class="q-sit">${esc(t)}</span>`).join(' ')}</div>` : ''}
          <div class="ch-msg-txt">${esc(m.texto || '')}</div></div>`;
      }).join('');
      // devolver: a UM gestor que já respondeu com tabulação
      const devolviveis = (d?.d || []).filter(x => x.e === 'tratado' && !x.l);
      const devolver = devolviveis.length ? `<label>Devolver ao gestor com uma pergunta<select id="ch-m-dev-dest">${devolviveis.map(x => `<option value="${esc(x.u)}">${esc(nomeU(x.u))}</option>`).join('')}</select><textarea id="ch-m-dev" rows="3" placeholder="O que você precisa que o gestor esclareça ou refaça?">${esc(guardado)}</textarea></label><div class="ch-form-pe"><span></span><button type="button" class="btn btn-fantasma" id="ch-m-devolver">↩ Devolver ao gestor</button></div>` : '';
      alvo.innerHTML = `<label>Gestores atribuídos ${origem ? `<small style="text-transform:none;font-weight:400">(${origem})</small>` : ''}<button type="button" class="btn btn-fantasma ch-atrib-btn" data-pick-toggle>✎ Atribuir / mover</button></label><div>${recebe}</div>${picker}${corpo ? `<label>Conversa</label>${corpo}` : ''}${devolver}`;
    };
    const depoisDeAtribuir = async () => { await carregarPainel(); pickerAberto = false; erro(''); desenharConversa(); atualizarOpcoes(); desenhar(); };
    ov.addEventListener('input', e => { if (e.target.id === 'ch-m-busca') { const q = e.target.value.trim().toLowerCase(); ov.querySelectorAll('.ch-picker-lista label').forEach(l => { l.style.display = !q || l.dataset.txt.includes(q) ? '' : 'none'; }); } });
    ov.addEventListener('click', async e => {
      if (e.target.closest('[data-pick-toggle]')) { pickerAberto = !pickerAberto; return desenharConversa(); }
      const salvarAtrib = async usuarios => { try { await post('atribuir', { id, usuarios }); await depoisDeAtribuir(); } catch (err) { erro('Não consegui atribuir: ' + err.message); } };
      if (e.target.closest('[data-pick-salvar]')) return salvarAtrib([...ov.querySelectorAll('input[name="ch-pick"]:checked')].map(i => i.value));
      if (e.target.closest('[data-pick-auto]')) return salvarAtrib([]);
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const tid = Number(ed.dataset.edit), m = msgs.find(x => x.id === tid), box = ov.querySelector(`[data-msg="${tid}"] .ch-msg-txt`);
        if (!m || !box) return;
        box.innerHTML = `<textarea rows="3" id="ch-m-edit-${tid}">${esc(m.texto || '')}</textarea><div class="ch-form-pe"><button type="button" class="btn btn-fantasma" data-edit-cancel>Cancelar</button><button type="button" class="btn btn-marca" data-edit-ok="${tid}">Salvar</button></div>`;
        return;
      }
      if (e.target.closest('[data-edit-cancel]')) return desenharConversa();
      const ok = e.target.closest('[data-edit-ok]');
      if (ok) {
        const tid = Number(ok.dataset.editOk), texto = (ov.querySelector(`#ch-m-edit-${tid}`)?.value || '').trim();
        if (texto.length < 3) return erro('Escreva o texto.');
        ok.disabled = true;
        try { const j = await post('editar', { tratativa_id: tid, texto }); Object.assign(msgs.find(x => x.id === tid), j.mensagem); erro(''); desenharConversa(); }
        catch (err) { ok.disabled = false; erro('Não consegui salvar: ' + err.message); }
        return;
      }
      if (e.target.closest('#ch-m-devolver')) {
        const btn = e.target.closest('#ch-m-devolver'), texto = (ov.querySelector('#ch-m-dev')?.value || '').trim(), dest = ov.querySelector('#ch-m-dev-dest')?.value || '';
        if (!dest) return erro('Escolha o gestor.');
        if (texto.length < 3) return erro('Escreva a pergunta para o gestor.');
        btn.disabled = true;
        try { const j = await post('devolver', { id, destinatario_id: dest, texto }); msgs.push({ ...j.mensagem, autor_id: st.meuId }); ov.querySelector('#ch-m-dev').value = ''; await depoisDeAtribuir(); }
        catch (err) { btn.disabled = false; erro('Não consegui devolver: ' + err.message); }
      }
    });
    desenharConversa();
    supa.from('churn_tratativas').select('*').eq('alerta_id', id).order('criado_em', { ascending: true }).then(({ data, error }) => {
      if (error) return erro('Não consegui ler a conversa: ' + error.message);
      msgs = data || []; desenharConversa();
    });
    document.body.append(ov);
  }


  // ── Relatório das tratativas: por cliente, a demanda, a tabulação de cada gestor e o retorno final pra Claro ──
  // Filtra por data (um dia ou intervalo); sai pra copiar (texto com formatação do WhatsApp) ou imprimir (visual).
  const diaLocal = d => d.toLocaleDateString('sv-SE');
  function diaDoAlerta(r, campo) {
    if (campo === 'janela') {
      const t = (r.data_janela || '').toString().trim();
      let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    }
    const d = r.recebido_em ? new Date(r.recebido_em) : null;
    return d && !isNaN(d) ? diaLocal(d) : '';
  }
  const fmtDia = iso => { const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || ''); };
  const fmtCnpj = c => { const d = String(c || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (c || '—'); };

  function abrirRelatorio() {
    const hoje = new Date(), ini = new Date(Date.now() - 6 * 86400000);
    const ov = document.createElement('div'); ov.className = 'modal-fundo';
    ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="Relatório das tratativas de churn" style="max-width:820px"><header><h3>Relatório das tratativas de churn</h3><button type="button" class="btn-icone" data-x aria-label="Fechar">${icone('close')}</button></header>
      <div class="ch-form"><div class="ch-rel-ctl">
        <label>Data de<select id="cr-campo"><option value="recebido">Recebimento do alerta</option><option value="janela">Janela de portabilidade</option></select></label>
        <label>De<input type="date" id="cr-de" value="${diaLocal(ini)}"></label>
        <label>Até (vazio = só o dia "De")<input type="date" id="cr-ate" value="${diaLocal(hoje)}"></label>
        <button type="button" class="btn btn-marca" id="cr-gerar">Gerar relatório</button></div>
        <div class="ch-rel-ctl"><label class="chip chip-chk"><input type="checkbox" id="cr-pend" checked><span>Incluir alertas ainda sem retorno pra Claro</span></label>
          <label class="chip chip-chk"><input type="checkbox" id="cr-txt"><span>Incluir o texto da tratativa de cada gestor</span></label></div>
        <div id="cr-saida"></div></div></div>`;
    let rel = null;
    const fechar = () => { ov.remove(); document.removeEventListener('keydown', tecla); }; const tecla = e => { if (e.key === 'Escape') fechar(); };
    ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) fechar(); }); document.addEventListener('keydown', tecla);
    const saida = ov.querySelector('#cr-saida');

    ov.querySelector('#cr-gerar').addEventListener('click', async () => {
      const campo = ov.querySelector('#cr-campo').value, de = ov.querySelector('#cr-de').value, ate = ov.querySelector('#cr-ate').value || de;
      const comPend = ov.querySelector('#cr-pend').checked, comTxt = ov.querySelector('#cr-txt').checked;
      if (!de) { saida.innerHTML = '<div class="txt-neg">Escolha a data.</div>'; return; }
      if (ate < de) { saida.innerHTML = '<div class="txt-neg">A data final é anterior à inicial.</div>'; return; }
      saida.innerHTML = '<div class="vazio"><span class="spinner"></span> Gerando…</div>';
      const alertas = st.dados.filter(r => { const dia = diaDoAlerta(r, campo); return dia && dia >= de && dia <= ate; })
        .filter(r => comPend || (r.feedback || '').trim() || r.respondido)
        .sort((a, b) => diaDoAlerta(a, campo).localeCompare(diaDoAlerta(b, campo)) || (a.nome_cliente || '').localeCompare(b.nome_cliente || '', 'pt-BR'));
      const textos = {};
      if (comTxt && alertas.length) {
        const ids = alertas.map(a => a.id);
        for (let i = 0; i < ids.length; i += 150) {
          const { data } = await supa.from('churn_tratativas').select('alerta_id,tipo,autor_id,texto,criado_em').eq('tipo', 'gestor').in('alerta_id', ids.slice(i, i + 150)).order('criado_em', { ascending: true });
          (data || []).forEach(m => { (textos[m.alerta_id] = textos[m.alerta_id] || {})[m.autor_id] = m; });
        }
      }
      const itens = alertas.map(r => ({
        r, d: dono(r), un: unidade(r), retorno: (r.feedback || '').trim(),
        gestores: (destino(r)?.d || []).map(x => ({ nome: nomeU(x.u), estado: x.e, status: x.s, motivo: x.m, texto: textos[r.id]?.[x.u]?.texto || '' })),
      }));
      const porStatus = {}; itens.forEach(it => it.gestores.forEach(g => { if (g.status) porStatus[g.status] = (porStatus[g.status] || 0) + 1; }));
      const periodo = de === ate ? fmtDia(de) : `${fmtDia(de)} a ${fmtDia(ate)}`, quem = campo === 'janela' ? 'janela' : 'recebimento';
      const comRet = itens.filter(it => it.retorno).length;
      const resumo = Object.entries(porStatus).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(' | ');

      const L = [`*RELATÓRIO DE CHURN — ${periodo}*`, `(${quem}) · ${itens.length} alerta(s) · ${comRet} com retorno pra Claro · ${itens.length - comRet} sem retorno`];
      if (resumo) L.push(`Tabulação: ${resumo}`);
      itens.forEach((it, i) => {
        const r = it.r;
        L.push('', `*${i + 1}) ${r.nome_cliente || '—'}* — CNPJ ${fmtCnpj(r.cnpj)}`, `• ${r.qtd_linhas ?? '—'} linha(s) · ${r.receptora || '—'} · Janela: ${r.data_janela || '—'} · Recebido: ${fmtDia(diaDoAlerta(r, 'recebido'))}`);
        const org = [it.un && it.un !== '—' ? it.un : '', it.d?.equipe ? 'Equipe ' + it.d.equipe : '', it.d?.consultor ? 'Consultor ' + it.d.consultor : ''].filter(Boolean).join(' · ');
        if (org) L.push(`• ${org}`);
        if (!it.gestores.length) L.push('• Gestor: sem gestor atribuído');
        it.gestores.forEach(g => { const tab = g.status ? `${g.status}${g.motivo ? ' (' + g.motivo + ')' : ''}` : (g.estado === 'devolvido' ? 'devolvido, aguardando réplica' : 'pendente'); L.push(`• ${g.nome}: ${tab}${g.texto ? ' — ' + g.texto.replace(/\s+/g, ' ') : ''}`); });
        L.push(`• *Retorno pra Claro:* ${it.retorno ? it.retorno.replace(/\s+/g, ' ') : 'ainda sem retorno'}`);
      });
      const cartoes = itens.map((it, i) => {
        const r = it.r;
        const gest = it.gestores.length ? it.gestores.map(g => {
          const cor = g.estado === 'tratado' ? '#15803d' : g.estado === 'devolvido' ? '#b45309' : '#64748b';
          const tab = g.status ? `${esc(g.status)}${g.motivo ? ' · ' + esc(g.motivo) : ''}` : (g.estado === 'devolvido' ? 'devolvido — aguardando réplica' : 'pendente');
          return `<div style="margin-top:2px"><b>${esc(g.nome)}</b>: <span style="color:${cor};font-weight:700">${tab}</span>${g.texto ? `<div style="color:#444;margin:1px 0 0 10px">${esc(g.texto)}</div>` : ''}</div>`;
        }).join('') : '<div style="margin-top:2px;color:#b91c1c;font-weight:700">Sem gestor atribuído</div>';
        return `<div style="border:1px solid #d4d4d8;border-radius:8px;padding:10px 12px;margin-top:8px;page-break-inside:avoid">
          <div style="font-weight:800;font-size:14px">${i + 1}) ${esc(r.nome_cliente || '—')} <span style="font-weight:400;color:#555;font-size:12px">CNPJ ${esc(fmtCnpj(r.cnpj))}</span></div>
          <div style="font-size:12px;color:#444;margin-top:2px">${r.qtd_linhas ?? '—'} linha(s) · ${esc(r.receptora || '—')} · Janela: ${esc(r.data_janela || '—')} · Recebido: ${esc(fmtDia(diaDoAlerta(r, 'recebido')))}${it.d?.equipe ? ' · Equipe ' + esc(it.d.equipe) : ''}${it.d?.consultor ? ' · Consultor ' + esc(it.d.consultor) : ''}</div>
          <div style="font-size:13px;margin-top:4px">${gest}</div>
          <div style="margin-top:6px;padding:6px 8px;border-radius:6px;font-size:13px;background:${it.retorno ? '#eff6ff' : '#fef2f2'}"><b>Retorno pra Claro:</b> ${it.retorno ? esc(it.retorno) : '<span style="color:#b91c1c">ainda sem retorno</span>'}</div></div>`;
      }).join('');
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#111"><div style="font-size:16px;font-weight:800">Relatório de churn — ${esc(periodo)}</div>
        <div style="font-size:12px;color:#444;margin-top:2px">Por ${quem} · ${itens.length} alerta(s) · ${comRet} com retorno pra Claro · ${itens.length - comRet} sem retorno${resumo ? '<br>Tabulação: ' + esc(resumo) : ''}</div>
        ${cartoes || '<div style="margin-top:10px;color:#555">Nenhum alerta no período.</div>'}</div>`;
      rel = { texto: L.join('\n'), html };
      saida.innerHTML = `<div class="ch-form-pe"><span></span><span><button type="button" class="btn btn-marca" id="cr-copiar">📋 Copiar texto (WhatsApp)</button> <button type="button" class="btn btn-fantasma" id="cr-imprimir">🖨 Imprimir / salvar PDF</button></span></div><div style="border:1px solid var(--borda);border-radius:var(--r-md);padding:14px;background:#fff">${html}</div>`;
    });
    ov.addEventListener('click', async e => {
      if (e.target.closest('#cr-copiar') && rel) {
        const btn = e.target.closest('#cr-copiar'); let ok = false;
        try { await navigator.clipboard.writeText(rel.texto); ok = true; }
        catch (err) { const ta = document.createElement('textarea'); ta.value = rel.texto; ta.style.cssText = 'position:fixed;left:-9999px'; document.body.append(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (e2) { /* sem cópia */ } ta.remove(); }
        const t = btn.textContent; btn.textContent = ok ? '✓ Copiado!' : 'Não consegui copiar'; setTimeout(() => { btn.textContent = t; }, 2000);
      }
      if (e.target.closest('#cr-imprimir') && rel) {
        const w = window.open('', '_blank');
        if (!w) { saida.insertAdjacentHTML('afterbegin', '<div class="txt-neg">O navegador bloqueou a janela de impressão. Libere pop-ups para este site.</div>'); return; }
        w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Relatório de churn</title><style>@page{margin:14mm}body{margin:0;padding:8px}</style></head><body>${rel.html}</body></html>`);
        w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
      }
    });
    document.body.append(ov);
  }

  async function carregar() {
    const eu = ++st.req;
    $('#ch-tabela').innerHTML = '<div class="vazio"><span class="spinner"></span> Carregando alertas…</div>';
    const { data: usuarios } = await supa.from('usuarios_dashboard').select('id,nome').eq('ativo', true).order('nome');
    st.usuarios = usuarios || [];
    try { st.meuId = (await supa.auth.getSession()).data?.session?.user?.id || null; } catch (e) { st.meuId = null; }
    // o Supabase entrega no máximo 1000 linhas por chamada: lê em páginas
    let data = [], error = null;
    for (let off = 0; ; off += 1000) {
      const pag = await supa.from('churn_alertas').select('*').order('recebido_em', { ascending: false }).order('id', { ascending: false }).range(off, off + 999);
      if (pag.error) { error = pag.error; break; }
      data = data.concat(pag.data || []);
      if ((pag.data || []).length < 1000) break;
    }
    if (error) { $('#ch-tabela').innerHTML = `<div class="alerta alerta-erro"><b>Erro ao carregar alertas</b> ${esc(error.message)}</div>`; return; }
    st.dados = data;
    await carregarPainel();
    // cruza com a Carteira (base padrão = mês atual ou a mais recente); se falhar, segue sem consultor/equipe
    try {
      const bases = await C.listarBases(), padrao = C.escolherBasePadrao(bases);
      if (padrao) { const dados = await C.baixarBase(padrao.titulo); st.mapaCnpj = new Map(); dados.forEach(r => { const dig = (r['CNPJ'] || '').replace(/\D/g, ''); if (dig) st.mapaCnpj.set(dig, r); }); }
    } catch (e) { console.warn('Não consegui cruzar o Churn com a Carteira:', e.message); }
    // aba 'baseneo' (reserva quando a aba do mês não traz consultor/equipe); best-effort como a Carteira
    try { st.baseneo = await carregarBaseNeo(); } catch (e) { console.warn('Não consegui ler a aba baseneo:', e.message); }
    if (eu !== st.req) return;
    atualizarOpcoes(); desenhar();
  }

  host.addEventListener('click', e => {
    const o = e.target.closest('[data-ord]'); if (o) { const k = o.dataset.ord; st.sortAsc = st.sortCol === k ? !st.sortAsc : false; st.sortCol = k; return desenhar(); }
    const v = e.target.closest('[data-ver]'); if (v) abrirDetalhe(Number(v.dataset.ver));
    if (e.target.closest('#ch-relatorio')) abrirRelatorio();
  });
  host.addEventListener('change', e => { if (e.target.matches('#ch-status, #ch-linhas, #ch-atrib, #ch-gestor')) aoFiltrar(); });

  return {
    mostrar() { if (!st.iniciou) { st.iniciou = true; carregar(); } },
    // "sino": alertas pendentes com resposta obrigatória (10+ linhas), consulta leve independente da aba
    async contarObrigatorios() { const { count } = await supa.from('churn_alertas').select('id', { count: 'exact', head: true }).eq('respondido', false).gte('qtd_linhas', 10); return count || 0; },
    // abre já em "pendentes + 10+" (clique no sino/badge)
    filtrarObrigatorios() { $('#ch-status').value = 'pendentes'; $('#ch-linhas').value = '10+'; if (st.iniciou) aoFiltrar(); },
  };
}
