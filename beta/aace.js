// Visão "Simulador de AACE" do Beta2 = a aba Simulador de AACE do Dash atual (index.html 2745-2863 e 8577-9581).
//
// Comparativo "AACE hoje" (Lado A) × "AACE sob a VST" (Lado B) pela política Claro (Anexo III-A).
// Regras, cálculo e importador de extrato estão em aace-regras.js (CÓPIA LITERAL do index.html, conferida contra o
// Dash atual); aqui ficam só a tela e os eventos. Persistência igual à do Dash atual:
//   • estado dos dois lados em localStorage 'vst_aace_v1' (MESMA chave e MESMO formato → o que se digita num aparece no outro);
//   • simulações salvas com nome na tabela simulacoes_aace (todos os admins leem; só quem salvou altera/apaga — RLS do banco);
//   • "Cluster e CNPJ/HC da VST" lê config_simulador2 (só leitura) da competência do seletor de Período.
// O importador lê CSV + texto do PDF no navegador e NÃO inventa o que o extrato não traz (metas ficam em branco).

import { supa } from './sessao.js';
import { esc } from './ui.js';
import { s2fmt } from './politica-sim.js';
import {
  AACE, AACE_STORAGE_KEY, AACE_SECOES, AACE_SECOES_ESPELHADAS, AACE_CAMPOS_LINHA,
  aaceEstadoPadrao, aaceValor, aaceEspelhado, aaceSomenteImport, aaceEstadoEfetivo, aaceCalcular, aaceNum, aaceFmtPct, aaceFmtNum,
  aaceLerCsv, aaceMapearAnalitico, aaceAplicarResumo,
} from './aace-regras.js';
import { FAIXAS_BONUS_PRODUTIVIDADE } from './politica-sim.js';

