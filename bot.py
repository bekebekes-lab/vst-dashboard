"""
NeoSales → Google Sheets Bot
Seletores inspecionados diretamente na página real (Vaadin framework).
Fluxo: login → 2FA TOTP → painel-producao → preenche datas → seleciona painel
       → clica aba "Exportação" → aguarda modal → faz download
       → atualiza aba BaseCRM no Google Sheets.
"""

import calendar
import os
import time
import json
import logging
from datetime import date, datetime
from pathlib import Path

import gspread
import openpyxl
import pyotp
from google.oauth2.service_account import Credentials
from playwright.sync_api import sync_playwright

# ─── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ─── Configurações (via GitHub Secrets) ───────────────────────────────────────
NEOSALES_URL  = "https://vipsul.neosales.com.br"
NEOSALES_USER = os.environ["NEOSALES_USER"]
NEOSALES_PASS = os.environ["NEOSALES_PASS"]
TOTP_SECRET   = os.environ.get("TOTP_SECRET", "")
SHEET_ID      = os.environ["SHEET_ID"]
DOWNLOAD_DIR  = Path("/tmp/neosales")

# ─── Período alvo ──────────────────────────────────────────────────────────────
# PERIODO_ALVO vem do botão "Atualizar" do Dash (dispara o workflow_dispatch
# com o mês que estava selecionado no seletor de Período) — vazio nas
# execuções agendadas, que continuam sempre pegando o mês corrente ao vivo.
# Formato esperado: "MMYYYY" (ex.: "082026"), igual ao padrão das abas
# históricas "BaseCRM MMYYYY" já usadas pelo Dash.
def resolver_periodo_alvo():
    """
    Devolve (data_inicio, data_fim, aba_destino) a partir de PERIODO_ALVO.
    Sem PERIODO_ALVO (execução agendada normal): mês corrente, do dia 1 até
    hoje, gravando na aba "BaseCRM" (live) — comportamento de sempre.
    Com PERIODO_ALVO="MMYYYY" (mês passado, escolhido no Dash): o mês
    inteiro (dia 1 ao último dia), gravando numa aba própria "BaseCRM
    MMYYYY" — não mexe na aba live.
    """
    bruto = os.environ.get("PERIODO_ALVO", "").strip()
    if not bruto or bruto.upper() == "BASECRM":
        hoje = date.today()
        return hoje.replace(day=1), hoje, "BaseCRM"

    mm, yyyy = bruto[:2], bruto[2:]
    mes, ano = int(mm), int(yyyy)
    ultimo_dia = calendar.monthrange(ano, mes)[1]
    data_inicio = date(ano, mes, 1)
    data_fim    = date(ano, mes, ultimo_dia)
    return data_inicio, data_fim, f"BaseCRM {mm}{yyyy}"

# ─── Seletores confirmados por inspeção real (Vaadin) ─────────────────────────
SEL_LOGIN_USER       = "#input-vaadin-text-field-16"
SEL_LOGIN_PASS       = "#input-vaadin-password-field-17"
SEL_LOGIN_BTN        = "vaadin-button:has-text('Logar')"
SEL_2FA_CODE         = "#input-vaadin-text-field-22"
SEL_DATA_INI         = "vaadin-date-picker:first-of-type input"
SEL_DATA_FIM         = "vaadin-date-picker:nth-of-type(2) input"
SEL_PAINEL           = "vaadin-combo-box:first-of-type"
SEL_ABA_EXPORTACAO   = "vaadin-tab:has-text('Exportação')"
SEL_PESQUISAR        = "vaadin-button:has-text('Pesquisar')"  # ainda usado para acionar a busca inicial
PAINEL_VALOR         = "PAINEL DE PRODUCAO CLARO VIPSUL"


# ─── HELPER: gerar código TOTP ────────────────────────────────────────────────
def gerar_totp() -> str:
    """Gera o código TOTP atual. Usa valid_window=1 para tolerância de ±30s."""
    totp = pyotp.TOTP(TOTP_SECRET)
    codigo = totp.now()
    log.info(f"  Código TOTP gerado")
    return codigo


