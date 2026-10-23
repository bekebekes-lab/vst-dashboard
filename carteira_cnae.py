"""
Carteira → CNAE.

Sempre que existir uma base de Carteira (aba "CARTEIRA ... MMAAAA") sem CNAE
preenchido, consulta o CNAE de cada CNPJ na BrasilAPI e grava duas colunas no
fim da própria aba: "CNAE" (7 dígitos) e "Descrição CNAE". O Dash lê essas colunas
direto da planilha e oferece o filtro por CNAE na aba Carteira.

- Cada base é preenchida UMA vez: base que já tem CNAE para todos os CNPJs não é tocada
  de novo. Por padrão vale para todas as bases (CARTEIRA_ABAS_MAX = 0); informe um número
  pra limitar às N mais recentes.
- Cache em public.cnae_cache (Supabase): CNPJ já consultado não vai de novo à API,
  então uma base nova só consulta os CNPJs que nunca apareceram.
- Retoma de onde parou: se estourar o limite de tempo, grava o que já tem (planilha
  e cache) e a próxima execução continua.
- CPF (cliente pessoa física) e CNPJ inválido ficam em branco.

Uso:
  python carteira_cnae.py                      # execução normal (GitHub Actions)
  python carteira_cnae.py --consultar CNPJ...  # só testa a consulta, sem planilha/cache
Variáveis: GOOGLE_CREDENTIALS, CARTEIRA_SHEET_ID, SUPABASE_SERVICE_ROLE_KEY,
           MODO_TESTE (1 = não grava nada), CARTEIRA_ABAS_MAX, CNAE_LIMITE_SEGUNDOS.
"""

import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import requests

SUPA_URL = "https://kzlchetrpsfefwybaaoy.supabase.co"
BRASILAPI = "https://brasilapi.com.br/api/cnpj/v1/"
COL_CNAE = "CNAE"
COL_DESC = "Descrição CNAE"
PAUSA_ENTRE_CONSULTAS = 0.2          # usado só no modo --consultar (teste manual)
TRABALHADORES = 6                    # com 12 a BrasilAPI começou a derrubar conexões (~10% de erro): 6 é o ponto estável
INTERVALO_MIN_CONSULTAS = 0.3        # trava GLOBAL entre inícios de consulta: no máximo ~3,3/s (e sobe sozinha se houver erros)
INTERVALO_MAX_CONSULTAS = 4.0        # teto da desaceleração automática (1 consulta a cada 4 s no pior caso)
REVALIDAR_NAO_ENCONTRADOS_DIAS = 30  # CNPJ "não encontrado" é reconsultado depois desse prazo
# Mesmo visual do cabeçalho da Carteira (fundo preto, texto branco em negrito)
ESTILO_CABECALHO = {
    "backgroundColor": {"red": 0, "green": 0, "blue": 0},
    "textFormat": {"bold": True, "foregroundColor": {"red": 1, "green": 1, "blue": 1}},
}
LOTE_CACHE = 200                     # grava no cache a cada N consultas (progresso nunca se perde)


def log(msg):
    print(msg, flush=True)


# ─── Documentos ──────────────────────────────────────────────────────────────
def so_digitos(v) -> str:
    return re.sub(r"\D", "", str(v or ""))


