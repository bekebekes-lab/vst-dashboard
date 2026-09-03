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
import random
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


def gerar_cnpj_aleatorio() -> str:
    """CNPJ com dígitos verificadores válidos, de empresa fictícia — o Dash
    não coleta CNPJ real do consultor (campo removido), mas o Salesforce
    exige o campo preenchido em formato válido."""
    def digito_verificador(numeros, pesos):
        soma = sum(n * p for n, p in zip(numeros, pesos))
        resto = soma % 11
        return 0 if resto < 2 else 11 - resto

    base = [random.randint(0, 9) for _ in range(8)] + [0, 0, 0, 1]  # filial 0001
    d1 = digito_verificador(base, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    d2 = digito_verificador(base + [d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return "".join(map(str, base + [d1, d2]))


def separar_coordenadas(coordenadas: str):
    """O Dash manda as coordenadas num campo único "lat, long" (igual o
    Google Maps copia) — separa em (latitude, longitude) aqui, na hora de
    preencher os dois campos do Radar (pedido explícito: quem separa é o
    robô, não o Dash)."""
    if not coordenadas:
        return None, None
    partes = coordenadas.split(",")
    if len(partes) != 2:
        return None, None
    return partes[0].strip(), partes[1].strip()


def geocodificar_endereco(cep: str, numero: str):
    """Geocodifica CEP+Número — fallback quando o consultor não informa a
    coordenada exata (Google Maps), mas informa o número do imóvel. Busca
    logradouro/bairro/cidade/UF via ViaCEP e manda pro Nominatim
    (OpenStreetMap, gratuito, sem chave). Tenta do mais específico ao mais
    genérico: o OSM raramente tem o número exato indexado no Brasil
    (confirmado testando CEPs reais — só a busca sem número/bairro
    resolveu), então cai pra rua+cidade se a busca completa vier vazia, em
    vez de desistir e deixar sem coordenada nenhuma."""
    try:
        via_cep = requests.get(f"https://viacep.com.br/ws/{cep}/json/", timeout=10).json()
        if via_cep.get("erro"):
            return None, None
        logradouro = via_cep.get("logradouro", "")
        bairro = via_cep.get("bairro", "")
        cidade = via_cep.get("localidade", "")
        uf = via_cep.get("uf", "")

        tentativas = [
            f"{logradouro}, {numero} - {bairro}, {cidade} - {uf}, Brasil",
            f"{logradouro}, {bairro}, {cidade} - {uf}, Brasil",
            f"{logradouro}, {cidade} - {uf}, Brasil",
        ]
        for i, endereco in enumerate(tentativas):
            if i > 0:
                time.sleep(1)  # Nominatim: máx. 1 req/s
            resp = requests.get(
                "https://nominatim.openstreetmap.org/search",
                params={"q": endereco, "format": "json", "limit": 1},
                headers={"User-Agent": "vst-dashboard-radar-bot/1.0"},
                timeout=10,
            )
            resultados = resp.json()
            if resultados:
                return resultados[0]["lat"], resultados[0]["lon"]
        return None, None
    except Exception as e:
        log.warning(f"  Falha ao geocodificar CEP {cep} nº{numero}: {e}")
        return None, None


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
    tela_2fa = False
    try:
        campo_codigo = page.locator("input#tc, input[name='emc'], input[type='tel']").first
        campo_codigo.wait_for(state="visible", timeout=15_000)
        tela_2fa = True
    except Exception:
        log.info("Nenhuma tela de 2FA apareceu (dispositivo já confiável).")

    if tela_2fa:
        page.screenshot(path=str(DOWNLOAD_DIR / "03_tela_2fa.png"))
        for tentativa in range(1, 4):
            codigo = aguardar_totp_fresco()
            campo_codigo.fill(codigo)
            for sel in ["#save", "button:has-text('Verificar')", "input[type='submit']"]:
                try:
                    page.locator(sel).first.click(timeout=5_000)
                    break
                except Exception:
                    continue
            # Confirma que o Salesforce aceitou o código antes de seguir —
            # achado real (print 04_pos_login.png de uma execução com falha
            # em cascata): ele às vezes rejeita ("Código de verificação
            # inválido ou expirado", provavelmente cruzou a janela de 30s
            # entre gerar o TOTP e o servidor validar), e o wait_for_url
            # abaixo não pegava isso (a URL de erro do 2FA não contém
            # "login"), então o bot seguia como se tivesse logado — e tudo
            # dali pra frente falhava (Access Denied / tela de login).
            try:
                page.locator("text=inválido ou expirado").wait_for(state="visible", timeout=4_000)
                log.warning(f"  Código 2FA rejeitado (tentativa {tentativa}/3) — gerando um novo.")
                continue
            except Exception:
                break
        else:
            page.screenshot(path=str(DOWNLOAD_DIR / "2fa_rejeitado_3x.png"))
            raise RuntimeError("Salesforce rejeitou o código 2FA 3 vezes seguidas.")
        log.info("2FA preenchido.")

    # Aviso informativo pós-login (ex.: "Janela Técnica para Implantação do
    # Fulfillment") — não indica indisponibilidade agora, só um comunicado
    # que precisa ser fechado clicando "Concluir" antes de seguir pro Radar.
    # Sem isso, a URL nunca sai de "/login" e o wait_for_url abaixo estoura
    # o timeout achando que o login falhou. Best-effort: se não aparecer em
    # poucos segundos, segue o fluxo normal.
    aviso_fechado = False
    for sel in ["text=Concluir", "button:has-text('Concluir')", "a:has-text('Concluir')", "[role='button']:has-text('Concluir')"]:
        try:
            page.locator(sel).first.click(timeout=6_000)
            aviso_fechado = True
            break
        except Exception:
            continue
    if aviso_fechado:
        log.info("  Aviso pós-login fechado ('Concluir').")
        time.sleep(1)
    else:
        page.screenshot(path=str(DOWNLOAD_DIR / "05_sem_aviso_concluir.png"), full_page=True)

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


def selecionar_lookup(page, aria_label: str, texto_completo: str, timeout=30_000) -> bool:
    """Digita no campo de busca (lookup) e clica na opção certa da lista —
    usado pra campos tipo Cliente/Produto/Item de Produto.

    `texto_completo` é o nome EXATO do registro (usado tanto pra buscar
    quanto, principalmente, pra identificar a opção certa entre as que a
    busca retornar).

    O clique aqui É necessário (sem ele o dropdown de busca nem abre —
    confirmado em execução real: sem clique, nem o Produto, que já
    funcionava antes, encontrava opção alguma). O que causava a falha
    entre dois lookups seguidos (Produto -> Item de Produto) era o overlay
    do primeiro lookup ainda não ter fechado de verdade quando o clique do
    segundo campo acontecia — por isso espera esse overlay sumir de fato
    (hidden) antes de devolver. NÃO usa Escape pra fechar o painel: dentro
    de um modal, Escape pode fechar o MODAL INTEIRO em vez de só o dropdown
    do lookup (suspeita forte após o campo seguinte sumir por completo em
    execução real — sem Escape, o overlay-hidden já basta).

    timeout default de 30s (não 15s): "Item de Produto" é uma busca
    dependente/filtrada pelo Produto já selecionado — o print de debug
    mostrou o resultado certo aparecendo NA TELA depois que o código já
    tinha desistido em 15s (confirmado via artefato de debug real).
    """
    campo = localizar_campo_lookup(page, aria_label, timeout)
    if campo is None:
        log.warning(f"  Campo de busca '{aria_label}' não encontrado.")
        return False
    # Digita o nome COMPLETO (com preço e tudo) — confirmado manualmente
    # pelo usuário que colar o texto assim, por inteiro, encontra o item
    # normalmente. Uma tentativa anterior de digitar só o trecho antes do
    # preço (achando que a pontuação colada atrapalhava) não retornava
    # opção nenhuma — o texto completo é o que de fato funciona.
    texto_busca = texto_completo
    # Selecionar um lookup pai (ex.: Produto) pode disparar um re-render do
    # próximo campo dependente (ex.: Item de Produto) — se o clique cair
    # bem nesse momento, o Playwright vê o elemento "instável" e, no limite,
    # "detached from the DOM" (confirmado em execução real). force=True
    # ignora a checagem de estabilidade; seguro aqui porque já garantimos
    # acima que o overlay do campo anterior fechou de verdade antes de
    # chegar neste ponto.
    campo.click(force=True)
    campo.fill(texto_busca)
    try:
        # Cada lookup mantém sua lista de opções no DOM mesmo depois de
        # fechada (só fica escondida) — um seletor sem escopo pega a 1ª
        # ocorrência na página inteira, quase sempre a sobra ESCONDIDA de um
        # lookup anterior, nunca a lista realmente visível deste campo
        # (confirmado em execução real: "locator resolved to hidden..."
        # repetido dezenas de vezes, timeout nos 30s inteiros). Restringe a
        # busca ao dropdown VISÍVEL no momento.
        opcoes = page.locator("[role='listbox']:visible").locator("lightning-base-combobox-item[role='option']")
        opcoes.first.wait_for(state="visible", timeout=timeout)
        # Pode aparecer mais de uma opção parecida (ex.: mesma velocidade,
        # com/sem "SMART") — identifica a certa pelo atributo title do
        # rótulo, que carrega o nome completo e exato do item; se não achar
        # por title (campo sem essa marcação, ex. "Produto"), cai pra
        # texto visível e por fim pra 1ª opção.
        alvo = opcoes.filter(has=page.locator(f"[title='{texto_completo}']"))
        if alvo.count() == 0:
            alvo = opcoes.filter(has_text=texto_busca)
        (alvo.first if alvo.count() > 0 else opcoes.first).click()
        try:
            page.locator("lightning-overlay-container").last.wait_for(state="hidden", timeout=5_000)
        except Exception:
            pass  # nem sempre existe um overlay-container pra esperar sumir
        page.wait_for_timeout(800)  # dá tempo do layout assentar antes do próximo campo
        return True
    except Exception as e:
        log.warning(f"  Nenhuma opção encontrada para '{aria_label}' = '{texto_completo}': {type(e).__name__}: {e}")
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        nome_arquivo = aria_label.lower().replace(' ', '_')
        try:
            page.screenshot(path=str(DOWNLOAD_DIR / f"lookup_sem_opcao_{nome_arquivo}.png"))
            (DOWNLOAD_DIR / f"lookup_sem_opcao_{nome_arquivo}.html").write_text(page.content(), encoding="utf-8")
        except Exception:
            pass
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
    """Cria o EV e retorna (record_id, numero_ev)."""
    log.info(f"Criando Estudo de Viabilidade para '{item['cliente_final']}'...")

    page.goto(
        f"{RADAR_URL.replace('.my.salesforce.com', '.lightning.force.com')}"
        "/lightning/o/Estudo_de_Viabilidade__c/new"
        "?count=1&nooverride=1&useRecordTypeCheck=1&navigationLocation=LIST_VIEW",
        wait_until="networkidle",
    )

    # Modal 1: escolher tipo de registro. O BLD Oferta PME (Produto pai
    # "BUSINESS LINK DIRECT") exige o tipo "Ativação" — as demais ofertas
    # (Conecta, sob "CONECTA+") usam "Estudo Agregador". Achado real
    # (falha_consulta_65.png): tentar salvar um item BLD.PME sob "Estudo
    # Agregador" é recusado com "O Item não pode ser associado a um Estudo
    # de Agregação. Mas sim, em um estudo de ativação." — a própria
    # mensagem de erro do Salesforce aponta o tipo certo.
    tipo_registro = "Ativação" if item.get("produto") == "BUSINESS LINK DIRECT" else "Estudo Agregador"
    # Localiza pelo RÓTULO visível, não por posição — a ordem das opções não
    # é garantida ser sempre a mesma (2 tipos possíveis agora, não 1 fixo).
    # Clicar no <label> em si falhou em execução real ("Element is outside
    # of the viewport" mesmo após rolar — o label do SLDS embute conteúdo
    # que estoura a área visível do modal); em vez disso, lê o atributo
    # `for` do label pra achar o <input type="radio"> de verdade associado
    # e força o clique nele — o mesmo truque que já funcionava antes só que
    # agora localizado por rótulo em vez de posição fixa. force=True: o
    # círculo visual customizado do SLDS fica por cima do input e intercepta
    # o clique — confirmado em execução real (Playwright ficava tentando e
    # desistia no timeout sem isso).
    #
    # ":visible" (extensão do Playwright, já usada em selecionar_lookup())
    # é necessário aqui: sem ele, ".first" às vezes resolve pra uma cópia
    # ESCONDIDA do mesmo texto que sobra no DOM durante a transição do
    # modal — achado real (2ª execução: "locator resolved to hidden
    # <label...>", timeout mesmo com o texto certo já selecionável na tela
    # segundos depois, confirmado pelo screenshot de debug).
    rotulo = page.locator(f"label:has-text('{tipo_registro}'):visible").first
    rotulo.wait_for(state="visible", timeout=10_000)
    id_input = rotulo.get_attribute("for")
    # Seletor de atributo, não "#id" — os IDs do Salesforce começam com
    # dígito (ex.: "0121M000..."), inválido como identificador CSS cru.
    page.locator(f'[id="{id_input}"]').check(force=True)
    page.locator("button:has-text('Avançar')").click()
    page.wait_for_selector(f"text=Criar Estudo de Viabilidade: {tipo_registro}", timeout=20_000)

    # Modal 2: formulário — preenche só por atributo `name` (API name real).
    preencher_input_por_name(page, "Razao_Social__c", item.get("razao_social") or item["cliente_final"])
    # O Dash não coleta CNPJ do consultor (campo removido) — o Salesforce
    # exige o campo preenchido e com dígitos verificadores válidos, então
    # gera um CNPJ fictício aqui na hora, só pra passar da validação.
    preencher_input_por_name(page, "CNPJ__c", gerar_cnpj_aleatorio())
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
def definir_endereco_sev(page, ev_record_id: str, cep: str, numero: str = None, coordenadas: str = None):
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
    time.sleep(3)

    # "Buscar CEP" já preenche Latitude/Longitude sozinho (geocode
    # aproximado, só pelo CEP) — mas isso não é preciso o bastante pro
    # ponto de instalação. Prioridade (pedido explícito):
    # 1) coordenada exata informada pelo consultor (Google Maps, "lat, long"
    #    num campo único — separa aqui, na hora de preencher os dois campos
    #    do Radar);
    # 2) sem coordenada, mas com Número, geocodifica CEP+Número aqui;
    # 3) sem os dois, mantém o que o Radar já calculou sozinho (o Dash
    #    bloqueia esse caso antes de chegar aqui, mas não custa ter um
    #    fallback seguro).
    latitude, longitude = separar_coordenadas(coordenadas)
    if not latitude or not longitude:
        if numero:
            latitude, longitude = geocodificar_endereco(cep, numero)
        else:
            latitude, longitude = None, None
    if latitude:
        try:
            page.locator("lightning-input.latitudeField input").first.fill(str(latitude))
        except Exception:
            log.warning("  Campo 'Latitude' não encontrado no modal de endereço.")
    if longitude:
        try:
            page.locator("lightning-input.longitudeField input").first.fill(str(longitude))
        except Exception:
            log.warning("  Campo 'Longitude' não encontrado no modal de endereço.")

    # O CEP sozinho não traz o número do imóvel — sem ele, a consulta de
    # viabilidade recusa com "Endereços não normalizados" mesmo depois de
    # clicar Validar (confirmado em execução real, print mostrando o campo
    # "Número" vazio).
    try:
        page.locator("lightning-input.numeroField input").first.fill(numero or "1")
    except Exception:
        log.warning("  Campo 'Número' não encontrado no modal de endereço.")

    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(DOWNLOAD_DIR / f"pos_buscar_cep_{ev_record_id}.png"))
    (DOWNLOAD_DIR / f"pos_buscar_cep_{ev_record_id}.html").write_text(page.content(), encoding="utf-8")

    # "Validar" e "Inserir" NÃO são alternativas — são duas etapas em
    # sequência (confirmado com print real): "Validar" só confirma que o
    # endereço é padronizável (toast "ENDERECO CONFIRMADO E PADRONIZADO"),
    # o modal continua aberto, e só o clique em "Inserir" (que fica
    # habilitado depois do Validar) de fato salva o endereço no SEV. Sem
    # esse 2º clique, a consulta de viabilidade recusava com "Endereços não
    # normalizados" — o formulário nunca tinha sido realmente submetido.
    if not clicar_botao_com_texto(page, "Validar", timeout=15_000):
        log.warning("  Botão 'Validar' não encontrado após buscar CEP — screenshot salvo.")
        page.screenshot(path=str(DOWNLOAD_DIR / f"erro_endereco_{ev_record_id}.png"))
        return
    try:
        page.wait_for_selector("text=CONFIRMADO E PADRONIZADO", timeout=15_000)
    except Exception:
        # O toast nem sempre aparece a tempo — achado real (print
        # falha_consulta_13/11): quando o Salesforce corrige/padroniza o CEP
        # digitado pra um diferente (ex.: 81460050 virou 81170230 na tela),
        # o botão "Inserir" fica habilitado normalmente mas esse toast
        # específico não aparece dentro do timeout. O sinal real de que a
        # validação terminou é "Inserir" ficar clicável, checado abaixo (o
        # .click() sem force já espera o botão ficar habilitado).
        log.info("  Toast 'CONFIRMADO E PADRONIZADO' não apareceu a tempo — seguindo pro clique em 'Inserir' mesmo assim.")

    if not clicar_botao_com_texto(page, "Inserir", timeout=20_000):
        log.warning("  Botão 'Inserir' não encontrado/habilitado depois de Validar — screenshot salvo.")
        page.screenshot(path=str(DOWNLOAD_DIR / f"erro_endereco_{ev_record_id}.png"))
        return

    page.wait_for_timeout(3_000)
    page.screenshot(path=str(DOWNLOAD_DIR / f"pos_inserir_{ev_record_id}.png"))


# ─── 3. Disparar "Consultar Viabilidade" ───────────────────────────────────
def consultar_viabilidade(page, ev_record_id: str):
    log.info("Disparando 'Consultar Viabilidade'...")
    base = RADAR_URL.replace(".my.salesforce.com", ".lightning.force.com")
    page.goto(f"{base}/lightning/r/Estudo_de_Viabilidade__c/{ev_record_id}/view", wait_until="networkidle")

    page.locator("button[name='Estudo_de_Viabilidade__c.Consultar_Viabilidade']").click(timeout=15_000, force=True)

    # Debug: "text=Consultar Viabilidade" sempre bate de cara com o próprio
    # rótulo do botão da página (já existe ANTES do clique) — não prova que
    # o modal abriu. Tira um print logo após o clique pra saber de fato se
    # algo mudou na tela, em vez de confiar num wait que nunca falha.
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(DOWNLOAD_DIR / f"pos_clique_consultar_{ev_record_id}.png"))

    # O Salesforce às vezes recusa a consulta na hora, com um banner
    # vermelho "Não é possível consultar, pois o estudo não possui os
    # critérios para consulta" — achado real (print pos_clique_consultar):
    # isso é uma rejeição de regra de negócio, não uma demora, e esperar os
    # 60s do toast só desperdiça tempo e mascara o motivo real da falha.
    try:
        page.locator("text=não possui os critérios para consulta").wait_for(state="visible", timeout=3_000)
        raise RuntimeError("Salesforce recusou a consulta: estudo não possui os critérios para consulta.")
    except RuntimeError:
        raise
    except Exception:
        pass

    # O toast real diz "entregue com sucesso" (confirmado no vídeo de
    # referência) — "enviado" (usado antes) nunca aparece, daí o timeout.
    page.wait_for_selector("text=entregue com sucesso", timeout=60_000)
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
    status_sevs = ler_texto_do_campo(page, "Status das SEVs")
    habilitado_pricing = ler_texto_do_campo(page, "Habilitado Para Pricing")
    resultado = {
        "status_consulta": status_consulta,
        "status_sevs": status_sevs,
        "habilitado_pricing": habilitado_pricing,
    }

    # "Status das SEVs" às vezes já vem preenchido (Viável/Inviável...)
    # antes de "Status da Consulta" virar "Concluído" (confirmado em
    # execução real) — trata qualquer um dos dois como sinal de que já dá
    # pra buscar o resultado detalhado (facilidade/custo), em vez de exigir
    # só o "Concluído" e perder o resultado real por atraso desse campo.
    if status_consulta != "Concluído" and not status_sevs:
        return resultado

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
            # Se uma tentativa anterior já criou o EV mas falhou depois
            # (endereço ou "Consultar Viabilidade"), reaproveita o registro
            # em vez de criar outro duplicado no Radar a cada retry.
            if item.get("ev_salesforce_id"):
                record_id, numero_ev = item["ev_salesforce_id"], item.get("ev_numero")
                log.info(f"  Reaproveitando EV já criado: {numero_ev} ({record_id})")
            else:
                record_id, numero_ev = criar_estudo(page, item)
                supa_atualizar(item["id"], {"ev_salesforce_id": record_id, "ev_numero": numero_ev})
            definir_endereco_sev(page, record_id, item["cep"], item.get("numero"), item.get("coordenadas"))
            consultar_viabilidade(page, record_id)
            supa_atualizar(item["id"], {
                "status": "aguardando_resultado",
                "ev_salesforce_id": record_id,
                "ev_numero": numero_ev,
                "status_consulta": "Aguardando Consulta",
            })
        except Exception as e:
            log.error(f"  Falha ao processar consulta {item['id']}: {e}", exc_info=True)
            DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
            try:
                page.screenshot(path=str(DOWNLOAD_DIR / f"falha_consulta_{item['id']}.png"))
                (DOWNLOAD_DIR / f"falha_consulta_{item['id']}.html").write_text(page.content(), encoding="utf-8")
            except Exception:
                pass
            # Se o Supabase estiver instável (foi o caso real: timeout de
            # leitura logo depois de um "Consultar Viabilidade" enviado com
            # sucesso), essa própria chamada de fallback pode falhar de
            # novo — sem essa proteção, a exceção sobe, derruba o script e
            # as demais consultas pendentes da rodada nem chegam a ser
            # tentadas. Loga e segue pro próximo item em vez de travar tudo.
            try:
                supa_atualizar(item["id"], {"status": "erro", "erro_mensagem": str(e)[:500]})
            except Exception as e2:
                log.error(f"  Também falhei ao marcar a consulta {item['id']} como erro: {e2}")


def revisar_em_andamento(page):
    em_andamento = supa_listar("aguardando_resultado")
    log.info(f"{len(em_andamento)} consulta(s) aguardando resultado.")
    for item in em_andamento:
        try:
            resultado = ler_resultado(page, item["ev_salesforce_id"])
            if resultado.get("status_consulta") == "Concluído":
                # Só aqui é seguro travar Habilitado Para Pricing/Facilidade/
                # Custo como definitivos — confirmado em execução real que
                # esses campos podem ainda não estar sincronizados no
                # instante em que "Status das SEVs" já mostra um resultado
                # (Habilitado Para Pricing chegou a ficar preso em "Não"
                # mesmo com o resultado real sendo "Sim").
                supa_atualizar(item["id"], {**resultado, "status": "concluido"})
            else:
                # Ainda não é o estado final, mas já atualiza Status da
                # Consulta/SEVs como prévia (sem tocar em pricing/
                # facilidade/custo) — a linha continua "aguardando_
                # resultado" e é reconferida na próxima rodada.
                supa_atualizar(item["id"], {
                    "status_consulta": resultado.get("status_consulta"),
                    "status_sevs": resultado.get("status_sevs"),
                })
        except Exception as e:
            log.error(f"  Falha ao ler resultado da consulta {item['id']}: {e}", exc_info=True)


def explorar_evs_existentes(page, quantidade: int = 8):
    """Diagnóstico manual (MODO=explorar) — abre a lista de EVs mais
    recentes no Radar e entra nos primeiros registros pra ler 'Quantidade
    de Circuitos' junto do Item de Produto, só pra descobrir o padrão real
    antes de travar esse campo no Dash. Não roda no fluxo normal."""
    base = RADAR_URL.replace(".my.salesforce.com", ".lightning.force.com")
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    page.goto(f"{base}/lightning/o/Estudo_de_Viabilidade__c/home", wait_until="networkidle")
    page.wait_for_timeout(1500)
    page.screenshot(path=str(DOWNLOAD_DIR / "explorar_lista.png"), full_page=True)

    links = page.locator("lightning-datatable a[href*='/lightning/r/Estudo_de_Viabilidade__c/']")
    total = min(links.count(), quantidade)
    log.info(f"Explorando {total} EVs existentes...")
    hrefs = [links.nth(i).get_attribute("href") for i in range(total)]
    for i, href in enumerate(hrefs):
        try:
            page.goto(f"{base}{href}", wait_until="networkidle")
            page.wait_for_timeout(1000)
            page.screenshot(path=str(DOWNLOAD_DIR / f"explorar_ev_{i}.png"), full_page=True)
        except Exception as e:
            log.warning(f"  Falha ao abrir EV {i} ({href}): {e}")
    log.info("Exploração concluída — prints salvos.")


def main():
    log.info("=" * 60)
    log.info("Radar Bot")
    log.info("=" * 60)

    modo = os.environ.get("MODO", "normal")

    if modo != "explorar":
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
            if modo == "explorar":
                explorar_evs_existentes(page)
            else:
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