def verificar_e_aguardar_totp() -> str:
    """
    Aguarda o início de um novo período TOTP para garantir que o código
    tenha pelo menos 25 segundos de validade antes de expirar.
    """
    import time as _time
    totp = pyotp.TOTP(TOTP_SECRET)
    # Calcula quantos segundos faltam para o próximo período
    segundos_restantes = 30 - (int(_time.time()) % 30)
    if segundos_restantes < 8:
        log.info(f"  Aguardando {segundos_restantes}s para novo período TOTP...")
        _time.sleep(segundos_restantes + 1)
    codigo = totp.now()
    log.info(f"  Código TOTP gerado (válido por ~{30 - (int(_time.time()) % 30)}s)")
    return codigo


# ─── HELPER: preencher vaadin-date-picker ─────────────────────────────────────
def preencher_vaadin_date(page, seletor: str, valor: str, label: str = ""):
    tentativas = [seletor]
    if label:
        tentativas.append(f"vaadin-date-picker[label='{label}'] input")

    for sel in tentativas:
        try:
            el = page.locator(sel).first
            el.wait_for(state="visible", timeout=5_000)
            el.click()
            el.click(click_count=3)
            el.type(valor, delay=80)
            page.keyboard.press("Escape")
            time.sleep(0.3)
            log.info(f"  Data '{valor}' via '{sel}'")
            return
        except Exception:
            pass

    log.warning(f"  Fallback JS para data '{valor}'")
    page.evaluate(f"""
        (function() {{
            function deep(root, id) {{
                if (root.id === id) return root;
                for (const el of root.querySelectorAll('*')) {{
                    if (el.id === id) return el;
                    if (el.shadowRoot) {{ const r = deep(el.shadowRoot, id); if (r) return r; }}
                }}
            }}
            const inp = deep(document, '{seletor.lstrip("#")}');
            if (inp) {{
                inp.value = '{valor}';
                inp.dispatchEvent(new Event('input',  {{bubbles:true}}));
                inp.dispatchEvent(new Event('change', {{bubbles:true}}));
            }}
        }})();
    """)


# ─── HELPER: selecionar vaadin-combo-box ──────────────────────────────────────
def selecionar_vaadin_combo(page, seletor: str, valor: str):
    try:
        el = page.locator(seletor).first
        el.wait_for(state="visible", timeout=10_000)
        el.click()
        time.sleep(0.5)
        el.click(click_count=3)
        page.keyboard.press('Control+a')
        page.keyboard.press('Delete')
        time.sleep(0.3)
        el.type(valor[:10], delay=80)
        time.sleep(1.5)
        # Tenta clicar na opção pelo texto
        opcao = page.locator(f"vaadin-combo-box-item:has-text('{valor[:20]}')")
        if opcao.count() > 0:
            opcao.first.click(timeout=5_000)
            log.info(f"  Combo '{valor}' selecionado via item")
        else:
            # Fallback: pressiona Enter
            page.keyboard.press("Enter")
            log.info(f"  Combo '{valor}' confirmado via Enter")
    except Exception as e:
        log.warning(f"  Combo '{seletor}' falhou: {e}")
        page.screenshot(path=str(DOWNLOAD_DIR / "erro_combo.png"))


# ─── HELPER: lidar com 2FA TOTP se aparecer ───────────────────────────────────
def lidar_com_2fa(page):
    seletores_2fa = [
        "input[autocomplete='one-time-code']",
        "input[placeholder*='digo']",
        "input[placeholder*='code']",
        "input[placeholder*='token']",
        "vaadin-text-field[label*='digo'] input",
        "vaadin-text-field[label*='Code'] input",
        "vaadin-text-field[label*='Token'] input",
        "vaadin-text-field[label*='utenti'] input",
    ]
    for sel in seletores_2fa:
        try:
            el = page.locator(sel).first
            el.wait_for(state="visible", timeout=3_000)
            codigo = gerar_totp()
            el.fill(codigo)
            time.sleep(0.5)
            page.keyboard.press("Enter")
            log.info(f"  2FA preenchido via: {sel}")
            time.sleep(2)
            return True
        except Exception:
            continue
    log.info("  Nenhuma tela de 2FA detectada.")
    return False


