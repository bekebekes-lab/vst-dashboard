"""
Sincroniza o histórico de ligações da discadora (MakeSystem) para a tabela
discadora_ligacoes no Supabase.

Por padrão sincroniza o dia de ontem (uso normal, 1x por dia via GitHub
Actions). Para carga inicial (backfill), passe --desde/--ate.

Busca um dia de cada vez usando os filtros data_hora_minima/data_hora_maxima
que a API da discadora já suporta (mas o app nunca usava) — isso evita ter
que paginar desde "agora" pra trás toda vez que o dia pedido for antigo, e
permite gravar no Supabase logo depois de cada dia, em vez de só no final
de tudo (importante pro backfill de vários meses: se algo falhar no meio,
os dias já processados continuam salvos).

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
MAX_PAGINAS_DIA = 20
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


def buscar_pagina_do_dia(cron_secret, dia, pagina):
    query = """{
      listar_historico_contato(
        contem_usuarios: true
        limite: 1000
        pagina: %d
        data_hora_minima: "%sT00:00:00-03:00"
        data_hora_maxima: "%sT23:59:59-03:00"
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
    }""" % (pagina, dia, dia)

    status, data = post_json(
        f"{VERCEL_BASE}/api/discadora",
        {"query": query},
        {"Content-Type": "application/json", "x-cron-secret": cron_secret},
    )
    if status != 200:
        raise RuntimeError(f"Falha ao buscar {dia} página {pagina}: HTTP {status} — {data}")
    if isinstance(data, dict) and data.get("errors"):
        raise RuntimeError(f"Erro GraphQL em {dia} página {pagina}: {data['errors']}")
    return (data or {}).get("data", {}).get("listar_historico_contato") or []


def corrigir_fuso(data_registro):
    # Espelha _discCorrigirFuso() em index.html: a API marca o horário como
    # "Z" (UTC) mas o valor já é hora de Brasília — troca só o rótulo do
    # fuso (não desloca o relógio), senão o histórico fica gravado 3h
    # adiantado em relação ao que o app mostra pros dados ao vivo.
    if data_registro and data_registro.endswith("Z"):
        return data_registro[:-1] + "-03:00"
    return data_registro


def transformar(registro):
    lead = registro.get("lead") or {}
    usuario = registro.get("usuario") or {}
    grupo = registro.get("grupo") or {}
    fila = registro.get("fila") or {}
    return {
        "data_registro": corrigir_fuso(registro.get("dataRegistro")),
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


def sincronizar_dia(cron_secret, service_key, dia_str):
    todos = []
    pagina = 1
    while pagina <= MAX_PAGINAS_DIA:
        lote = buscar_pagina_do_dia(cron_secret, dia_str, pagina)
        if not lote:
            break
        todos.extend(transformar(r) for r in lote)
        if len(lote) < 1000:
            break
        pagina += 1

    # Dedup pela mesma chave do UNIQUE constraint — o Postgres rejeita um
    # upsert em lote se duas linhas do MESMO comando colidirem na chave.
    vistos = {}
    for linha in todos:
        chave = (linha["data_registro"], linha["usuario_nome"], linha["telefonia"], linha["duracao"])
        vistos[chave] = linha
    linhas_dedup = list(vistos.values())

    upsert_supabase(service_key, linhas_dedup)
    return len(linhas_dedup)


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

    total_dias = (ate - desde).days + 1
    print(f"Sincronizando de {desde} até {ate} ({total_dias} dia(s)), um dia por vez...")

    total_geral = 0
    dia = desde
    idx = 0
    while dia <= ate:
        idx += 1
        dia_str = dia.strftime("%Y-%m-%d")
        n = sincronizar_dia(cron_secret, service_key, dia_str)
        total_geral += n
        print(f"[{idx}/{total_dias}] {dia_str}: {n} registros gravados (total acumulado: {total_geral})")
        dia += timedelta(days=1)

    print(f"Sincronização concluída. Total: {total_geral} registros em {total_dias} dia(s).")


if __name__ == "__main__":
    main()
