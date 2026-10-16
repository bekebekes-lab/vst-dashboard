// Espelha getEscopoTravado()/linhaDentroDoEscopo() de index.html (busca por
// "TRAVA DE ESCOPO" lá) — usado pra filtrar os dados da planilha ANTES de
// devolver pro navegador, em vez de confiar só no filtro client-side.
//
// IMPORTANTE: EQUIPES_GESTORES abaixo precisa ser mantido em sincronia com o
// objeto de mesmo nome em index.html sempre que uma equipe nova for
// cadastrada ou remapeada (ex.: troca de gestor). O index.html é a fonte
// usada na tela; esta cópia só serve pra decidir o que o servidor pode
// devolver.

export const EQUIPES_GESTORES = {
  "ACIFI- FOZ":"LOHAYNE MOHANNA",
  "ADM E GESTORES":"PATRÍCIA",
  "COMERCIAL ACENIX":"MAURO NARDINO",
  "COMERCIAL DIOU":"DIOU",
  "COMERCIAL ERISON":"RAFA GOMES",
  "COMERCIAL FRANCISCO BELTRAO":"RAPHAEL FIRMINO",
  "COMERCIAL JEAN":"DAMARES FERREIRA",
  "COMERCIAL KARINA":"KARINA MENDES",
  "COMERCIAL KARINA 54/55":"KARINA MENDES",
  "COMERCIAL LAURA":"LAURA SANTOS",
  "COMERCIAL LEANDRO":"MAURO NARDINO",
  "COMERCIAL LISANDRA CAPITAL":"LISANDRA SANTOS",
  "COMERCIAL LISANDRA INTERIOR":"LISANDRA SANTOS",
  "COMERCIAL LOHAYNE":"LOHAYNE MOHANNA",
  "COMERCIAL MARCOS":"MAURO NARDINO",
  "COMERCIAL MAURO":"MAURO NARDINO",
  "COMERCIAL NATHAN":"MAURO NARDINO",
  "COMERCIAL PATRICIA":"PATRÍCIA",
  "COMERCIAL PAULA":"PAULA",
  "COMERCIAL RAFAEL GOMES":"RAFA GOMES",
  "COMERCIAL RICHIELLE":"RICHIELLE MORAIS",
  "COMERCIAL RICHIELLE 55":"RICHIELLE MORAIS",
  "COMERCIAL SANDRA":"RAPHAEL FIRMINO",
  "EQUIPE BALNEARIO CAMBORIU":"RICHIELLE MORAIS",
  "EQUIPE CAMPO MOURÃO":"RAPHAEL FIRMINO",
  "EQUIPE CAMPO MOURÃO INTERNO":"LOHAYNE MOHANNA",
  "EQUIPE CANOAS":"YAB",
  "EQUIPE CANOAS - ERON":"YAB",
  "EQUIPE CANOAS - RAFAEL":"YAB",
  "EQUIPE CANOAS - VANESSA":"YAB",
  "EQUIPE CASCAVEL":"RAPHAEL FIRMINO",
  "EQUIPE CASCAVEL - EXECUTIVA":"LOHAYNE MOHANNA",
  "EQUIPE CASCAVEL - INTERNO":"LOHAYNE MOHANNA",
  "EQUIPE CHAPECO":"DAMARES FERREIRA",
  "EQUIPE CONECTON":"LISANDRA SANTOS",
  "EQUIPE CRICIUMA":"RAFA GOMES",
  "EQUIPE CURITIBA - INTERNO":"LISANDRA SANTOS",
  "EQUIPE CXS":"PATRÍCIA",
  "EQUIPE CXS TEL":"PATRÍCIA",
  "EQUIPE ERECHIM":"PATRÍCIA",
  "EQUIPE FOZ DO IGUACU":"LOHAYNE MOHANNA",
  "EQUIPE FOZ DO IGUAÇU":"LOHAYNE MOHANNA",
  "EQUIPE JOINVILLE":"YAB",
  "EQUIPE KL":"LISANDRA SANTOS",
  "EQUIPE LIVRAMENTO":"RICHIELLE MORAIS",
  "EQUIPE LONDRINA":"RAPHAEL MARIANO",
  "EQUIPE LONDRINA - INTERNO":"RAPHAEL MARIANO",
  "EQUIPE MARINGA":"GISLAINE",
  "EQUIPE NH - INTERNO LAURA":"LAURA SANTOS",
  "EQUIPE NH - INTERNO MARIA":"MARIA VAZ",
  "EQUIPE NH - PAULA":"PAULA",
  "EQUIPE PEL":"VAGNER PEREIRA",
  "EQUIPE PEL 2":"VAGNER PEREIRA",
  "EQUIPE PONTA GROSSA":"BRS",
  "EQUIPE RIO GRANDE":"RICHIELLE MORAIS",
  "EQUIPE STA CRUZ":"KARINA MENDES",
  "EQUIPE STA MARIA":"RICHIELLE MORAIS",
  "EQUIPE THIAGO KASSNER":"KARINA MENDES",
  "INSIDE SALES POA - A":"RICHARD REIS",
  "INSIDE SALES POA - B":"RICHARD REIS",
  "PAP ERECHIM":"PATRÍCIA"
};

