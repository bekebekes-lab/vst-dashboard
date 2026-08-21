"""
Radar (Salesforce da Embratel) -> Supabase Bot
Fluxo: login (usuário/senha + TOTP) -> processa fila de consultas pendentes
       (cria Estudo de Viabilidade, define endereço do SEV, dispara "Consultar
       Viabilidade") -> revisita consultas em andamento e grava o resultado
       (viável/inviável, facilidade, custos) na tabela
       conectividade_estudos_viabilidade do Supabase.

Todos os seletores usam atributos estáveis (name/aria-label/id de campo do
Salesforce), nunca posição de tela — a UI do Radar muda de layout com
frequência, mas os nomes de campo (ex.: Razao_Social__c) não mudam.
"""

import os
import re
import time
import logging
from pathlib import Path

import requests
import pyotp
from playwright.sync_api import sync_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ─── Configuração (via GitHub Secrets) ─────────────────────────────────────
RADAR_URL = "https://embratel.my.salesforce.com"
RADAR_USER = os.environ["RADAR_USER"]
RADAR_PASS = os.environ["RADAR_PASS"]
RADAR_TOTP_SECRET = os.environ["RADAR_TOTP_SECRET"]
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://kzlchetrpsfefwybaaoy.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
DOWNLOAD_DIR = Path("/tmp/radar_bot")

TABELA = "conectividade_estudos_viabilidade"

# ─── Supabase (REST/PostgREST) ─────────────────────────────────────────────
def _supa_headers():
    return {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
    }


def supa_listar(status: str) -> list[dict]:
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/{TABELA}",
        headers=_supa_headers(),
        params={"status": f"eq.{status}", "select": "*"},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def supa_atualizar(row_id: int, campos: dict):
    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{TABELA}",
        headers={**_supa_headers(), "Prefer": "return=minimal"},
        params={"id": f"eq.{row_id}"},
        json=campos,
        timeout=30,
    )
    resp.raise_for_status()


# ─── TOTP ───────────────────────────────────────────────────────────────────
def gerar_totp() -> str:
    return pyotp.TOTP(RADAR_TOTP_SECRET).now()


def aguardar_totp_fresco() -> str:
    """Espera o início de um novo período TOTP p/ o código durar mais na hora
    de submeter (evita o código expirar entre gerar e clicar Verificar)."""
    segundos_restantes = 30 - (int(time.time()) % 30)
    if segundos_restantes < 8:
        time.sleep(segundos_restantes + 1)
    return pyotp.TOTP(RADAR_TOTP_SECRET).now()


# O mapeamento "nossa oferta (tipo+velocidade) -> texto de busca no Item de
# Produto do Radar" mora no backend JS (api/_lib/radar-catalogo.js) — é lá
# que o consultor escolhe a oferta na tela; a linha já chega aqui em
# `produto`/`item_produto` prontos pra buscar no lookup do Salesforce.


# ─── Login ──────────────────────────────────────────────────────────────────
def login(page):
    log.info("Fazendo login no Radar...")
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    page.goto(RADAR_URL, wait_until="networkidle")
    page.fill("#username", RADAR_USER)
    page.screenshot(path=str(DOWNLOAD_DIR / "01_username_preenchido.png"))

    # Domínios customizados do Salesforce (My Domain, caso do
    # embratel.my.salesforce.com) costumam usar login em DUAS etapas:
    # usuário -> "Próximo"/"Continuar" -> só então aparece a senha, numa
    # tela separada. Detecta qual dos dois formatos é este antes de mexer
    # no campo de senha.
    campo_senha = page.locator("#password")
    if not campo_senha.is_visible():
        log.info("  Campo de senha não visível ainda — tentando avançar (login em duas etapas)...")
        for sel in ["#Login", "button:has-text('Próximo')", "button:has-text('Next')", "button:has-text('Continuar')"]:
            try:
                page.locator(sel).first.click(timeout=3_000)
                break
            except Exception:
                continue
        campo_senha.wait_for(state="visible", timeout=20_000)
        page.screenshot(path=str(DOWNLOAD_DIR / "02_tela_senha.png"))

    campo_senha.fill(RADAR_PASS)
    for sel in ["#Login", "button:has-text('Fazer login')", "button:has-text('Log In')"]:
        try:
            page.locator(sel).first.click(timeout=3_000)
            break
        except Exception:
            continue

    # Tela de verificação (2FA) — só aparece se o dispositivo não for
    # lembrado; seletores padrão do Salesforce, com fallback por texto.
    try:
        campo_codigo = page.locator("input#tc, input[name='emc'], input[type='tel']").first
        campo_codigo.wait_for(state="visible", timeout=15_000)
        page.screenshot(path=str(DOWNLOAD_DIR / "03_tela_2fa.png"))
        codigo = aguardar_totp_fresco()
        campo_codigo.fill(codigo)
        for sel in ["#save", "button:has-text('Verificar')", "input[type='submit']"]:
            try:
                page.locator(sel).first.click(timeout=5_000)
                break
            except Exception:
                continue
        log.info("2FA preenchido.")
    except Exception:
        log.info("Nenhuma tela de 2FA apareceu (dispositivo já confiável).")

    page.wait_for_url(lambda url: "login" not in url, timeout=60_000)
    page.screenshot(path=str(DOWNLOAD_DIR / "04_pos_login.png"))
    log.info("Login OK.")


