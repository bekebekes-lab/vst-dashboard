"""
Sincroniza os e-mails de "ALERTA PORT-OUT" (retenção Claro) da caixa
raphael@vstgroup.com.br (KingHost, IMAP) para a tabela churn_alertas no
Supabase, pra alimentar a aba Churn do Dashboard.

IMPORTANTE — a caixa de e-mail NUNCA é alterada:
- A mailbox é aberta em modo EXAMINE (select(..., readonly=True)), que faz
  o próprio servidor IMAP recusar qualquer tentativa de mudar flags
  (marcar como lido, etc.) durante essa sessão.
- Nenhum e-mail é apagado, movido ou arquivado — só lido.
- O Outlook do usuário continua enxergando tudo exatamente como chegou.

Dedup: pela chave de NEGÓCIO (cnpj, data_janela), não só pelo Message-ID —
a Claro às vezes reenvia/encaminha o mesmo alerta de PORT-OUT em e-mails
diferentes (Message-ID novo, conteúdo idêntico), e isso deve contar como o
MESMO caso na tela, não duas linhas. O upsert usa "resolution=merge-duplicates",
que atualiza os campos vindos do e-mail mas nunca toca em
atribuido_a/feedback/respondido — esses são só editados pela tela.

recebido_em = data do e-mail MAIS ANTIGO entre todos os que já bateram nesse
mesmo (cnpj, data_janela) — não a data do último processado. Como o script
reprocessa a caixa inteira a cada execução (não só e-mails novos), cada
Message-ID já contabilizado fica registrado em message_ids_processados
(coluna text[]) pra: (a) não contar de novo o mesmo e-mail em execuções
futuras, e (b) quando um Message-ID genuinamente novo aparecer pro mesmo
alerta (reenvio/encaminhamento), incrementar qtd_emails_recebidos sem
perder a data original em recebido_em.

Só usa a biblioteca padrão do Python (imaplib, email, json, urllib) — sem
dependências externas.
"""
import email
import email.utils
import imaplib
import json
import os
import re
import sys
import time
import unicodedata
import urllib.request
import urllib.error
from datetime import datetime
from email.header import decode_header

IMAP_HOST = "imap.kinghost.net"
IMAP_PORT = 993
SUPA_URL = "https://kzlchetrpsfefwybaaoy.supabase.co"
ASSUNTO_BUSCA = "ALERTA PORT-OUT"

# Mapeia o rótulo (normalizado: minúsculo, sem acento, sem pontuação) pra
# coluna da tabela. Precisa bater com os rótulos reais do e-mail da Claro.
CAMPOS = {
    "nome do cliente": "nome_cliente",
    "cnpj": "cnpj",
    "numero de linhas portando": "qtd_linhas",
    "receptora": "receptora",
    "promocao atual": "promocao_atual",
    "classificacao": "classificacao",
    "tempo medio": "tempo_medio",
    "carteira aace": "carteira_aace",
    "gerente de canal": "gerente_canal",
    "coordenador": "coordenador",
    "data da janela": "data_janela",
    "multa estimada": "multa_estimada",
    "oferta de retencao de mkt": "oferta_retencao_mkt",
    "oferta valida para adequacao para o claro pos": "oferta_pos",
}