export function normalizarNomeEquipe(s) {
  return (s || '').toString().trim()
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ');
}

// perfis com trava por gestor único (aceita 1 nome via gestor_ref ou vários
// via gestores_ref, exatamente como no cliente)
const PERFIS_GESTOR_UNICO = ['gestor_macro', 'gestor_macro3', 'gestor', 'gestor_beta'];
const PERFIS_EQUIPE = ['supervisao', 'supervisao_beta'];

// Espelha byte a byte a regra que ja existe no cliente (aplicarFiltrosGerencial
// em index.html): quando o campo de escopo esperado pro perfil nao esta
// preenchido, o app SEMPRE tratou isso como "sem trava" (ve tudo), nunca como
// "nega tudo". Este helper reproduz exatamente essa regra -- nao pode ser
// mais restritivo do que o cliente ja e, senao quebra contas que hoje
// dependem desse comportamento (ex.: gestor_macro2 sem gestores_ref
// configurado ainda ve tudo, do jeito que sempre viu).
//
// u = linha de usuarios_dashboard/usuarios (ou null se o usuario nao tiver
// nenhuma das duas -- nesse caso o cliente cai no perfil sintetico
// {perfil:'consultor', consultor_ref:null}, que tambem resulta em "sem
// trava"; reproduzimos isso aqui tratando null do mesmo jeito).
export function getEscopoTravado(perfil, u) {
  const p = perfil || 'consultor';
  const row = u || { consultor_ref: null };
  if (!p || p === 'admin') return null;

  if (p === 'gestor_macro2') {
    const g = row.gestores_ref || [];
    return g.length ? { gestores: new Set(g) } : null;
  }
  if (PERFIS_GESTOR_UNICO.includes(p)) {
    const g = (row.gestores_ref || []).length ? row.gestores_ref : (row.gestor_ref ? [row.gestor_ref] : []);
    return g.length ? { gestores: new Set(g) } : null;
  }
  if (PERFIS_EQUIPE.includes(p)) {
    const e = row.equipes_ref || [];
    return e.length ? { equipes: new Set(e) } : null;
  }
  if (p === 'consultor') {
    return row.consultor_ref ? { consultorRef: row.consultor_ref.toUpperCase() } : null;
  }
  return null;
}

export function linhaDentroDoEscopo(equipeNorm, proprietario, escopo) {
  if (!escopo) return true;
  if (escopo.gestores && !escopo.gestores.has(EQUIPES_GESTORES[equipeNorm])) return false;
  if (escopo.equipes && !escopo.equipes.has(equipeNorm)) return false;
  if (escopo.consultorRef && (proprietario || '').toUpperCase() !== escopo.consultorRef) return false;
  return true;
}

// ── Carteira ─────────────────────────────────────────────────────────────────
// A planilha de Carteira não tem EQUIPE/PROPRIETARIO — a unidade de cada
// cliente vem do código no fim da coluna "Território" (mesma regra de
// carteiraUnidade() em index.html: último pedaço depois do "-", em
// maiúsculas, é o código da tag, ex.: "6OV1" = #6OV1 - CRICIUMA).
//
// Quais códigos um gestor/supervisão pode ver na Carteira é definido aqui,
// por grupo_ref. Se o grupo não estiver na lista, devolve [] (nada liberado)
// — falha fechada em vez de vazar a carteira inteira.
const CARTEIRA_CODIGOS_POR_GRUPO = {
  'EQUIPE CRICIUMA': ['6OV1'],
};

// Devolve null quando NÃO há trava específica de Carteira pro usuário (aí
// vale o comportamento que já existia — admin vê tudo, e quem tem a aba por
// acesso extra sem esse tipo de trava segue como sempre). Só gestor/supervisão
// com grupo_ref preenchido entram na trava por unidade.
export function getCarteiraCodigosPermitidos(perfil, u) {
  if (perfil !== 'gestor' && perfil !== 'supervisao') return null;
  const grupo = (u?.grupo_ref || '').toString().trim().toUpperCase();
  if (!grupo) return null;
  return CARTEIRA_CODIGOS_POR_GRUPO[grupo] || [];
}

export function carteiraCodigoDoTerritorio(territorio) {
  const partes = (territorio || '').toString().split('-').map(s => s.trim()).filter(Boolean);
  return (partes[partes.length - 1] || '').toUpperCase();
}
