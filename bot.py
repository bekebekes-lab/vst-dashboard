"""
NeoSales → Google Sheets Bot
Seletores inspecionados diretamente na página real (Vaadin framework).
Fluxo: login → painel-producao → preenche datas → seleciona painel
       → seleciona visão EXPORTACAO → clica Pesquisar → aguarda download
       → atualiza aba BaseCRM no Google Sheets.
"""

import os
import time
import json
import logging
from datetime import date, datetime
from pathlib import Path

import gspread
import openpyxl
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
SHEET_ID      = os.environ["SHEET_ID"]
ABA_DESTINO   = "BaseCRM"
DOWNLOAD_DIR  = Path("/tmp/neosales")

# ─── Seletores confirmados por inspeção real (Vaadin) ─────────────────────────
# Login
SEL_LOGIN_USER = "#input-vaadin-text-field-13"
SEL_LOGIN_PASS = "#input-vaadin-password-field-14"
SEL_LOGIN_BTN  = "vaadin-button"

# Painel de Produção
SEL_DATA_INI   = "#input-vaadin-date-picker-67"
SEL_DATA_FIM   = "#input-vaadin-date-picker-68"
SEL_PAINEL     = "#input-vaadin-combo-box-70"

# Visão EXPORTACAO — radio button confirmado (id: input-vaadin-radio-button-85)
SEL_RADIO_EXPORTACAO = "#input-vaadin-radio-button-85"

# Botão Pesquisar — dispara o download quando visão = EXPORTACAO
SEL_PESQUISAR  = "vaadin-button:has-text('Pesquisar')"

# Painel correto (confirmado pelas opções reais do combo)
PAINEL_VALOR   = "PAINEL DE PRODUCAO CLARO VIPSUL"


# ─── HELPER: preencher vaadin-date-picker ─────────────────────────────────────
def preencher_vaadin_date(page, seletor: str, valor: str, label: str = ""):
    """
    Preenche um campo vaadin-date-picker.
    O input real fica dentro do shadow DOM do componente.
    valor no formato DD/MM/AAAA.
    """
    tentativas = [seletor]
    if label:
        tentativas.append(f"vaadin-date-picker[label='{label}'] input")

    for sel in tentativas:
        try:
            el = page.locator(sel).first
            el.wait_for(state="visible", timeout=5_000)
            el.click()
            el.triple_click()
            el.type(valor, delay=80)
            page.keyboard.press("Escape")   # fecha o calendário se abrir
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
    """Digita no combo e clica na opção correspondente."""
    try:
        el = page.locator(seletor).first
        el.wait_for(state="visible", timeout=5_000)
        el.click()
        el.triple_click()
        # Digita os primeiros 10 chars para filtrar
        el.type(valor[:10], delay=80)
        time.sleep(1)

        # Clica na opção que contém o valor
        opcao = page.locator(f"vaadin-combo-box-item:has-text('{valor[:20]}')")
        opcao.first.click(timeout=5_000)
        log.info(f"  Combo '{valor}' selecionado")
    except Exception as e:
        log.warning(f"  Combo '{seletor}' falhou: {e}")
        # Tira screenshot para debug
        page.screenshot(path=str(DOWNLOAD_DIR / "erro_combo.png"))


