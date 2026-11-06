// Visão "Simulador 2.0" do Beta2 = a aba principal do Simulador 2.0 do Dash atual (index.html 2228-2463 e
// 8296-10930). A sub-aba "Simulador de Carteira" NÃO foi migrada (decisão do Raphael, 06/11/2026).
//
// As contas ficam em simulador2-calculo.js (porte literal, conferido contra o Dash atual). Esta tela só lê/escreve
// os campos e desenha. Persistência = a MESMA tabela do Dash atual (config_simulador2: periodo, chave, valor),
// com as mesmas chaves e o mesmo formato, pelo cliente Supabase com a sessão do usuário (o RLS decide).
//   • competência = o seletor de Período do topo (nunca escolhida aqui);
//   • "Salvar competência" faz upsert (onConflict periodo,chave); troca de período salva antes se houver edição pendente;
//   • fechar/recarregar com edição pendente: fetch keepalive igual ao do Dash atual (beforeunload, index.html 8136-8155).

import { supa } from './sessao.js';
import { SUPA_URL, SUPA_KEY } from './config.js';
import { esc } from './ui.js';
import { S2_DEFAULTS, RAMPA_PRODUTIVIDADE, s2fmt } from './politica-sim.js';
import { S2_METAS_TRIMESTRE } from './politica.js';
import { CODIGOS_AACE2, s2Sid, num, s2PuxarDados, s2Calcular } from './simulador2-calculo.js';

const ehAdminLike = p => p === 'admin' || p === 'admin_gestao';                     // index.html 4131
const L = x => x.toLocaleString('pt-BR');
const S2_MESES_LABEL = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const VISOES = [['ativo', 'Ativo'], ['ativacao', '+ Ativação'], ['aprovados', '+ Aprovados'], ['geral', 'Geral']];
const LISTA_SELECTS = { 'tabela-cnpjhc': ['transicao', 'definitiva'], categoria: ['bronze', 'prata', 'ouro', 'safira', 'diamante'], cluster: ['P', 'M', 'G'] };

// estado novo de uma competência (index.html resetarCamposSimulador2 + S2_DEFAULTS)
function estadoPadrao() {
  const v = { ...S2_DEFAULTS };
  CODIGOS_AACE2.forEach(({ tag }) => { const sid = s2Sid(tag); v['cart-linhas-' + sid] = 0; v['cart-netadds-' + sid] = 0; });
  RAMPA_PRODUTIVIDADE.forEach((r, i) => { v['rampa-disp-' + i] = 0; });
  return v;
}