def normalizar_rotulo(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()
    s = re.sub(r"\s+", " ", s)
    return s


def extrair_texto(msg):
    """Prefere a parte text/plain; se não tiver, tira tags HTML na força bruta."""
    for parte in msg.walk():
        if parte.get_content_type() == "text/plain" and not parte.get("Content-Disposition"):
            payload = parte.get_payload(decode=True)
            charset = parte.get_content_charset() or "utf-8"
            return payload.decode(charset, errors="replace")

    for parte in msg.walk():
        if parte.get_content_type() == "text/html" and not parte.get("Content-Disposition"):
            payload = parte.get_payload(decode=True)
            charset = parte.get_content_charset() or "utf-8"
            html = payload.decode(charset, errors="replace")
            texto = re.sub(r"<(br|/p|/div|/tr)\s*/?>", "\n", html, flags=re.IGNORECASE)
            texto = re.sub(r"<[^>]+>", "", texto)
            import html as html_mod
            return html_mod.unescape(texto)

    return ""


def parsear_corpo(texto):
    linhas = [l.strip() for l in texto.splitlines()]
    dados = {}
    i = 0
    while i < len(linhas):
        linha = linhas[i]
        m = re.match(r"^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]*?)\*?\s*:\s*(.*)$", linha)
        if m:
            rotulo = normalizar_rotulo(m.group(1))
            valor = m.group(2).strip()
            if rotulo in CAMPOS:
                if not valor and i + 1 < len(linhas):
                    proxima = linhas[i + 1]
                    if proxima and not re.match(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]*\*?\s*:", proxima):
                        valor = proxima.strip()
                        i += 1
                dados[CAMPOS[rotulo]] = valor
        i += 1
    return dados


def decodificar_assunto(raw):
    partes = decode_header(raw or "")
    out = ""
    for texto, cod in partes:
        if isinstance(texto, bytes):
            out += texto.decode(cod or "utf-8", errors="replace")
        else:
            out += texto
    return out


def post_json(url, body, headers, method="POST"):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw.decode("utf-8", errors="replace")
        return e.code, parsed


def buscar_uf_cnpj(cnpj_digitos, cache):
    """UF/município do cliente via CNPJ, consultando a BrasilAPI (dados
    públicos da Receita Federal). Usa um cache pra não bater na mesma API
    de novo pro mesmo CNPJ a cada sincronização — só consulta CNPJ novo."""
    if cnpj_digitos in cache:
        return cache[cnpj_digitos]
    try:
        req = urllib.request.Request(
            f"https://brasilapi.com.br/api/cnpj/v1/{cnpj_digitos}",
            headers={
                "Accept": "application/json",
                # Sem um User-Agent "de navegador" a BrasilAPI devolve 403
                # (bloqueio anti-bot do lado deles) — o padrão do urllib
                # ("Python-urllib/3.x") cai nesse filtro.
                "User-Agent": "Mozilla/5.0 (compatible; vst-dashboard-churn-sync/1.0)",
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            dados = json.loads(resp.read())
        resultado = (dados.get("uf"), dados.get("municipio"))
    except Exception as e:
        print(f"  aviso: não consegui consultar UF do CNPJ {cnpj_digitos}: {e}")
        resultado = (None, None)
    cache[cnpj_digitos] = resultado
    return resultado


def gravar_alerta(service_key, message_id, recebido_em_dt, qtd_emails, ids_processados, dados):
    if not dados.get("cnpj") or not dados.get("data_janela"):
        # Sem CNPJ+janela não dá pra deduplicar pela chave de negócio (Claro
        # reenvia o mesmo alerta mais de uma vez às vezes) — descarta em vez
        # de arriscar duplicar ou colidir com outra linha por engano.
        return
    linha = {
        "message_id": message_id,
        "recebido_em": recebido_em_dt.isoformat() if recebido_em_dt else None,
        "qtd_emails_recebidos": qtd_emails,
        "message_ids_processados": sorted(ids_processados),
        **dados,
    }
    if "qtd_linhas" in linha:
        try:
            linha["qtd_linhas"] = int(re.sub(r"\D", "", linha["qtd_linhas"]) or 0)
        except ValueError:
            linha["qtd_linhas"] = None
    # on_conflict na chave de NEGÓCIO (cnpj, data_janela), não no Message-ID —
    # Claro às vezes reenvia o mesmo alerta via e-mails diferentes; isso é
    # tratado como o MESMO caso, não uma duplicata na tela. merge-duplicates
    # atualiza os campos vindos do e-mail, mas nunca toca em
    # atribuido_a/feedback/respondido porque esses campos não fazem parte do
    # payload enviado aqui.
    status, resp = post_json(
        f"{SUPA_URL}/rest/v1/churn_alertas?on_conflict=cnpj,data_janela",
        linha,
        {
            "Content-Type": "application/json",
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
    )
    if status not in (200, 201, 204):
        raise RuntimeError(f"Falha ao gravar alerta no Supabase: HTTP {status} — {resp}")


def carregar_cache_alertas(service_key):
    """Pré-carrega, por (cnpj, data_janela), o estado já gravado no Supabase
    (data mais antiga já vista, quantos e-mails já contaram, quais
    Message-IDs já foram contabilizados) — necessário pra decidir, a cada
    e-mail desta execução, se é a primeira vez que o alerta aparece, uma
    mensagem já vista antes (não conta de novo) ou um duplicado novo."""
    status, dados = post_json(
        f"{SUPA_URL}/rest/v1/churn_alertas?select=cnpj,data_janela,recebido_em,qtd_emails_recebidos,message_ids_processados",
        None,
        {"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        method="GET",
    )
    cache = {}
    if status == 200 and dados:
        for row in dados:
            recebido_dt = None
            if row.get("recebido_em"):
                try:
                    recebido_dt = datetime.fromisoformat(row["recebido_em"])
                except Exception:
                    recebido_dt = None
            cache[(row["cnpj"], row["data_janela"])] = {
                "recebido_em": recebido_dt,
                "qtd": row.get("qtd_emails_recebidos") or 1,
                "ids": set(row.get("message_ids_processados") or []),
            }
    return cache


def carregar_cache_uf(service_key):
    """Pré-popula o cache de CNPJ->UF com o que já está gravado no Supabase,
    pra não bater na BrasilAPI de novo pra CNPJs que já foram consultados em
    sincronizações anteriores."""
    status, dados = post_json(
        f"{SUPA_URL}/rest/v1/churn_alertas?select=cnpj,uf_cliente,municipio_cliente&uf_cliente=not.is.null",
        None,
        {"apikey": service_key, "Authorization": f"Bearer {service_key}"},
        method="GET",
    )
    cache = {}
    if status == 200 and dados:
        for row in dados:
            cache[row["cnpj"]] = (row.get("uf_cliente"), row.get("municipio_cliente"))
    return cache


def main():
    email_user = os.environ.get("CHURN_EMAIL_USER")
    email_pass = os.environ.get("CHURN_EMAIL_PASS")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not email_user or not email_pass or not service_key:
        print("Faltando CHURN_EMAIL_USER, CHURN_EMAIL_PASS ou SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    cache_uf = carregar_cache_uf(service_key)
    cache_alertas = carregar_cache_alertas(service_key)

    imap = imaplib.IMAP4_SSL(IMAP_HOST, IMAP_PORT)
    try:
        imap.login(email_user, email_pass)
        # readonly=True -> EXAMINE em vez de SELECT: o servidor recusa
        # qualquer tentativa de alterar flags nessa sessão.
        imap.select("INBOX", readonly=True)

        status, dados_busca = imap.search(None, f'(SUBJECT "{ASSUNTO_BUSCA}")')
        if status != "OK":
            raise RuntimeError(f"Falha na busca IMAP: {status}")

        ids = dados_busca[0].split()
        print(f"Encontrados {len(ids)} e-mails com assunto contendo '{ASSUNTO_BUSCA}'")

        novos = 0
        for msg_id in ids:
            status, msg_dados = imap.fetch(msg_id, "(BODY.PEEK[])")
            if status != "OK" or not msg_dados or not msg_dados[0]:
                continue
            raw = msg_dados[0][1]
            msg = email.message_from_bytes(raw)

            message_id_header = msg.get("Message-ID")
            if not message_id_header:
                # Sem Message-ID não dá pra deduplicar com segurança — pula.
                continue

            assunto = decodificar_assunto(msg.get("Subject"))
            texto = extrair_texto(msg)
            dados = parsear_corpo(texto)
            if not dados.get("nome_cliente") and not dados.get("cnpj"):
                print(f"  aviso: não consegui extrair dados de '{assunto}' — pulando")
                continue

            recebido_em_dt = None
            data_header = msg.get("Date")
            if data_header:
                try:
                    recebido_em_dt = email.utils.parsedate_to_datetime(data_header)
                except Exception:
                    recebido_em_dt = None

            cnpj_digitos = re.sub(r"\D", "", dados.get("cnpj") or "")
            if cnpj_digitos:
                era_cache_hit = cnpj_digitos in cache_uf
                uf, municipio = buscar_uf_cnpj(cnpj_digitos, cache_uf)
                if uf:
                    dados["uf_cliente"] = uf
                if municipio:
                    dados["municipio_cliente"] = municipio
                if not era_cache_hit:
                    time.sleep(1)  # não martela a BrasilAPI em consultas novas

            # Decide, contra o estado já gravado (+ o que já foi visto nesta
            # mesma execução), se este e-mail é: a primeira vez que o alerta
            # aparece, uma mensagem já contabilizada antes (reprocessada
            # porque o script varre a caixa inteira toda vez — não conta de
            # novo), ou um duplicado genuinamente novo (reenvio/encaminhamento
            # — conta mais uma vez, mas a data "recebido" continua sendo a
            # mais antiga entre todas).
            message_id_str = message_id_header.strip()
            chave = (dados.get("cnpj"), dados.get("data_janela"))
            estado = cache_alertas.get(chave)

            if estado is None:
                qtd_final = 1
                ids_final = {message_id_str}
                recebido_final = recebido_em_dt
                if chave[0] and chave[1]:
                    cache_alertas[chave] = {"recebido_em": recebido_final, "qtd": qtd_final, "ids": ids_final}
                duplicado = False
            elif message_id_str in estado["ids"]:
                qtd_final = estado["qtd"]
                ids_final = estado["ids"]
                recebido_final = estado["recebido_em"]
                duplicado = False
            else:
                estado["ids"].add(message_id_str)
                if estado["recebido_em"] and recebido_em_dt:
                    estado["recebido_em"] = min(estado["recebido_em"], recebido_em_dt)
                elif recebido_em_dt:
                    estado["recebido_em"] = recebido_em_dt
                estado["qtd"] += 1
                qtd_final = estado["qtd"]
                ids_final = estado["ids"]
                recebido_final = estado["recebido_em"]
                duplicado = True

            gravar_alerta(service_key, message_id_str, recebido_final, qtd_final, ids_final, dados)
            novos += 1
            marca = f" (duplicado #{qtd_final})" if duplicado else ""
            print(f"  gravado: {dados.get('nome_cliente', '?')} (CNPJ {dados.get('cnpj', '?')}) — recebido em {recebido_final}{marca}")

        print(f"Sincronização concluída. {novos} alerta(s) processado(s) (novos ou já existentes, ignorados via upsert).")
    finally:
        try:
            imap.close()
        except Exception:
            pass
        imap.logout()


if __name__ == "__main__":
    main()