# ─── Helpers de formulário Lightning ───────────────────────────────────────
def preencher_input_por_name(page, name: str, valor: str):
    if not valor:
        return
    page.locator(f"input[name='{name}']").first.fill(str(valor))


def localizar_campo_lookup(page, aria_label: str, timeout=15_000):
    """Localiza o <input> do lookup pelo aria-label — 'Produto' é substring
    de 'Item de Produto', então get_by_role(name=...) sem exact=True pode
    resolver ambos; exact=True primeiro, e o atributo aria-label cru como
    fallback (mais literal, sem depender do cálculo de nome acessível)."""
    tentativas = [
        lambda: page.get_by_role("combobox", name=aria_label, exact=True).first,
        lambda: page.locator(f"input[aria-label='{aria_label}']").first,
    ]
    for tentativa in tentativas:
        try:
            campo = tentativa()
            campo.wait_for(state="visible", timeout=timeout)
            return campo
        except Exception:
            continue
    return None


def selecionar_lookup(page, aria_label: str, texto_completo: str, timeout=15_000) -> bool:
    """Digita no campo de busca (lookup) e clica na opção certa da lista —
    usado pra campos tipo Cliente/Produto/Item de Produto.

    `texto_completo` é o nome EXATO do registro (usado tanto pra buscar
    quanto, principalmente, pra identificar a opção certa entre as que a
    busca retornar). A digitação em si usa só o trecho antes do primeiro
    "(" — nomes de catálogo com pontuação colada no preço (ex.: "SMART
    (R$575...)", sem espaço) atrapalhavam a busca do Salesforce quando
    digitados por inteiro (confirmado em execução real: zero resultados).
    """
    campo = localizar_campo_lookup(page, aria_label, timeout)
    if campo is None:
        log.warning(f"  Campo de busca '{aria_label}' não encontrado.")
        return False
    texto_busca = texto_completo.split('(')[0].strip()
    # force=True: o painel/overlay do lookup anterior às vezes ainda não
    # terminou de fechar e intercepta o clique no próximo campo (confirmado
    # em execução real — "lightning-overlay-container ... intercepts
    # pointer events").
    campo.click(force=True)
    campo.fill(texto_busca, force=True)
    try:
        opcoes = page.locator("lightning-base-combobox-item[role='option']")
        opcoes.first.wait_for(state="visible", timeout=timeout)
        # Pode aparecer mais de uma opção parecida (ex.: mesma velocidade,
        # com/sem "SMART") — identifica a certa pelo atributo title do
        # rótulo, que carrega o nome completo e exato do item; se não achar
        # por title (campo sem essa marcação, ex. "Produto"), cai pra
        # texto visível e por fim pra 1ª opção.
        alvo = opcoes.filter(has=page.locator(f"[title='{texto_completo}']"))
        if alvo.count() == 0:
            alvo = opcoes.filter(has_text=texto_busca)
        (alvo.first if alvo.count() > 0 else opcoes.first).click(force=True)
        page.keyboard.press("Escape")  # fecha qualquer resquício do painel antes do próximo campo
        return True
    except Exception:
        log.warning(f"  Nenhuma opção encontrada para '{aria_label}' = '{texto_completo}'")
        return False


def clicar_botao_com_texto(page, *textos, timeout=10_000) -> bool:
    for texto in textos:
        try:
            page.locator(f"button:has-text('{texto}')").first.click(timeout=timeout)
            return True
        except Exception:
            continue
    return False