# ─── 1. LOGIN + DOWNLOAD ──────────────────────────────────────────────────────
def baixar_relatorio(data_inicio_dt: date, data_fim_dt: date) -> Path:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    agora       = datetime.now()  # só pro nome do arquivo baixado, não é o período da consulta
    data_inicio = data_inicio_dt.strftime("%d/%m/%Y")
    data_fim    = data_fim_dt.strftime("%d/%m/%Y")
    log.info(f"Período: {data_inicio} → {data_fim}")

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        context = browser.new_context(accept_downloads=True)
        page    = context.new_page()
        page.set_default_timeout(30_000)

        # ── Login ──────────────────────────────────────────────────────────
        log.info("Fazendo login...")
        page.goto(f"{NEOSALES_URL}/login", wait_until="networkidle")
        page.wait_for_selector(SEL_LOGIN_USER, timeout=40_000)

        page.fill(SEL_LOGIN_USER, NEOSALES_USER)
        page.fill(SEL_LOGIN_PASS, NEOSALES_PASS)

        # ── Gera e preenche 2FA imediatamente antes de clicar ──────────────
        log.info("Preenchendo código 2FA...")
        codigo_2fa = verificar_e_aguardar_totp()
        page.fill(SEL_2FA_CODE, codigo_2fa)
        log.info(f"  Código 2FA preenchido.")

        # Clica imediatamente sem delay
        page.locator(SEL_LOGIN_BTN).click(timeout=10_000)

        page.screenshot(path=str(DOWNLOAD_DIR / "pos_login.png"))
        log.info("Screenshot pós-login salvo.")
        time.sleep(3)
        page.screenshot(path=str(DOWNLOAD_DIR / "pos_login.png"))
        log.info("Screenshot pós-login salvo.")

        # ── Aguarda redirecionamento pós-login ─────────────────────────────
        page.wait_for_url(lambda url: "/login" not in url, timeout=60_000)
        log.info("Login OK.")

        # ── Navega para Painel de Produção ─────────────────────────────────
        log.info("Navegando para /painel-producao...")
        page.goto(f"{NEOSALES_URL}/painel-producao", wait_until="networkidle")
        time.sleep(3)
        page.screenshot(path=str(DOWNLOAD_DIR / "painel_producao.png"))
        log.info("Screenshot do painel salvo.")

        # Loga IDs reais dos campos vaadin para debug
        try:
            ids = page.evaluate(
                "() => Array.from(document.querySelectorAll('vaadin-date-picker,vaadin-combo-box,vaadin-radio-button')).map(e => ({tag:e.tagName,id:e.id,label:e.getAttribute('label')||''}))"
            )
            for item in ids:
                log.info(f"  Vaadin: {item}")
        except Exception as ex:
            log.warning(f"  Falha ao inspecionar elementos: {ex}")

        # Aguarda campo de data com múltiplos seletores
        sels_data = [
            SEL_DATA_INI,
            "vaadin-date-picker[label='Inicial'] input",
            "vaadin-date-picker[label='Data Inicial'] input",
            "vaadin-date-picker[label='De'] input",
            "vaadin-date-picker:first-of-type input",
        ]
        sel_ini_ok = SEL_DATA_INI
        for sel in sels_data:
            try:
                page.wait_for_selector(sel, timeout=5_000)
                sel_ini_ok = sel
                log.info(f"  Campo data inicial encontrado: {sel}")
                break
            except Exception:
                continue
        else:
            page.screenshot(path=str(DOWNLOAD_DIR / "erro_painel.png"))
            raise RuntimeError("Campo de data não encontrado no painel.")
        time.sleep(1)

        # ── Preenche datas ─────────────────────────────────────────────────
        log.info(f"Datas: {data_inicio} → {data_fim}")
        preencher_vaadin_date(page, sel_ini_ok, data_inicio, "Inicial")
        preencher_vaadin_date(page, SEL_DATA_FIM, data_fim,    "Final")

        # ── Fecha calendário antes de interagir com combo ────────────────
        page.keyboard.press("Escape")
        time.sleep(0.5)
        page.keyboard.press("Escape")
        time.sleep(0.5)
        page.screenshot(path=str(DOWNLOAD_DIR / "pre_combo.png"))

        # ── Seleciona painel ───────────────────────────────────────────────
        log.info(f"Selecionando painel: {PAINEL_VALOR}")
        selecionar_vaadin_combo(page, SEL_PAINEL, PAINEL_VALOR)
        time.sleep(0.5)
        page.screenshot(path=str(DOWNLOAD_DIR / "pos_combo.png"))

        # ── Clica em "Pesquisar" pra aplicar o filtro de datas ─────────────
        # Sem isso, a aba Exportação gera o arquivo em cima da última busca
        # já aplicada no servidor (não das datas recém-digitadas) — foi a
        # causa real do mês inteiro vir incompleto (o filtro nunca era
        # aplicado de fato, só preenchido visualmente nos campos).
        log.info("Clicando em 'Pesquisar' pra aplicar o filtro de datas...")
        page.keyboard.press("Escape")
        time.sleep(0.5)
        try:
            page.locator(SEL_PESQUISAR).first.click(timeout=10_000)
            log.info("  'Pesquisar' clicado.")
        except Exception as e:
            # Crítico: sem isso, a exportação sai em cima do filtro antigo
            # (foi exatamente a causa do mês incompleto) — falha alto em vez
            # de seguir silenciosamente com dado errado.
            page.screenshot(path=str(DOWNLOAD_DIR / "erro_pesquisar.png"))
            raise RuntimeError(f"Falha ao clicar 'Pesquisar' — abortando pra não gerar exportação com filtro errado: {e}")
        time.sleep(2)
        page.screenshot(path=str(DOWNLOAD_DIR / "pos_pesquisar.png"))

        # ── Clica na aba "Exportação" (novo fluxo) ────────────────────────
        log.info("Clicando na aba 'Exportação'...")
        arquivo = DOWNLOAD_DIR / f"producao_{agora.strftime('%Y%m%d_%H%M')}.xlsx"

        # Tenta via seletor Vaadin tab; fallback via JS
        aba_exportacao_clicada = False
        for sel_tab in [SEL_ABA_EXPORTACAO, "vaadin-tab:has-text('Exportacao')"]:
            try:
                el_tab = page.locator(sel_tab).first
                el_tab.wait_for(state="visible", timeout=10_000)
                el_tab.click(timeout=10_000)
                aba_exportacao_clicada = True
                log.info(f"  Aba Exportação clicada via: {sel_tab}")
                break
            except Exception:
                continue

        if not aba_exportacao_clicada:
            log.warning("  Fallback JS para clicar na aba Exportação")
            page.evaluate(
                "document.querySelectorAll('vaadin-tab').forEach(t => { if(t.textContent.trim().toLowerCase().includes('exporta')) t.click(); })"
            )

        time.sleep(2)
        page.screenshot(path=str(DOWNLOAD_DIR / "pos_aba_exportacao.png"))

        # Pra períodos grandes (mês inteiro), o NeoSales mostra "Gerando
        # exportação em segundo plano" antes do arquivo ficar pronto (~40s
        # pra um mês inteiro, confirmado manualmente). Sem esperar esse
        # estado terminar, "Arquivo disponível" podia já estar na tela (de
        # uma exportação anterior ou como rótulo estático) e o bot baixava
        # um arquivo errado/incompleto — foi isso que causou a extração de
        # agosto vir com só ~40% das linhas reais.
        try:
            page.wait_for_selector("text=Gerando exportação em segundo plano", timeout=8_000)
            log.info("  Geração em segundo plano detectada — aguardando concluir...")
            page.wait_for_selector("text=Gerando exportação em segundo plano", state="hidden", timeout=180_000)
            log.info("  Geração concluída.")
        except Exception:
            log.info("  Indicador de geração em segundo plano não apareceu — seguindo direto pro arquivo.")

        # Aguarda o modal "Arquivo disponível" (aparece automaticamente após clicar na aba)
        log.info("Aguardando modal 'Arquivo disponível'...")
        page.wait_for_selector("text=Arquivo disponível", timeout=120_000)
        time.sleep(1)
        page.screenshot(path=str(DOWNLOAD_DIR / "modal_download.png"))
        log.info("Modal 'Arquivo disponível' detectado.")

        # Clica no link do arquivo para disparar o download
        with page.expect_download(timeout=30_000) as dl_info:
            page.locator("text=ExportacaoProducao.xlsx").click(timeout=10_000)

        dl_info.value.save_as(str(arquivo))
        log.info(f"Download salvo: {arquivo}")

        browser.close()

    return arquivo