def cnpj_valido(d: str) -> bool:
    if len(d) != 14 or len(set(d)) == 1:
        return False

    def dv(base, pesos):
        s = sum(int(c) * p for c, p in zip(base, pesos))
        r = s % 11
        return "0" if r < 2 else str(11 - r)

    d1 = dv(d[:12], [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    d2 = dv(d[:12] + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return d[12] == d1 and d[13] == d2


def cpf_valido(d: str) -> bool:
    if len(d) != 11 or len(set(d)) == 1:
        return False
    for n in (9, 10):
        s = sum(int(d[i]) * (n + 1 - i) for i in range(n))
        dv = (s * 10) % 11 % 10
        if dv != int(d[n]):
            return False
    return True


def normalizar_cnpj(valor):
    """Devolve o CNPJ (14 dígitos) ou None se for CPF/vazio/inválido.
    O Sheets às vezes guarda CNPJ como número e perde zeros à esquerda: se faltarem
    dígitos, completa com zeros e só aceita se o dígito verificador fechar."""
    d = so_digitos(valor)
    if not d or len(d) > 14:
        return None
    if len(d) == 11 and cpf_valido(d):
        return None  # pessoa física
    d = d.zfill(14)
    return d if cnpj_valido(d) else None


# ─── Consulta (BrasilAPI) ────────────────────────────────────────────────────
def consultar_cnae(cnpj: str, sessao=None, tentativas=5, limitador=None):
    """('ok', {cnae_codigo, cnae_descricao, situacao}) | ('nao_encontrado', None) | ('erro', None)."""
    http = sessao or requests
    espera = 2
    for i in range(tentativas):
        if i and limitador:
            limitador.esperar()  # repetição também respeita o ritmo global
        try:
            r = http.get(BRASILAPI + cnpj, timeout=25, headers={"User-Agent": "vst-dashboard-carteira-cnae"})
        except requests.RequestException as e:
            if limitador:
                limitador.falha()
            log(f"    {cnpj}: falha de rede ({e.__class__.__name__}), tentativa {i + 1}/{tentativas}")
            time.sleep(espera)
            espera = min(espera * 2, 60)
            continue
        if r.status_code == 200:
            if limitador:
                limitador.ok()
            d = r.json()
            cod = d.get("cnae_fiscal")
            if cod in (None, "", 0):
                return "nao_encontrado", None
            return "ok", {
                "cnae_codigo": str(cod).zfill(7),  # a API devolve inteiro: 600001 -> 0600001
                "cnae_descricao": (d.get("cnae_fiscal_descricao") or "").strip(),
                "situacao": (d.get("descricao_situacao_cadastral") or "").strip(),
            }
        if r.status_code in (400, 404):
            if limitador:
                limitador.ok()  # a API respondeu normalmente: o CNPJ é que não existe
            return "nao_encontrado", None
        # 429 (limite) e 5xx: espera e tenta de novo, respeitando Retry-After
        if limitador:
            limitador.falha()
        try:
            espera_api = int(r.headers.get("Retry-After", "0"))
        except ValueError:
            espera_api = 0
        time.sleep(max(espera, espera_api))
        espera = min(espera * 2, 60)
    return "erro", None


# ─── Cache (Supabase) ────────────────────────────────────────────────────────
def _hdr(chave, extra=None):
    h = {"apikey": chave, "Authorization": f"Bearer {chave}", "Content-Type": "application/json"}
    h.update(extra or {})
    return h


def cache_carregar(chave, sessao=None):
    http = sessao or requests
    cache, ini = {}, 0
    while True:
        r = http.get(
            f"{SUPA_URL}/rest/v1/cnae_cache?select=cnpj,encontrado,cnae_codigo,cnae_descricao,consultado_em",
            headers=_hdr(chave, {"Range-Unit": "items", "Range": f"{ini}-{ini + 999}"}), timeout=60)
        r.raise_for_status()
        linhas = r.json()
        for l in linhas:
            cache[l["cnpj"]] = l
        if len(linhas) < 1000:
            return cache
        ini += 1000


def cache_gravar(chave, registros, sessao=None):
    if not registros:
        return
    http = sessao or requests
    r = http.post(
        f"{SUPA_URL}/rest/v1/cnae_cache?on_conflict=cnpj",
        headers=_hdr(chave, {"Prefer": "resolution=merge-duplicates,return=minimal"}),
        data=json.dumps(registros), timeout=60)
    r.raise_for_status()


class Limitador:
    """Intervalo mínimo entre o INÍCIO de consultas (somando todas as threads) e ADAPTATIVO:
    cada falha (rede, 429, 5xx) aumenta o intervalo em 50% (até o teto) e cada sequência de
    sucessos o reduz de volta até o valor base. Assim o robô desacelera sozinho quando a API
    começa a recusar conexões, em vez de insistir e piorar."""

    def __init__(self, base, maximo=None):
        self.base = base
        self.maximo = maximo or base
        self.atual = base
        self.lock = threading.Lock()
        self.proxima = 0.0
        self.sucessos = 0

    def esperar(self):
        with self.lock:
            agora = time.monotonic()
            espera = max(0.0, self.proxima - agora)
            self.proxima = max(agora, self.proxima) + self.atual
        if espera:
            time.sleep(espera)

    def falha(self):
        with self.lock:
            self.sucessos = 0
            self.atual = min(self.maximo, self.atual * 1.5)

    def ok(self):
        with self.lock:
            self.sucessos += 1
            if self.sucessos >= 20 and self.atual > self.base:
                self.atual = max(self.base, self.atual * 0.8)
                self.sucessos = 0


def agora_iso():
    return datetime.now(timezone.utc).isoformat()


def precisa_consultar(cnpj, cache):
    """Sem cache -> consulta. 'Não encontrado' antigo -> reconsulta. Encontrado -> usa o cache."""
    c = cache.get(cnpj)
    if c is None:
        return True
    if c.get("encontrado"):
        return False
    try:
        quando = datetime.fromisoformat(c["consultado_em"].replace("Z", "+00:00"))
    except (KeyError, ValueError):
        return True
    return datetime.now(timezone.utc) - quando > timedelta(days=REVALIDAR_NAO_ENCONTRADOS_DIAS)


# ─── Planilha ────────────────────────────────────────────────────────────────
def parse_nome_aba(titulo: str):
    """Mesma regra do Dash (carteiraParseNomeBase): MMAAAA no fim, versão opcional depois."""
    m = re.search(r"(\d{2})(\d{4})(?:\D+(\d+))?\s*$", titulo)
    if not m:
        return None
    mes, ano = int(m.group(1)), int(m.group(2))
    if not 1 <= mes <= 12:
        return None
    return (ano, mes, int(m.group(3)) if m.group(3) else 1)


def letra_coluna(n: int) -> str:  # 1 -> A
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def abas_alvo(worksheets, maximo):
    com_chave = [(parse_nome_aba(w.title), w) for w in worksheets]
    validas = sorted([(k, w) for k, w in com_chave if k], key=lambda x: x[0], reverse=True)
    return [w for _, w in (validas[:maximo] if maximo else validas)]


def planejar_aba(valores):
    """Lê a matriz da aba e devolve (idx_cnpj, header, linhas_dados) ou None se não tiver coluna CNPJ."""
    if not valores:
        return None
    header = valores[0]
    idx = next((i for i, h in enumerate(header) if str(h).strip().lower() == "cnpj"), None)
    return None if idx is None else (idx, header, valores[1:])


def posicao_colunas(header):
    """Índices (0-based) de CNAE e Descrição CNAE; as que faltam entram no fim do cabeçalho, uma por vez."""
    nomes = [str(h).strip().lower() for h in header]
    ultimo = max((i for i, h in enumerate(header) if str(h).strip()), default=-1)
    prox = ultimo + 1
    pos = {}
    for col in (COL_CNAE, COL_DESC):
        if col.lower() in nomes:
            pos[col] = nomes.index(col.lower())
        else:
            pos[col] = prox
            prox += 1
    return pos


def montar_colunas(dados, idx_cnpj, cache):
    """Valores das duas colunas, linha a linha (em branco quando não há CNAE)."""
    cnae, desc = [], []
    for linha in dados:
        cnpj = normalizar_cnpj(linha[idx_cnpj]) if len(linha) > idx_cnpj else None
        c = cache.get(cnpj) if cnpj else None
        if c and c.get("encontrado") and c.get("cnae_codigo"):
            cnae.append([c["cnae_codigo"]])
            desc.append([c.get("cnae_descricao") or ""])
        else:
            cnae.append([""])
            desc.append([""])
    return cnae, desc


def escrever_colunas(ws, header, pos, dados, cnae, desc):
    """Escreve só as duas colunas (cabeçalho + dados). Pula a escrita se nada mudou."""
    n = len(dados)
    maior = max(pos.values()) + 1
    if ws.col_count < maior:
        ws.add_cols(maior - ws.col_count)
    if ws.row_count < n + 1:
        ws.add_rows(n + 1 - ws.row_count)

    def atual(col_idx):
        return [[(l[col_idx] if len(l) > col_idx else "")] for l in dados]

    escreveu = False
    for nome, valores in ((COL_CNAE, cnae), (COL_DESC, desc)):
        i = pos[nome]
        ja_existia = i < len(header) and str(header[i]).strip().lower() == nome.lower()
        if ja_existia and atual(i) == valores:
            continue
        letra = letra_coluna(i + 1)
        ws.update(range_name=f"{letra}1:{letra}{n + 1}", values=[[nome]] + valores, value_input_option="RAW")
        if not ja_existia:
            ws.format(f"{letra}1", ESTILO_CABECALHO)
        escreveu = True
    return escreveu


# ─── Execução ────────────────────────────────────────────────────────────────
def abrir_planilha():
    import gspread
    from google.oauth2.service_account import Credentials
    bruto = os.environ.get("GOOGLE_CREDENTIALS", "").strip()
    if not bruto:
        raise SystemExit("GOOGLE_CREDENTIALS está vazio")
    creds = None
    for texto in (bruto, bruto.replace("'", '"'), bruto.strip("'").strip('"')):
        try:
            creds = json.loads(texto)
            break
        except json.JSONDecodeError:
            continue
    if creds is None:
        raise SystemExit("GOOGLE_CREDENTIALS não é um JSON válido")
    cred = Credentials.from_service_account_info(creds, scopes=["https://www.googleapis.com/auth/spreadsheets"])
    return gspread.authorize(cred).open_by_key(os.environ["CARTEIRA_SHEET_ID"].strip())


def executar():
    if not os.environ.get("CARTEIRA_SHEET_ID", "").strip():
        log("CARTEIRA_SHEET_ID não configurado — nada a fazer (configure o secret no GitHub).")
        return 0
    chave = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not chave:
        raise SystemExit("SUPABASE_SERVICE_ROLE_KEY ausente")
    modo_teste = os.environ.get("MODO_TESTE", "").strip().lower() in ("1", "true", "sim")
    maximo = int(os.environ.get("CARTEIRA_ABAS_MAX", "").strip() or 0)  # vazio/0 = todas as bases
    limite = time.time() + int(os.environ.get("CNAE_LIMITE_SEGUNDOS", "").strip() or 5 * 3600)

    planilha = abrir_planilha()
    alvos = abas_alvo(planilha.worksheets(), maximo)
    log(f"Bases-alvo: {[w.title for w in alvos]}" + ("  [MODO TESTE — não grava]" if modo_teste else ""))
    cache = cache_carregar(chave)
    log(f"Cache: {len(cache)} CNPJs já conhecidos")
    pendentes_total = 0

    # uma sessão HTTP por thread (Session não é garantidamente thread-safe) + trava global de ritmo
    local = threading.local()
    limitador = Limitador(INTERVALO_MIN_CONSULTAS, INTERVALO_MAX_CONSULTAS)

    def consultar_limitado(cnpj):
        if not hasattr(local, "sessao"):
            local.sessao = requests.Session()
        limitador.esperar()
        return consultar_cnae(cnpj, local.sessao, limitador=limitador)

    n_trab = int(os.environ.get("CNAE_TRABALHADORES", "").strip() or TRABALHADORES)
    pool = ThreadPoolExecutor(max_workers=n_trab)

    for ws in alvos:
        valores = ws.get_all_values()
        plano = planejar_aba(valores)
        if not plano:
            log(f"[{ws.title}] sem coluna CNPJ — ignorada")
            continue
        idx, header, dados = plano
        cnpjs = {normalizar_cnpj(l[idx]) for l in dados if len(l) > idx}
        cnpjs.discard(None)
        faltam = sorted(c for c in cnpjs if precisa_consultar(c, cache))
        log(f"[{ws.title}] {len(dados)} linhas · {len(cnpjs)} CNPJs válidos · {len(faltam)} a consultar")

        feitos, erros = 0, 0
        for ini in range(0, len(faltam), LOTE_CACHE):
            if time.time() > limite:
                log("  limite de tempo atingido — grava o que já tem; a próxima execução continua")
                break
            lote = []
            # as consultas do lote rodam em paralelo (resultado volta na ordem de envio)
            for cnpj, (status, d) in zip(faltam[ini:ini + LOTE_CACHE], pool.map(consultar_limitado, faltam[ini:ini + LOTE_CACHE])):
                if status == "erro":
                    erros += 1  # não entra no cache: será tentado de novo na próxima execução
                    continue
                reg = {"cnpj": cnpj, "encontrado": status == "ok", "consultado_em": agora_iso(),
                       "cnae_codigo": d["cnae_codigo"] if d else None,
                       "cnae_descricao": d["cnae_descricao"] if d else None,
                       "situacao": d["situacao"] if d else None}
                cache[cnpj] = reg
                lote.append(reg)
            feitos += len(faltam[ini:ini + LOTE_CACHE])
            if lote and not modo_teste:
                cache_gravar(chave, lote)  # progresso nunca se perde
            log(f"  {feitos}/{len(faltam)} consultados · {erros} erro(s) · intervalo atual {limitador.atual:.2f}s")
        pendentes_total += max(0, len(faltam) - feitos) + erros

        pos = posicao_colunas(header)
        cnae, desc = montar_colunas(dados, idx, cache)
        com_cnae = sum(1 for c in cnae if c[0])
        log(f"[{ws.title}] {com_cnae}/{len(dados)} linhas com CNAE · {erros} erro(s) de consulta")
        if modo_teste:
            log("  [TESTE] planilha não alterada")
        elif escrever_colunas(ws, header, pos, dados, cnae, desc):
            log(f"  ✅ colunas '{COL_CNAE}' e '{COL_DESC}' gravadas em '{ws.title}'")
        else:
            log("  sem mudanças — planilha já estava atualizada")

    pool.shutdown()
    if pendentes_total:
        log(f"Ainda restam {pendentes_total} CNPJ(s) — serão retomados na próxima execução")
    return 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--consultar":
        for bruto in sys.argv[2:]:
            cnpj = normalizar_cnpj(bruto)
            if not cnpj:
                print(f"{bruto}: CPF/CNPJ inválido")
                continue
            print(cnpj, *consultar_cnae(cnpj))
            time.sleep(PAUSA_ENTRE_CONSULTAS)
        return 0
    return executar()


if __name__ == "__main__":
    sys.exit(main())