# ─── 1. Criar Estudo de Viabilidade ────────────────────────────────────────
def criar_estudo(page, item: dict) -> tuple[str, str]:
    """Cria o EV (tipo Estudo Agregador) e retorna (record_id, numero_ev)."""
    log.info(f"Criando Estudo de Viabilidade para '{item['cliente_final']}'...")

    page.goto(
        f"{RADAR_URL.replace('.my.salesforce.com', '.lightning.force.com')}"
        "/lightning/o/Estudo_de_Viabilidade__c/new"
        "?count=1&nooverride=1&useRecordTypeCheck=1&navigationLocation=LIST_VIEW",
        wait_until="networkidle",
    )

    # Modal 1: escolher tipo de registro — só usamos "Estudo Agregador".
    # force=True: o círculo visual customizado do SLDS fica por cima do
    # <input type="radio"> real e intercepta o clique — confirmado em
    # execução real (Playwright ficava tentando e desistia no timeout).
    page.locator("input[type='radio']").nth(1).check(force=True)  # 2ª opção = Estudo Agregador
    page.locator("button:has-text('Avançar')").click()
    page.wait_for_selector("text=Criar Estudo de Viabilidade: Estudo Agregador", timeout=20_000)

    # Modal 2: formulário — preenche só por atributo `name` (API name real).
    preencher_input_por_name(page, "Razao_Social__c", item.get("razao_social") or item["cliente_final"])
    preencher_input_por_name(page, "CNPJ__c", item.get("cnpj"))
    preencher_input_por_name(page, "Cliente_Final__c", item["cliente_final"])

    if not selecionar_lookup(page, "Produto", item["produto"]):
        raise RuntimeError(f"Produto '{item['produto']}' não encontrado no Radar")

    if item.get("item_produto") and not selecionar_lookup(page, "Item de Produto", item["item_produto"]):
        # Sem opção selecionada da lista, o Salesforce bloqueia o Salvar
        # ("Selecione uma opção...") — desiste na hora em vez de esperar o
        # timeout do Salvar à toa, e limpa o texto solto do campo.
        campo = localizar_campo_lookup(page, "Item de Produto", timeout=5_000)
        if campo:
            campo.fill("", force=True)
        raise RuntimeError(f"Item de Produto '{item['item_produto']}' não encontrado no Radar")

    qtd_input = page.locator("input[name='Quantidade_de_Circuitos__c']").first
    qtd_input.fill(str(item.get("quantidade_circuitos", 1)))

    page.locator("button[name='SaveEdit']").click()
    page.wait_for_selector("text=Criação concluída", timeout=30_000)
    page.wait_for_url(re.compile(r"/lightning/r/Estudo_de_Viabilidade__c/"), timeout=30_000)

    record_id = re.search(r"/Estudo_de_Viabilidade__c/([\w]+)/view", page.url).group(1)
    numero_ev = page.locator("records-highlights2 lightning-formatted-text").first.inner_text(timeout=10_000)
    log.info(f"  Criado: {numero_ev} ({record_id})")
    return record_id, numero_ev


# ─── 2. Definir endereço do SEV (auto-criado junto com o EV) ───────────────
def definir_endereco_sev(page, ev_record_id: str, cep: str):
    log.info(f"Definindo endereço (CEP {cep}) do SEV...")
    base = RADAR_URL.replace(".my.salesforce.com", ".lightning.force.com")
    page.goto(f"{base}/lightning/r/Estudo_de_Viabilidade__c/{ev_record_id}/related/SEV_s__r/view", wait_until="networkidle")

    primeiro_sev = page.locator("lightning-datatable a[href*='/lightning/r/']").first
    primeiro_sev.wait_for(state="visible", timeout=20_000)
    primeiro_sev.click()
    page.wait_for_selector("text=Endereço", timeout=20_000)

    page.locator("a:has-text('Endereço')").first.click()
    page.locator("button.alterarEnderecoBtn").first.click(timeout=15_000)

    page.locator("lightning-input.cepField input").first.fill(cep)
    page.locator("button.buscarCepButton").click()

    # Depois da busca, confirma com o botão que aparecer (varia conforme o
    # CEP já vir com número/complemento resolvidos ou não).
    time.sleep(3)
    if not clicar_botao_com_texto(page, "Validar", "Inserir"):
        log.warning("  Nenhum botão de confirmação encontrado após buscar CEP — screenshot salvo.")
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(DOWNLOAD_DIR / f"erro_endereco_{ev_record_id}.png"))
    time.sleep(2)


# ─── 3. Disparar "Consultar Viabilidade" ───────────────────────────────────
def consultar_viabilidade(page, ev_record_id: str):
    log.info("Disparando 'Consultar Viabilidade'...")
    base = RADAR_URL.replace(".my.salesforce.com", ".lightning.force.com")
    page.goto(f"{base}/lightning/r/Estudo_de_Viabilidade__c/{ev_record_id}/view", wait_until="networkidle")

    page.locator("button[name='Estudo_de_Viabilidade__c.Consultar_Viabilidade']").click(timeout=15_000)
    page.wait_for_selector("text=Consultar Viabilidade", timeout=15_000)

    # Modal pode ter um botão de confirmação (varia por org) — clica se
    # existir; se a ação for auto-executada (só um spinner), segue direto.
    clicar_botao_com_texto(page, "Confirmar", "Consultar", "OK", "Enviar", timeout=5_000)

    page.wait_for_selector("text=enviado com sucesso", timeout=60_000)
    log.info("  Consulta enviada ao GAIA com sucesso.")