# ─── 2. LER XLSX ──────────────────────────────────────────────────────────────
def formatar_celula(valor):
    """Converte valor para tipo seguro para o Google Sheets via RAW."""
    if valor is None:
        return ""
    import math
    if isinstance(valor, float):
        if math.isnan(valor):
            return ""
        if valor == int(valor):
            return int(valor)
        return valor
    if isinstance(valor, int):
        return valor
    return str(valor)

def ler_xlsx(arquivo: Path) -> tuple[list, list[list]]:
    import pandas as pd
    log.info(f"Lendo {arquivo.name}...")

    # dtype=str evita que o pandas converta qualquer coisa para datetime ou float
    df = pd.read_excel(arquivo, dtype=str)
    df = df.fillna("")

    cabecalhos = list(df.columns)
    dados = df.values.tolist()

    log.info(f"  {len(dados)} registros | {len(cabecalhos)} colunas")
    return cabecalhos, dados


# ─── 3. ATUALIZAR GOOGLE SHEETS ───────────────────────────────────────────────
def atualizar_sheets(cabecalhos: list, dados: list[list], aba_destino: str):
    log.info(f"Atualizando Sheets → aba '{aba_destino}'...")

    raw_creds = os.environ.get("GOOGLE_CREDENTIALS", "").strip()
    if not raw_creds:
        raise ValueError("GOOGLE_CREDENTIALS está vazio!")
    log.info(f"  GOOGLE_CREDENTIALS — primeiros 20 chars: {raw_creds[:20]}")
    log.info(f"  GOOGLE_CREDENTIALS — tamanho: {len(raw_creds)} chars")
    # Tenta parse direto, depois tenta corrigir aspas simples
    creds_dict = None
    for tentativa, texto in enumerate([
        raw_creds,
        raw_creds.replace("'", '"'),
        raw_creds.strip("'").strip('"'),
    ]):
        try:
            creds_dict = json.loads(texto)
            log.info(f"  JSON parsed OK na tentativa {tentativa+1}")
            break
        except json.JSONDecodeError as e:
            log.warning(f"  Tentativa {tentativa+1} falhou: {e}")
    if creds_dict is None:
        raise ValueError("GOOGLE_CREDENTIALS não é JSON válido após 3 tentativas")
    creds = Credentials.from_service_account_info(
        creds_dict,
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    gc    = gspread.authorize(creds)
    sheet = gc.open_by_key(SHEET_ID)

    try:
        aba = sheet.worksheet(aba_destino)
    except gspread.WorksheetNotFound:
        aba = sheet.add_worksheet(title=aba_destino, rows=1, cols=1)
        log.info(f"  Aba '{aba_destino}' criada.")

    aba.resize(rows=len(dados) + 1, cols=len(cabecalhos))
    aba.clear()
    aba.update([cabecalhos] + dados, value_input_option="RAW")
    log.info(f"  ✅ {len(dados)} linhas gravadas em '{aba_destino}'.")


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    log.info("=" * 60)
    log.info(f"NeoSales Bot  —  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    # MODO_TESTE=1: baixa e lê o arquivo normalmente, mas NUNCA grava no
    # Sheets — usado pra validar a extração (contagem de linhas) sem
    # arriscar sobrescrever uma aba real com dado ainda não confirmado.
    modo_teste = os.environ.get("MODO_TESTE", "").strip().lower() in ("1", "true", "sim")

    try:
        data_inicio_dt, data_fim_dt, aba_destino = resolver_periodo_alvo()
        log.info(f"Alvo: {data_inicio_dt} → {data_fim_dt} → aba '{aba_destino}'" + (" [MODO TESTE — não vai gravar]" if modo_teste else ""))
        arquivo = baixar_relatorio(data_inicio_dt, data_fim_dt)
        cabecalhos, dados = ler_xlsx(arquivo)
        if modo_teste:
            log.info(f"🧪 MODO TESTE: {len(dados)} linhas extraídas, {len(cabecalhos)} colunas — NÃO gravado em '{aba_destino}'.")
        else:
            atualizar_sheets(cabecalhos, dados, aba_destino)
        log.info("✅ Concluído com sucesso!")
    except Exception as e:
        log.error(f"❌ Falha: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    main()
