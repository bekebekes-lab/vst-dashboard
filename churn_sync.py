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

Dedup: cada e-mail tem um Message-ID único (cabeçalho padrão de e-mail);
a tabela tem esse campo como UNIQUE, e o upsert usa
"resolution=ignore-duplicates", então rodar de novo sobre o mesmo e-mail
não duplica nem sobrescreve nada.

Só usa a biblioteca padrão do Python (imaplib, email, json, urllib) — sem
dependências externas.
"""
import email
import imaplib
import json
import os
import re
import sys
import unicodedata
import urllib.request
import urllib.error
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


def gravar_alerta(service_key, message_id, dados):
    linha = {"message_id": message_id, **dados}
    if "qtd_linhas" in linha:
        try:
            linha["qtd_linhas"] = int(re.sub(r"\D", "", linha["qtd_linhas"]) or 0)
        except ValueError:
            linha["qtd_linhas"] = None
    status, resp = post_json(
        f"{SUPA_URL}/rest/v1/churn_alertas?on_conflict=message_id",
        linha,
        {
            "Content-Type": "application/json",
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        },
    )
    if status not in (200, 201, 204):
        raise RuntimeError(f"Falha ao gravar alerta no Supabase: HTTP {status} — {resp}")


def main():
    email_user = os.environ.get("CHURN_EMAIL_USER")
    email_pass = os.environ.get("CHURN_EMAIL_PASS")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not email_user or not email_pass or not service_key:
        print("Faltando CHURN_EMAIL_USER, CHURN_EMAIL_PASS ou SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

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

            gravar_alerta(service_key, message_id_header.strip(), dados)
            novos += 1
            print(f"  gravado: {dados.get('nome_cliente', '?')} (CNPJ {dados.get('cnpj', '?')})")

        print(f"Sincronização concluída. {novos} alerta(s) processado(s) (novos ou já existentes, ignorados via upsert).")
    finally:
        try:
            imap.close()
        except Exception:
            pass
        imap.logout()


if __name__ == "__main__":
    main()
