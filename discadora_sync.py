"""
Sincroniza o histórico de ligações da discadora (MakeSystem) para a tabela
discadora_ligacoes no Supabase.

Por padrão sincroniza o dia de ontem (uso normal, 1x por dia via GitHub
Actions). Para carga inicial (backfill), passe --desde/--ate.

Só usa a biblioteca padrão do Python (urllib) — sem dependências externas,
pra manter esse workflow leve e rápido (não precisa instalar nada).
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timedelta, timezone

VERCEL_BASE = "https://vst-dashboard.vercel.app"
SUPA_URL = "https://kzlchetrpsfefwybaaoy.supabase.co"
BRT = timezone(timedelta(hours=-3))
MAX_PAGINAS = 2000
BATCH_SIZE = 500


def post_json(url, body, headers, method="POST"):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            parsed = json.loads(raw)
        except Exception:
            parsed = raw.decode("utf-8", errors="replace")
        return e.code, parsed


def buscar_pagina(cron_secret, pagina):
    query = """{
      listar_historico_contato(
        contem_usuarios: true
        limite: 1000
        pagina: %d
      ) {
        dataRegistro
        duracao
        telefonia
        dddTelefone
        documento
        lead { nome }
        usuario { nome }
        grupo { nome }
        fila { nome }
      }
    }""" % pagina

    status, data = post_json(
        f"{VERCEL_BASE}/api/discadora",
        {"query": query},
        {"Content-Type": "application/json", "x-cron-secret": cron_secret},
    )
    if status != 200:
        raise RuntimeError(f"Falha ao buscar página {pagina}: HTTP {status} — {data}")
    if isinstance(data, dict) and data.get("errors"):
        raise RuntimeError(f"Erro GraphQL na página {pagina}: {data['errors']}")
    return (data or {}).get("data", {}).get("listar_historico_contato") or []


def transformar(registro):
    lead = registro.get("lead") or {}
    usuario = registro.get("usuario") or {}
    grupo = registro.get("grupo") or {}
    fila = registro.get("fila") or {}
    return {
        "data_registro": registro.get("dataRegistro"),
        "duracao": registro.get("duracao"),
        "telefonia": registro.get("telefonia"),
        "ddd_telefone": str(registro.get("dddTelefone")) if registro.get("dddTelefone") is not None else None,
        "documento": registro.get("documento"),
        "lead_nome": lead.get("nome"),
        "usuario_nome": usuario.get("nome"),
        "grupo_nome": grupo.get("nome"),
        "fila_nome": fila.get("nome"),
    }


def upsert_supabase(service_key, linhas):
    if not linhas:
        return
    for i in range(0, len(linhas), BATCH_SIZE):
        lote = linhas[i:i + BATCH_SIZE]
        status, resp = post_json(
            f"{SUPA_URL}/rest/v1/discadora_ligacoes?on_conflict=data_registro,usuario_nome,telefonia,duracao",
            lote,
            {
                "Content-Type": "application/json",
                "apikey": service_key,
                "Authorization": f"Bearer {service_key}",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        if status not in (200, 201, 204):
            raise RuntimeError(f"Falha ao gravar lote no Supabase: HTTP {status} — {resp}")
        print(f"  gravadas {len(lote)} linhas (lote {i // BATCH_SIZE + 1})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--desde", help="Data inicial YYYY-MM-DD (default: ontem)")
    parser.add_argument("--ate", help="Data final YYYY-MM-DD (default: ontem)")
    args = parser.parse_args()

    cron_secret = os.environ.get("DISCADORA_CRON_SECRET")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not cron_secret or not service_key:
        print("Faltando DISCADORA_CRON_SECRET ou SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
        sys.exit(1)

    hoje_brt = datetime.now(BRT).date()
    ontem = hoje_brt - timedelta(days=1)
    desde = datetime.strptime(args.desde, "%Y-%m-%d").date() if args.desde else ontem
    ate = datetime.strptime(args.ate, "%Y-%m-%d").date() if args.ate else ontem

    ts_ini = datetime.combine(desde, datetime.min.time(), tzinfo=BRT).timestamp()
    ts_fim = datetime.combine(ate, datetime.max.time(), tzinfo=BRT).timestamp()

    print(f"Sincronizando de {desde} até {ate}...")

    todos = []
    pagina = 1
    while pagina <= MAX_PAGINAS:
        lote = buscar_pagina(cron_secret, pagina)
        if not lote:
            break

        ts_recente = datetime.fromisoformat(lote[0]["dataRegistro"].replace("Z", "+00:00")).timestamp()
        if ts_recente < ts_ini:
            break

        for r in lote:
            ts = datetime.fromisoformat(r["dataRegistro"].replace("Z", "+00:00")).timestamp()
            if ts_ini <= ts <= ts_fim:
                todos.append(transformar(r))

        ts_antigo = datetime.fromisoformat(lote[-1]["dataRegistro"].replace("Z", "+00:00")).timestamp()
        print(f"página {pagina}: {len(lote)} registros (mais antigo: {lote[-1]['dataRegistro']})")
        if ts_antigo < ts_ini:
            break
        if len(lote) < 1000:
            break
        pagina += 1

    print(f"Total coletado no período: {len(todos)} registros")

    # Dedup pela mesma chave do UNIQUE constraint — o Postgres rejeita um
    # upsert em lote se duas linhas do MESMO comando colidirem na chave
    # (ON CONFLICT não pode afetar a mesma linha duas vezes). Duplicatas
    # acontecem por causa de sobreposição entre páginas ao paginar uma
    # API que segue recebendo dados novos durante a coleta.
    vistos = {}
    for linha in todos:
        chave = (linha["data_registro"], linha["usuario_nome"], linha["telefonia"], linha["duracao"])
        vistos[chave] = linha
    linhas_dedup = list(vistos.values())
    if len(linhas_dedup) != len(todos):
        print(f"Removidas {len(todos) - len(linhas_dedup)} duplicatas (sobreposição de página)")

    upsert_supabase(service_key, linhas_dedup)
    print("Sincronização concluída.")


if __name__ == "__main__":
    main()
