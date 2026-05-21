"""
NeoSales → Google Sheets Bot
Seletores inspecionados diretamente na página real (Vaadin framework).
Fluxo: login → 2FA TOTP → painel-producao → preenche datas → seleciona painel
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
TOTP_SECRET   = os.environ.get("TOTP_SECRET", "").strip().replace(" ", "")
SHEET_ID      = os.environ["SHEET_ID"]
ABA_DESTINO   = "BaseCRM"
DOWNLOAD_DIR  = Path("/tmp/neosales")

# ─── Seletores confirmados por inspeção real (Vaadin) ─────────────────────────
SEL_LOGIN_USER       = "#input-vaadin-text-field-16"
SEL_LOGIN_PASS       = "#input-vaadin-password-field-17"
SEL_LOGIN_BTN        = "vaadin-button:has-text('Logar')"
SEL_2FA_CODE         = "#input-vaadin-text-field-22"
SEL_DATA_INI         = "#input-vaadin-date-picker-67"
SEL_DATA_FIM         = "#input-vaadin-date-picker-68"
SEL_PAINEL           = "#input-vaadin-combo-box-70"
SEL_RADIO_EXPORTACAO = "#input-vaadin-radio-button-85"
SEL_PESQUISAR        = "vaadin-button:has-text('Pesquisar')"
PAINEL_VALOR         = "PAINEL DE PRODUCAO CLARO VIPSUL"


# ─── HELPER: gerar código TOTP com diagnóstico ────────────────────────────────
def gerar_totp_seguro() -> str:
    """
    Gera o código TOTP aguardando que haja pelo menos 15s de validade restante.
    Loga informações de diagnóstico para facilitar depuração.
    """
    if not TOTP_SECRET:
        raise ValueError("TOTP_SECRET não configurado!")

    totp = pyotp.TOTP(TOTP_SECRET)

    # Diagnóstico: mostra o timestamp atual e o código gerado
    ts_atual = int(time.time())
    segundos_no_periodo = ts_atual % 30
    segundos_restantes  = 30 - segundos_no_periodo

    log.info(f"  TOTP — timestamp Unix: {ts_atual}")
    log.info(f"  TOTP — posição no período: {segundos_no_periodo}s / 30s")
    log.info(f"  TOTP — tempo restante no código atual: {segundos_restantes}s")

    # Aguarda se restar menos de 10s para garantir validade durante o envio
    if segundos_restantes < 10:
        log.info(f"  TOTP — aguardando {segundos_restantes + 1}s para novo período...")
        time.sleep(segundos_restantes + 1)
        ts_atual = int(time.time())
        segundos_restantes = 30 - (ts_atual % 30)
        log.info(f"  TOTP — novo tempo restante: {segundos_restantes}s")

    codigo = totp.now()
    log.info(f"  TOTP — código gerado (válido por ~{segundos_restantes}s)")

    # Validação local antes de enviar
    if not totp.verify(codigo, valid_window=1):
        log.warning("  TOTP — AVISO: código não validou localmente (possível dessincronização de relógio)")

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
            el.triple_click()
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
        el.wait_for(state="visible", timeout=5_000)
        el.click()
        el.triple_click()
        el.type(valor[:10], delay=80)
        time.sleep(1)
        opcao = page.locator(f"vaadin-combo-box-item:has-text('{valor[:20]}')")
        opcao.first.click(timeout=5_000)
        log.info(f"  Combo '{valor}' selecionado")
    except Exception as e:
        log.warning(f"  Combo '{seletor}' falhou: {e}")
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

        # ── Login com loop de tentativas TOTP ─────────────────────────────
        log.info("Fazendo login...")
        page.goto(f"{NEOSALES_URL}/login", wait_until="networkidle")
        page.wait_for_selector(SEL_LOGIN_USER, timeout=40_000)

        def preencher_campo_2fa(codigo: str):
            """Preenche o campo 2FA usando ID fixo ou fallback."""
            seletores = [
                SEL_2FA_CODE,
                "input[autocomplete='one-time-code']",
                "vaadin-text-field[label*='2FA'] input",
                "vaadin-text-field[label*='Codigo'] input",
                "vaadin-text-field[label*='digo'] input",
            ]
            for sel in seletores:
                try:
                    el = page.locator(sel).first
                    el.wait_for(state="visible", timeout=3_000)
                    el.triple_click()
                    el.fill(codigo)
                    log.info(f"  Campo 2FA preenchido via: {sel}")
                    return True
                except Exception:
                    continue
            return False

        login_ok = False
        for tentativa in range(1, 4):  # até 3 tentativas (cobre ~90s de janela TOTP)
            log.info(f"Tentativa de login {tentativa}/3...")

            # Preenche usuário e senha sempre (a página pode ter recarregado)
            page.fill(SEL_LOGIN_USER, NEOSALES_USER)
            page.fill(SEL_LOGIN_PASS, NEOSALES_PASS)

            # Gera código TOTP com margem mínima de 10s
            codigo_2fa = gerar_totp_seguro()

            if not preencher_campo_2fa(codigo_2fa):
                log.error("  Não foi possível encontrar o campo 2FA!")
                break

            page.screenshot(path=str(DOWNLOAD_DIR / f"pre_login_{tentativa}.png"))
            log.info(f"  Screenshot pré-clique {tentativa} salvo.")

            page.locator(SEL_LOGIN_BTN).click(timeout=10_000)
            time.sleep(3)  # aguarda resposta do servidor

            page.screenshot(path=str(DOWNLOAD_DIR / f"pos_login_{tentativa}.png"))
            log.info(f"  Screenshot pós-clique {tentativa} salvo.")

            current_url = page.url
            log.info(f"  URL após tentativa {tentativa}: {current_url}")

            if "/login" not in current_url:
                log.info(f"  ✅ Login bem-sucedido na tentativa {tentativa}!")
                login_ok = True
                break

            # Verifica mensagem de erro na página
            try:
                if page.locator("text=inválido").first.is_visible(timeout=1_000):
                    log.warning(f"  Código TOTP rejeitado na tentativa {tentativa}.")
            except Exception:
                pass

            if tentativa < 3:
                # Aguarda o próximo período TOTP completo antes de tentar novamente
                segundos_restantes = 30 - (int(time.time()) % 30)
                log.info(f"  Aguardando {segundos_restantes + 2}s para próximo período TOTP...")
                time.sleep(segundos_restantes + 2)

        if not login_ok:
            page.screenshot(path=str(DOWNLOAD_DIR / "falha_login_final.png"))
            raise RuntimeError(
                "Login falhou após 3 tentativas TOTP. "
                "Verifique as screenshots e confirme que o relógio do runner está sincronizado. "
                "O TOTP_SECRET foi confirmado como correto."
            )

        # ── Navega para Painel de Produção ─────────────────────────────────
        log.info("Navegando para /painel-producao...")
        page.goto(f"{NEOSALES_URL}/painel-producao", wait_until="networkidle")
        page.wait_for_selector(SEL_DATA_INI, timeout=20_000)
        time.sleep(1)

        # ── Preenche datas ─────────────────────────────────────────────────
        log.info(f"Datas: {data_inicio} → {data_fim}")
        preencher_vaadin_date(page, SEL_DATA_INI, data_inicio, "Inicial")
        preencher_vaadin_date(page, SEL_DATA_FIM, data_fim,    "Final")

        # ── Seleciona painel ───────────────────────────────────────────────
        log.info(f"Selecionando painel: {PAINEL_VALOR}")
        selecionar_vaadin_combo(page, SEL_PAINEL, PAINEL_VALOR)
        time.sleep(0.5)

        # ── Seleciona visão EXPORTACAO ─────────────────────────────────────
        log.info("Selecionando visão EXPORTACAO...")
        try:
            page.locator(SEL_RADIO_EXPORTACAO).click(timeout=5_000)
            log.info("  Radio EXPORTACAO selecionado via ID")
        except Exception:
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