// ctx() => { periodoS2(), usuario: { id, nome, email } }
export function criarAace(host, ctx) {
  const st = { montado: false, iniciou: false, sim: null };     // sim = simulação aberta { id, nome, dono, donoNome }
  const $ = s => host.querySelector(s);

  // ── persistência local (index.html aaceSalvar / aaceCarregarSalvo, 9015-9024) ───────────────────────────
  function salvarLocal() { try { localStorage.setItem(AACE_STORAGE_KEY, JSON.stringify(AACE)); } catch (e) { /* sem storage: segue sem lembrar */ } }
  function carregarLocal() {
    try {
      const bruto = localStorage.getItem(AACE_STORAGE_KEY);
      if (!bruto) return;
      const d = JSON.parse(bruto);
      ['a', 'b'].forEach(l => { if (d[l]) AACE[l] = { ...AACE[l], ...d[l] }; });
      if (d.g) AACE.g = { ...AACE.g, ...d.g };
    } catch (e) { /* dado salvo inválido: ignora */ }
  }

  // ── casca ────────────────────────────────────────────────────────────────────────────────────────────
  function montar() {
    host.innerHTML = `
      <div class="aa-pagina">
      <section class="painel aa-topo"><div class="aa-barra">
        <div class="aa-acoes">
          <button type="button" class="btn" id="aa-b-sims" title="Salva a simulação com um nome e abre as dos outros admins">Simulações salvas</button>
          <button type="button" class="btn" id="aa-b-imp" title="Preenche o Lado A com o analítico de comissão (CSV) e o extrato resumido do AACE">Importar extrato</button>
          <button type="button" class="btn" id="aa-b-vst" title="Lê o cluster e o CNPJ/HC da VST salvos no Simulador 2.0 e aplica ao Lado B">Cluster e CNPJ/HC da VST</button>
          <button type="button" class="btn btn-fantasma" id="aa-b-limpar" title="Limpa os campos dos dois lados">Limpar</button>
        </div>
        <div class="aa-ctl">
          <label class="chip chip-sel"><span>Tabela de CNPJ/HC</span><select id="aace-g-tabela" aria-label="Tabela de CNPJ/HC"><option value="definitiva">Definitiva (a partir de set/26)</option><option value="transicao">Transição (jun a ago/26)</option></select></label>
          <span class="tag" id="aace-pill">Política Claro · Lado A × Lado B</span>
        </div></div></section>
      <p class="aa-nota">A = o que a política paga ao AACE operando isolado. B = a mesma operação dentro dos KPIs da VST. A produção, as metas e as linhas de carteira lançadas no A são copiadas para o B (🔒). Nada vem preenchido: informe os números ou escolha cluster, categoria e atingimento direto nos seletores.</p>
      <div id="aace-msg" class="aa-msg"></div>

      <section class="painel" id="aace-simulacoes" hidden><header class="painel-cab"><div class="painel-tit"><h2>Simulações salvas — visíveis a todos os admins</h2></div>
        <div class="painel-ctl"><button type="button" class="btn btn-fantasma" id="aa-b-sims-fechar">Fechar</button></div></header>
        <div class="painel-corpo">
          <div class="aa-sim-form">
            <label class="sm-campo"><span>Nome da simulação</span><input type="text" id="aace-sim-nome" maxlength="120" placeholder="Ex.: AACE Cascavel — extrato set/26"></label>
            <button type="button" class="btn btn-marca" id="aa-b-sim-salvar">Salvar como nova</button>
            <button type="button" class="btn" id="aace-sim-btn-atualizar" hidden>Atualizar a simulação aberta</button>
            <button type="button" class="btn btn-fantasma" id="aa-b-sim-lista">↻ Atualizar lista</button>
          </div>
          <div id="aace-sim-msg" class="aa-msg"></div>
          <div id="aace-sim-lista" class="aa-tab-wrap"></div>
        </div></section>

      <section class="painel" id="aace-importador" hidden><header class="painel-cab"><div class="painel-tit"><h2>Importar extrato do AACE para o Lado A</h2></div>
        <div class="painel-ctl"><button type="button" class="btn btn-fantasma" id="aa-b-imp-fechar">Fechar</button></div></header>
        <div class="painel-corpo">
          <div class="aa-imp-grid">
            <label class="sm-campo"><span>1. Analítico de comissão (CSV)</span><input type="file" id="aace-imp-csv" accept=".csv,.txt">
              <small class="sm-dica">Arquivo COMISS_ANALITICO_PME_…csv (dentro do ZIP). Preenche produção, renovação por faixa, redução, estornos e carteira.</small></label>
            <label class="sm-campo"><span>2. Extrato resumido (opcional): cole o texto do PDF</span>
              <textarea id="aace-imp-pdf" rows="5" placeholder="Abra o PDF do extrato resumido, selecione tudo (Ctrl+A), copie e cole aqui. Traz CNPJs novos, Net Adds, churn, vendedores e o enquadramento por indicador."></textarea></label>
          </div>
          <div class="aa-imp-acoes"><button type="button" class="btn btn-marca" id="aa-b-imp-ir">Importar para o Lado A</button><span class="sm-dica">Tudo é lido no seu navegador; nenhum dado é enviado.</span></div>
          <div id="aace-imp-res" class="aa-msg aa-pre"></div>
        </div></section>

      <div class="aa-kpis">
        <article class="kpi aa-kpi aa-kpi-a"><div class="kpi-rot">A — Condição atual do AACE</div><div class="kpi-val" id="aace-total-a">—</div><div class="kpi-pe"><span class="kpi-nota" id="aace-sub-a"></span></div></article>
        <article class="kpi aa-kpi aa-kpi-b"><div class="kpi-rot">B — Condição com a VST</div><div class="kpi-val" id="aace-total-b">—</div><div class="kpi-pe"><span class="kpi-nota" id="aace-sub-b"></span></div></article>
        <article class="kpi aa-kpi aa-kpi-d"><div class="kpi-rot">Diferença (B − A)</div><div class="kpi-val" id="aace-dif">—</div><div class="kpi-pe"><span class="kpi-nota" id="aace-sub-d"></span></div></article>
      </div>

      <div class="aa-topo3">
        <details class="painel aa-cartao"><summary class="painel-cab"><div class="painel-tit"><h2>Produção lançada — demonstrativo</h2></div></summary><div id="aace-demo" class="aa-tab-wrap aa-corpo"></div></details>
        <details class="painel aa-cartao"><summary class="painel-cab"><div class="painel-tit"><h2>Remuneração por componente</h2></div>
          <div class="aa-leg-wrap"><span class="aa-leg"><i class="aa-ponto aa-ponto-a"></i>A — AACE atual</span><span class="aa-leg"><i class="aa-ponto aa-ponto-b"></i>B — Com a VST</span></div></summary><div id="aace-barras" class="aa-corpo"></div></details>
        <details class="painel aa-cartao"><summary class="painel-cab"><div class="painel-tit"><h2>Enquadramento</h2></div></summary><div id="aace-enq" class="aa-tab-wrap aa-corpo"></div></details>
      </div>

      <div id="aace-secoes" class="aa-secoes"></div>

      <details class="painel aa-cartao"><summary class="painel-cab"><div class="painel-tit"><h2>Comparativo detalhado e avisos</h2></div></summary>
        <div class="aa-corpo"><div id="aace-resultado" class="aa-tab-wrap"></div>
        <h3 class="aa-h3">Avisos</h3><div id="aace-avisos" class="aa-msg"></div></div></details>

      <details class="painel aa-cartao"><summary class="painel-cab"><div class="painel-tit"><h2>Premissas deste modelo</h2></div></summary>
        <ul class="aa-premissas aa-corpo">
          <li>Fatores fixos e adicionais: Tabelas 1 dos itens 2.2 e 2.3 e Anexo I da política, tal como escritos — sem o mapeamento de negócio do Simulador 2.0.</li>
          <li>Cluster automático usa a produção informada do mês (linhas de Voz, instalações de BL e receita de Conectividade) nos limites do Anexo III; a política não deixa claro se a volumetria é mensal ou de base ativa, por isso cada cluster pode ser escolhido na mão.</li>
          <li>Atingimento de meta: informe a meta e o realizado, ou escolha 100%, 120% ou 140%. O fator adicional só vale a partir de 100% (item 2.3-xv); soluções digitais, M2M, módulos e renovação não recebem adicional.</li>
          <li>Master: cluster sempre P (2.1-ix), fatores fixos da coluna Master, sem Bônus Produtividade, carteira a R$ 1,00/R$ 0,60 com teto de 33%. O item 2.3 não exclui o Master do adicional por meta.</li>
          <li>Fora da área de atuação: usa os fatores "fora da área" da Tabela 1 e não recebe adicional (a política não detalha o adicional fora da área).</li>
          <li>Nota final do Bônus Categoria: duas casas decimais, arredondando para cima na 3ª casa (0,875 vira 0,88), como mostram os extratos reais; o item 2.5.3-iii da política só diz "duas casas decimais".</li>
          <li>Net Adds = linhas ativadas − canceladas; zero conta como positivo. Teto de carteira e Bônus Categoria seguem as bases dos itens 2.6.5 e 2.5.5.</li>
          <li>Bônus Produtividade: sem a rampa de vendedores novos (todos cobrados a 100% da meta) e só para Elite com 4 ou mais HCs.</li>
          <li>Ainda não modelado: meta mínima de AACE novo, estornos, Programa Nacional (2.9), novos credenciamentos (2.10), órgãos públicos, produtos de alto valor, renovação de contratos (2.14), negociações especiais.</li>
        </ul></details>
      </div>`;
    st.montado = true;

    // eventos — delegação nos campos dos formulários (substitui os oninput/onchange inline do Dash atual)
    host.addEventListener('input', e => { const el = e.target.closest('[data-aa]'); if (el && el.tagName === 'INPUT') alterou(el.dataset.lado, el.dataset.aa, el.value); });
    host.addEventListener('change', e => {
      const el = e.target.closest('[data-aa]'); if (el && el.tagName === 'SELECT') alterou(el.dataset.lado, el.dataset.aa, el.value);
      if (e.target.id === 'aace-g-tabela') { AACE.g.tabela = e.target.value; salvarLocal(); renderResultado(); }   // aaceAlterouGeral
    });
    $('#aa-b-sims').addEventListener('click', abrirPainelSims);
    $('#aa-b-sims-fechar').addEventListener('click', abrirPainelSims);
    $('#aa-b-imp').addEventListener('click', abrirImportador);
    $('#aa-b-imp-fechar').addEventListener('click', abrirImportador);
    $('#aa-b-vst').addEventListener('click', carregarPadraoVst);
    $('#aa-b-limpar').addEventListener('click', limpar);
    $('#aa-b-imp-ir').addEventListener('click', importar);
    $('#aa-b-sim-salvar').addEventListener('click', () => simSalvar(false));
    $('#aace-sim-btn-atualizar').addEventListener('click', () => simSalvar(true));
    $('#aa-b-sim-lista').addEventListener('click', simListar);
    $('#aace-sim-lista').addEventListener('click', e => { const b = e.target.closest('[data-sim-acao]'); if (!b) return; (b.dataset.simAcao === 'abrir' ? simAbrir : simExcluir)(b.dataset.id); });
  }

  const aaceMsg = (txt, erro) => { const el = $('#aace-msg'); if (!el) return; el.textContent = txt || ''; el.classList.toggle('aa-erro', !!erro); };

  // ── formulário (origem: aaceInputHtml / aaceCorpoHtml / aaceRenderForm, index.html 8961-9013) ────────────
  function inputHtml(lado, k, def) {
    const id = `aace-${lado}-${k}`, v = aaceValor(lado, k);
    const trava = aaceSomenteImport(k) ? ' disabled title="Vem do extrato importado — somente leitura"'
      : (lado === 'b' && aaceEspelhado(k) ? ' disabled title="Espelhado do Lado A — altere lá"' : '');
    if (def && def.t === 'sel') {
      return `<select id="${id}" data-aa="${k}" data-lado="${lado}"${trava}>${def.op.map(([val, lab]) => `<option value="${esc(val)}"${String(v) === String(val) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    }
    return `<input type="number" id="${id}" data-aa="${k}" data-lado="${lado}"${trava} step="any" value="${esc(v)}">`;
  }
  function corpoHtml(lado, s) {
    if (s.tipo === 'campos') {
      return `<div class="aa-grid">${s.campos.map(c =>
        `<div class="aa-campo"><label for="aace-${lado}-${c.k}">${esc(c.l)}${lado === 'b' && aaceEspelhado(c.k) ? ' 🔒' : ''}</label>${inputHtml(lado, c.k, c)}</div>`).join('')}</div>`;
    }
    const nCols = s.cab.length;
    const linhaHtml = r => `<div class="aa-ll">${esc(r.l)}</div>${Array.from({ length: nCols }, (_, i) => {
      const k = r.cols[i];
      return k ? `<div>${inputHtml(lado, k, AACE_CAMPOS_LINHA[k])}</div>` : '<div></div>';
    }).join('')}`;
    const cabHtml = `<div class="aa-lh"></div>${s.cab.map(h => `<div class="aa-lh">${esc(h)}</div>`).join('')}`;
    const basicas = s.linhas.filter(r => !r.mais), mais = s.linhas.filter(r => r.mais);
    // bloco recolhido abre sozinho se algum campo dele já tem valor (nunca esconder dado digitado)
    const preenchido = mais.some(r => r.cols.some(k => k && aaceValor(lado, k) !== '' && String(aaceValor(lado, k)) !== String((AACE_CAMPOS_LINHA[k] || {}).def ?? '')));
    return `<div class="aa-linhas aa-c${nCols}">${cabHtml}${basicas.map(linhaHtml).join('')}</div>
      ${mais.length ? `<details class="aa-mais"${preenchido ? ' open' : ''}><summary>Outros tipos (${mais.length})</summary><div class="aa-linhas aa-c${nCols}">${mais.map(linhaHtml).join('')}</div></details>` : ''}`;
  }
  // seção "recolhida" abre sozinha quando algum campo dela (em qualquer lado) já tem valor
  function secaoPreenchida(s) {
    const ks = s.tipo === 'campos' ? s.campos.map(c => c.k) : s.linhas.flatMap(r => r.cols).filter(Boolean);
    const pad = aaceEstadoPadrao('a');
    return ks.some(k => ['a', 'b'].some(l => { const v = aaceValor(l, k); return v !== '' && String(v) !== String(pad[k]); }));
  }
  function minimizarTudo() { host.querySelectorAll('details').forEach(d => { d.open = false; }); }
  function renderForm() {
    const el = $('#aace-secoes');
    // reconstruir o formulário (importar, padrão VST…) não pode fechar o que o usuário abriu
    const abertas = new Set([...host.querySelectorAll('#aace-secoes details[data-sec]')].filter(d => d.open).map(d => d.dataset.sec));
    el.innerHTML = AACE_SECOES.map(s => {
      if (s.somenteImport && !secaoPreenchida(s)) return '';
      const trava = AACE_SECOES_ESPELHADAS.includes(s.id);
      const meio = (l, nome, cls) => `<div class="aa-meio aa-meio-${l}"><div class="aa-meio-t"><i class="aa-ponto ${cls}"></i>${nome}</div>${corpoHtml(l, s)}</div>`;
      return `<div class="painel aa-sec"><details data-sec="${s.id}"${abertas.has(s.id) ? ' open' : ''}><summary class="painel-cab"><div class="painel-tit"><h2>${esc(s.titulo)}</h2></div>${s.somenteImport ? '<span class="aa-esp-tag">🔒 vem do extrato importado — somente leitura</span>' : (trava ? '<span class="aa-esp-tag">🔒 o Lado B copia o Lado A</span>' : '')}</summary>
        <div class="aa-par aa-corpo">${meio('a', 'A — AACE atual', 'aa-ponto-a')}${meio('b', 'B — Com a VST', 'aa-ponto-b')}</div></details></div>`;
    }).join('');
    $('#aace-g-tabela').value = AACE.g.tabela;
  }
  // origem: aaceAlterou, index.html 9025-9030
  function alterou(lado, k, v) {
    if (aaceSomenteImport(k) || (lado === 'b' && aaceEspelhado(k))) return;       // travado: vem do extrato importado / do Lado A
    AACE[lado][k] = v;
    if (lado === 'a' && aaceEspelhado(k)) { const el = $('#aace-b-' + k); if (el) el.value = v; }
    salvarLocal(); renderResultado();
  }
  // origem: aaceLimpar, index.html 9039-9048
  function limpar() {
    if (!confirm('Limpar todos os campos dos dois lados?')) return;
    AACE.a = aaceEstadoPadrao('a'); AACE.b = aaceEstadoPadrao('b'); AACE.g = { tabela: 'definitiva' };
    salvarLocal(); renderForm(); renderResultado(); aaceMsg('');
    $('#aace-importador').hidden = true;
    st.sim = null; $('#aace-sim-nome').value = ''; simAtualizarUi();
    $('#aace-imp-res').textContent = '';
    minimizarTudo();
  }
  // origem: aaceCarregarPadraoVst, index.html 9050-9067 (só LÊ config_simulador2)
  async function carregarPadraoVst() {
    const periodo = ctx().periodoS2();
    aaceMsg('Buscando o padrão VST de ' + periodo + '…');
    try {
      const { data, error } = await supa.from('config_simulador2').select('*').eq('periodo', periodo);
      if (error) throw new Error(error.message);
      const v = ch => (data || []).find(d => d.chave === ch)?.valor;
      const partes = [];
      if (v('cluster')) { AACE.b.clusterMovel = AACE.b.clusterFixa = AACE.b.clusterConect = String(v('cluster')); partes.push('cluster ' + v('cluster')); }
      const cn = aaceNum(v('total-cnpjs')), hc = aaceNum(v('total-hcs'));
      if (cn > 0 && hc > 0) { AACE.b.razaoGrupo = (cn / hc).toFixed(1); partes.push('CNPJ/HC do grupo ' + aaceFmtNum(cn / hc)); }
      if (!partes.length) { aaceMsg('Não há padrão VST salvo no Simulador 2.0 para ' + periodo + '.', true); return; }
      salvarLocal(); renderForm(); renderResultado();
      aaceMsg('Padrão VST de ' + periodo + ' aplicado ao Lado B: ' + partes.join(' · ') + '. A faixa de adicional e a categoria da VST você ajusta no Enquadramento do Lado B.');
    } catch (e) {
      aaceMsg('Não consegui ler o Simulador 2.0: ' + e.message, true);
    }
  }

  // ── "Automático" mostra o que o cálculo escolheu (origem: aaceRotulosAuto, index.html 9070-9088) ──────────
  function rotulosAuto(lado, r) {
    const set = (k, txt) => { const op = host.querySelector(`#aace-${lado}-${k} option[value="auto"]`); if (op) op.textContent = txt; };
    const hc = aaceNum(AACE[lado === 'b' ? 'b' : 'a'].hcs);
    set('modalidade', `Automático ${r.master ? 'Master' : 'Elite'} (${hc > 0 ? hc + (hc === 1 ? ' HC' : ' HCs') : 'HCs não informados'})`);
    const cluster = c => r.master ? 'Automático P (Master)' : `Automático ${r.sug[c]} (pela produção)`;
    set('clusterMovel', cluster('movel')); set('clusterFixa', cluster('fixa')); set('clusterConect', cluster('conect'));
    const faixa = c => {
      if (!r.metaInf[c]) return 'Automático — meta não informada';
      const f = r.fxAuto[c], p = aaceFmtPct(r.pct[c]);
      return f >= 0 ? `Automático Faixa ${f + 1} (${p} da meta)` : `Automático sem adicional (${p} da meta)`;
    };
    set('faixaMovel', faixa('voz')); set('faixaFixa', faixa('fixaBl')); set('faixaConect', faixa('conect'));
    const cat = r.bonusCat.catAuto;
    set('categoria', `Automático ${cat.charAt(0).toUpperCase() + cat.slice(1)} (4 indicadores)`);
    [['dvForca', 'dv'], ['dbForca', 'db'], ['dnForca', 'dn'], ['dcForca', 'dc']].forEach(([k, d]) => set(k, `Automático ${r.dAuto[d]} (pelo valor informado)`));
    set('faixaCnpjHc', `Automático Faixa ${r.manut.faixaAuto} (pela razão)`);
    set('tetoCarteira', `Automático (teto de ${aaceFmtPct(r.manut.lib * 100)} da base de ativação)`);
    set('faixaProd', r.prod.elegivel ? `Automático Faixa ${r.prod.faixaAuto} (${s2fmt(FAIXAS_BONUS_PRODUTIVIDADE[r.prod.faixaAuto].valor)} por vendedor)` : 'Automático — não elegível (Master ou menos de 4 HCs)');
  }

  // ── demonstrativo (origem: aaceDemonstrativo, index.html 9091-9149) ─────────────────────────────────────
  function demonstrativo(ra, rb) {
    const el = $('#aace-demo'); if (!el) return;
    const A = AACE.a, B = aaceEstadoEfetivo('b');
    const n = aaceNum;
    const grupo = t => `<tr class="aa-grupo"><td colspan="4">${t}</td></tr>`;
    const lin = (nome, qtd, ticket, rec, extra) => `<tr><td>${nome}${extra ? ` <span class="aa-x">${extra}</span>` : ''}</td><td>${qtd === null ? '' : aaceFmtNum(qtd)}</td><td>${ticket === null ? '' : s2fmt(ticket)}</td><td>${s2fmt(rec)}</td></tr>`;
    let totLinhas = 0, totRec = 0;
    const partes = [];
    const bloco = (titulo, linhas) => { if (linhas.length) partes.push(grupo(titulo) + linhas.join('')); };
    const itensDe = g => ra.itens.filter(i => i.grupo === g && (i.qtd > 0 || i.receita > 0)).map(i => {
      const ex = [n(A[i.k + 'Red']) > 0 ? `${aaceFmtNum(n(A[i.k + 'Red']))} c/ redução` : '', n(A[i.k + 'Fora']) > 0 ? `${aaceFmtNum(n(A[i.k + 'Fora']))} fora da área` : ''].filter(Boolean).join(' · ');
      totLinhas += i.qtd; totRec += i.receita;
      return lin(esc(i.l), i.qtd, i.qtd > 0 ? i.receita / i.qtd : 0, i.receita, ex);
    });
    bloco('Móvel — ativação', itensDe('movel'));
    bloco('Fixa Básica — instalações', itensDe('fixa'));
    const renov = ra.renov.linhas.filter(l => l.qtd > 0 || l.receita > 0).map(l => {
      totRec += l.receita;
      return lin(`Faixa ${l.faixa} <span class="aa-x">(Delta ${esc(l.delta)})</span>`, l.qtd, l.ticket, l.receita, l.red > 0 ? `${aaceFmtNum(Math.min(l.red, l.qtd))} c/ redução` : '');
    });
    bloco(`Renovação / Migração — Tabela ${ra.renov.tabela}`, renov);
    const outras = [];
    const so = (nome, rec, extra) => { if (rec > 0) { totRec += rec; outras.push(lin(nome, null, null, rec, extra)); } };
    so('Incremento de módulo e TT Pós', ra.modulos.receita);
    so('M2M', ra.m2m.receita);
    so('Hotel e Hospital', ra.hotel.receita);
    so('Conectividade Avançada — ativação', ra.conect.receita);
    so('Conectividade — Renovação Conecta', ra.conectRenov.receita);
    so('Soluções Digitais e SVA', ra.sd.receita, `fator ${aaceFmtNum(ra.sd.fator * 100)}%`);
    so('Plugin de Convergência', ra.conv.receita, `fator ${aaceFmtNum(ra.conv.fator)}`);
    bloco('Demais receitas', outras);
    const resumo = totLinhas + totRec > 0
      ? `<table class="aa-tab aa-demo-tab"><thead><tr><th>Item</th><th>Linhas</th><th>Ticket</th><th>Receita</th></tr></thead><tbody>${partes.join('')}
          <tr class="aa-tot"><td>Total lançado (nos dois lados)</td><td>${aaceFmtNum(totLinhas)}</td><td></td><td>${s2fmt(totRec)}</td></tr></tbody></table>`
      : '<div class="vazio">Nada lançado ainda: informe a produção do Lado A.</div>';
    const v = (x, fmt) => (x === '' || x === undefined) ? '—' : fmt(n(x));
    const pct = x => (x === '' || x === undefined) ? '—' : aaceFmtPct(n(x));
    const fi = (nome, a, b) => `<tr><td>${nome}</td><td>${a}</td><td>${b}</td></tr>`;
    const num = x => v(x, aaceFmtNum);
    const carteira = `<div class="aa-demo-sub">Carteira, equipe e indicadores</div>
      <table class="aa-tab aa-demo-tab"><thead><tr><th>Item</th><th>A</th><th>B</th></tr></thead><tbody>
        ${fi('Linhas ativas na carteira', num(A.linhasAtivas), num(B.linhasAtivas) + ' <span class="aa-x">(do A)</span>')}
        ${fi('CNPJs na carteira', num(A.cnpjs), num(B.cnpjs))}
        ${fi('Vendedores / HCs', num(A.hcs), num(B.hcs))}
        ${fi('CNPJ/HC (razão usada)', ra.manut.razao > 0 ? aaceFmtNum(ra.manut.razao) : '—', rb.manut.razao > 0 ? aaceFmtNum(rb.manut.razao) : '—')}
        ${fi('CNPJs novos — Voz / Fixa BL', `${num(A.cnpjNovoVoz)} / ${num(A.cnpjNovoBl)}`, `${num(B.cnpjNovoVoz)} / ${num(B.cnpjNovoBl)}`)}
        ${fi('Net Adds', ra.bonusCat.direto ? pct(A.netAddsPct) : (n(A.gross) > 0 ? aaceFmtPct(ra.bonusCat.pctNet) : '—'), rb.bonusCat.direto ? pct(B.netAddsPct) : (n(B.gross) > 0 ? aaceFmtPct(rb.bonusCat.pctNet) : '—'))}
        ${fi('Churn Safra 180 dias', pct(A.churn), pct(B.churn))}
        ${fi('Metas do mês — Móvel Voz / Fixa BL', `${num(A.metaVoz)} / ${num(A.metaFixaBl)}`, '<span class="aa-x">(do A)</span>')}
        ${fi('Estornos e recálculos (saldo)', n(A.ajusteSaldo) !== 0 ? s2fmt(n(A.ajusteSaldo)) : '—', n(B.ajusteSaldo) !== 0 ? s2fmt(n(B.ajusteSaldo)) + ' <span class="aa-x">(do A)</span>' : '—')}
      </tbody></table>`;
    el.innerHTML = resumo + carteira;
  }

  // ── resultado (origem: aaceRender, index.html 9151-9276) ────────────────────────────────────────────────
  function renderResultado() {
    if (!st.montado) return;
    const ra = aaceCalcular(AACE.a, AACE.g), rb = aaceCalcular(aaceEstadoEfetivo('b'), AACE.g);
    rotulosAuto('a', ra); rotulosAuto('b', rb);
    ['a', 'b'].forEach((l, i) => { const el = $('#aace-total-' + l); if (el) el.textContent = s2fmt([ra, rb][i].total); });
    const dif = (a, b) => {
      const d = b - a;
      const p = a > 0 ? ` <span class="aa-pct">(${d >= 0 ? '+' : ''}${aaceFmtPct(d / a * 100)})</span>` : '';
      return `<span class="${d > 0.005 ? 'aa-pos' : d < -0.005 ? 'aa-neg' : ''}">${d > 0 ? '+' : ''}${s2fmt(d)}${p}</span>`;
    };
    const txt = (t, a, b) => `<tr><td>${t}</td><td>${a}</td><td>${b}</td><td></td></tr>`;
    const din = (t, f, forte) => `<tr class="${forte ? 'aa-forte' : ''}"><td>${t}</td><td>${s2fmt(f(ra))}</td><td>${s2fmt(f(rb))}</td><td>${dif(f(ra), f(rb))}</td></tr>`;
    const cab = t => `<tr class="aa-grupo"><td colspan="4">${t}</td></tr>`;
    const faixaTxt = (r, c) => {
      const f = r.fx[c], meta = ['100%', '120%', '140%'][f];
      if (f < 0) return r.fxForca[c] ? 'Abaixo de 100% (escolhido)' : `Sem adicional (${aaceFmtPct(r.pct[c])} da meta)`;
      return r.fxForca[c] ? `${meta} da meta — Faixa ${f + 1} (escolhido)` : `Faixa ${f + 1} (${aaceFmtPct(r.pct[c])} da meta)`;
    };
    const exInf = l => AACE[l].extratoTotal === '' ? null : aaceNum(AACE[l].extratoTotal);
    const exA = exInf('a'), exB = exInf('b');
    const extRows = (exA !== null || exB !== null) ? `${cab('Conferência com o extrato')}
      <tr><td>Total pago no extrato (informado)</td><td>${exA !== null ? s2fmt(exA) : '—'}</td><td>${exB !== null ? s2fmt(exB) : '—'}</td><td></td></tr>
      <tr><td>Simulado − extrato</td><td>${exA !== null ? dif(exA, ra.total) : '—'}</td><td>${exB !== null ? dif(exB, rb.total) : '—'}</td><td></td></tr>` : '';
    const ajRow = (ra.ajustes !== 0 || rb.ajustes !== 0) ? din('Estornos e recálculos (saldo do extrato)', r => r.ajustes) : '';
    const redRow = (ra.reducaoTotal > 0.005 || rb.reducaoTotal > 0.005) ? txt('Redução MKT Nacional (R$ não recebidos)', s2fmt(ra.reducaoTotal), s2fmt(rb.reducaoTotal)) : '';
    const fatorTxt = f => f.toFixed(2).replace('.', ',');
    const regraRenov = r => `Tabela ${r.renov.tabela} (${r.renov.tabela === '1' ? 'fora da área cabeada, com BL ou convergência' : 'área cabeada, sem convergência'}) · cluster do Móvel ${r.renov.cluster}${r.master ? ' (Master)' : ''} — o fator vem do Delta Ticket da linha × cluster`;
    const linhaRenov = (r, i) => {
      const l = r.renov.linhas[i];
      if (!l || l.qtd <= 0) return '—';
      const porLinha = l.ticket * l.fator * l.mult;
      const red = l.mult < 1 ? ` · redução MKT Nacional em ${aaceFmtNum(Math.min(l.red, l.qtd))} das ${aaceFmtNum(l.qtd)} linhas (paga ${aaceFmtNum(r.renov.redPct)}% do fator)` : '';
      return `${aaceFmtNum(l.qtd)} linhas · Faixa ${l.faixa} (Delta ${esc(l.delta)}) · fator ${fatorTxt(l.fator)} × ticket ${s2fmt(l.ticket)} = ${s2fmt(porLinha)} por linha${red} → ${s2fmt(l.comissao)}`;
    };
    const renovRows = [0, 1, 2, 3, 4, 5, 6].filter(i => ra.renov.linhas[i].qtd > 0 || rb.renov.linhas[i].qtd > 0)
      .map(i => txt('Renovação — linha ' + (i + 1), linhaRenov(ra, i), linhaRenov(rb, i))).join('\n');
    const manRegra = r => {
      const m = r.manut, un = s2fmt(m.unit), cat = m.cat.toUpperCase();
      const sinal = m.negativo ? `Net Adds negativo (${aaceFmtPct(m.pctNet)})` : `Net Adds positivo (${aaceFmtPct(m.pctNet)})`;
      if (m.motivo === 'master') return `Master · ${sinal} → unitário fixo de ${un} por linha (item 2.6.6)`;
      if (m.motivo === 'negativo') return `Elite · ${sinal} → unitário fixo da categoria ${cat}: ${un} por linha (item 2.6.4-i)`;
      return `Elite · ${sinal} → razão CNPJ/HC ${aaceFmtNum(m.razao)} cai na Faixa ${m.faixa} (tabela ${m.tabela}): ${un} por linha (item 2.6.4-ii)`;
    };
    const manValor = r => r.manut.linhas > 0 ? `${aaceFmtNum(r.manut.linhas)} linhas × ${s2fmt(r.manut.unit)} por linha = ${s2fmt(r.manut.bruto)}` : '—';
    const manTeto = r => {
      const m = r.manut;
      if (!(m.linhas > 0)) return '—';
      if (m.semTeto) return `teto ignorado (escolhido): paga 100% das linhas, ${s2fmt(m.bruto)}. Pela política o teto seria ${s2fmt(m.teto)} (${aaceFmtPct(m.lib * 100)} de ${s2fmt(m.base)})` + (m.bruto > m.teto ? `, que cortaria ${s2fmt(m.bruto - m.teto)}` : ', sem cortar nada');
      const quem = m.motivo === 'faixa' ? `categoria ${m.cat.toUpperCase()} × Faixa ${m.faixa}, item 2.6.5-ii` : '33% fixo, itens 2.6.4-i e 2.6.6';
      const res = m.limitou ? `TETO APLICADO: pago ${s2fmt(m.pago)}, cortou ${s2fmt(m.bruto - m.teto)}` : `abaixo do teto: paga os ${s2fmt(m.pago)} inteiros`;
      return `base de ativação ${s2fmt(m.base)} × ${aaceFmtPct(m.lib * 100)} — ${quem} = teto de ${s2fmt(m.teto)} → ${res}`;
    };
    const manutBloco = [txt('Manutenção de carteira — regra aplicada', manRegra(ra), manRegra(rb)), txt('Manutenção de carteira — valor por linha', manValor(ra), manValor(rb)), txt('Manutenção de carteira — teto', manTeto(ra), manTeto(rb))].join('\n');
    const renovBloco = renovRows ? txt('Renovação — regra aplicada', regraRenov(ra), regraRenov(rb)) + '\n' + renovRows : '';
    const netTxt = r => r.bonusCat.direto ? `${aaceFmtPct(r.bonusCat.pctNet)} (informado)` : `${aaceFmtNum(r.bonusCat.netAdds)} linhas (${aaceFmtPct(r.bonusCat.pctNet)})`;
    const modTxt = r => (r.master ? 'Master' : 'Elite') + (r.modAuto ? ' (automático)' : '');
    const catTxt = r => `${r.bonusCat.cat.toUpperCase()} · nota ${r.bonusCat.nota.toFixed(2).replace('.', ',')}${r.bonusCat.cat !== r.bonusCat.catAuto ? ' (forçada)' : ''}`;
    const desemp = r => `${r.bonusCat.dv} · ${r.bonusCat.db} · ${r.bonusCat.dn} · ${r.bonusCat.dc}`;
    const prodTxt = r => r.prod.elegivel ? `${aaceFmtPct(r.prod.alM)} · ${aaceFmtPct(r.prod.alF)} · ${aaceFmtPct(r.prod.alS)} → Faixa ${r.prod.faixa}${r.prod.forcada ? ' (escolhida)' : (r.prod.retro ? ' (retroagiu por SD)' : '')} · ${s2fmt(r.prod.valorVend)}/vendedor` : 'Não elegível';

    $('#aace-resultado').innerHTML = `<table class="aa-tab"><thead><tr><th>Item</th><th>A — AACE atual</th><th>B — Com a VST</th><th>Diferença (B − A)</th></tr></thead><tbody>
      ${cab('Remuneração de ativação (receita contratada × fator)')}
      ${din('Móvel — Voz e Banda Larga', r => r.comMovel)}
      ${din('Móvel — módulos e TT Pós', r => r.modulos.comissao)}
      ${din('Móvel — M2M', r => r.m2m.comissao)}
      ${din('Fixa Básica (BL, TV, Fone) e Hotel/Hospital', r => r.comFixa)}
      ${din('Conectividade Avançada (ativação e Conecta)', r => r.conect.comissao + r.conectRenov.comissao)}
      ${din('Soluções Digitais e SVA', r => r.sd.comissao)}
      ${din('Renovação / Migração Móvel', r => r.renov.comissao)}
      ${din('Plugin de Convergência', r => r.conv.comissao)}
      ${cab('Bônus e carteira')}
      ${din('Bônus Categoria (% sobre a base de ativação)', r => r.bonusCat.valor)}
      ${din('Manutenção de Carteira (já com o teto)', r => r.manut.pago)}
      ${din('Bônus Produtividade', r => r.prod.total)}
      ${ajRow}
      ${din('TOTAL DO MÊS', r => r.total, true)}
      ${extRows}
      ${cab('Detalhes dos cálculos')}
      ${txt('Base do Bônus Categoria', `${s2fmt(ra.baseBonusCat)} × ${aaceFmtPct(ra.bonusCat.pct * 100)}`, `${s2fmt(rb.baseBonusCat)} × ${aaceFmtPct(rb.bonusCat.pct * 100)}`)}
      ${manutBloco}
      ${renovBloco}
      ${redRow}
      ${txt('Produtividade: Móvel · Fixa BL · SD', prodTxt(ra), prodTxt(rb))}
    </tbody></table>`;

    $('#aace-enq').innerHTML = `<table class="aa-tab aa-tab-enq"><thead><tr><th>Item</th><th>A — AACE atual</th><th>B — Com a VST</th><th></th></tr></thead><tbody>
      ${txt('Modalidade', modTxt(ra), modTxt(rb))}
      ${txt('Cluster — Móvel / Fixa / Conectividade', `${ra.C.movel} / ${ra.C.fixa} / ${ra.C.conect}`, `${rb.C.movel} / ${rb.C.fixa} / ${rb.C.conect}`)}
      ${txt('Adicional — Móvel Voz', faixaTxt(ra, 'voz'), faixaTxt(rb, 'voz'))}
      ${txt('Adicional — Fixa Básica BL', faixaTxt(ra, 'fixaBl'), faixaTxt(rb, 'fixaBl'))}
      ${txt('Desempenho (CNPJ Novo Voz · BL · Net Adds · Churn)', desemp(ra), desemp(rb))}
      ${txt('Categoria do Bônus', catTxt(ra), catTxt(rb))}
      ${txt('Net Adds do mês', netTxt(ra), netTxt(rb))}
      ${txt('CNPJ/HC — faixa e unitário', `${aaceFmtNum(ra.manut.razao)} → Faixa ${ra.manut.faixa} · ${s2fmt(ra.manut.unit)}/linha`, `${aaceFmtNum(rb.manut.razao)} → Faixa ${rb.manut.faixa} · ${s2fmt(rb.manut.unit)}/linha`)}
    </tbody></table>`;

    const d = rb.total - ra.total;
    $('#aace-dif').innerHTML = `<span class="${d > 0.005 ? 'aa-pos' : d < -0.005 ? 'aa-neg' : ''}">${d > 0 ? '+' : ''}${s2fmt(d)}</span>`;
    $('#aace-sub-d').textContent = ra.total > 0 ? `${d >= 0 ? '+' : ''}${aaceFmtPct(d / ra.total * 100)} sobre o Lado A` : 'Informe a produção no Lado A';
    const subKpi = r => `${r.bonusCat.cat.charAt(0).toUpperCase() + r.bonusCat.cat.slice(1)} · Cluster ${r.C.movel}/${r.C.fixa}/${r.C.conect} · ${r.master ? 'Master' : 'Elite'}`;
    $('#aace-sub-a').textContent = subKpi(ra); $('#aace-sub-b').textContent = subKpi(rb);

    const comps = [
      ['Móvel — Voz e Banda Larga', r => r.comMovel], ['Móvel — módulos e TT Pós', r => r.modulos.comissao], ['Móvel — M2M', r => r.m2m.comissao],
      ['Fixa Básica e Hotel/Hospital', r => r.comFixa], ['Conectividade Avançada', r => r.conect.comissao + r.conectRenov.comissao],
      ['Soluções Digitais e SVA', r => r.sd.comissao], ['Renovação / Migração', r => r.renov.comissao], ['Plugin de Convergência', r => r.conv.comissao],
      ['Bônus Categoria', r => r.bonusCat.valor], ['Manutenção de Carteira', r => r.manut.pago], ['Bônus Produtividade', r => r.prod.total],
    ].map(([l, f]) => ({ l, a: f(ra), b: f(rb) })).filter(c => c.a > 0.005 || c.b > 0.005);
    const maxV = Math.max(1, ...comps.flatMap(c => [c.a, c.b]));
    const barra = (v, cls) => `<div class="aa-bar-track"><div class="aa-bar-bg"><div class="aa-bar-fill ${cls}" style="width:${v / maxV * 100}%"></div></div><span>${s2fmt(v)}</span></div>`;
    $('#aace-barras').innerHTML = comps.length
      ? comps.map(c => `<div class="aa-bar-row"><div class="aa-bar-lab">${esc(c.l)}</div><div class="aa-bar-par">${barra(c.a, 'aa-bar-a')}${barra(c.b, 'aa-bar-b')}</div></div>`).join('')
      : '<div class="vazio">Lance a produção no Lado A para ver o comparativo.</div>';
    demonstrativo(ra, rb);
    const av = (r, l) => r.avisos.map(a => `<li><b>${l}:</b> ${esc(a)}</li>`).join('');
    $('#aace-avisos').innerHTML = (ra.avisos.length || rb.avisos.length) ? `<ul>${av(ra, 'A')}${av(rb, 'B')}</ul>` : '<span class="aa-mudo">Sem avisos.</span>';
  }

  // ── importador (origem: aaceAbrirImportador / aaceImportar, index.html 9440-9475) ───────────────────────────
  function abrirImportador() { const el = $('#aace-importador'); el.hidden = !el.hidden; }
  async function importar() {
    const arq = $('#aace-imp-csv').files[0];
    const txtPdf = $('#aace-imp-pdf').value.trim();
    const res = $('#aace-imp-res');
    if (!arq && !txtPdf) { res.textContent = 'Escolha o CSV do analítico e/ou cole o texto do extrato resumido.'; return; }
    try {
      const est = arq ? aaceEstadoPadrao('a') : { ...AACE.a };   // um CSV novo recomeça o Lado A; só o texto complementa o que já está lá
      const notas = [];
      if (arq) {
        const buf = await arq.arrayBuffer();
        let texto;
        try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { texto = new TextDecoder('windows-1252').decode(buf); }
        const m = aaceMapearAnalitico(aaceLerCsv(texto));
        Object.assign(est, m.est); notas.push(...m.notas);
      }
      let des = {};
      if (txtPdf) { const r = aaceAplicarResumo(est, txtPdf); notas.push(...r.notas); des = r.des; }
      AACE.a = est;
      // se o desempenho do extrato diferir do calculado (ex.: região B), usa o do extrato
      const b = aaceCalcular(AACE.a, AACE.g).bonusCat;
      [['dv', 'dvForca'], ['db', 'dbForca'], ['dn', 'dnForca'], ['dc', 'dcForca']].forEach(([d, f]) => {
        if (des[d] !== undefined && b[d] !== des[d]) { AACE.a[f] = String(des[d]); notas.push(`Desempenho ${d} do extrato (${des[d]}) difere do calculado (${b[d]}): mantive o do extrato.`); }
      });
      salvarLocal(); renderForm(); renderResultado();
      const ra = aaceCalcular(AACE.a, AACE.g), ex = aaceNum(AACE.a.extratoTotal);
      if (ex > 0) notas.push(`Total simulado R$ ${aaceFmtNum(ra.total)} × extrato R$ ${aaceFmtNum(ex)} (diferença R$ ${aaceFmtNum(ra.total - ex)}).`);
      res.textContent = notas.join('\n');
      aaceMsg('Lado A preenchido pelo extrato importado. O Lado B copiou a produção; ajuste o enquadramento e os KPIs dele.');
    } catch (e) {
      res.textContent = 'Não consegui importar: ' + e.message;
    }
  }

  // ── simulações salvas (origem: index.html 9477-9580) — tabela public.simulacoes_aace ─────────────────────────
  const simMsg = (txt, erro) => { const el = $('#aace-sim-msg'); if (!el) return; el.textContent = txt || ''; el.classList.toggle('aa-erro', !!erro); };
  function simErro(e) {
    const m = String((e && (e.message || e.details)) || e || '');
    if (/does not exist|schema cache|42P01|PGRST205/i.test(m)) return 'O recurso ainda não foi ativado no banco: falta criar a tabela simulacoes_aace (migração 20261102000001_simulacoes_aace.sql).';
    if (/row-level security|permission denied|42501/i.test(m)) return 'Sem permissão: as simulações são só dos admins, e só quem salvou pode alterar ou apagar a sua.';
    return 'Não consegui completar: ' + m;
  }
  function simAtualizarUi() {
    const u = ctx().usuario();
    const dono = st.sim && u && st.sim.dono === u.id;
    $('#aace-pill').textContent = st.sim ? 'Simulação: ' + st.sim.nome : 'Política Claro · Lado A × Lado B';
    $('#aace-sim-btn-atualizar').hidden = !dono;
  }
  function abrirPainelSims() {
    const el = $('#aace-simulacoes');
    const abrir = el.hidden;
    el.hidden = !abrir;
    if (abrir) simListar();
  }
  async function simListar() {
    const box = $('#aace-sim-lista');
    box.innerHTML = '<div class="vazio">Carregando…</div>';
    try {
      const { data, error } = await supa.from('simulacoes_aace').select('id,nome,criado_por,criado_por_nome,atualizado_em').order('atualizado_em', { ascending: false });
      if (error) throw error;
      if (!data.length) { box.innerHTML = '<div class="vazio">Nenhuma simulação salva ainda.</div>'; return; }
      const meu = ctx().usuario()?.id;
      const quando = d => new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
      box.innerHTML = `<table class="aa-tab"><thead><tr><th>Nome</th><th>Salva por</th><th>Atualizada em</th><th></th></tr></thead><tbody>${data.map(r => `<tr>
        <td>${esc(r.nome)}${st.sim && st.sim.id === r.id ? ' <span class="aa-x">(aberta)</span>' : ''}</td><td>${esc(r.criado_por_nome || '—')}</td><td>${quando(r.atualizado_em)}</td>
        <td style="white-space:nowrap"><button type="button" class="btn" data-sim-acao="abrir" data-id="${esc(r.id)}">Abrir</button>${r.criado_por === meu ? ` <button type="button" class="btn btn-perigo" data-sim-acao="excluir" data-id="${esc(r.id)}">Excluir</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
    } catch (e) {
      box.innerHTML = '';
      simMsg(simErro(e), true);
    }
  }
  async function simSalvar(atualizar) {
    const nome = ($('#aace-sim-nome').value || '').trim();
    if (!nome) { simMsg('Dê um nome à simulação antes de salvar.', true); return; }
    const u = ctx().usuario();
    if (!u) { simMsg('Faça login para salvar.', true); return; }
    const dados = { v: 1, a: AACE.a, b: AACE.b, g: AACE.g };
    try {
      if (atualizar && st.sim) {
        const { data, error } = await supa.from('simulacoes_aace').update({ nome, dados, atualizado_em: new Date().toISOString() }).eq('id', st.sim.id).select('id');
        if (error) throw error;
        if (!data || !data.length) { simMsg('Só quem salvou a simulação pode atualizá-la. Use "Salvar como nova" para guardar a sua cópia.', true); return; }
        st.sim.nome = nome;
        simMsg('Simulação "' + nome + '" atualizada.');
      } else {
        const { data, error } = await supa.from('simulacoes_aace').insert({ nome, dados, criado_por: u.id, criado_por_nome: u.nome || u.email || null }).select('id').single();
        if (error) throw error;
        st.sim = { id: data.id, nome, dono: u.id, donoNome: u.nome || '' };
        simMsg('Simulação "' + nome + '" salva. Os outros admins já conseguem abri-la.');
      }
      simAtualizarUi();
      simListar();
    } catch (e) {
      simMsg(simErro(e), true);
    }
  }
  async function simAbrir(id) {
    try {
      const { data, error } = await supa.from('simulacoes_aace').select('id,nome,dados,criado_por,criado_por_nome').eq('id', id).single();
      if (error) throw error;
      const d = data.dados || {};
      AACE.a = { ...aaceEstadoPadrao('a'), ...(d.a || {}) };
      AACE.b = { ...aaceEstadoPadrao('b'), ...(d.b || {}) };
      AACE.g = { tabela: 'definitiva', ...(d.g || {}) };
      st.sim = { id: data.id, nome: data.nome, dono: data.criado_por, donoNome: data.criado_por_nome || '' };
      const meu = ctx().usuario()?.id === data.criado_por;
      $('#aace-sim-nome').value = meu ? data.nome : data.nome + ' (cópia)';
      salvarLocal(); renderForm(); renderResultado(); simAtualizarUi();
      simMsg('Simulação "' + data.nome + '" aberta' + (data.criado_por_nome ? ' (salva por ' + data.criado_por_nome + ')' : '') + '.' + (meu ? '' : ' Para guardar alterações, use "Salvar como nova".'));
      simListar();
    } catch (e) {
      simMsg(simErro(e), true);
    }
  }
  async function simExcluir(id) {
    if (!confirm('Excluir esta simulação para todos os admins?')) return;
    try {
      const { data, error } = await supa.from('simulacoes_aace').delete().eq('id', id).select('id');
      if (error) throw error;
      if (!data || !data.length) { simMsg('Só quem salvou a simulação pode excluí-la.', true); return; }
      if (st.sim && st.sim.id === id) { st.sim = null; simAtualizarUi(); }
      simMsg('Simulação excluída.');
      simListar();
    } catch (e) {
      simMsg(simErro(e), true);
    }
  }

  // origem: initAace, index.html 9582-9590 — toda vez que a aba é aberta, tudo começa minimizado
  return {
    mostrar() {
      if (!st.montado) montar();
      if (!st.iniciou) { carregarLocal(); renderForm(); st.iniciou = true; }
      renderResultado();
      minimizarTudo();
    },
  };
}