// ctx() => { perfil, periodoS2(), rows(), monitorDup(), irParaPeriodo(periodoS2) -> boolean }
export function criarSimulador2(host, ctx) {
  const st = { montado: false, v: estadoPadrao(), periodo: null, sujo: false, visao: 'ativo', sheet: null, rowsRef: null, trocando: null, resultado: null, historico: [] };
  const $ = s => host.querySelector(s);
  const out = (k, txt) => { const el = host.querySelector(`[data-o="${k}"]`); if (el) el.textContent = txt; };
  let token = null;                                                // token da sessão p/ o salvamento ao fechar a página
  supa.auth.onAuthStateChange((ev, sess) => { token = sess?.access_token || null; });
  supa.auth.getSession().then(r => { token = token || r?.data?.session?.access_token || null; }).catch(() => {});

  // ── casca ──────────────────────────────────────────────────────────────────
  function montar() {
    const campo = (k, rot, extra = '') => `<label class="sm-campo"><span>${rot}</span><input type="number" data-k="${k}" ${extra}></label>`;
    host.innerHTML = `
      <div class="sm-pagina">
      <div id="sm-msg"></div>
      <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2>Parâmetros do período</h2>
        <p>Categoria do parceiro e tabela de CNPJ/HC vigente alimentam o cálculo de todas as seções. A competência simulada é sempre a do seletor de Período no topo — tudo que você salva aqui fica gravado nela.</p></div></header>
        <div class="painel-corpo"><div class="sm-grade">
          <label class="sm-campo"><span>Competência (via Período, no topo)</span><input type="text" id="sm-comp" readonly></label>
          <label class="sm-campo"><span>Tabela CNPJ / HC vigente</span><select data-k="tabela-cnpjhc">
            <option value="transicao">Transição (jun–ago/26) — faixas ≤400/500/599/600</option>
            <option value="definitiva">Definitiva (a partir de set/26) — faixas ≤200/300/399/400</option></select>
            <small class="sm-dica">Item 2.6.7: os 3 primeiros fechamentos (jun, jul, ago/26) usam faixas mais largas; de set/26 vale a definitiva. Selecione conforme a competência.</small></label>
          <label class="sm-campo"><span>Categoria do parceiro</span><select data-k="categoria">
            <option value="bronze">Bronze</option><option value="prata">Prata</option><option value="ouro">Ouro</option><option value="safira">Safira</option><option value="diamante">Diamante</option></select>
            <small class="sm-dica">Categoria mensal apurada pela Claro (item 2.5). Define o % de bônus categoria, o unitário de Net Adds negativo e o % de liberação do teto.</small></label>
        </div></div></section>

      <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2><span class="sm-num">01</span> Recebimento de carteira por unidade</h2>
        <p>A Comissão de Ativação vem do BaseCRM do período. Linhas da Carteira e Net Adds são digitados por unidade — a Claro reporta esses números no demonstrativo próprio (item 2.6.1-vii), eles não estão na planilha.</p></div></header>
        <div class="painel-corpo">
          <div class="sm-grade">
            <div class="sm-campo"><span>Escopo — Comissão de Ativação (fonte: BaseCRM)</span>
              <div class="seg" id="sm-visoes" role="group" aria-label="Escopo">${VISOES.map(([k, r]) => `<button type="button" class="seg-btn${k === 'ativo' ? ' ativo' : ''}" data-visao="${k}">${r}</button>`).join('')}</div>
              <small class="sm-dica">Define quais filas do BaseCRM entram na contagem de linhas ativadas no mês. Atualiza ao trocar o escopo ou clicar em Atualizar.</small></div>
            <label class="sm-campo"><span>Cluster atingido (Elite, dentro da área — Tabela 1)</span><select data-k="cluster"><option value="P">Cluster "P"</option><option value="M">Cluster "M"</option><option value="G">Cluster "G"</option></select>
              <small class="sm-dica">Define os 3 fatores fixos da Tabela 1 (modalidade Elite, dentro da área de atuação).</small></label>
            <div class="sm-campo"><span>Fator VIRTUA (Fixa Básica) · VOZ Novo · VOZ Portab. (R$/linha)</span>
              <div class="sm-trio"><output data-o="f-virtua">—</output><output data-o="f-voznovo">—</output><output data-o="f-vozport">—</output></div>
              <small class="sm-dica">Preenchidos pelo Cluster (fixo + adicional por meta). "Voz Portab." já inclui o Plugin de Portabilidade (+R$ 1,50/linha, item 2.2-v).</small></div>
            <div class="sm-campo"><span>Total CNPJs · Total HCs</span>
              <div class="sm-trio sm-duo"><input type="number" data-k="total-cnpjs" min="0" aria-label="Total de CNPJs na carteira" title="Total de CNPJs na carteira"><input type="number" data-k="total-hcs" min="1" aria-label="Total de HCs ativos declarados" title="Total de HCs ativos declarados"></div>
              <small class="sm-dica">CNPJ/HC: <b data-o="cnpjhc">—</b> · Faixa: <b data-o="faixa">—</b></small></div>
          </div>
          <div class="sm-grade sm-sep">
            <label class="sm-campo"><span>Meta trimestral — Móvel Voz (linhas)</span><input type="number" data-k="meta-movel-voz" min="0" step="0.1">
              <small class="sm-dica">Realizado: <b data-o="real-mv">0</b> linhas (VOZ Novo + Portabilidade) · <b data-o="pct-mv">0%</b> atingido · <b data-o="faixa-mv">Faixa 0</b></small></label>
            <label class="sm-campo"><span>Meta trimestral — Fixa Básica Banda Larga (linhas)</span><input type="number" data-k="meta-fixa-bl" min="0" step="0.1">
              <small class="sm-dica">Realizado: <b data-o="real-bl">0</b> linhas (VIRTUA) · <b data-o="pct-bl">0%</b> atingido · <b data-o="faixa-bl">Faixa 0</b></small></label>
            <div class="sm-campo sm-largo"><small class="sm-dica">Item 2.3: acima de 100% da meta trimestral (informada mês a mês pela Claro) o AACE ganha um <b>fator adicional</b> por faixa de atingimento e cluster, somado ao fator fixo — já embutido nos 3 fatores acima. Abaixo de 100% vale só o fixo.</small></div>
          </div>
          <div class="kpis sm-kpis">${[
            ['bruto', 'Dinheiro da Carteira', ''], ['rec', 'Carteira Recebida', 'txt-pos'], ['nr', 'Carteira Não Recebida', 'txt-neg'], ['mesa', 'Deixado na Mesa', 'sm-ambar'],
            ['lv', 'Linhas Ativas — Voz', ''], ['lb', 'Linhas Ativas — Virtua', ''], ['at', 'Comissão de Ativação (total)', ''], ['teto', 'Teto de Carteira (total)', ''],
          ].map(([k, r, c]) => `<article class="kpi"><div class="kpi-rot">${r}</div><div class="kpi-val ${c}" data-o="k-${k}">—</div><div class="kpi-pe"><span class="kpi-nota" data-o="k-${k}-s"></span></div></article>`).join('')}</div>
          <div class="tab-wrap sm-tab" style="margin-top:var(--e4)"><table class="tab sm-tabela" id="sm-tab-rec"><thead>
            <tr><th rowspan="2">Unidade</th><th colspan="3" class="sm-g">Comissão de Ativação</th><th colspan="3" class="sm-g">Linhas</th><th colspan="4" class="sm-g">Carteira (R$/linha variável — política 2.6.4)</th><th colspan="2" class="sm-g">Dinheiro Não Recebido</th></tr>
            <tr><th>Comissão</th><th>% Teto</th><th>Teto (R$)</th><th>Potencial</th><th>Carteira</th><th>Net Adds</th><th>Unitário</th><th>Lin. Recebidas</th><th>Din. Carteira</th><th>Cart. Recebida</th><th>Cart. Não Recebida</th><th>Deixado na Mesa</th></tr></thead>
            <tbody>${CODIGOS_AACE2.map(({ tag, nome }) => { const sid = s2Sid(tag); return `<tr>
              <td data-l="Unidade"><b>${esc(nome)}</b></td><td class="num" data-l="Comissão" data-o="u-at-${sid}">—</td><td class="num" data-l="% Teto" data-o="u-tp-${sid}">—</td><td class="num" data-l="Teto (R$)" data-o="u-te-${sid}">—</td>
              <td class="num" data-l="Potencial" data-o="u-po-${sid}">—</td>
              <td data-l="Carteira (linhas)"><input type="number" min="0" class="sm-in" data-k="cart-linhas-${sid}" aria-label="Linhas da carteira — ${esc(nome)}"></td>
              <td data-l="Net Adds"><input type="number" class="sm-in" data-k="cart-netadds-${sid}" aria-label="Net Adds — ${esc(nome)}"></td>
              <td class="num" data-l="Unitário" data-o="u-un-${sid}">—</td><td class="num" data-l="Lin. Recebidas" data-o="u-lr-${sid}">—</td><td class="num" data-l="Din. Carteira" data-o="u-br-${sid}">—</td>
              <td class="num" data-l="Cart. Recebida" data-o="u-rc-${sid}">—</td><td class="num" data-l="Cart. Não Recebida" data-o="u-nr-${sid}">—</td><td class="num" data-l="Deixado na Mesa" data-o="u-me-${sid}">—</td></tr>`; }).join('')}</tbody>
            <tfoot><tr><td data-l="">TOTAL GERAL</td><td class="num" data-l="Comissão" data-o="t-at">—</td><td class="num" data-l="% Teto" data-o="t-tp">—</td><td class="num" data-l="Teto (R$)" data-o="t-te">—</td><td class="num" data-l="Potencial" data-o="t-po">—</td><td class="num" data-l="Carteira" data-o="t-cl">—</td><td></td><td></td>
              <td class="num" data-l="Lin. Recebidas" data-o="t-lr">—</td><td class="num" data-l="Din. Carteira" data-o="t-br">—</td><td class="num" data-l="Cart. Recebida" data-o="t-rc">—</td><td class="num" data-l="Cart. Não Recebida" data-o="t-nr">—</td><td class="num" data-l="Deixado na Mesa" data-o="t-me">—</td></tr></tfoot></table></div>
          <p class="sm-dica">Potencial = Teto ÷ Unitário. Linhas Recebidas = MIN(Potencial, Carteira). Cart. Não Recebida = Potencial &lt; Carteira (faturou pouco, precisa de mais comissão de ativação). Deixado na Mesa = Potencial &gt; Carteira (teto sobra). Net Adds positivo usa o unitário da Faixa CNPJ/HC; negativo, o unitário fixo da Categoria (2.6.4). Teto = Comissão de Ativação × % de liberação (Categoria × Faixa, 2.6.5).</p>
        </div></section>

      <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2><span class="sm-num">04</span> Bônus Produtividade</h2>
        <p>Exclusivo para modalidade Elite, mínimo de 4 vendedores (item 2.7). Informe quantos HCs você TEM em cada estágio da rampa (0/25/25/50/75/100% do 1º ao 6º mês+) — "Sugestão a Declarar" calcula quantos declarar em cada estágio para maximizar o total de HCs sem cair abaixo de 100% em Voz e BL. O 1º mês (0% de meta) é "grátis".</p></div></header>
        <div class="painel-corpo">
          <div class="sm-grade">
            ${campo('meta-voz', 'Meta p/ ativar 1 HC — Voz (linhas)', 'min="0" step="1"')}
            ${campo('meta-bl', 'Meta p/ ativar 1 HC — BL (linhas)', 'min="0" step="1"')}
            ${campo('meta-sd', 'Meta p/ ativar 1 HC — Solução Digital (R$)', 'min="0" step="1"')}
            <div class="sm-campo"><span>Receita SD realizada no mês (R$)</span><output data-o="real-sd">—</output><small class="sm-dica">Somada automaticamente do BaseCRM (Serviços Digitais), no escopo da seção 01 — não editável.</small></div>
          </div>
          <div class="kpis sm-kpis3" style="margin-top:var(--e4)">
            <article class="kpi"><div class="kpi-rot">Capacidade máx. — Voz (em HC 100%)</div><div class="kpi-val" data-o="cap-voz">0</div><div class="kpi-pe"><span class="kpi-nota" data-o="cap-voz-s"></span></div></article>
            <article class="kpi"><div class="kpi-rot">Capacidade máx. — BL (em HC 100%)</div><div class="kpi-val" data-o="cap-bl">0</div><div class="kpi-pe"><span class="kpi-nota" data-o="cap-bl-s"></span></div></article>
            <article class="kpi"><div class="kpi-rot">HCs disponíveis × Sugeridos p/ declarar</div><div class="kpi-val" data-o="cap-heads">0 / 0</div></article>
          </div>
          <p class="sm-dica">"Em HC 100%" = quantos HCs a produção sustentaria SE todos estivessem no último estágio da rampa — é uma unidade de referência para achar o gargalo, não uma contagem real de cabeças.</p>
          <div class="tab-wrap sm-tab sm-rampa"><table class="tab sm-tabela"><thead><tr><th>Estágio (meses de casa)</th><th class="num">% meta exigida</th><th>Disponível (tenho)</th><th class="num">Sugestão a Declarar</th></tr></thead>
            <tbody>${RAMPA_PRODUTIVIDADE.map((r, i) => `<tr><td data-l="Estágio">${esc(r.label)}</td><td class="num" data-l="% meta">${(r.pct * 100).toFixed(0)}%</td>
              <td data-l="Disponível"><input type="number" min="0" class="sm-in" data-k="rampa-disp-${i}" aria-label="HCs disponíveis — ${esc(r.label)}"></td><td class="num sm-verde" data-l="Sugestão" data-o="sug-${i}">0</td></tr>`).join('')}</tbody>
            <tfoot><tr><td>Total</td><td></td><td class="num" data-o="rampa-disp">0</td><td class="num" data-o="rampa-sug">0</td></tr></tfoot></table></div>
          <div class="kpis sm-kpis3" style="margin-top:var(--e4)">
            <article class="kpi"><div class="kpi-rot">Móvel Voz — Realizado / Meta ponderada</div><div class="kpi-val" data-o="pm-num">0 / 0</div><div class="kpi-pe"><span class="kpi-nota"><b data-o="pm-pct">0%</b> atingido · Meta máx. se declarar TODOS: <b data-o="pm-max">0</b></span></div></article>
            <article class="kpi"><div class="kpi-rot">Fixa Básica BL — Realizado / Meta ponderada</div><div class="kpi-val" data-o="pf-num">0 / 0</div><div class="kpi-pe"><span class="kpi-nota"><b data-o="pf-pct">0%</b> atingido · Meta máx. se declarar TODOS: <b data-o="pf-max">0</b></span></div></article>
            <article class="kpi"><div class="kpi-rot">Solução Digital — Realizado / Meta ponderada</div><div class="kpi-val" data-o="ps-num">R$ 0 / R$ 0</div><div class="kpi-pe"><span class="kpi-nota"><b data-o="ps-pct">0%</b> atingido · Meta máx. se declarar TODOS: <b data-o="ps-max">R$ 0</b> — se &lt;100% retroage 1 faixa (2.7-iii-6)</span></div></article>
          </div>
          <div class="kpis" style="margin-top:var(--e4)">
            <article class="kpi"><div class="kpi-rot">Trava dupla performance (mín. 60%)</div><div class="kpi-val" data-o="trava">—</div></article>
            <article class="kpi"><div class="kpi-rot">Faixa apurada (menor entre Móvel/Fixa)</div><div class="kpi-val" data-o="faixa-base">—</div></article>
            <article class="kpi"><div class="kpi-rot">Faixa final (após SD)</div><div class="kpi-val" data-o="faixa-final">—</div></article>
            <article class="kpi"><div class="kpi-rot">Bônus Produtividade total</div><div class="kpi-val txt-pos" data-o="prod-total">R$ 0,00</div></article>
          </div>
        </div></section>

      <section class="painel"><header class="painel-cab"><div class="painel-tit"><h2><span class="sm-num">05</span> Bônus Categoria</h2>
        <p>A partir de Prata, o parceiro recebe um % sobre o faturamento de comissão de ativação (soma da seção 01), conforme a categoria dos Parâmetros do período (item 2.5.5).</p></div></header>
        <div class="painel-corpo"><div class="kpis">
          <article class="kpi"><div class="kpi-rot">Categoria selecionada</div><div class="kpi-val" data-o="cat-nome">—</div></article>
          <article class="kpi"><div class="kpi-rot">% Bônus Categoria</div><div class="kpi-val" data-o="cat-pct">0%</div></article>
          <article class="kpi"><div class="kpi-rot">Base de cálculo (comissão ativação)</div><div class="kpi-val" data-o="cat-base">R$ 0,00</div></article>
          <article class="kpi"><div class="kpi-rot">Bônus Categoria total</div><div class="kpi-val txt-pos" data-o="cat-total">R$ 0,00</div></article>
        </div></div></section>

      <section class="painel"><div class="painel-corpo sm-total-corpo">
        <div class="sm-total"><span>TOTAL GERAL DA COMPETÊNCIA <small>(Ativação + Carteira + Produtividade + Categoria)</small></span><strong data-o="total">R$ 0,00</strong></div>
        <div class="sm-acoes">
          <button type="button" class="btn btn-marca" id="sm-salvar">Salvar competência</button>
          <button type="button" class="btn" id="sm-exportar">Exportar CSV</button>
          <label class="chip chip-sel"><span>Histórico</span><select id="sm-historico" aria-label="Histórico de competências"><option value="">Ver competências salvas…</option></select></label>
        </div></div></section>
      </div>`;
    st.montado = true;
    host.addEventListener('input', aoEditar);
    host.addEventListener('change', aoEditar);
    $('#sm-visoes').addEventListener('click', e => { const b = e.target.closest('[data-visao]'); if (b) trocarVisao(b.dataset.visao); });
    $('#sm-salvar').addEventListener('click', () => salvar(false));
    $('#sm-exportar').addEventListener('click', exportarCsv);
    $('#sm-historico').addEventListener('change', e => { const p = e.target.value; e.target.value = ''; if (p) abrirHistorico(p); });
  }

  const msg = (t, erro) => { const el = $('#sm-msg'); if (el) el.innerHTML = t ? `<div class="alerta ${erro ? 'alerta-erro' : 'alerta-info'}">${esc(t)}</div>` : ''; };

  // ── estado ↔ campos ───────────────────────────────────────────────────────
  function aoEditar(e) {
    const el = e.target.closest('[data-k]'); if (!el) return;
    st.v[el.dataset.k] = el.value;
    st.sujo = true;                       // marcarSimulador2Sujo()
    atualizar();
  }
  function pintarCampos() {
    host.querySelectorAll('[data-k]').forEach(el => { const k = el.dataset.k; if (k in st.v) el.value = st.v[k]; });
    const p = (st.periodo || '').match(/^(\d{4})-(\d{2})$/);       // s2AtualizarLabelCompetencia
    const c = $('#sm-comp'); if (c) c.value = p ? `${S2_MESES_LABEL[parseInt(p[2], 10) - 1]}/${p[1]}` : '—';
  }
  // valores como o Dash atual lê/grava (s2CamposParaSalvar, index.html 10678-10698)
  function camposParaSalvar() {
    const v = st.v, c = {
      'tabela-cnpjhc': v['tabela-cnpjhc'], 'categoria': v['categoria'], 'cluster': v['cluster'],
      'total-cnpjs': num(v['total-cnpjs']), 'total-hcs': num(v['total-hcs']), 'meta-voz': num(v['meta-voz']), 'meta-bl': num(v['meta-bl']), 'meta-sd': num(v['meta-sd']),
      'meta-movel-voz': num(v['meta-movel-voz']), 'meta-fixa-bl': num(v['meta-fixa-bl']),
    };
    CODIGOS_AACE2.forEach(({ tag }) => { const sid = s2Sid(tag); c['cart-linhas-' + sid] = num(v['cart-linhas-' + sid]); c['cart-netadds-' + sid] = num(v['cart-netadds-' + sid]); });
    RAMPA_PRODUTIVIDADE.forEach((r, i) => { c['rampa-disp-' + i] = num(v['rampa-disp-' + i]); });
    return c;
  }

  // ── carga / gravação (config_simulador2) ────────────────────────────────────
  // origem: carregarSimulador2, index.html 10776-10805
  async function carregar(periodo) {
    st.v = estadoPadrao();
    try {
      const { data, error } = await supa.from('config_simulador2').select('*').eq('periodo', periodo);
      if (error) { console.warn('Simulador 2.0: erro ao consultar config_simulador2 —', error.message); msg('Não consegui ler a configuração salva desta competência: ' + error.message, true); }
      else {
        if (data && data.length) data.forEach(({ chave, valor }) => {
          if (!(chave in st.v)) return;                                  // só as chaves que existem no formulário (como o getElementById do original)
          if (LISTA_SELECTS[chave] && !LISTA_SELECTS[chave].includes(String(valor))) return;
          st.v[chave] = valor;
        });
        const metasDoMes = S2_METAS_TRIMESTRE[periodo];                  // metas jun/jul/ago-26 só se a competência ainda não tiver as suas
        const jaTemMeta = data && data.some(d => d.chave === 'meta-movel-voz' || d.chave === 'meta-fixa-bl');
        if (metasDoMes && !jaTemMeta) Object.entries(metasDoMes).forEach(([chave, val]) => { st.v[chave] = val; });
      }
    } catch (e) { console.warn('Simulador 2.0: config_simulador2 indisponível —', e.message); }
    st.periodo = periodo; st.sujo = false;
    pintarCampos();
  }
  // origem: salvarSimulador2, index.html 10748-10774
  async function salvar(silencioso, periodoForcado) {
    if (!ehAdminLike(ctx().perfil)) { if (!silencioso) msg('Apenas administradores podem salvar o Simulador 2.0.', true); return; }
    const btn = $('#sm-salvar');
    if (!silencioso) { btn.textContent = 'Salvando…'; btn.disabled = true; }
    const periodo = periodoForcado || st.periodo || new Date().toISOString().slice(0, 7);
    const rows = Object.entries(camposParaSalvar()).map(([chave, valor]) => ({ periodo, chave, valor }));
    try {
      const { error } = await supa.from('config_simulador2').upsert(rows, { onConflict: 'periodo,chave' });
      if (error) throw error;
      st.sujo = false;
      if (!silencioso) { btn.textContent = 'Salvo!'; msg(`Competência ${periodo} salva (${rows.length} campos).`); }
      carregarHistorico();
    } catch (e) {
      console.warn('Erro ao salvar Simulador 2.0:', e);
      if (!silencioso) { btn.textContent = 'Erro ao salvar'; msg('Não foi possível salvar no Supabase. Motivo: ' + (e.message || e) + '. Verifique se a tabela "config_simulador2" existe e se as permissões (RLS) permitem INSERT/UPDATE para o usuário logado.', true); }
    } finally {
      if (!silencioso) setTimeout(() => { btn.textContent = 'Salvar competência'; btn.disabled = false; }, 2000);
    }
  }
  // origem: carregarHistoricoListaSimulador2, index.html 10807-10816
  async function carregarHistorico() {
    try {
      const { data, error } = await supa.from('config_simulador2').select('periodo').order('periodo', { ascending: false });
      if (error || !data) return;
      const periodos = [...new Set(data.map(d => d.periodo))];
      $('#sm-historico').innerHTML = '<option value="">Ver competências salvas…</option>' + periodos.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    } catch (e) { /* tabela ainda não existe — silencioso */ }
  }
  // origem: trocarPeriodoSimulador2, index.html 10823-10834
  async function trocarPeriodo(novo) {
    if (!novo) return;
    if (st.sujo && st.periodo && st.periodo !== novo && ehAdminLike(ctx().perfil)) {
      await salvar(true, st.periodo).catch(e => console.warn('Falha ao autosalvar Simulador 2.0:', e));
    }
    st.sujo = false;
    await carregar(novo);
    atualizar();
  }
  // origem: carregarHistoricoSimulador2, index.html 10840-10851: se o mês é uma aba do seletor, troca o Período do topo
  async function abrirHistorico(periodo) {
    if (ctx().irParaPeriodo(periodo)) return;            // o app troca o seletor e a carga volta aqui por mostrar()
    await trocarPeriodo(periodo);
  }

  // ── dados do BaseCRM e cálculo ───────────────────────────────────────────────
  function puxarDados() { st.sheet = s2PuxarDados(ctx().rows(), st.visao, ctx().monitorDup()); st.rowsRef = ctx().rows(); }
  function trocarVisao(v) {
    st.visao = v;
    host.querySelectorAll('#sm-visoes .seg-btn').forEach(b => { const on = b.dataset.visao === v; b.classList.toggle('ativo', on); b.setAttribute('aria-pressed', String(on)); });
    puxarDados(); atualizar();
  }
  const moeda = s2fmt;
  function atualizar() {
    if (!st.montado) return;
    const R = st.resultado = s2Calcular(st.v, st.sheet);
    const f = R.fatores, T = R.totais, P = R.prod;
    out('f-virtua', f.fVirtua.toFixed(2)); out('f-voznovo', f.fVozNovo.toFixed(2)); out('f-vozport', f.fVozPort.toFixed(2));
    out('cnpjhc', R.razaoCnpjHc.toFixed(1)); out('faixa', R.faixaObj.faixa);
    const fmtFaixa = idx => idx >= 0 ? ('Faixa ' + (idx + 1)) : 'Faixa 0 (sem adicional)';
    out('real-mv', L(f.realMovelVoz)); out('pct-mv', f.pctMovelVoz.toFixed(1) + '%'); out('faixa-mv', fmtFaixa(f.faixaMovelVozIdx));
    out('real-bl', L(f.realFixaBl)); out('pct-bl', f.pctFixaBl.toFixed(1) + '%'); out('faixa-bl', fmtFaixa(f.faixaFixaBlIdx));
    R.unidades.forEach(u => {
      const s = u.sid;
      out('u-at-' + s, moeda(u.comissao)); out('u-tp-' + s, (u.pctLiberacao * 100).toFixed(0) + '%'); out('u-te-' + s, moeda(u.teto)); out('u-po-' + s, L(u.potencial));
      out('u-un-' + s, 'R$ ' + u.unit.toFixed(2) + (u.netAdds < 0 ? ' (Net−)' : ' (Net+)')); out('u-lr-' + s, L(u.linhasRecebidas)); out('u-br-' + s, moeda(u.bruto));
      out('u-rc-' + s, moeda(u.recebida)); out('u-nr-' + s, moeda(u.naoRecebida)); out('u-me-' + s, moeda(u.mesa));
      const nr = host.querySelector(`[data-o="u-nr-${s}"]`), me = host.querySelector(`[data-o="u-me-${s}"]`);
      nr.classList.toggle('txt-neg', u.naoRecebida > 0); me.classList.toggle('sm-ambar', u.mesa > 0);
    });
    out('t-at', moeda(T.totalAtivacaoGeral)); out('t-tp', (R.pctLiberacao * 100).toFixed(0) + '%'); out('t-te', moeda(T.totalTeto)); out('t-po', L(T.totalPotencial)); out('t-cl', L(T.totalLinhasCarteira));
    out('t-lr', L(T.totalLinhasRecebidas)); out('t-br', moeda(T.totalBrutoCarteira)); out('t-rc', moeda(T.totalPagoCarteira)); out('t-nr', moeda(T.totalNaoRecebida)); out('t-me', moeda(T.totalMesa));
    out('k-bruto', moeda(T.totalBrutoCarteira)); out('k-bruto-s', T.totalBrutoCarteira ? 'calculado pela faixa/categoria' : '');
    out('k-rec', moeda(T.totalPagoCarteira)); out('k-nr', moeda(T.totalNaoRecebida)); out('k-nr-s', 'Acima do teto — precisa de mais comissão de ativação');
    out('k-mesa', moeda(T.totalMesa)); out('k-mesa-s', 'Teto maior que a carteira — poderia ter mais linhas/CNPJs');
    out('k-lv', L(T.totalLinhasVoz)); out('k-lb', L(T.totalLinhasVirtua)); out('k-at', moeda(T.totalAtivacaoGeral));
    out('k-teto', moeda(T.totalTeto)); out('k-teto-s', `% liberação: ${(R.pctLiberacao * 100).toFixed(0)}% (${R.cat.categoria.charAt(0).toUpperCase() + R.cat.categoria.slice(1)} · ${R.faixaObj.faixa})`);
    out('real-sd', moeda(P.realizadoSd));
    out('cap-voz', P.capVoz === Infinity ? '—' : P.capVoz.toFixed(1)); out('cap-voz-s', P.limitanteLabel === 'Voz' ? '⚠ é o gargalo' : 'tem folga');
    out('cap-bl', P.capBl === Infinity ? '—' : P.capBl.toFixed(1)); out('cap-bl-s', P.limitanteLabel === 'BL' ? '⚠ é o gargalo' : 'tem folga');
    out('cap-heads', `${L(P.totalDisponivel)} / ${L(P.totalVendedores)}`);
    P.sugestaoPorEstagio.forEach((s, i) => out('sug-' + i, L(s)));
    out('rampa-disp', L(P.totalDisponivel)); out('rampa-sug', L(P.totalVendedores));
    out('pm-num', `${L(P.realizadoVoz)} / ${P.metaVozPonderada.toFixed(1)}`); out('pm-pct', P.pctMovel.toFixed(1) + '%'); out('pm-max', P.metaVozMaxTodos.toFixed(1));
    out('pf-num', `${L(P.realizadoBl)} / ${P.metaBlPonderada.toFixed(1)}`); out('pf-pct', P.pctFixa.toFixed(1) + '%'); out('pf-max', P.metaBlMaxTodos.toFixed(1));
    out('ps-num', `${moeda(P.realizadoSd)} / ${moeda(P.metaSdPonderada)}`); out('ps-pct', P.pctSd.toFixed(1) + '%'); out('ps-max', moeda(P.metaSdMaxTodos));
    out('trava', P.travaTxt); const tv = host.querySelector('[data-o="trava"]'); tv.classList.toggle('txt-pos', P.travaOk); tv.classList.toggle('txt-neg', !P.travaOk);
    out('faixa-base', P.faixaBase.label); out('faixa-final', P.faixaFinal.label); out('prod-total', moeda(P.totalBonusProdutividade));
    out('cat-nome', R.cat.categoria.charAt(0).toUpperCase() + R.cat.categoria.slice(1)); out('cat-pct', (R.cat.pctCategoria * 100).toFixed(0) + '%');
    out('cat-base', moeda(T.totalAtivacaoGeral)); out('cat-total', moeda(R.cat.totalBonusCategoria));
    out('total', moeda(R.totalGeralCompetencia));
  }

  // origem: exportarSimulador2, index.html 10853-10888
  function exportarCsv() {
    const R = st.resultado; if (!R) { msg('Calcule o simulador antes de exportar.', true); return; }
    const r = R.ultimo, v = st.v;
    const linhas = [
      ['Competência', st.periodo || ''], ['Categoria', v['categoria']], ['Faixa CNPJ/HC', r.faixaCnpjHc], ['CNPJ/HC apurado', r.razaoCnpjHc.toFixed(2)],
      ['% Liberação Teto', (r.pctLiberacao * 100).toFixed(0) + '%'], [''],
      ['Código', 'Comissão Ativação', 'Cart. Recebida', 'Cart. Não Recebida', 'Deixado na Mesa'],
      ...R.unidades.map(u => [u.nome, moeda(u.comissao), moeda(u.recebida), moeda(u.naoRecebida), moeda(u.mesa)]),
      [''],
      ['Total Ativação', r.totalAtivacaoGeral.toFixed(2)], ['Total Carteira (pago)', r.totalPagoCarteira.toFixed(2)],
      ['Total Bônus Produtividade', r.totalBonusProdutividade.toFixed(2)], ['Total Bônus Categoria', r.totalBonusCategoria.toFixed(2)], ['TOTAL GERAL', r.totalGeralCompetencia.toFixed(2)],
    ];
    const csv = '﻿' + linhas.map(row => row.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = 'simulador2_' + (st.periodo || '') + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  // Edição pendente ao fechar/recarregar a página: mesmo POST keepalive do Dash atual (index.html 8136-8155)
  window.addEventListener('beforeunload', () => {
    if (!st.sujo || !st.periodo || !st.montado) return;
    if (!ehAdminLike(ctx().perfil)) return;
    const rows = Object.entries(camposParaSalvar()).map(([chave, valor]) => ({ periodo: st.periodo, chave, valor }));
    if (!rows.length) return;
    fetch(`${SUPA_URL}/rest/v1/config_simulador2?on_conflict=periodo,chave`, {
      method: 'POST', keepalive: true,
      headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY, 'Authorization': `Bearer ${token || SUPA_KEY}`, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
    }).catch(() => {});
  });

  // origem: initSimulador2, index.html 10368-10420
  return {
    // chamada ao abrir a visão e sempre que a base do período é (re)carregada
    async mostrar() {
      if (!st.montado) montar();
      if (st.trocando) return st.trocando;
      st.trocando = (async () => {
        const p = ctx().periodoS2();
        if (st.periodo === null) await carregar(p);
        else if (p !== st.periodo) await trocarPeriodo(p);
        puxarDados(); atualizar();
        carregarHistorico();
      })().finally(() => { st.trocando = null; });
      return st.trocando;
    },
    // para testes e para o app saber se há edição pendente
    get sujo() { return st.sujo; },
    get resultado() { return st.resultado; },
  };
}