# ─── 1. LOGIN + DOWNLOAD ──────────────────────────────────────────────────────
def baixar_relatorio() -> Path:
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)

    hoje        = date.today()
    data_inicio = hoje.replace(day=1).strftime("%d/%m/%Y")
    data_fim    = hoje.strftime("%d/%m/%Y")
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
        page.wait_for_selector(SEL_LOGIN_USER, timeout=15_000)

        page.fill(SEL_LOGIN_USER, NEOSALES_USER)
        page.fill(SEL_LOGIN_PASS, NEOSALES_PASS)
        page.locator(SEL_LOGIN_BTN).first.click()

        page.wait_for_url(lambda url: "/login" not in url, timeout=20_000)
        log.info("Login OK.")

        # ── Navega para Painel de Produção ─────────────────────────────────
        log.info("Navegando para /painel-producao...")
        page.goto(f"{NEOSALES_URL}/painel-producao", wait_until="networkidle")
        page.wait_for_selector(SEL_DATA_INI, timeout=20_000)
        time.sleep(1)

        # ── Preenche datas ─────────────────────────────────────────────────
        log.info(f"Datas: {data_inicio} → {data_fim}")
        preencher_vaadin_date(page, SEL_DATA_INI, data_inicio, "Inicial")
        preencher_vaadin_date(page, SEL_DATA_FIM, data_fim,    "Final")

        # ── Seleciona painel "PAINEL DE PRODUCAO CLARO VIPSUL" ─────────────
        log.info(f"Selecionando painel: {PAINEL_VALOR}")
        selecionar_vaadin_combo(page, SEL_PAINEL, PAINEL_VALOR)
        time.sleep(0.5)

        # ── Seleciona visão EXPORTACAO (radio button) ──────────────────────
        # IMPORTANTE: selecionar esta visão antes de pesquisar faz o
        # Pesquisar disparar o download direto do arquivo XLSX.
        log.info("Selecionando visão EXPORTACAO...")
        try:
            page.locator(SEL_RADIO_EXPORTACAO).click(timeout=5_000)
            log.info("  Radio EXPORTACAO selecionado via ID")
        except Exception:
            # Fallback por label
            page.locator("vaadin-radio-button:has-text('EXPORTACAO')").first.click(timeout=5_000)
            log.info("  Radio EXPORTACAO selecionado via texto")

        time.sleep(0.5)

        # ── Pesquisar → dispara o download ─────────────────────────────────
        log.info("Clicando em Pesquisar (gera o download)...")
        arquivo = DOWNLOAD_DIR / f"producao_{hoje.strftime('%Y%m%d_%H%M')}.xlsx"

        with page.expect_download(timeout=120_000) as dl_info:
            page.locator(SEL_PESQUISAR).click(timeout=10_000)

        dl_info.value.save_as(str(arquivo))
        log.info(f"Download salvo: {arquivo}")

        browser.close()

    return arquivo


# ─── 2. LER XLSX ──────────────────────────────────────────────────────────────
def ler_xlsx(arquivo: Path) -> tuple[list, list[list]]:
    log.info(f"Lendo {arquivo.name}...")
    wb   = openpyxl.load_workbook(arquivo, read_only=True, data_only=True)
    ws   = wb.active
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    if not rows:
        raise ValueError("Arquivo XLSX vazio.")

    cabecalhos = [str(c) if c is not None else "" for c in rows[0]]
    dados = [
        [str(c) if c is not None else "" for c in row]
        for row in rows[1:]
        if any(c for c in row)
    ]
    log.info(f"  {len(dados)} registros | {len(cabecalhos)} colunas")
    return cabecalhos, dados


# ─── 3. ATUALIZAR GOOGLE SHEETS ───────────────────────────────────────────────
def atualizar_sheets(cabecalhos: list, dados: list[list]):
    log.info(f"Atualizando Sheets → aba '{ABA_DESTINO}'...")

    creds = Credentials.from_service_account_info(
        json.loads(os.environ["GOOGLE_CREDENTIALS"]),
        scopes=["https://www.googleapis.com/auth/spreadsheets"],
    )
    gc    = gspread.authorize(creds)
    sheet = gc.open_by_key(SHEET_ID)

    try:
        aba = sheet.worksheet(ABA_DESTINO)
    except gspread.WorksheetNotFound:
        aba = sheet.add_worksheet(title=ABA_DESTINO, rows=1, cols=1)
        log.info(f"  Aba '{ABA_DESTINO}' criada.")

    aba.resize(rows=len(dados) + 1, cols=len(cabecalhos))
    aba.clear()
    aba.update([cabecalhos] + dados, value_input_option="USER_ENTERED")
    log.info(f"  ✅ {len(dados)} linhas gravadas em '{ABA_DESTINO}'.")


# ─── MAIN ─────────────────────────────────────────────────────────────────────
def main():
    log.info("=" * 60)
    log.info(f"NeoSales Bot  —  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    try:
        arquivo = baixar_relatorio()
        cabecalhos, dados = ler_xlsx(arquivo)
        atualizar_sheets(cabecalhos, dados)
        log.info("✅ Concluído com sucesso!")
    except Exception as e:
        log.error(f"❌ Falha: {e}", exc_info=True)
        raise


if __name__ == "__main__":
    main()