# ─── 4. Ler resultado (Status da Consulta / Status das SEVs / SEV) ─────────
def ler_texto_do_campo(page, label: str) -> str | None:
    try:
        item = page.locator(f"records-record-layout-item:has-text('{label}')").first
        return item.locator("lightning-formatted-text, lightning-formatted-rich-text").first.inner_text(timeout=3_000).strip()
    except Exception:
        return None


def ler_resultado(page, ev_record_id: str) -> dict:
    base = RADAR_URL.replace(".my.salesforce.com", ".lightning.force.com")
    page.goto(f"{base}/lightning/r/Estudo_de_Viabilidade__c/{ev_record_id}/view", wait_until="networkidle")

    status_consulta = ler_texto_do_campo(page, "Status da Consulta")
    resultado = {"status_consulta": status_consulta}
    if status_consulta != "Concluído":
        return resultado

    resultado["status_sevs"] = ler_texto_do_campo(page, "Status das SEVs")

    # Lê a 1ª linha da lista relacionada de SEV's (Facilidade + custos).
    try:
        page.goto(f"{base}/lightning/r/Estudo_de_Viabilidade__c/{ev_record_id}/related/SEV_s__r/view", wait_until="networkidle")
        linha = page.locator("lightning-datatable tbody tr").first
        celulas = linha.locator("lightning-primitive-custom-cell").all_inner_texts()
        # Colunas: [checkbox,] Número da SEV, Nome da SEV, Status, Facilidade,
        # Cliente Abordado, Custo Total (CAPEX), Data mod., Data validade.
        if len(celulas) >= 6:
            resultado["facilidade"] = celulas[3].strip() or None
            capex_txt = celulas[5].strip()
            resultado["custo_capex"] = _parse_valor_brl(capex_txt)
    except Exception as e:
        log.warning(f"  Falha ao ler SEV's: {e}")

    return resultado


def _parse_valor_brl(txt: str):
    if not txt or "R$" not in txt:
        return None
    numero = txt.replace("R$", "").strip().replace(".", "").replace(",", ".")
    try:
        return float(numero)
    except ValueError:
        return None


# ─── MAIN ───────────────────────────────────────────────────────────────────
def processar_pendentes(page):
    pendentes = supa_listar("pendente")
    log.info(f"{len(pendentes)} consulta(s) pendente(s).")
    for item in pendentes:
        try:
            supa_atualizar(item["id"], {"status": "processando"})
            record_id, numero_ev = criar_estudo(page, item)
            definir_endereco_sev(page, record_id, item["cep"])
            consultar_viabilidade(page, record_id)
            supa_atualizar(item["id"], {
                "status": "aguardando_resultado",
                "ev_salesforce_id": record_id,
                "ev_numero": numero_ev,
                "status_consulta": "Aguardando Consulta",
            })
        except Exception as e:
            log.error(f"  Falha ao processar consulta {item['id']}: {e}", exc_info=True)
            supa_atualizar(item["id"], {"status": "erro", "erro_mensagem": str(e)[:500]})


def revisar_em_andamento(page):
    em_andamento = supa_listar("aguardando_resultado")
    log.info(f"{len(em_andamento)} consulta(s) aguardando resultado.")
    for item in em_andamento:
        try:
            resultado = ler_resultado(page, item["ev_salesforce_id"])
            if resultado.get("status_consulta") == "Concluído":
                supa_atualizar(item["id"], {**resultado, "status": "concluido"})
            else:
                supa_atualizar(item["id"], {"status_consulta": resultado.get("status_consulta")})
        except Exception as e:
            log.error(f"  Falha ao ler resultado da consulta {item['id']}: {e}", exc_info=True)


def main():
    log.info("=" * 60)
    log.info("Radar Bot")
    log.info("=" * 60)

    pendentes = supa_listar("pendente")
    em_andamento = supa_listar("aguardando_resultado")
    if not pendentes and not em_andamento:
        log.info("Nada a fazer — nenhuma consulta pendente ou aguardando resultado.")
        return

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-dev-shm-usage"])
        page = browser.new_context().new_page()
        page.set_default_timeout(30_000)

        try:
            login(page)
            processar_pendentes(page)
            revisar_em_andamento(page)
        except Exception:
            DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
            try:
                page.screenshot(path=str(DOWNLOAD_DIR / "99_erro_fatal.png"))
            except Exception:
                pass
            raise
        finally:
            browser.close()

    log.info("Concluído.")


if __name__ == "__main__":
    main()
