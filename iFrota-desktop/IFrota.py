import sys
import os
import json
import math
import heapq
import urllib.request
import urllib.parse
import unicodedata
import threading
import http.server

# Flags de GPU — devem vir antes de qualquer import Qt.
# MapLibre GL JS exige WebGL. Como o ambiente não tem GPU compatível,
# forçamos ANGLE com SwiftShader (renderização via software). Isso dá WebGL
# sem precisar de hardware, evitando o crash de criação de contexto GLES3.
# --use-angle=swiftshader        : backend gráfico via software puro
# --enable-unsafe-swiftshader    : libera SwiftShader em Chromium recente
# --ignore-gpu-blocklist         : ignora a lista negra de GPUs
# --in-process-gpu               : evita handshake cross-process
# --no-sandbox                   : remove restrições de sandbox
os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = (
    "--use-angle=swiftshader --enable-unsafe-swiftshader "
    "--ignore-gpu-blocklist --in-process-gpu --no-sandbox"
)
os.environ["QTWEBENGINE_DISABLE_SANDBOX"] = "1"

import qtawesome as qta

from PySide6.QtWidgets import (
    QApplication, QWidget, QPushButton, QLineEdit, QLabel,
    QHBoxLayout, QVBoxLayout, QGraphicsDropShadowEffect, QGraphicsOpacityEffect,
    QScrollArea, QSizePolicy,
)
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtCore import Qt, Signal, QPropertyAnimation, QEasingCurve, QRect, QUrl, QTimer, QSize, QThread
from PySide6.QtGui import QColor, QPainter, QPixmap
try:
    from PySide6.QtPositioning import QGeoPositionInfoSource, QGeoPositionInfo
    _POSITIONING_OK = True
except ImportError:
    QGeoPositionInfoSource = None  # type: ignore
    QGeoPositionInfo = None  # type: ignore
    _POSITIONING_OK = False

# ─── GEOMETRIA ────────────────────────────────────────────────────────────────
WIN_W, WIN_H = 420, 860
HEADER_H     = 62
SEARCH_H     = 64
CHIPS_H      = 48
PANEL_W      = 280
CARD_H       = 290
CARD_H_COMPACT  = 290
CARD_H_EXPANDED = 720
ANIM_MS      = 340

# ─── CAMPUS ───────────────────────────────────────────────────────────────────
SW_LAT, SW_LON = -22.5225, -43.9960
NE_LAT, NE_LON = -22.5175, -43.9890
CENTRO_LAT = (SW_LAT + NE_LAT) / 2
CENTRO_LON = (SW_LON + NE_LON) / 2
ZOOM_PADRAO = 17

COR_HEX = {
    "green":      "#5cb85c", "lightgreen": "#8bc34a", "red":        "#d9534f",
    "blue":       "#428bca", "orange":     "#f0ad4e", "purple":     "#9B479F",
    "pink":       "#e91e8c", "cadetblue":  "#436978", "darkgreen":  "#2e7d32",
    "darkred":    "#a23336", "darkpurple": "#5B396B",
}

EMOJI_ICONE = {
    "road": "🚧", "briefcase": "💼", "book": "📚", "graduation-cap": "🎓",
    "bullhorn": "📢", "paint-brush": "🎨", "cutlery": "🍴", "futbol-o": "⚽",
    "leaf": "🌿", "sun-o": "☀", "paw": "🐾",
}

# Mapeia os ícones FontAwesome usados no mapa para Material Design Icons (qtawesome)
MDI_ICONE = {
    "road":           "mdi6.gate",
    "briefcase":      "mdi6.briefcase-outline",
    "book":           "mdi6.book-open-variant",
    "graduation-cap": "mdi6.school-outline",
    "bullhorn":       "mdi6.bullhorn-outline",
    "paint-brush":    "mdi6.palette-outline",
    "cutlery":        "mdi6.silverware-fork-knife",
    "futbol-o":       "mdi6.soccer",
    "leaf":           "mdi6.leaf",
    "sun-o":          "mdi6.white-balance-sunny",
    "paw":            "mdi6.paw",
}

CATEGORIAS = [
    ("Tudo",           "Tudo",           None),
    ("Ensino",         "Ensino",         "#428bca"),
    ("Administrativo", "Administrativo", "#d9534f"),
    ("Agropecuária",   "Agropecuária",   "#5cb85c"),
    ("Acessos",        "Acessos",        "#8bc34a"),
    ("Convivência",    "Convivência",    "#436978"),
    ("Esporte",        "Esporte",        "#2e7d32"),
]

LOCAIS_PADRAO = [
    {"nome": "Portaria 1 (Principal)", "coords": [-22.518476, -43.995129], "cor": "green",     "icone": "road",           "cat": "Acessos",        "desc": "Entrada principal do campus."},
    {"nome": "Portaria 2",             "coords": [-22.520139, -43.994636], "cor": "lightgreen", "icone": "road",           "cat": "Acessos",        "desc": "Acesso secundário ao campus."},
    {"nome": "Diretoria",              "coords": [-22.521774, -43.990663], "cor": "red",        "icone": "briefcase",      "cat": "Administrativo", "desc": "Setor de gestão e administração da instituição."},
    {"nome": "Biblioteca",             "coords": [-22.520877, -43.990945], "cor": "blue",       "icone": "book",           "cat": "Ensino",         "desc": "Acervo bibliográfico aberto a alunos e funcionários.",
     "agenda": {"seg": [["08:00", "Abertura"], ["14:00", "Estudo"]], "ter": [["08:00", "Abertura"]], "qua": [["08:00", "Abertura"], ["18:00", "Clube do livro"]], "qui": [["08:00", "Abertura"]], "sex": [["08:00", "Abertura"]], "sab": [["09:00", "Estudo livre"]], "dom": []},
     "fotos": ["fotos/biblioteca-1.jpg", "fotos/biblioteca-2.jpg", "fotos/biblioteca-3.jpg"]},
    {"nome": "Prédio Principal",       "coords": [-22.520178, -43.994086], "cor": "orange",     "icone": "graduation-cap", "cat": "Ensino",         "desc": "Bloco central com salas de aula e coordenações."},
    {"nome": "Auditório",              "coords": [-22.520218, -43.990749], "cor": "purple",     "icone": "bullhorn",       "cat": "Administrativo", "desc": "Espaço para eventos e apresentações."},
    {"nome": "Laboratório de Artes",   "coords": [-22.522104, -43.990095], "cor": "pink",       "icone": "paint-brush",    "cat": "Ensino",         "desc": "Laboratório para atividades artísticas."},
    {"nome": "Cantina",                "coords": [-22.520270, -43.990411], "cor": "cadetblue",  "icone": "cutlery",        "cat": "Convivência",    "desc": "Serviço de alimentação para alunos e funcionários."},
    {"nome": "Quadra Poliesportiva",   "coords": [-22.520471, -43.990526], "cor": "darkgreen",  "icone": "futbol-o",       "cat": "Esporte",        "desc": "Quadra coberta para prática de esportes.",
     "agenda": {"seg": [["19:00", "Futsal"]], "ter": [["07:00", "Ed. Física"], ["19:00", "Vôlei"]], "qua": [["19:00", "Basquete"]], "qui": [["07:00", "Ed. Física"]], "sex": [["19:00", "Futsal"]], "sab": [["09:00", "Aberta"]], "dom": []},
     "fotos": ["fotos/quadra-1.jpg", "fotos/quadra-2.jpg"]},
    {"nome": "Plantação / Lavoura",    "coords": [-22.519237, -43.994515], "cor": "green",      "icone": "leaf",           "cat": "Agropecuária",   "desc": "Área de cultivo para atividades de agroecologia."},
    {"nome": "Estufa",                 "coords": [-22.520243, -43.991634], "cor": "orange",     "icone": "sun-o",          "cat": "Agropecuária",   "desc": "Estufa para produção de mudas e experimentos."},
    {"nome": "Suinocultura",           "coords": [-22.520040, -43.993464], "cor": "darkred",    "icone": "paw",            "cat": "Agropecuária",   "desc": "Setor de criação de suínos."},
    {"nome": "Equinos",                "coords": [-22.520149, -43.992557], "cor": "darkpurple", "icone": "paw",            "cat": "Agropecuária",   "desc": "Área de manejo e criação de cavalos."},
]

# ─── SERVIDOR LOCAL ───────────────────────────────────────────────────────────
def _start_local_server(html_path: str) -> str:
    """Serve o HTML via HTTP local para que o Chromium carregue CDNs normalmente."""
    directory = os.path.dirname(html_path)
    filename  = os.path.basename(html_path)

    class _Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=directory, **kwargs)
        def log_message(self, *_args, **_kwargs):
            pass

    server = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{port}/{filename}"

# ─── DADOS ────────────────────────────────────────────────────────────────────
CONFIG_FILE = "config.json"

def carregar_config() -> dict:
    if not os.path.exists(CONFIG_FILE):
        return {}
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}

def salvar_config(config: dict) -> None:
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
    except OSError:
        pass

GRAFO_FILE  = "grafo.json"
CAMPUS_FILE = "campus.geojson"

# Feature flag — habilita Overpass API (raw OSM) como fonte adicional de
# rotas. False = volta ao comportamento de só vector tiles do OpenFreeMap.
# Ver CHANGELOG-overpass.md pra reverter por completo.
USE_OVERPASS = True

CACHE_DIR        = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
TILES_DIR_LIGHT  = os.path.join(CACHE_DIR, "tiles", "light")
TILES_DIR_DARK   = os.path.join(CACHE_DIR, "tiles", "dark")
TILE_URL_LIGHT   = "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
TILE_URL_DARK    = "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"

def lat_lon_to_tile(lat, lon, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_rad = math.radians(lat)
    y = int((1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * n)
    return x, y

def baixar_tiles_bbox(bbox, zoom_range, url_template, dest_dir):
    """Baixa todos os tiles do bbox para os zooms especificados. Pula os já em cache."""
    (sw_lat, sw_lon), (ne_lat, ne_lon) = bbox
    headers = {"User-Agent": "IFrota-TCC/1.0 (educational campus map)"}
    baixados, cache_hits, falhas = 0, 0, 0
    for z in zoom_range:
        x1, y1 = lat_lon_to_tile(ne_lat, sw_lon, z)
        x2, y2 = lat_lon_to_tile(sw_lat, ne_lon, z)
        for x in range(min(x1, x2), max(x1, x2) + 1):
            for y in range(min(y1, y2), max(y1, y2) + 1):
                path = os.path.join(dest_dir, str(z), str(x), f"{y}.png")
                if os.path.exists(path) and os.path.getsize(path) > 0:
                    cache_hits += 1
                    continue
                os.makedirs(os.path.dirname(path), exist_ok=True)
                url = (url_template.replace("{z}", str(z))
                                   .replace("{x}", str(x))
                                   .replace("{y}", str(y)))
                try:
                    req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(req, timeout=8) as r:
                        data = r.read()
                    with open(path, "wb") as f:
                        f.write(data)
                    baixados += 1
                except Exception:
                    falhas += 1
    return baixados, cache_hits, falhas

def garantir_tiles(bbox, zoom_min, zoom_max):
    """Garante que tiles dos temas claro e escuro estão em cache local."""
    os.makedirs(TILES_DIR_LIGHT, exist_ok=True)
    os.makedirs(TILES_DIR_DARK, exist_ok=True)
    zooms = range(zoom_min, zoom_max + 1)
    total_baixados = 0
    for nome, url_tpl, dest in [
        ("claro",  TILE_URL_LIGHT, TILES_DIR_LIGHT),
        ("escuro", TILE_URL_DARK,  TILES_DIR_DARK),
    ]:
        b, c, f = baixar_tiles_bbox(bbox, zooms, url_tpl, dest)
        total_baixados += b
        if b > 0 or f > 0:
            print(f"[TILES] {nome}: {b} baixados, {c} já em cache, {f} falhas")
    if total_baixados == 0:
        print(f"[TILES] todos os tiles ({zoom_min}-{zoom_max}) já estão em cache local")

def carregar_campus():
    """Carrega o polígono do campus do GeoJSON. Retorna (coords, bbox) ou (None, None).
       coords: lista [(lat, lon), ...]; bbox: ((sw_lat, sw_lon), (ne_lat, ne_lon))"""
    if not os.path.exists(CAMPUS_FILE):
        return None, None
    try:
        with open(CAMPUS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        feats = data.get("features", [data]) if data.get("type") == "FeatureCollection" else [data]
        for feat in feats:
            geom = feat.get("geometry", feat)
            if geom.get("type") != "Polygon":
                continue
            ring = geom["coordinates"][0]
            coords = [(p[1], p[0]) for p in ring]  # GeoJSON é [lon,lat]
            lats = [c[0] for c in coords]
            lons = [c[1] for c in coords]
            bbox = ((min(lats), min(lons)), (max(lats), max(lons)))
            return coords, bbox
        return None, None
    except (json.JSONDecodeError, KeyError, IndexError, OSError, TypeError):
        return None, None

def ponto_dentro(lat, lon, polygon):
    """Ray casting. polygon = list[(lat, lon)]. Se polygon for vazio, retorna True."""
    if not polygon:
        return True
    n = len(polygon)
    inside = False
    j = n - 1
    for i in range(n):
        yi, xi = polygon[i]
        yj, xj = polygon[j]
        if ((yi > lat) != (yj > lat)) and \
           (lon < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi):
            inside = not inside
        j = i
    return inside

def haversine(lat1, lon1, lat2, lon2):
    """Distância em metros entre dois pontos."""
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlam/2)**2
    return 2 * R * math.asin(math.sqrt(a))

def carregar_grafo():
    if not os.path.exists(GRAFO_FILE):
        return {"nodes": {}, "edges": [], "_next_id": 1}
    try:
        with open(GRAFO_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        data.setdefault("nodes", {})
        data.setdefault("edges", [])
        # Recalcula próximo ID baseado nos nós existentes
        max_id = 0
        for nid in data["nodes"]:
            try:
                max_id = max(max_id, int(nid.lstrip("n")))
            except ValueError:
                pass
        data["_next_id"] = max_id + 1
        return data
    except (json.JSONDecodeError, OSError):
        return {"nodes": {}, "edges": [], "_next_id": 1}

def salvar_grafo(grafo):
    try:
        out = {"nodes": grafo["nodes"], "edges": grafo["edges"]}
        with open(GRAFO_FILE, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
    except OSError:
        pass

def _adjacencias(grafo):
    adj = {nid: [] for nid in grafo["nodes"]}
    for a, b in grafo["edges"]:
        if a in grafo["nodes"] and b in grafo["nodes"]:
            la, oa = grafo["nodes"][a]
            lb, ob = grafo["nodes"][b]
            d = haversine(la, oa, lb, ob)
            adj[a].append((b, d))
            adj[b].append((a, d))
    return adj

def no_mais_proximo(grafo, lat, lon):
    best, best_d = None, float("inf")
    for nid, (la, lo) in grafo["nodes"].items():
        d = haversine(lat, lon, la, lo)
        if d < best_d:
            best_d, best = d, nid
    return best, best_d

def astar(grafo, start_id, goal_id):
    if start_id not in grafo["nodes"] or goal_id not in grafo["nodes"]:
        return None
    if start_id == goal_id:
        return [start_id]
    adj = _adjacencias(grafo)
    nodes = grafo["nodes"]
    g_lat, g_lon = nodes[goal_id]
    def h(nid):
        la, lo = nodes[nid]
        return haversine(la, lo, g_lat, g_lon)

    open_set = [(h(start_id), 0.0, start_id)]
    came_from = {}
    g_score = {start_id: 0.0}
    while open_set:
        _f, g, current = heapq.heappop(open_set)
        if current == goal_id:
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)
            return list(reversed(path))
        if g > g_score.get(current, float("inf")):
            continue
        for nb, w in adj[current]:
            t = g + w
            if t < g_score.get(nb, float("inf")):
                came_from[nb] = current
                g_score[nb] = t
                heapq.heappush(open_set, (t + h(nb), t, nb))
    return None

OVERPASS_CACHE = ".cache/overpass_campus.json"

def fetch_overpass_caminhos(bbox, force_refresh=False, timeout=15):
    """Consulta Overpass API por TODAS as features de highway no bbox.
    Cacheia em disco — só faz fetch real na primeira execução.
    Retorna lista de features no formato:
        [{geometry: {type, coordinates}, properties: {class}}, ...]
    Retorna [] em caso de erro (sistema funciona sem Overpass)."""
    cache_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), OVERPASS_CACHE)
    if not force_refresh and os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass  # cache corrompido, refaz

    (sw_lat, sw_lon), (ne_lat, ne_lon) = bbox
    # Overpass QL: todas as ways com tag highway dentro do bbox
    query = f"""
    [out:json][timeout:{timeout}];
    way["highway"]({sw_lat},{sw_lon},{ne_lat},{ne_lon});
    out geom;
    """
    url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={
        "User-Agent": "IFrota-TCC/1.0 (educational campus map)",
        "Accept": "application/json",
    })
    # Tenta SSL verificado primeiro; se falhar, retry com contexto relaxado
    # (problema comum no Windows com bundles de CA desatualizados do Python)
    import ssl as _ssl
    data = None
    last_err = None
    for ctx in [None, _ssl.create_default_context()]:
        if ctx is not None:
            ctx.check_hostname = False
            ctx.verify_mode = _ssl.CERT_NONE
        try:
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            break
        except Exception as e:
            last_err = e
    if data is None:
        print(f"[OVERPASS] Falha ao consultar: {last_err}")
        return []

    feats = []
    for el in data.get("elements", []):
        if el.get("type") != "way":
            continue
        geom = el.get("geometry")
        if not geom or len(geom) < 2:
            continue
        coords = [[g["lon"], g["lat"]] for g in geom]
        highway = (el.get("tags") or {}).get("highway", "unknown")
        feats.append({
            "geometry": {"type": "LineString", "coordinates": coords},
            "properties": {"class": highway},
        })
    print(f"[OVERPASS] {len(feats)} caminhos obtidos do banco OSM")

    # Salva cache
    try:
        os.makedirs(os.path.dirname(cache_path), exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(feats, f)
    except OSError:
        pass

    return feats

def osrm_route(start, end, timeout=4):
    """Chama OSRM público (modo a pé). Retorna lista [[lat,lon],...] ou None."""
    url = (
        "https://router.project-osrm.org/route/v1/foot/"
        f"{start[1]},{start[0]};{end[1]},{end[0]}"
        "?overview=full&geometries=geojson"
    )
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("code") != "Ok" or not data.get("routes"):
            return None
        return [[c[1], c[0]] for c in data["routes"][0]["geometry"]["coordinates"]]
    except Exception:
        return None

def in_campus(lat, lon):
    return SW_LAT <= lat <= NE_LAT and SW_LON <= lon <= NE_LON

def auto_gerar_grafo(locais, k=4, max_dist_m=350):
    """Gera grafo inicial conectando cada waypoint aos K vizinhos mais próximos
    (limitado por max_dist_m). Útil quando grafo.json ainda não foi populado.
    O usuário pode refinar depois via 'Editar Grafo' no painel."""
    nodes = {}
    for i, l in enumerate(locais):
        nid = f"n{i+1}"
        nodes[nid] = list(l["coords"])

    edges = []
    seen = set()
    for i, l in enumerate(locais):
        nid_a = f"n{i+1}"
        dists = []
        for j, l2 in enumerate(locais):
            if i == j:
                continue
            d = haversine(l["coords"][0], l["coords"][1],
                          l2["coords"][0], l2["coords"][1])
            dists.append((d, f"n{j+1}"))
        dists.sort()
        for d, nid_b in dists[:k]:
            if d > max_dist_m:
                break
            key = tuple(sorted([nid_a, nid_b]))
            if key in seen:
                continue
            seen.add(key)
            edges.append([nid_a, nid_b])
    return {"nodes": nodes, "edges": edges, "_next_id": len(nodes) + 1}

def calcular_rota(start, end, locais):
    """Híbrido: grafo interno + OSRM. Retorna lista [[lat,lon],...]."""
    grafo = carregar_grafo()
    # Se ainda não há grafo populado, auto-gera a partir dos waypoints
    if not grafo["nodes"]:
        grafo = auto_gerar_grafo(locais)
        salvar_grafo(grafo)
        print(f"[GRAFO] Auto-gerado: {len(grafo['nodes'])} nós, "
              f"{len(grafo['edges'])} arestas (conectando waypoints por proximidade)")
    s_in = in_campus(*start)
    e_in = in_campus(*end)

    # Ambos no campus + grafo populado → A* interno
    if s_in and e_in and grafo["nodes"]:
        s_id, _ = no_mais_proximo(grafo, *start)
        e_id, _ = no_mais_proximo(grafo, *end)
        path = astar(grafo, s_id, e_id) if s_id and e_id else None
        if path:
            interior = [grafo["nodes"][nid] for nid in path]
            return [list(start)] + interior + [list(end)]

    # Aluno fora, destino no campus → OSRM até portaria + grafo interno
    if (not s_in) and e_in and grafo["nodes"]:
        portarias = [l for l in locais if l.get("cat") == "Acessos"]
        if portarias:
            portaria = min(portarias, key=lambda l: haversine(start[0], start[1], l["coords"][0], l["coords"][1]))
            ext = osrm_route(start, portaria["coords"])
            if ext:
                p_id, _ = no_mais_proximo(grafo, *portaria["coords"])
                e_id, _ = no_mais_proximo(grafo, *end)
                if p_id and e_id:
                    interior_ids = astar(grafo, p_id, e_id)
                    if interior_ids:
                        interior = [grafo["nodes"][nid] for nid in interior_ids]
                        return ext + interior + [list(end)]

    # Caso geral: OSRM puro (ou ambos fora)
    osrm = osrm_route(start, end)
    if osrm:
        return osrm

    # Fallback: linha reta
    return [list(start), list(end)]

def comprimento_rota(coords):
    total = 0.0
    for i in range(1, len(coords)):
        total += haversine(coords[i-1][0], coords[i-1][1], coords[i][0], coords[i][1])
    return total

def carregar_dados():
    arquivo = "locais.json"
    if not os.path.exists(arquivo):
        with open(arquivo, "w", encoding="utf-8") as f:
            json.dump(LOCAIS_PADRAO, f, ensure_ascii=False, indent=4)
        return LOCAIS_PADRAO

    with open(arquivo, "r", encoding="utf-8") as f:
        dados = json.load(f)

    # Migra JSONs antigos: preenche quaisquer campos ausentes a partir do padrão,
    # casando pelo campo "nome".
    padrao_por_nome = {l["nome"]: l for l in LOCAIS_PADRAO}
    alterado = False
    for local in dados:
        padrao = padrao_por_nome.get(local.get("nome"), {})
        for chave, valor in padrao.items():
            if chave not in local:
                local[chave] = valor
                alterado = True
        local.setdefault("desc", "")

    # Se migrou algo, persiste de volta para não repetir na próxima execução
    if alterado:
        with open(arquivo, "w", encoding="utf-8") as f:
            json.dump(dados, f, ensure_ascii=False, indent=4)

    return dados

# ─── BUSCA FUZZY ──────────────────────────────────────────────────────────────
def _norm(s):
    return "".join(
        c for c in unicodedata.normalize("NFD", s.lower())
        if unicodedata.category(c) != "Mn"
    )

def _lev(a, b):
    m, n = len(a), len(b)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev, dp[0] = dp[0], i
        for j in range(1, n + 1):
            temp = dp[j]
            dp[j] = prev if a[i-1] == b[j-1] else 1 + min(prev, dp[j], dp[j-1])
            prev = temp
    return dp[n]

def buscar_locais(query, locais):
    q = _norm(query)
    if len(q) < 2:
        return []
    resultado = []
    for local in locais:
        nn = _norm(local["nome"])
        if q in nn:
            resultado.append((0, local))
            continue
        menor = min(
            (_lev(q, p) for p in nn.split() if abs(len(p) - len(q)) <= 3),
            default=999,
        )
        if menor <= max(1, len(q) // 3):
            resultado.append((menor, local))
    resultado.sort(key=lambda x: x[0])
    return [r[1] for r in resultado]

# ─── MAPA HTML (MapLibre GL JS) ──────────────────────────────────────────────
STYLE_LIGHT_URL = "https://tiles.openfreemap.org/styles/positron"
# OpenFreeMap só hospeda 3 estilos (positron, bright, liberty). Para o tema
# escuro montamos um style inline que reaproveita as mesmas vector tiles.
STYLE_DARK_INLINE = {
    "version": 8,
    "name": "campus-dark-matter",
    "sources": {
        "openmaptiles": {
            "type": "vector",
            "url": "https://tiles.openfreemap.org/planet"
        }
    },
    "glyphs": "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    "layers": [
        {"id": "background", "type": "background",
         "paint": {"background-color": "#0a0a0a"}},
        {"id": "landcover", "type": "fill", "source": "openmaptiles",
         "source-layer": "landcover",
         "paint": {"fill-color": "#161616", "fill-opacity": 0.6}},
        {"id": "park", "type": "fill", "source": "openmaptiles",
         "source-layer": "park",
         "paint": {"fill-color": "#1c1c1c", "fill-opacity": 0.8}},
        {"id": "landuse", "type": "fill", "source": "openmaptiles",
         "source-layer": "landuse",
         "paint": {"fill-color": "#181818", "fill-opacity": 0.6}},
        {"id": "water", "type": "fill", "source": "openmaptiles",
         "source-layer": "water",
         "paint": {"fill-color": "#000000"}},
        {"id": "waterway", "type": "line", "source": "openmaptiles",
         "source-layer": "waterway",
         "paint": {"line-color": "#000000", "line-width": 1}},
        {"id": "building", "type": "fill", "source": "openmaptiles",
         "source-layer": "building",
         "paint": {"fill-color": "#1e1e1e", "fill-outline-color": "#2a2a2a"}},
        {"id": "tunnel", "type": "line", "source": "openmaptiles",
         "source-layer": "transportation",
         "filter": ["==", "brunnel", "tunnel"],
         "paint": {"line-color": "#1e1e1e", "line-width": 1.5, "line-dasharray": [2, 2]}},
        {"id": "highway-minor", "type": "line", "source": "openmaptiles",
         "source-layer": "transportation",
         "filter": ["!in", "class", "motorway", "trunk", "primary"],
         "paint": {"line-color": "#2e2e2e",
                   "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 20, 4]}},
        {"id": "highway-major", "type": "line", "source": "openmaptiles",
         "source-layer": "transportation",
         "filter": ["in", "class", "motorway", "trunk", "primary"],
         "paint": {"line-color": "#4a4a4a",
                   "line-width": ["interpolate", ["linear"], ["zoom"], 12, 1, 20, 6]}},
        {"id": "boundary", "type": "line", "source": "openmaptiles",
         "source-layer": "boundary",
         "paint": {"line-color": "#363636", "line-width": 0.8, "line-dasharray": [2, 2]}},
        {"id": "transportation_name", "type": "symbol", "source": "openmaptiles",
         "source-layer": "transportation_name", "minzoom": 14,
         "layout": {"text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 11},
         "paint": {"text-color": "#8a8a8a", "text-halo-color": "#0a0a0a", "text-halo-width": 1.2}},
        {"id": "place", "type": "symbol", "source": "openmaptiles",
         "source-layer": "place",
         "layout": {"text-field": "{name}", "text-font": ["Noto Sans Regular"], "text-size": 12},
         "paint": {"text-color": "#b0b0b0", "text-halo-color": "#0a0a0a", "text-halo-width": 1.2}}
    ]
}

def gerar_mapa(locais, dark=False):
    poligono, bbox = carregar_campus()
    if bbox:
        (sw_lat, sw_lon), (ne_lat, ne_lon) = bbox
        ctr_lat = (sw_lat + ne_lat) / 2
        ctr_lon = (sw_lon + ne_lon) / 2
        if poligono:
            locais = [l for l in locais if ponto_dentro(l["coords"][0], l["coords"][1], poligono)]
    else:
        sw_lat, sw_lon = SW_LAT, SW_LON
        ne_lat, ne_lon = NE_LAT, NE_LON
        ctr_lat, ctr_lon = CENTRO_LAT, CENTRO_LON

    # Acrescenta cor_hex em cada local (já que o JS rasterizado pelo folium não existe mais)
    locais_js = [{**l, "cor_hex": COR_HEX.get(l.get("cor", "green"), "#5cb85c")} for l in locais]

    dados_js   = json.dumps(locais_js, ensure_ascii=False)
    # Overpass API: features adicionais de highway (raw OSM, mais completo
    # que o que vem nas vector tiles do OpenFreeMap)
    overpass_features = (fetch_overpass_caminhos(((sw_lat, sw_lon), (ne_lat, ne_lon)))
                         if USE_OVERPASS else [])
    overpass_js = json.dumps(overpass_features)
    poly_js    = json.dumps([[c[0], c[1]] for c in poligono]) if poligono else "null"
    bounds_js  = json.dumps([[sw_lat, sw_lon], [ne_lat, ne_lon]])

    html = f"""<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>IFrota</title>
<link href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css" rel="stylesheet">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">
<style>
  html, body, #map {{ margin: 0; padding: 0; height: 100%; width: 100%; }}
  /* Background do body deve combinar com o do mapa para o horizonte
     (área além das tiles quando tilted) não mostrar branco vazando */
  body              {{ background-color: #f0f2f0; }}  /* claro */
  body.dark         {{ background-color: #0a0a0a; }}  /* escuro */
  /* Remove o outline laranja/amarelo padrão do Chromium em foco */
  * {{ outline: none !important; }}
  *:focus, *:focus-visible {{ outline: none !important; }}
  canvas, .maplibregl-canvas {{ outline: none !important; }}
  .wp-marker {{ width: 36px; height: 47px; cursor: pointer; }}
  /* Tema CLARO (padrão): borda e seta pretas. Ícone interno SEMPRE branco. */
  .wp-circle {{
    width: 36px; height: 36px; border-radius: 50%;
    background: #ffffff;
    border: 2.5px solid #0f172a;
    box-shadow: 0 4px 12px rgba(0,0,0,0.30);
    display: flex; align-items: center; justify-content: center;
    color: #ffffff; font-size: 14px;
  }}
  .wp-arrow {{
    width: 0; height: 0; margin: -1px auto 0;
    border-left: 8px solid transparent; border-right: 8px solid transparent;
    border-top: 11px solid #0f172a;
  }}
  /* Tema ESCURO: inverte borda e seta para branco. Ícone continua branco. */
  body.dark .wp-circle {{
    background: #0f172a;
    border-color: #ffffff;
    box-shadow: 0 4px 12px rgba(0,0,0,0.55);
  }}
  body.dark .wp-arrow {{
    border-top-color: #ffffff;
  }}
  /* Marker selecionado (card aberto): pulse no .wp-content para não conflitar
     com o transform: translate(...) que o MapLibre define inline no .wp-marker. */
  .wp-marker.selected {{ z-index: 100; }}
  .wp-marker.selected .wp-content {{
    animation: wp-pulse 1.6s ease-in-out infinite;
    transform-origin: bottom center;
  }}
  .wp-marker.selected .wp-circle {{
    box-shadow: 0 0 0 4px rgba(255,255,255,0.30), 0 8px 20px rgba(0,0,0,0.55);
  }}
  @keyframes wp-pulse {{
    0%, 100% {{ transform: scale(1); }}
    50%      {{ transform: scale(1.15); }}
  }}
  /* Marcador do usuário: branco com borda preta */
  .user-dot {{
    width: 18px; height: 18px; border-radius: 50%;
    background: #ffffff; border: 3px solid #0f172a;
    box-shadow: 0 0 0 3px rgba(255,255,255,0.55), 0 2px 8px rgba(0,0,0,0.6);
  }}
  /* Nó do editor de grafo: preto, seleção em vermelho */
  .node-dot {{
    width: 14px; height: 14px; border-radius: 50%;
    background: #0f172a; border: 2px solid #ffffff; cursor: pointer;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  }}
  .node-dot.sel {{ background: #dc2626; transform: scale(1.4); }}
  .maplibregl-ctrl-attrib, .maplibregl-ctrl-logo {{ display: none !important; }}

  /* Controles de navegação estilizados (mobile-friendly) */
  .maplibregl-ctrl-top-right {{
    margin-top: 10px !important; margin-right: 10px !important;
  }}
  .maplibregl-ctrl-group {{
    background: rgba(20, 20, 20, 0.92) !important;
    border: 1px solid rgba(80, 80, 80, 0.4) !important;
    border-radius: 12px !important;
    box-shadow: 0 4px 16px rgba(0,0,0,0.45) !important;
    overflow: hidden;
  }}
  body.dark .maplibregl-ctrl-group {{
    background: rgba(20, 20, 20, 0.92) !important;
  }}
  body:not(.dark) .maplibregl-ctrl-group {{
    background: rgba(255, 255, 255, 0.95) !important;
    border-color: rgba(0, 0, 0, 0.1) !important;
  }}
  .maplibregl-ctrl-group button {{
    width: 42px !important; height: 42px !important;
    background-color: transparent !important;
    transition: background-color 120ms ease-out;
  }}
  .maplibregl-ctrl-group button + button {{
    border-top: 1px solid rgba(120, 120, 120, 0.25) !important;
  }}
  .maplibregl-ctrl-group button:hover {{
    background-color: rgba(255, 255, 255, 0.08) !important;
  }}
  body:not(.dark) .maplibregl-ctrl-group button:hover {{
    background-color: rgba(0, 0, 0, 0.06) !important;
  }}
  body.dark .maplibregl-ctrl-group button .maplibregl-ctrl-icon {{
    filter: invert(0.92);
  }}
</style>
</head><body>
<div id="map"></div>
<script>
const _locais         = {dados_js};
const _campusPoly     = {poly_js};
const _campusBoundsArr = {bounds_js};
const _overpassFeats   = {overpass_js};  // features adicionais de highway via Overpass API
const _styleLight     = "{STYLE_LIGHT_URL}";
const _styleDark      = {json.dumps(STYLE_DARK_INLINE)};
const CENTRO          = [{ctr_lon}, {ctr_lat}];
const ZOOM_PADRAO     = {ZOOM_PADRAO};

let _currentDark = {str(dark).lower()};
let _currentRoute = null;
// Marca o body com a classe .dark — CSS dos marcadores responde a isso
if (_currentDark) document.body.classList.add('dark');

const map = new maplibregl.Map({{
    container: 'map',
    style: _currentDark ? _styleDark : _styleLight,
    center: CENTRO,
    zoom: ZOOM_PADRAO,
    pitch: 45,
    bearing: -17,
    minZoom: {ZOOM_PADRAO} - 1,
    maxZoom: 21,
    maxBounds: [
        [_campusBoundsArr[0][1] - 0.005, _campusBoundsArr[0][0] - 0.005],
        [_campusBoundsArr[1][1] + 0.005, _campusBoundsArr[1][0] + 0.005]
    ],
    attributionControl: false
}});

map.addControl(new maplibregl.NavigationControl({{ visualizePitch: true, showCompass: true }}), 'top-right');
map.dragRotate.enable();
map.touchZoomRotate.enableRotation();

// ── Marcadores dos waypoints ──────────────────────────────────────────────────
let _allMarkers = [];
function _addWaypointMarkers() {{
    _locais.forEach(local => {{
        const wrap = document.createElement('div');
        wrap.className = 'wp-marker';
        // Wrapper interno .wp-content recebe a animação de pulse, deixando
        // o .wp-marker externo livre pro MapLibre aplicar translate de posição.
        wrap.innerHTML = ''
            + '<div class="wp-content">'
            + '  <div class="wp-circle" style="background:' + local.cor_hex + ';">'
            + '    <i class="fa fa-' + local.icone + '"></i>'
            + '  </div>'
            + '  <div class="wp-arrow"></div>'
            + '</div>';
        wrap.addEventListener('click', (ev) => {{
            ev.stopPropagation();
            console.log('IFROTA:CLICK:' + local.nome);
        }});
        const m = new maplibregl.Marker({{ element: wrap, anchor: 'bottom' }})
            .setLngLat([local.coords[1], local.coords[0]]).addTo(map);
        m._cat  = local.cat;
        m._nome = local.nome;
        m._el   = wrap;
        _allMarkers.push(m);
    }});
}}

// ── Máscara invertida + contorno do campus ────────────────────────────────────
// Suaviza os cantos do polígono via Bezier quadrático.
// - smoothness: fração da aresta usada (0..0.45)
// - maxDistDeg: teto absoluto em graus (~111m por grau de lat) pra evitar que
//   o arredondamento "morda" features próximas da borda (ex: portaria).
// Retorna o anel suavizado sem alterar a geometria original (usada no Python).
function _roundedRing(ring, smoothness, maxDistDeg) {{
    if (!ring || ring.length < 4) return ring;
    smoothness = Math.max(0, Math.min(0.45, smoothness || 0.10));
    maxDistDeg = maxDistDeg || 0.00015;  // ~15m
    const r = ring.slice();
    if (r[0][0] === r[r.length-1][0] && r[0][1] === r[r.length-1][1]) r.pop();
    const n = r.length;
    const out = [];
    const steps = 8;
    for (let i = 0; i < n; i++) {{
        const prev = r[(i - 1 + n) % n];
        const curr = r[i];
        const next = r[(i + 1) % n];
        const vpx = prev[0] - curr[0], vpy = prev[1] - curr[1];
        const vnx = next[0] - curr[0], vny = next[1] - curr[1];
        const lenP = Math.hypot(vpx, vpy);
        const lenN = Math.hypot(vnx, vny);
        // Distância máxima que cada lado da curva avança do vértice — clamped
        // tanto pelo fraction quanto pelo teto absoluto
        const distP = Math.min(lenP * smoothness, maxDistDeg);
        const distN = Math.min(lenN * smoothness, maxDistDeg);
        const A = [curr[0] + (vpx/lenP) * distP, curr[1] + (vpy/lenP) * distP];
        const B = [curr[0] + (vnx/lenN) * distN, curr[1] + (vny/lenN) * distN];
        out.push(A);
        for (let t = 1; t < steps; t++) {{
            const u = t / steps;
            const omu = 1 - u;
            const x = omu*omu*A[0] + 2*omu*u*curr[0] + u*u*B[0];
            const y = omu*omu*A[1] + 2*omu*u*curr[1] + u*u*B[1];
            out.push([x, y]);
        }}
        out.push(B);
    }}
    out.push(out[0]);
    return out;
}}

function _setupCampusMask() {{
    if (!_campusPoly || _campusPoly.length < 3) return;
    const world  = [[-180,-85],[180,-85],[180,85],[-180,85],[-180,-85]];
    const sharpRing = _campusPoly.map(c => [c[1], c[0]]);
    if (sharpRing[0][0] !== sharpRing[sharpRing.length-1][0] ||
        sharpRing[0][1] !== sharpRing[sharpRing.length-1][1]) sharpRing.push(sharpRing[0]);
    // Cantos arredondados via Bezier — smoothness 12% com teto absoluto de ~12m
    // (mantém features próximas da borda, ex: portarias, dentro do polígono)
    const ring = _roundedRing(sharpRing, 0.12, 0.00012);

    if (map.getLayer('campus-mask')) map.removeLayer('campus-mask');
    if (map.getSource('campus-mask')) map.removeSource('campus-mask');
    if (map.getLayer('campus-outline')) map.removeLayer('campus-outline');
    if (map.getSource('campus-outline')) map.removeSource('campus-outline');

    map.addSource('campus-mask', {{
        type: 'geojson',
        data: {{ type: 'Feature', geometry: {{ type: 'Polygon', coordinates: [world, ring] }} }}
    }});
    map.addLayer({{
        id: 'campus-mask', source: 'campus-mask', type: 'fill',
        paint: {{ 'fill-color': '#000', 'fill-opacity': 0.45 }}
    }});
    map.addSource('campus-outline', {{
        type: 'geojson',
        data: {{ type: 'Feature', geometry: {{ type: 'Polygon', coordinates: [ring] }} }}
    }});
    // Borda em cor oposta ao tema: branca no escuro, preta no claro
    const outlineColor = _currentDark ? '#ffffff' : '#0a0a0a';
    map.addLayer({{
        id: 'campus-outline', source: 'campus-outline', type: 'line',
        layout: {{ 'line-join': 'round', 'line-cap': 'round' }},
        paint: {{ 'line-color': outlineColor, 'line-width': 3, 'line-dasharray': [2, 2] }}
    }});
}}

// ── Prédios 3D extrudados (a partir do source de building do estilo) ──────────
function _setup3DBuildings() {{
    const layers = map.getStyle().layers || [];
    let labelLayer = null;
    for (const l of layers) {{
        if (l.type === 'symbol' && l.layout && l.layout['text-field']) {{ labelLayer = l.id; break; }}
    }}
    // OpenFreeMap usa source 'openmaptiles', source-layer 'building'
    if (!map.getSource('openmaptiles')) return;
    if (map.getLayer('3d-buildings')) map.removeLayer('3d-buildings');
    map.addLayer({{
        id: '3d-buildings',
        source: 'openmaptiles',
        'source-layer': 'building',
        type: 'fill-extrusion',
        minzoom: 14,
        paint: {{
            'fill-extrusion-color': _currentDark ? '#2e2e2e' : '#d6d6d6',
            'fill-extrusion-height': ['coalesce', ['get','render_height'], ['get','height'], 6],
            'fill-extrusion-base':   ['coalesce', ['get','render_min_height'], ['get','min_height'], 0],
            'fill-extrusion-opacity': 0.85
        }}
    }}, labelLayer);
}}

// ── API exposta para o Python ─────────────────────────────────────────────────
window.flyToLocal = function(lat, lon) {{
    map.flyTo({{ center: [lon, lat], zoom: 19, duration: 1500, essential: true }});
}};

window.setMapPadding = function(top, bottom) {{
    map.setPadding({{ top: top || 0, right: 0, bottom: bottom || 0, left: 0 }});
}};

// ── ROUTING SOBRE A REDE VIÁRIA DO MAPA ────────────────────────────────────
function _hav(lat1, lon1, lat2, lon2) {{
    const R = 6371000;
    const r1 = lat1 * Math.PI / 180, r2 = lat2 * Math.PI / 180;
    const dr = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dr/2)**2 + Math.cos(r1)*Math.cos(r2)*Math.sin(dl/2)**2;
    return 2 * R * Math.asin(Math.sqrt(a));
}}

function _astarJS(adj, startId, goalId, nodes) {{
    const open = new Map();  // id -> fScore
    const cameFrom = {{}};
    const gScore = {{[startId]: 0}};
    const goal = nodes[goalId];
    const h = (id) => {{
        const n = nodes[id];
        return _hav(n[1], n[0], goal[1], goal[0]);
    }};
    open.set(startId, h(startId));
    while (open.size) {{
        // Pop nó com menor f
        let curr = null, minF = Infinity;
        for (const [id, f] of open) {{ if (f < minF) {{ minF = f; curr = id; }} }}
        open.delete(curr);
        if (curr === goalId) {{
            const path = [curr];
            let c = curr;
            while (c in cameFrom) {{ c = cameFrom[c]; path.unshift(c); }}
            return path;
        }}
        for (const [nb, w] of (adj[curr] || [])) {{
            const t = gScore[curr] + w;
            if (t < (gScore[nb] ?? Infinity)) {{
                cameFrom[nb] = curr;
                gScore[nb] = t;
                open.set(nb, t + h(nb));
            }}
        }}
    }}
    return null;
}}

// Ray-casting: ponto dentro do polígono do campus.
// _campusPoly é list [(lat, lon), ...] (mesmo formato usado no Python).
function _ptInCampus(lat, lon) {{
    const poly = _campusPoly;
    if (!poly || poly.length < 3) return true;
    let inside = false;
    let j = poly.length - 1;
    for (let i = 0; i < poly.length; i++) {{
        const yi = poly[i][0], xi = poly[i][1];
        const yj = poly[j][0], xj = poly[j][1];
        const intersect = ((yi > lat) !== (yj > lat)) &&
                          (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
        if (intersect) inside = !inside;
        j = i;
    }}
    return inside;
}}

function _construirRedeViaria() {{
    // Extrai LineStrings da camada transportation das tiles carregadas.
    // Filtro mais permissivo: inclui segmento se PELO MENOS UM endpoint ou
    // o midpoint estiver dentro do campus (assim captura caminhos internos
    // mesmo que entrem/saiam pela borda).
    let feats = [];
    try {{
        feats = map.querySourceFeatures('openmaptiles', {{ sourceLayer: 'transportation' }});
    }} catch (e) {{
        console.log('Erro ao consultar source openmaptiles:', e);
        return null;
    }}
    const nodes = {{}};
    const adj   = {{}};
    // Precisão de ~1m (4 casas decimais ≈ 11m / 10x). Usamos 5 (≈1.1m) pra
    // unir nós no mesmo "ponto" mesmo com pequenas variações em OSM raw data.
    const key = (c) => c[0].toFixed(5) + ',' + c[1].toFixed(5);
    const getId = (c) => {{
        const k = key(c);
        if (!(k in nodes)) {{ nodes[k] = c; adj[k] = []; }}
        return k;
    }};
    let total = 0, kept = 0;
    const addEdge = (a, b) => {{
        total++;
        // Aceita se qualquer um dos endpoints OU o ponto médio está dentro
        const aIn  = _ptInCampus(a[1], a[0]);
        const bIn  = _ptInCampus(b[1], b[0]);
        const mLat = (a[1] + b[1]) / 2, mLon = (a[0] + b[0]) / 2;
        const mIn  = _ptInCampus(mLat, mLon);
        if (!aIn && !bIn && !mIn) return;
        kept++;
        const w = _hav(a[1], a[0], b[1], b[0]);
        const ia = getId(a), ib = getId(b);
        adj[ia].push([ib, w]);
        adj[ib].push([ia, w]);
    }};
    const handleLine = (coords) => {{
        for (let i = 0; i < coords.length - 1; i++) addEdge(coords[i], coords[i+1]);
    }};
    // Conta features por class pra debug
    const classCount = {{}};
    for (const f of feats) {{
        const g = f.geometry;
        if (!g) continue;
        const cls = (f.properties && f.properties.class) || 'sem-class';
        classCount[cls] = (classCount[cls] || 0) + 1;
        if (g.type === 'LineString') handleLine(g.coordinates);
        else if (g.type === 'MultiLineString') g.coordinates.forEach(handleLine);
    }}
    // ── ADIÇÃO: features do Overpass API (raw OSM, mais completo) ──
    let overpassAdded = 0;
    if (typeof _overpassFeats !== 'undefined' && _overpassFeats.length > 0) {{
        for (const f of _overpassFeats) {{
            const g = f.geometry;
            if (!g || g.type !== 'LineString') continue;
            const cls = '[ovp]' + ((f.properties && f.properties.class) || 'unk');
            classCount[cls] = (classCount[cls] || 0) + 1;
            handleLine(g.coordinates);
            overpassAdded++;
        }}
    }}
    console.log('IFROTA:DBG: classes OSM no campus: ' + JSON.stringify(classCount));
    if (overpassAdded > 0) {{
        console.log('IFROTA:DBG: ' + overpassAdded + ' features adicionadas do Overpass');
    }}
    // PENALIDADE pra arestas virtuais — A* vai preferir ruas reais mesmo
    // se forem mais longas geograficamente. Bridges só serão usadas quando
    // não houver caminho real disponível.
    const VIRTUAL_COST = 20;

    // Bridge 1 — nó-a-nó: liga dois nós se estão a menos de NODE_LINK_M.
    // Captura junções "soltas" entre fragmentos do OSM.
    const NODE_LINK_M = 50;
    const nodeIds = Object.keys(nodes);
    let virtualEdges = 0;
    for (let i = 0; i < nodeIds.length; i++) {{
        for (let j = i + 1; j < nodeIds.length; j++) {{
            const ca = nodes[nodeIds[i]], cb = nodes[nodeIds[j]];
            const d = _hav(ca[1], ca[0], cb[1], cb[0]);
            if (d > 0 && d < NODE_LINK_M) {{
                const exists = adj[nodeIds[i]].some(([id]) => id === nodeIds[j]);
                if (!exists) {{
                    // peso × VIRTUAL_COST → A* só usa em último caso
                    adj[nodeIds[i]].push([nodeIds[j], d * VIRTUAL_COST]);
                    adj[nodeIds[j]].push([nodeIds[i], d * VIRTUAL_COST]);
                    virtualEdges++;
                }}
            }}
        }}
    }}

    // Bridge 2 — nó-a-segmento: pra cada nó, projeta perpendicularmente
    // sobre todos os segmentos. Se a perpendicular cai a < PROJ_LINK_M, injeta
    // ponto virtual no segmento e cria aresta. Resolve atalhos no MEIO de ruas.
    const PROJ_LINK_M = 25;
    const edgesList = [];
    const seenEdges = new Set();
    for (const idA in adj) {{
        for (const [idB] of adj[idA]) {{
            const k = idA < idB ? idA + '|' + idB : idB + '|' + idA;
            if (seenEdges.has(k)) continue;
            seenEdges.add(k);
            edgesList.push([idA, idB]);
        }}
    }}
    let projEdges = 0;
    for (const nid of nodeIds) {{
        const n = nodes[nid];  // [lon, lat]
        let melhor = {{ distM: Infinity, edge: null, point: null, t: 0 }};
        for (const [idA, idB] of edgesList) {{
            if (idA === nid || idB === nid) continue;
            const a = nodes[idA], b = nodes[idB];
            const ax = a[0], ay = a[1], bx = b[0], by = b[1];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx*dx + dy*dy;
            if (len2 === 0) continue;
            let t = ((n[0] - ax) * dx + (n[1] - ay) * dy) / len2;
            // Só perpendiculares "internas" ao segmento (não em extensões)
            if (t < 0.1 || t > 0.9) continue;
            const cx = ax + t * dx, cy = ay + t * dy;
            const distM = _hav(n[1], n[0], cy, cx);
            if (distM < melhor.distM) {{
                melhor = {{ distM, edge: [idA, idB], point: [cx, cy], t }};
            }}
        }}
        if (melhor.edge && melhor.distM < PROJ_LINK_M) {{
            // Injeta nó virtual no ponto perpendicular e cria aresta nid → virt
            const [aId, bId] = melhor.edge;
            const virtId = '__pinj_' + Object.keys(nodes).length;
            nodes[virtId] = melhor.point;
            adj[virtId] = [];
            const dA = _hav(melhor.point[1], melhor.point[0],
                            nodes[aId][1], nodes[aId][0]);
            const dB = _hav(melhor.point[1], melhor.point[0],
                            nodes[bId][1], nodes[bId][0]);
            // A-virt-B são subdivisões de um segmento REAL do OSM → peso normal
            adj[virtId].push([aId, dA]); adj[aId].push([virtId, dA]);
            adj[virtId].push([bId, dB]); adj[bId].push([virtId, dB]);
            // A aresta nid → virt é VIRTUAL (atravessa não-rua) → penalizada
            adj[virtId].push([nid, melhor.distM * VIRTUAL_COST]);
            adj[nid].push([virtId, melhor.distM * VIRTUAL_COST]);
            projEdges++;
        }}
    }}
    console.log('IFROTA:DBG: rede viária — ' + Object.keys(nodes).length +
                ' nós, ' + kept + '/' + total + ' segmentos no campus, ' +
                virtualEdges + ' bridges nó-a-nó, ' +
                projEdges + ' projeções perpendiculares');
    return {{ nodes, adj }};
}}

function _rotaPorPoligono(startLat, startLon, destLat, destLon) {{
    // Sem polígono — linha reta
    if (!_campusPoly || _campusPoly.length < 3) {{
        return [[startLat, startLon], [destLat, destLon]];
    }}
    // Se ambos os pontos estão dentro do campus, usa linha reta direta
    // (assume polígono majoritariamente convexo entre os dois pontos)
    if (_ptInCampus(startLat, startLon) && _ptInCampus(destLat, destLon)) {{
        return [[startLat, startLon], [destLat, destLon]];
    }}
    // Caso contrário: rota pelo perímetro (entrada/saída do campus)
    const ring = _campusPoly;
    let iA = 0, iB = 0, dA = Infinity, dB = Infinity;
    for (let i = 0; i < ring.length; i++) {{
        const ds = _hav(startLat, startLon, ring[i][0], ring[i][1]);
        const de = _hav(destLat, destLon, ring[i][0], ring[i][1]);
        if (ds < dA) {{ dA = ds; iA = i; }}
        if (de < dB) {{ dB = de; iB = i; }}
    }}
    const n = ring.length;
    const fwd = (iB - iA + n) % n;
    const bwd = (iA - iB + n) % n;
    const route = [[startLat, startLon]];
    let i = iA;
    if (fwd <= bwd) {{
        while (true) {{ route.push(ring[i]); if (i === iB) break; i = (i + 1) % n; }}
    }} else {{
        while (true) {{ route.push(ring[i]); if (i === iB) break; i = (i - 1 + n) % n; }}
    }}
    route.push([destLat, destLon]);
    return route;
}}

// Cache da rede viária do campus — construída uma vez após tiles carregados
let _redeViariaCache = null;
function _construirEcachearRede() {{
    if (_redeViariaCache) return _redeViariaCache;
    const rede = _construirRedeViaria();
    if (rede && Object.keys(rede.nodes).length > 5) {{
        _redeViariaCache = rede;
    }}
    return rede;
}}

// Pré-carrega a rede assim que o mapa fica idle no startup (todos os tiles
// do bbox inicial — que cobre o campus — devem estar disponíveis nesse ponto)
map.once('idle', () => {{
    setTimeout(() => {{
        const rede = _construirEcachearRede();
        if (rede) {{
            console.log('IFROTA:DBG: rede viária PRÉ-CARREGADA — ' +
                Object.keys(rede.nodes).length + ' nós');
        }}
    }}, 800);
}});

// Clona a rede pra poder injetar nós virtuais sem poluir o cache
function _cloneRede(rede) {{
    const nodes = {{}};
    const adj   = {{}};
    for (const id in rede.nodes) nodes[id] = rede.nodes[id];
    for (const id in rede.adj) adj[id] = rede.adj[id].slice();
    return {{ nodes, adj }};
}}

// Retorna os top-K segmentos mais próximos do ponto, cada um com a projeção
// perpendicular calculada (ponto, t, edge IDs, distância em metros).
function _topKSegmentos(rede, lat, lon, maxDistM, k) {{
    const adj   = rede.adj;
    const nodes = rede.nodes;
    const candidatos = [];
    const visited = new Set();
    for (const idA in adj) {{
        for (const [idB] of adj[idA]) {{
            const key = idA < idB ? idA + '|' + idB : idB + '|' + idA;
            if (visited.has(key)) continue;
            visited.add(key);
            const a = nodes[idA], b = nodes[idB];
            const ax = a[0], ay = a[1], bx = b[0], by = b[1];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx*dx + dy*dy;
            let t = 0;
            if (len2 > 0) {{
                t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
                t = Math.max(0, Math.min(1, t));
            }}
            const cx = ax + t * dx, cy = ay + t * dy;
            const distM = _hav(lat, lon, cy, cx);
            if (distM <= maxDistM) {{
                candidatos.push({{ distM, edge: [idA, idB], point: [cx, cy], t }});
            }}
        }}
    }}
    candidatos.sort((a, b) => a.distM - b.distM);
    return candidatos.slice(0, k);
}}

// Injeta um candidato (resultado de _topKSegmentos) na rede e retorna o ID do nó virtual.
function _injetarCandidato(rede, cand) {{
    const [aId, bId] = cand.edge;
    if (cand.t < 0.02) return aId;
    if (cand.t > 0.98) return bId;
    const virtId = '__inj_' + Object.keys(rede.nodes).length;
    rede.nodes[virtId] = cand.point;
    rede.adj[virtId] = [];
    const dA = _hav(cand.point[1], cand.point[0],
                    rede.nodes[aId][1], rede.nodes[aId][0]);
    const dB = _hav(cand.point[1], cand.point[0],
                    rede.nodes[bId][1], rede.nodes[bId][0]);
    rede.adj[virtId].push([aId, dA]);
    rede.adj[virtId].push([bId, dB]);
    rede.adj[aId].push([virtId, dA]);
    rede.adj[bId].push([virtId, dB]);
    return virtId;
}}

// Injeta nó virtual no ponto perpendicular mais próximo do segmento mais próximo
// (em vez de snapar ao nó mais próximo). Resolve o bug de "ir pro início da rua e
// voltar" quando o usuário está perpendicularmente próximo do meio do segmento.
function _injetarNoEmSegmento(rede, lat, lon, maxDistM) {{
    const adj   = rede.adj;
    const nodes = rede.nodes;
    let best = {{ distM: Infinity, edge: null, point: null, t: 0 }};
    const visited = new Set();
    for (const idA in adj) {{
        for (const [idB] of adj[idA]) {{
            const key = idA < idB ? idA + '|' + idB : idB + '|' + idA;
            if (visited.has(key)) continue;
            visited.add(key);
            const a = nodes[idA], b = nodes[idB];  // [lon, lat]
            const ax = a[0], ay = a[1], bx = b[0], by = b[1];
            const dx = bx - ax, dy = by - ay;
            const len2 = dx*dx + dy*dy;
            let t = 0;
            if (len2 > 0) {{
                t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
                t = Math.max(0, Math.min(1, t));
            }}
            const cx = ax + t * dx, cy = ay + t * dy;
            const distM = _hav(lat, lon, cy, cx);
            if (distM < best.distM) {{
                best = {{ distM, edge: [idA, idB], point: [cx, cy], t }};
            }}
        }}
    }}
    if (!best.edge || best.distM > (maxDistM || 200)) return null;
    const [aId, bId] = best.edge;
    // Se o ponto está praticamente em cima de um endpoint, reusa esse nó
    if (best.t < 0.02) return aId;
    if (best.t > 0.98) return bId;
    // Injeta novo nó virtual no ponto perpendicular
    const virtId = '__inj_' + Object.keys(nodes).length;
    nodes[virtId] = best.point;
    adj[virtId] = [];
    const distA = _hav(best.point[1], best.point[0], nodes[aId][1], nodes[aId][0]);
    const distB = _hav(best.point[1], best.point[0], nodes[bId][1], nodes[bId][0]);
    adj[virtId].push([aId, distA]);
    adj[virtId].push([bId, distB]);
    adj[aId].push([virtId, distA]);
    adj[bId].push([virtId, distB]);
    return virtId;
}}

window.calcularRotaMapa = function(startLat, startLon, destLat, destLon, destNome) {{
    const SNAP_MAX_M = 120;
    const redeCache = _construirEcachearRede();
    let routeCoords = null;
    let virtualMap = null;
    let modo = '';
    if (redeCache && Object.keys(redeCache.nodes).length > 0) {{
        // Tenta TOP-K segmentos pra cada ponto e escolhe a combinação que dá
        // o menor caminho real total. Resolve o caso onde o nó mais próximo
        // está numa rua que dá uma volta longa.
        const TOP_K = 5;
        const startCand = _topKSegmentos(redeCache, startLat, startLon, SNAP_MAX_M, TOP_K);
        const endCand   = _topKSegmentos(redeCache, destLat,  destLon,  SNAP_MAX_M, TOP_K);
        console.log('IFROTA:DBG: top-K candidatos — start=' + startCand.length +
                    ', dest=' + endCand.length);
        let bestPath = null, bestCost = Infinity, bestRede = null;
        for (const sCand of startCand) {{
            for (const eCand of endCand) {{
                const rede = _cloneRede(redeCache);
                const sId = _injetarCandidato(rede, sCand);
                const eId = _injetarCandidato(rede, eCand);
                if (!sId || !eId) continue;
                const path = _astarJS(rede.adj, sId, eId, rede.nodes);
                if (!path || path.length < 2) continue;
                // Computa custo REAL (geographic) — não o weighted do A*
                let custo = 0;
                custo += sCand.distM; custo += eCand.distM;
                for (let i = 1; i < path.length; i++) {{
                    const a = rede.nodes[path[i-1]], b = rede.nodes[path[i]];
                    custo += _hav(a[1], a[0], b[1], b[0]);
                }}
                if (custo < bestCost) {{
                    bestCost = custo;
                    bestPath = path;
                    bestRede = rede;
                }}
            }}
        }}
        if (bestPath && bestRede) {{
            const virtNodes = bestPath.filter(id => id.startsWith('__')).length;
            console.log('IFROTA:DBG: A* — path=' + bestPath.length + ' nós (' +
                        virtNodes + ' virtuais), custo=' + Math.round(bestCost) + 'm');
            routeCoords = [[startLat, startLon]];
            for (const id of bestPath) {{
                const c = bestRede.nodes[id];
                routeCoords.push([c[1], c[0]]);
            }}
            routeCoords.push([destLat, destLon]);
            modo = 'mapa';
            // virtualMap[i] = true se o segmento routeCoords[i]→[i+1] é VIRTUAL.
            // Detectamos pelo peso na adj: virtual tem peso = haversine × VIRTUAL_COST.
            virtualMap = new Array(routeCoords.length - 1).fill(false);
            virtualMap[0] = true;                          // user → 1º nó (off-road)
            virtualMap[virtualMap.length - 1] = true;      // último nó → dest (off-road)
            for (let i = 0; i < bestPath.length - 1; i++) {{
                const a = bestRede.nodes[bestPath[i]];
                const b = bestRede.nodes[bestPath[i+1]];
                const geo = _hav(a[1], a[0], b[1], b[0]);
                const edge = bestRede.adj[bestPath[i]].find(([id]) => id === bestPath[i+1]);
                const w = edge ? edge[1] : geo;
                virtualMap[i + 1] = (w > geo * 2);  // multiplicador virtual aplicado
            }}
        }}
    }}
    if (!routeCoords) {{
        // Sem caminho na rede viária — usa linha reta direta como último recurso
        // (NÃO usa o polígono do campus — ele é só delimitador visual, não caminho)
        routeCoords = [[startLat, startLon], [destLat, destLon]];
        modo = 'linha-reta';
    }}
    // Calcula distância total
    let dist = 0;
    for (let i = 1; i < routeCoords.length; i++) {{
        dist += _hav(routeCoords[i-1][0], routeCoords[i-1][1],
                     routeCoords[i][0],   routeCoords[i][1]);
    }}
    const eta = Math.max(1, Math.round(dist / 1.4 / 60));
    window.desenharRota(routeCoords, destLat, destLon, virtualMap);
    window.isolarDestino(destNome);
    // Envia info pro Python atualizar o banner
    console.log('IFROTA:ROTA:' + JSON.stringify({{
        dist: Math.round(dist), eta: eta, nome: destNome, modo: modo
    }}));
}};

// Foca o waypoint preservando pitch e bearing (vista 3D mantida).
window.focarMarcador = function(lat, lon, paddingBottom) {{
    const padding = {{ top: 0, right: 0, bottom: paddingBottom || 0, left: 0 }};
    map.easeTo({{
        center: [lon, lat],
        padding: padding,
        duration: 600,
        essential: true
    }});
}};

// Estado de seleção de marcador (para destacar o waypoint atualmente focado)
let _selectedMarker = null;
window.selecionarMarcador = function(nome) {{
    _allMarkers.forEach(m => {{
        if (m._nome === nome) {{
            m._el.classList.add('selected');
            _selectedMarker = m;
        }} else {{
            m._el.classList.remove('selected');
        }}
    }});
}};
window.limparSelecao = function() {{
    _allMarkers.forEach(m => m._el.classList.remove('selected'));
    _selectedMarker = null;
}};
let _currentCat = 'Tudo';
let _isolatedDest = null;

function _applyFilter() {{
    _allMarkers.forEach(m => {{
        let show;
        if (_isolatedDest !== null) {{
            show = (m._nome === _isolatedDest);
        }} else {{
            show = (_currentCat === 'Tudo') || (m._cat === _currentCat);
        }}
        m._el.style.display = show ? '' : 'none';
    }});
}}

window.filtrarCat = function(cat) {{
    _currentCat = cat;
    _isolatedDest = null;  // troca de filtro cancela o isolamento
    _applyFilter();
}};

window.isolarDestino = function(nome) {{
    _isolatedDest = nome;
    _applyFilter();
}};

window.restaurarMarcadores = function() {{
    if (_isolatedDest !== null) {{
        _isolatedDest = null;
        _applyFilter();
    }}
}};

// Qualquer interação do usuário com o mapa cancela o isolamento — exceto durante animação da rota
function _onMapInteract() {{
    if (_animatingRoute) return;
    window.restaurarMarcadores();
}}
map.on('dragstart',  _onMapInteract);
map.on('wheel',      _onMapInteract);
map.on('rotatestart',_onMapInteract);
map.on('pitchstart', _onMapInteract);
window.resetarMapa = function() {{
    map.flyTo({{ center: CENTRO, zoom: ZOOM_PADRAO, pitch: 45, bearing: -17, duration: 1500 }});
}};
function _reAddRouteLayers() {{
    if (!_currentRoute) return;
    try {{
        // Reusa desenharRota — gera todas as layers (casing + real + virtual)
        // mas sem reanimar (não passa destLat/destLon)
        const savedDest = _currentDest;
        const coords = _currentRoute;
        const vmap = _currentVirtualMap;
        window.desenharRota(coords, undefined, undefined, vmap);
        _currentRoute = coords;
        _currentDest = savedDest;
        _currentVirtualMap = vmap;
    }} catch (e) {{
        console.log('Falha ao re-adicionar layers da rota:', e);
        setTimeout(_reAddRouteLayers, 200);
    }}
}}

window.aplicarTema = function(escuro) {{
    if (escuro === _currentDark) return;
    _currentDark = escuro;
    document.body.classList.toggle('dark', escuro);
    _animatingRoute = false;  // troca de tema cancela qualquer lock de animação pendente

    let rerendered = false;
    function rerender() {{
        if (rerendered) return;
        rerendered = true;
        _setupCampusMask();
        _setup3DBuildings();
        _reAddRouteLayers();
        if (_editMode) _renderEditor();
    }}
    // Registra o listener ANTES do setStyle pra não perder o evento (especialmente
    // quando o estilo é um objeto inline, que carrega praticamente síncrono)
    map.once('style.load', () => setTimeout(rerender, 100));
    map.setStyle(escuro ? _styleDark : _styleLight);
    // Fallback: dispara rerender em 600ms mesmo se 'style.load' não disparou
    setTimeout(rerender, 600);
}};

// ── Marcador do usuário ───────────────────────────────────────────────────────
let _userMarker = null;
// ── TRACKING DURANTE ROTA ATIVA ────────────────────────────────────────────
let _offRouteCount = 0;
const OFF_ROUTE_M = 25;     // distância em metros pra considerar "fora da rota"
const OFF_ROUTE_TRIES = 3;  // leituras consecutivas off-route pra disparar reroute

function _distPontoPolyline(lat, lon, polyline) {{
    if (!polyline || polyline.length < 2) return {{dist: Infinity, seg: 0, t: 0}};
    let melhor = {{dist: Infinity, seg: 0, t: 0}};
    for (let i = 0; i < polyline.length - 1; i++) {{
        const a = polyline[i], b = polyline[i+1];
        // a, b são [lat, lon]
        const ax = a[1], ay = a[0], bx = b[1], by = b[0];
        const dx = bx - ax, dy = by - ay;
        const len2 = dx*dx + dy*dy;
        let t = 0;
        if (len2 > 0) {{
            t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
            t = Math.max(0, Math.min(1, t));
        }}
        const cy = ay + t * dy;
        const cx = ax + t * dx;
        const d = _hav(lat, lon, cy, cx);
        if (d < melhor.dist) melhor = {{dist: d, seg: i, t}};
    }}
    return melhor;
}}

function _distRestantePolyline(lat, lon, polyline) {{
    const proj = _distPontoPolyline(lat, lon, polyline);
    if (!polyline || polyline.length < 2 || proj.dist === Infinity) return 0;
    // Distância do ponto projetado até o final do segmento atual
    const a = polyline[proj.seg], b = polyline[proj.seg + 1];
    const px = a[1] + proj.t * (b[1] - a[1]);
    const py = a[0] + proj.t * (b[0] - a[0]);
    let resto = _hav(py, px, b[0], b[1]);
    // Soma os segmentos restantes
    for (let i = proj.seg + 1; i < polyline.length - 1; i++) {{
        resto += _hav(polyline[i][0], polyline[i][1],
                      polyline[i+1][0], polyline[i+1][1]);
    }}
    return resto;
}}

// Chamada toda vez que a posição do usuário atualiza
window.atualizarTracking = function(lat, lon) {{
    if (!_currentRoute || _currentRoute.length < 2) return;
    const proj = _distPontoPolyline(lat, lon, _currentRoute);
    const restante = _distRestantePolyline(lat, lon, _currentRoute);
    const eta = Math.max(1, Math.round(restante / 1.4 / 60));
    if (proj.dist > OFF_ROUTE_M) {{
        _offRouteCount++;
        if (_offRouteCount >= OFF_ROUTE_TRIES) {{
            console.log('IFROTA:OFFROUTE:' + lat + ',' + lon);
            _offRouteCount = 0;
        }}
    }} else {{
        _offRouteCount = 0;
    }}
    // Envia ETA atualizado pro banner
    console.log('IFROTA:ETA:' + JSON.stringify({{
        dist: Math.round(restante), eta: eta, off: Math.round(proj.dist)
    }}));
}};

window.mostrarUsuario = function(lat, lon, _accuracy) {{
    if (!_userMarker) {{
        const el = document.createElement('div');
        el.className = 'user-dot';
        _userMarker = new maplibregl.Marker({{ element: el, anchor: 'center' }})
            .setLngLat([lon, lat]).addTo(map);
    }} else {{
        _userMarker.setLngLat([lon, lat]);
    }}
    map.flyTo({{ center: [lon, lat], zoom: 19, duration: 1200 }});
}};

// ── Modo manual de definir posição ────────────────────────────────────────────
let _manualMode = false;
let _manualHandler = null;
window.ativarModoManual = function(ativo) {{
    if (ativo && !_manualMode) {{
        _manualMode = true;
        map.getCanvas().style.cursor = 'crosshair';
        _manualHandler = (e) => console.log('IFROTA:POS:' + e.lngLat.lat + ',' + e.lngLat.lng);
        map.on('click', _manualHandler);
    }} else if (!ativo && _manualMode) {{
        _manualMode = false;
        map.getCanvas().style.cursor = '';
        if (_manualHandler) map.off('click', _manualHandler);
        _manualHandler = null;
    }}
}};

// ── Rota ─────────────────────────────────────────────────────────────────────
let _currentDest = null;
let _animatingRoute = false;  // bloqueia restauração via interação no mapa durante animação
// Suaviza um polyline (LineString aberta) aplicando Bezier quadrático em cada
// vértice interior — mantém os endpoints inalterados.
function _suavizarPolyline(path, smoothness) {{
    if (!path || path.length < 3) return path;
    smoothness = Math.max(0, Math.min(0.45, smoothness || 0.30));
    const steps = 8;
    const out = [path[0]];  // primeiro ponto fica fixo
    for (let i = 1; i < path.length - 1; i++) {{
        const prev = path[i - 1];
        const curr = path[i];
        const next = path[i + 1];
        const vpx = prev[0] - curr[0], vpy = prev[1] - curr[1];
        const vnx = next[0] - curr[0], vny = next[1] - curr[1];
        const A = [curr[0] + vpx * smoothness, curr[1] + vpy * smoothness];
        const B = [curr[0] + vnx * smoothness, curr[1] + vny * smoothness];
        out.push(A);
        for (let t = 1; t < steps; t++) {{
            const u = t / steps;
            const omu = 1 - u;
            const x = omu*omu*A[0] + 2*omu*u*curr[0] + u*u*B[0];
            const y = omu*omu*A[1] + 2*omu*u*curr[1] + u*u*B[1];
            out.push([x, y]);
        }}
        out.push(B);
    }}
    out.push(path[path.length - 1]);  // último ponto fica fixo
    return out;
}}

let _currentVirtualMap = null;
window.desenharRota = function(coords, destLat, destLon, virtualMap) {{
    _currentRoute = coords;
    _currentVirtualMap = virtualMap || null;
    if (!map.isStyleLoaded()) {{
        setTimeout(() => window.desenharRota(coords, destLat, destLon, virtualMap), 150);
        return;
    }}
    // Constrói FeatureCollection — features separadas por flag virtual
    if (!virtualMap || virtualMap.length === 0) {{
        virtualMap = new Array(Math.max(0, coords.length - 1)).fill(false);
    }}
    const features = [];
    if (coords.length >= 2) {{
        let segStart = 0;
        let segIsVirt = virtualMap[0];
        for (let i = 1; i < virtualMap.length; i++) {{
            if (virtualMap[i] !== segIsVirt) {{
                const slice = coords.slice(segStart, i + 1).map(c => [c[1], c[0]]);
                features.push({{
                    type: 'Feature',
                    properties: {{ virtual: segIsVirt }},
                    geometry: {{ type: 'LineString', coordinates: slice }}
                }});
                segStart = i;
                segIsVirt = virtualMap[i];
            }}
        }}
        const slice = coords.slice(segStart).map(c => [c[1], c[0]]);
        features.push({{
            type: 'Feature',
            properties: {{ virtual: segIsVirt }},
            geometry: {{ type: 'LineString', coordinates: slice }}
        }});
    }}
    const data = {{ type: 'FeatureCollection', features: features }};
    ['route-casing','route-line','route-line-real','route-line-virtual'].forEach(id => {{
        if (map.getLayer(id)) map.removeLayer(id);
    }});
    if (map.getSource('route')) map.removeSource('route');
    map.addSource('route', {{ type: 'geojson', data: data }});
    map.addLayer({{
        id: 'route-casing', source: 'route', type: 'line',
        layout: {{ 'line-cap':'round', 'line-join':'round' }},
        paint: {{ 'line-color': '#ffffff', 'line-width': 10, 'line-opacity': 0.9 }}
    }});
    // Trechos REAIS (rua OSM verdadeira) — sólido preto
    map.addLayer({{
        id: 'route-line-real', source: 'route', type: 'line',
        filter: ['!=', ['get', 'virtual'], true],
        layout: {{ 'line-cap':'round', 'line-join':'round' }},
        paint: {{ 'line-color': '#0f172a', 'line-width': 5, 'line-opacity': 1 }}
    }});
    // Trechos VIRTUAIS (atalhos inventados) — tracejado laranja, alto contraste
    map.addLayer({{
        id: 'route-line-virtual', source: 'route', type: 'line',
        filter: ['==', ['get', 'virtual'], true],
        layout: {{ 'line-cap':'butt', 'line-join':'round' }},
        paint: {{
            'line-color': '#ea580c',
            'line-width': 5,
            'line-opacity': 1,
            'line-dasharray': [1.8, 1.2]
        }}
    }});
    // Sem dest = só redesenha a linha (usado em troca de tema, sem reanimar)
    if (destLat === undefined || destLon === undefined) return;
    _currentDest = [destLat, destLon];
    _animatingRoute = true;  // bloqueia restauração de marcadores via interação
    // 1) Zoom focado no waypoint destino (não no último ponto da rota)
    map.flyTo({{ center: [destLon, destLat], zoom: 19, pitch: 45, duration: 1500, essential: true }});
    // 2) Após 2s, mostra a rota inteira
    setTimeout(() => {{
        const b = new maplibregl.LngLatBounds();
        lineCoords.forEach(c => b.extend(c));
        map.fitBounds(b, {{ padding: 60, maxZoom: 19, pitch: 45, duration: 1500, essential: true }});
        // 3) 1.5s após fitBounds terminar, libera interação pra restaurar marcadores
        setTimeout(() => {{ _animatingRoute = false; }}, 1500 + 1500);
    }}, 2000);
}};
window.limparRota = function() {{
    _currentRoute = null;
    _currentDest = null;
    _currentVirtualMap = null;
    _animatingRoute = false;
    ['route-casing','route-line','route-line-real','route-line-virtual'].forEach(id => {{
        if (map.getLayer(id)) map.removeLayer(id);
    }});
    if (map.getSource('route')) map.removeSource('route');
}};

// ── Editor de grafo ──────────────────────────────────────────────────────────
let _editMode = false;
let _editClickHandler = null;
let _selectedNode = null;
let _nodeMarkers = {{}};
window._lastGrafo = {{ nodes: {{}}, edges: [] }};

function _clearGrafoLayers() {{
    Object.values(_nodeMarkers).forEach(m => m.remove());
    _nodeMarkers = {{}};
    if (map.getLayer('grafo-edges'))  map.removeLayer('grafo-edges');
    if (map.getSource('grafo-edges')) map.removeSource('grafo-edges');
}}

function _renderEditor() {{
    _clearGrafoLayers();
    if (!_editMode) return;
    const g = window._lastGrafo;
    const features = (g.edges || []).map(([a, b]) => {{
        const ca = g.nodes[a], cb = g.nodes[b];
        if (!ca || !cb) return null;
        return {{ type: 'Feature', geometry: {{ type: 'LineString', coordinates: [[ca[1], ca[0]], [cb[1], cb[0]]] }} }};
    }}).filter(Boolean);
    map.addSource('grafo-edges', {{ type: 'geojson', data: {{ type: 'FeatureCollection', features }} }});
    map.addLayer({{
        id: 'grafo-edges', source: 'grafo-edges', type: 'line',
        paint: {{ 'line-color': '#ff9800', 'line-width': 3, 'line-opacity': 0.9 }}
    }});
    Object.entries(g.nodes || {{}}).forEach(([nid, latlon]) => {{
        const el = document.createElement('div');
        el.className = 'node-dot' + (nid === _selectedNode ? ' sel' : '');
        el.addEventListener('click', (ev) => {{
            ev.stopPropagation();
            if (ev.shiftKey) {{
                console.log('IFROTA:GRAFO:DEL_NODE:' + nid);
            }} else if (_selectedNode && _selectedNode !== nid) {{
                console.log('IFROTA:GRAFO:EDGE:' + _selectedNode + ',' + nid);
                _selectedNode = null;
            }} else {{
                _selectedNode = nid;
                _renderEditor();
            }}
        }});
        const m = new maplibregl.Marker({{ element: el, anchor: 'center' }})
            .setLngLat([latlon[1], latlon[0]]).addTo(map);
        _nodeMarkers[nid] = m;
    }});
}}

window.renderizarGrafo = function(grafo) {{
    window._lastGrafo = grafo;
    _renderEditor();
}};
window.ativarEditor = function(ativo) {{
    _editMode = ativo;
    _selectedNode = null;
    if (ativo) {{
        map.getCanvas().style.cursor = 'crosshair';
        _editClickHandler = (e) => console.log('IFROTA:GRAFO:NODE:' + e.lngLat.lat + ',' + e.lngLat.lng);
        map.on('click', _editClickHandler);
    }} else {{
        map.getCanvas().style.cursor = '';
        if (_editClickHandler) map.off('click', _editClickHandler);
        _editClickHandler = null;
    }}
    _renderEditor();
}};

// ── Inicialização ─────────────────────────────────────────────────────────────
map.on('load', () => {{
    _addWaypointMarkers();
    _setupCampusMask();
    _setup3DBuildings();
}});
</script>
</body></html>
"""

    os.makedirs(CACHE_DIR, exist_ok=True)
    out_path = os.path.join(CACHE_DIR, "ifrota_map.html")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    return out_path

# ─── PAGE: intercepta cliques nos marcadores via console.log ──────────────────
class IFrotaPage(QWebEnginePage):
    marker_clicked = Signal(str)
    map_clicked    = Signal(float, float)
    grafo_node_add = Signal(float, float)
    grafo_edge_add = Signal(str, str)
    grafo_node_del = Signal(str)
    rota_pronta    = Signal(dict)
    off_route      = Signal(float, float)  # lat, lon do ponto atual
    eta_update     = Signal(dict)          # {dist, eta, off}

    def __init__(self, parent=None):
        super().__init__(parent)
        self.featurePermissionRequested.connect(self._on_feature_permission)

    def _on_feature_permission(self, origin, feature):
        self.setFeaturePermission(
            origin, feature,
            QWebEnginePage.PermissionPolicy.PermissionGrantedByUser,
        )

    def javaScriptConsoleMessage(self, _level, message, _line, _source):
        # Usa len() do próprio prefixo pra evitar desalinhamento se o prefixo mudar
        if message.startswith(p := "IFROTA:CLICK:"):
            self.marker_clicked.emit(message[len(p):])
        elif message.startswith(p := "IFROTA:POS:"):
            try:
                lat_s, lon_s = message[len(p):].split(",", 1)
                self.map_clicked.emit(float(lat_s), float(lon_s))
            except ValueError:
                pass
        elif message.startswith(p := "IFROTA:GRAFO:NODE:"):
            try:
                lat_s, lon_s = message[len(p):].split(",", 1)
                self.grafo_node_add.emit(float(lat_s), float(lon_s))
            except ValueError:
                pass
        elif message.startswith(p := "IFROTA:GRAFO:EDGE:"):
            try:
                a, b = message[len(p):].split(",", 1)
                self.grafo_edge_add.emit(a, b)
            except ValueError:
                pass
        elif message.startswith(p := "IFROTA:GRAFO:DEL_NODE:"):
            self.grafo_node_del.emit(message[len(p):])
        elif message.startswith(p := "IFROTA:ROTA:"):
            try:
                self.rota_pronta.emit(json.loads(message[len(p):]))
            except (ValueError, json.JSONDecodeError):
                pass
        elif message.startswith(p := "IFROTA:OFFROUTE:"):
            try:
                lat_s, lon_s = message[len(p):].split(",", 1)
                self.off_route.emit(float(lat_s), float(lon_s))
            except ValueError:
                pass
        elif message.startswith(p := "IFROTA:ETA:"):
            try:
                self.eta_update.emit(json.loads(message[len(p):]))
            except (ValueError, json.JSONDecodeError):
                pass
        elif message.startswith(p := "IFROTA:DBG:"):
            print(f"[DBG] {message[len(p):]}", flush=True)
        else:
            print(f"[JS] {message}", flush=True)

# ─── DIM OVERLAY (fundo semitransparente do menu lateral) ─────────────────────
class DimOverlay(QWidget):
    clicked = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self.hide()

    def paintEvent(self, _event):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(0, 0, 0, 145))

    def mousePressEvent(self, _event):
        self.clicked.emit()


# ─── VISUALIZADOR FULLSCREEN DE FOTO ──────────────────────────────────────────
class PhotoFullscreen(QWidget):
    """Overlay fullscreen pra visualização ampliada de fotos da galeria."""
    closed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
        self._photos: list = []
        self._idx = 0

        # Foto centralizada
        self._img = QLabel(self)
        self._img.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._img.setStyleSheet("background: transparent;")

        # Botão fechar (canto superior direito)
        self._btn_close = QPushButton("✕", self)
        self._btn_close.setFixedSize(40, 40)
        self._btn_close.setCursor(Qt.CursorShape.PointingHandCursor)
        self._btn_close.setStyleSheet(
            "QPushButton { background-color: rgba(255,255,255,0.18); color: white;"
            " border: none; border-radius: 20px; font-size: 18px; font-weight: 700; }"
            "QPushButton:hover { background-color: rgba(255,255,255,0.32); }"
        )
        self._btn_close.clicked.connect(self._do_close)

        # Setas laterais de navegação
        for name, txt in (("_btn_prev", "‹"), ("_btn_next", "›")):
            btn = QPushButton(txt, self)
            btn.setFixedSize(48, 48)
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setStyleSheet(
                "QPushButton { background-color: rgba(255,255,255,0.18); color: white;"
                " border: none; border-radius: 24px; font-size: 28px; font-weight: 700; }"
                "QPushButton:hover { background-color: rgba(255,255,255,0.32); }"
            )
            setattr(self, name, btn)
        self._btn_prev.clicked.connect(lambda: self._navigate(-1))
        self._btn_next.clicked.connect(lambda: self._navigate(1))

        # Contador "2 / 5"
        self._counter = QLabel(self)
        self._counter.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._counter.setStyleSheet(
            "color: white; font-size: 13px; font-weight: 600;"
            " background-color: rgba(0,0,0,0.4); padding: 6px 14px; border-radius: 14px;"
        )

        self.hide()

    def paintEvent(self, _event):
        p = QPainter(self)
        p.fillRect(self.rect(), QColor(0, 0, 0, 230))

    def mousePressEvent(self, ev):
        # Clique no backdrop (não nos botões/imagem) fecha
        child = self.childAt(ev.position().toPoint())
        if child is None or child is self:
            self._do_close()

    def keyPressEvent(self, ev):
        if ev.key() == Qt.Key.Key_Escape:
            self._do_close()
        elif ev.key() in (Qt.Key.Key_Left,):
            self._navigate(-1)
        elif ev.key() in (Qt.Key.Key_Right,):
            self._navigate(1)
        else:
            super().keyPressEvent(ev)

    def show_photos(self, photos: list, idx: int = 0):
        self._photos = [p for p in (photos or []) if p]
        if not self._photos:
            return
        self._idx = idx % len(self._photos) if self._photos else 0
        parent = self.parentWidget()
        if parent:
            self.setGeometry(0, 0, parent.width(), parent.height())
        self._render()
        self.raise_()
        self.show()
        self.setFocus(Qt.FocusReason.OtherFocusReason)

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        w, h = self.width(), self.height()
        # Foto ocupa o centro com margens
        self._img.setGeometry(40, 40, w - 80, h - 100)
        # Botão X canto superior direito
        self._btn_close.move(w - 60, 20)
        # Setas centralizadas verticalmente
        self._btn_prev.move(16, (h - 48) // 2)
        self._btn_next.move(w - 64, (h - 48) // 2)
        # Contador embaixo
        self._counter.adjustSize()
        self._counter.move((w - self._counter.width()) // 2, h - 50)
        self._render()

    def _navigate(self, delta: int):
        if not self._photos:
            return
        self._idx = (self._idx + delta) % len(self._photos)
        self._render()

    def _render(self):
        if not self._photos:
            return
        path = self._photos[self._idx]
        if path and os.path.exists(path):
            pm = QPixmap(path).scaled(
                max(1, self._img.width()), max(1, self._img.height()),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            self._img.setPixmap(pm)
            self._img.setText("")
        else:
            self._img.setPixmap(QPixmap())
            self._img.setText("📷")
            self._img.setStyleSheet("color: white; font-size: 96px; background: transparent;")

        n = len(self._photos)
        self._counter.setText(f"{self._idx + 1} / {n}")
        self._counter.adjustSize()
        self._counter.move((self.width() - self._counter.width()) // 2, self.height() - 50)
        # Setas escondem se só tem 1 foto
        self._btn_prev.setVisible(n > 1)
        self._btn_next.setVisible(n > 1)

    def _do_close(self):
        self.hide()
        self.closed.emit()


# ─── HANDLE DRAGGABLE DO CARD ─────────────────────────────────────────────────
class CardHandleBar(QWidget):
    """Barra superior do card (com a "alça") — arrasta pra cima/baixo para expandir/colapsar."""
    drag_started = Signal()
    drag_delta   = Signal(int)  # delta em pixels (positivo = arrastando pra cima)
    drag_ended   = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._press_y = None
        self.setCursor(Qt.CursorShape.SizeVerCursor)

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._press_y = event.globalPosition().toPoint().y()
            self.drag_started.emit()
            event.accept()  # impede propagação pra janela (que também arrasta)
            return
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._press_y is not None and (event.buttons() & Qt.MouseButton.LeftButton):
            current_y = event.globalPosition().toPoint().y()
            self.drag_delta.emit(self._press_y - current_y)
            event.accept()
            return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        if self._press_y is not None:
            self._press_y = None
            self.drag_ended.emit()
            event.accept()
            return
        super().mouseReleaseEvent(event)


# ─── BANNER DE ROTA ATIVA ────────────────────────────────────────────────────
class RouteBanner(QWidget):
    """Bottom sheet estilo Waze — handle bar no topo, fundo sólido card_bg,
    horário de chegada em destaque + linha secundária."""
    canceled = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("route_banner")
        # Garante que o background do QSS é desenhado (sem isso fica transparente)
        self.setAttribute(Qt.WidgetAttribute.WA_StyledBackground, True)

        # Sombra projetada pra cima (banner está no fundo da tela)
        sh = QGraphicsDropShadowEffect()
        sh.setBlurRadius(36); sh.setColor(QColor(0,0,0,90)); sh.setOffset(0, -6)
        self.setGraphicsEffect(sh)

        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # Handle bar no topo (igual ao bottom card de waypoint)
        hw = QWidget(self)
        hw.setObjectName("route_handle_wrap")
        hwl = QHBoxLayout(hw); hwl.setContentsMargins(0, 10, 0, 4)
        handle = QWidget(hw)
        handle.setObjectName("route_handle"); handle.setFixedSize(44, 5)
        handle.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        hwl.addWidget(handle, 0, Qt.AlignmentFlag.AlignCenter)
        outer.addWidget(hw)

        # Body — 3 colunas: [icon+nome] | [hora + resumo centralizado] | [close]
        body = QWidget(self)
        bl = QHBoxLayout(body); bl.setContentsMargins(14, 4, 12, 16); bl.setSpacing(12)

        # ── ESQUERDA: ícone do destino + nome (estilo waypoint card) ──
        left = QVBoxLayout(); left.setSpacing(4); left.setContentsMargins(0, 0, 0, 0)
        self._dest_icon_frame = QWidget(body)
        self._dest_icon_frame.setFixedSize(40, 40)
        ifl = QVBoxLayout(self._dest_icon_frame); ifl.setContentsMargins(0, 0, 0, 0)
        self._dest_icon_lbl = QLabel(self._dest_icon_frame)
        self._dest_icon_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        ifl.addWidget(self._dest_icon_lbl)
        self._dest_name = QLabel("", body)
        self._dest_name.setObjectName("route_dest_name")
        self._dest_name.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._dest_name.setWordWrap(False)
        self._dest_name.setMaximumWidth(90)
        left.addWidget(self._dest_icon_frame, 0, Qt.AlignmentFlag.AlignCenter)
        left.addWidget(self._dest_name, 0, Qt.AlignmentFlag.AlignCenter)
        bl.addLayout(left)

        # ── CENTRO: horário de chegada + tempo · distância (centralizado) ──
        center = QVBoxLayout(); center.setSpacing(2); center.setContentsMargins(0, 0, 0, 0)
        self._arrival = QLabel("--:--", body)
        self._arrival.setObjectName("route_arrival")
        self._arrival.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._summary = QLabel("", body)
        self._summary.setObjectName("route_summary")
        self._summary.setAlignment(Qt.AlignmentFlag.AlignCenter)
        center.addWidget(self._arrival)
        center.addWidget(self._summary)
        bl.addLayout(center, 1)  # stretch — ocupa o espaço central

        # ── DIREITA: botão fechar ──
        self._close_btn = QPushButton("", body)
        self._close_btn.setObjectName("route_banner_close")
        self._close_btn.setIconSize(QSize(14, 14))
        self._close_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._close_btn.setFixedSize(28, 28)
        self._close_btn.clicked.connect(self.canceled.emit)
        bl.addWidget(self._close_btn, 0, Qt.AlignmentFlag.AlignTop)

        outer.addWidget(body)
        self.hide()

    def show_route(self, local, dist_m: float, eta_min: int):
        """local: dict do destino (com nome/icone/cor) ou string apenas com nome."""
        if isinstance(local, dict):
            nome    = local.get("nome", "destino")
            icone   = local.get("icone", "")
            hex_cor = COR_HEX.get(local.get("cor", "green"), "#5cb85c")
            mdi     = MDI_ICONE.get(icone, "mdi6.map-marker")
            # Pinta o frame do ícone com a cor da categoria
            self._dest_icon_frame.setStyleSheet(
                f"background-color:{hex_cor}; border-radius:12px;"
            )
            self._dest_icon_lbl.setPixmap(qta.icon(mdi, color="white").pixmap(22, 22))
        else:
            nome = str(local)
        self._dest_name.setText(nome)

        from datetime import datetime, timedelta
        arrival = datetime.now() + timedelta(minutes=eta_min)
        self._arrival.setText(arrival.strftime("%H:%M"))
        if dist_m >= 1000:
            dist_str = f"{dist_m/1000:.1f} km"
        else:
            dist_str = f"{dist_m:.0f} m"
        self._summary.setText(f"{eta_min} min · {dist_str}")
        # Bottom sheet — ocupa toda a largura, encostado no fundo
        parent = self.parentWidget()
        if parent:
            w = parent.width()
            h = self.sizeHint().height()
            self.setGeometry(0, parent.height() - h, w, h)
        self.raise_()
        self.show()


# ─── TOAST — notificação flutuante ───────────────────────────────────────────
class Toast(QLabel):
    """Notificação flutuante temporária no centro/topo da janela."""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setObjectName("toast")
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        self.hide()
        self._opacity = QGraphicsOpacityEffect(self)
        self._opacity.setOpacity(0.0)
        self.setGraphicsEffect(self._opacity)
        self._anim = QPropertyAnimation(self._opacity, b"opacity")
        self._anim.setDuration(220)
        self._hide_timer = QTimer(self)
        self._hide_timer.setSingleShot(True)
        self._hide_timer.timeout.connect(self._fade_out)

    def show_text(self, text: str, duration_ms: int = 1800):
        self.setText(text)
        self.adjustSize()
        # Posiciona no topo-centro, abaixo do header+search
        parent = self.parentWidget()
        if parent:
            x = (parent.width() - self.width()) // 2
            y = HEADER_H + SEARCH_H + 14
            self.move(x, y)
        self.raise_()
        self.show()
        self._anim.stop()
        try:
            self._anim.finished.disconnect()
        except (TypeError, RuntimeError):
            pass
        self._anim.setStartValue(self._opacity.opacity())
        self._anim.setEndValue(1.0)
        self._anim.start()
        self._hide_timer.start(duration_ms)

    def _fade_out(self):
        self._anim.stop()
        try:
            self._anim.finished.disconnect()
        except (TypeError, RuntimeError):
            pass
        self._anim.setStartValue(self._opacity.opacity())
        self._anim.setEndValue(0.0)
        self._anim.finished.connect(self.hide)
        self._anim.start()

# ─── TEMAS QSS ────────────────────────────────────────────────────────────────
def _qss(dark: bool) -> str:
    if dark:
        # Paleta neutra em escala de cinza (sem tons azulados/violeta)
        root       = "#0a0a0a"
        hdr_grad   = "stop:0 #1b5e20, stop:1 #0d3b14"
        hdr_txt    = "#a5d6a7"
        hdr_hover  = "rgba(165,214,167,0.15)"
        sb_bg      = "#141414"
        sb_border  = "#2a2a2a"
        pill_bg    = "#1f1f1f"
        pill_bord  = "#353535"
        inp_col    = "#e5e5e5"
        sbtn_bg    = "#2e7d32"; sbtn_hov = "#388e3c"
        chip_chk   = "#a6e3a1"; chip_chk_col = "#0a0a0a"
        panel_bg   = "#141414"; panel_div = "#2a2a2a"
        panel_tit  = "#a6e3a1"; panel_col = "#e5e5e5"; panel_hov = "#1f1f1f"; panel_hov_col = "#a6e3a1"
        leg_tit    = "#6b6b6b"
        card_bg    = "#141414"
        hdl_col    = "#353535"
        card_tit   = "#e5e5e5"; card_cat_bg = "#1f1f1f"; card_cat_col = "#a3a3a3"
        card_desc  = "#a3a3a3"; card_div = "#2a2a2a"
        nav_bg     = "#2e7d32"; nav_hov = "#388e3c"
        cls_bg     = "#1f1f1f"; cls_col = "#e5e5e5"; cls_hov = "#2a2a2a"
        res_bg     = "#141414"; res_bord = "#2a2a2a"
        res_col    = "#e5e5e5"; res_hov = "#1f1f1f"
    else:
        root       = "#f0f2f0"
        hdr_grad   = "stop:0 #43a047, stop:1 #2e7d32"
        hdr_txt    = "white"
        hdr_hover  = "rgba(255,255,255,0.18)"
        sb_bg      = "#ffffff"
        sb_border  = "#e8eae8"
        pill_bg    = "#f1f3f1"
        pill_bord  = "#dde0dd"
        inp_col    = "#1a1a1a"
        sbtn_bg    = "#43a047"; sbtn_hov = "#2e7d32"
        chip_chk   = "#2e7d32"; chip_chk_col = "white"
        panel_bg   = "#ffffff"; panel_div = "#e8eae8"
        panel_tit  = "#2e7d32"; panel_col = "#333"; panel_hov = "#f1f8e9"; panel_hov_col = "#2e7d32"
        leg_tit    = "#9e9e9e"
        card_bg    = "#ffffff"
        hdl_col    = "#ddd"
        card_tit   = "#1a1a1a"; card_cat_bg = "#f5f5f5"; card_cat_col = "#777"
        card_desc  = "#555"; card_div = "#f0f0f0"
        nav_bg     = "#2e7d32"; nav_hov = "#1b5e20"
        cls_bg     = "#f5f5f5"; cls_col = "#666"; cls_hov = "#e0e0e0"
        res_bg     = "#ffffff"; res_bord = "#e0e0e0"
        res_col    = "#333"; res_hov = "#f1f8e9"

    return f"""
    QWidget {{ font-family: 'Segoe UI', Arial, sans-serif; }}
    QWidget#root {{ background-color: {root}; }}

    QWidget#header {{
        background: qlineargradient(x1:0,y1:0,x2:0,y2:1, {hdr_grad});
    }}
    QLabel#title {{
        color: {hdr_txt}; font-size: 18px; font-weight: 700; letter-spacing: 0.5px;
    }}
    QPushButton#hdr_btn {{
        background: transparent; border: none; color: {hdr_txt};
        font-size: 20px; border-radius: 20px;
        min-width: 40px; max-width: 40px; min-height: 40px; max-height: 40px;
    }}
    QPushButton#hdr_btn:hover   {{ background: {hdr_hover}; }}
    QPushButton#hdr_btn:pressed {{ background: {hdr_hover}; }}
    QPushButton#hdr_btn[role="close"]:hover   {{ background: rgba(211,47,47,0.85); color: white; }}
    QPushButton#hdr_btn[role="minimize"]:hover {{ background: {hdr_hover}; }}

    QWidget#search_bar  {{ background-color: {sb_bg}; border-bottom: 1px solid {sb_border}; }}
    QWidget#search_pill {{ background-color: {pill_bg}; border-radius: 22px; border: 1.5px solid {pill_bord}; }}
    QLineEdit#search_input {{
        background: transparent; border: none;
        color: {inp_col}; font-size: 15px; padding: 0 4px;
    }}
    QPushButton#search_btn {{
        background-color: {sbtn_bg}; border: none; border-radius: 18px;
        color: white; font-size: 16px;
        min-width: 36px; max-width: 36px; min-height: 36px; max-height: 36px;
    }}
    QPushButton#search_btn:hover {{ background-color: {sbtn_hov}; }}

    QWidget#slide_panel  {{ background-color: {panel_bg}; }}
    QWidget#panel_divider {{ background-color: {panel_div}; }}
    QLabel#panel_title   {{ color: {panel_tit}; font-size: 20px; font-weight: 700; letter-spacing: 0.3px; }}
    QLabel#panel_subtitle {{ color: {leg_tit}; font-size: 11px; font-weight: 500; }}
    QLabel#section_header {{
        color: {leg_tit}; font-size: 10px; font-weight: 700; letter-spacing: 1.4px;
        padding-left: 2px;
    }}
    QPushButton#panel_btn {{
        background: transparent; border: 1.5px solid {panel_div}; color: {panel_col};
        font-size: 13px; padding: 0 14px; text-align: left; border-radius: 10px;
    }}
    QPushButton#panel_btn:hover {{ background-color: {panel_hov}; color: {panel_hov_col}; }}

    QPushButton#cat_btn {{
        background-color: transparent; border: 1.5px solid {panel_div};
        border-radius: 10px; color: {panel_col}; text-align: left;
        padding-left: 14px; font-size: 13px; font-weight: 500;
    }}
    QPushButton#cat_btn:hover:!checked {{
        background-color: {panel_hov}; border-color: {panel_hov};
    }}
    QPushButton#cat_btn:checked {{
        background-color: {chip_chk}; color: {chip_chk_col}; border-color: {chip_chk};
        font-weight: 600;
    }}

    QWidget#bottom_card  {{ background-color: {card_bg}; border-radius: 22px 22px 0 0; }}
    QWidget#card_handle  {{ background-color: {hdl_col}; border-radius: 3px; }}
    QLabel#card_title    {{ color: {card_tit}; font-size: 17px; font-weight: 700; }}
    QLabel#card_cat      {{
        color: {card_cat_col}; font-size: 11px; font-weight: 600;
        background-color: {card_cat_bg}; border-radius: 10px; padding: 3px 10px;
    }}
    QLabel#card_desc     {{ color: {card_desc}; font-size: 14px; }}
    QLabel#card_distance {{
        color: {panel_tit}; font-size: 13px; font-weight: 600;
        background-color: {card_cat_bg};
        border-radius: 10px;
        padding: 8px 12px;
    }}
    QWidget#card_divider {{ background-color: {card_div}; }}
    QPushButton#nav_btn {{
        background-color: {nav_bg}; color: white; border: none;
        border-radius: 14px; padding: 13px; font-size: 15px; font-weight: 700;
    }}
    QPushButton#nav_btn:hover {{ background-color: {nav_hov}; }}

    /* Toast (notificação flutuante) */
    QLabel#toast {{
        background-color: rgba(20, 20, 20, 0.92);
        color: #ffffff;
        border: 1px solid rgba(120, 120, 120, 0.25);
        border-radius: 18px;
        padding: 10px 20px;
        font-size: 13px;
        font-weight: 600;
    }}
    /* Bottom sheet de rota — estilo Waze, mesmo visual do bottom card */
    QWidget#route_banner {{
        background-color: {card_bg};
        border-top-left-radius: 22px;
        border-top-right-radius: 22px;
        border-bottom-left-radius: 0;
        border-bottom-right-radius: 0;
    }}
    QWidget#route_handle_wrap {{ background: transparent; }}
    QWidget#route_handle {{
        background-color: {hdl_col};
        border-radius: 3px;
    }}
    QLabel#route_dest_name {{
        color: {card_tit}; font-size: 11px; font-weight: 700;
        background: transparent;
    }}
    QLabel#route_arrival {{
        color: {card_tit}; font-size: 24px; font-weight: 800;
        background: transparent;
        letter-spacing: 0.3px;
    }}
    QLabel#route_summary {{
        color: {card_desc}; font-size: 13px; font-weight: 500;
        background: transparent;
        padding-top: 2px;
    }}
    QPushButton#route_banner_close {{
        background-color: {cls_bg};
        border: none; border-radius: 14px;
    }}
    QPushButton#route_banner_close:hover {{
        background-color: {cls_hov};
    }}

    /* ── Seção expandida do card ─────────────────────────────────────────── */
    QScrollArea#card_expanded_scroll {{
        background-color: {card_bg};
        border: none;
    }}
    QScrollArea#card_expanded_scroll > QWidget > QWidget {{
        background-color: {card_bg};
    }}
    QScrollArea#card_expanded_scroll QScrollBar:vertical {{
        background: transparent;
        width: 6px;
        margin: 4px 2px 4px 0;
    }}
    QScrollArea#card_expanded_scroll QScrollBar::handle:vertical {{
        background: {card_div};
        border-radius: 3px;
        min-height: 30px;
    }}
    QScrollArea#card_expanded_scroll QScrollBar::handle:vertical:hover {{
        background: {leg_tit};
    }}
    QScrollArea#card_expanded_scroll QScrollBar::add-line:vertical,
    QScrollArea#card_expanded_scroll QScrollBar::sub-line:vertical,
    QScrollArea#card_expanded_scroll QScrollBar::add-page:vertical,
    QScrollArea#card_expanded_scroll QScrollBar::sub-page:vertical {{
        background: transparent; border: none; height: 0;
    }}
    QWidget#card_expanded {{ background-color: {card_bg}; }}
    QWidget#day_row, QWidget#day_row_today {{
        min-height: 36px;
    }}
    QWidget#day_row {{
        background-color: {card_cat_bg};
        border-radius: 8px;
    }}
    QWidget#day_row_today {{
        background-color: {card_div};
        border-radius: 8px;
        border-left: 3px solid {panel_tit};
    }}
    QLabel#day_label {{
        color: {card_desc}; font-size: 12px; font-weight: 600;
        letter-spacing: 0.3px;
        background: transparent;
    }}
    QLabel#day_label_today {{
        color: {panel_tit}; font-size: 12px; font-weight: 800;
        letter-spacing: 0.6px;
        background: transparent;
    }}
    QLabel#day_item {{
        color: {card_desc}; font-size: 12px;
        background: transparent;
        padding: 1px 0;
    }}
    QLabel#day_item_today {{
        color: {card_tit}; font-size: 13px;
        background: transparent;
        padding: 1px 0;
    }}
    QLabel#day_empty {{
        color: {leg_tit}; font-size: 12px;
        background: transparent;
        font-style: italic;
        padding: 1px 0;
    }}
    QWidget#photo_carousel {{
        background-color: {card_cat_bg};
        border-radius: 12px;
    }}
    QLabel#photo_main {{
        background-color: {card_cat_bg};
        border-radius: 12px;
    }}
    QPushButton#photo_nav_btn {{
        background-color: rgba(0, 0, 0, 145);
        color: white;
        border: none;
        border-radius: 19px;
        font-size: 22px;
        font-weight: 700;
        padding-bottom: 3px;
    }}
    QPushButton#photo_nav_btn:hover {{
        background-color: rgba(0, 0, 0, 200);
    }}
    QPushButton#photo_nav_btn:pressed {{
        background-color: rgba(0, 0, 0, 230);
    }}
    QLabel#photo_counter {{
        color: white;
        background-color: rgba(0, 0, 0, 145);
        padding: 5px 11px;
        border-radius: 11px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.3px;
    }}
    QLabel#photo_dot {{
        background-color: {leg_tit};
        border-radius: 4px;
        max-width: 8px; max-height: 8px;
    }}
    QLabel#photo_dot_active {{
        background-color: {panel_tit};
        border-radius: 4px;
        max-width: 8px; max-height: 8px;
    }}
    QPushButton#close_btn {{
        background-color: {cls_bg}; border: none; color: {cls_col};
        border-radius: 18px; font-size: 16px;
        min-width: 36px; max-width: 36px; min-height: 36px; max-height: 36px;
    }}
    QPushButton#close_btn:hover {{ background-color: {cls_hov}; }}

    QWidget#results_panel {{
        background-color: {res_bg}; border-radius: 14px; border: 1px solid {res_bord};
    }}
    QPushButton#result_btn {{
        background: transparent; border: none; color: {res_col};
        font-size: 14px; padding: 10px 16px; text-align: left; border-radius: 8px;
    }}
    QPushButton#result_btn:hover {{ background-color: {res_hov}; }}
    """

# ─── ROUTE WORKER ─────────────────────────────────────────────────────────────
class RouteWorker(QThread):
    finished_route = Signal(list)  # lista de [lat, lon]

    def __init__(self, start, end, locais, parent=None):
        super().__init__(parent)
        self._start = start
        self._end = end
        self._locais = locais

    def run(self):
        try:
            rota = calcular_rota(self._start, self._end, self._locais)
        except Exception as e:
            print(f"[ROTA] Erro: {e}")
            rota = None
        self.finished_route.emit(rota or [])

# ─── JANELA PRINCIPAL ─────────────────────────────────────────────────────────
class IFrotaWindow(QWidget):
    def __init__(self, locais, map_path):
        super().__init__()
        self.locais         = locais
        self._campus_poly, _ = carregar_campus()
        self._dark          = False
        self._map_loaded    = False
        self._card_open     = False
        self._card_height   = CARD_H_COMPACT
        self._panel_open    = False
        self._current_local = None

        self._drag_offset = None

        self.setObjectName("root")
        self.setWindowTitle("IFrota")
        self.setFixedSize(WIN_W, WIN_H)
        self.setWindowFlags(Qt.WindowType.FramelessWindowHint)

        self._build_map(map_path)
        self._build_header()
        self._build_search()
        self._build_dim()
        self._build_panel()
        self._build_card()
        self._build_results()
        self._setup_anims()

        # Garante que overlays começam ocultos e fora da área visível
        self.bottom_card.hide()
        self.slide_panel.hide()
        self.dim.hide()

        cfg = carregar_config()
        self._apply_theme(bool(cfg.get("dark", False)))
        self._reposition()

    # ── CONSTRUÇÃO ───────────────────────────────────────────────────────────

    def _build_map(self, map_path):
        self._page = IFrotaPage(self)
        self._page.marker_clicked.connect(self._on_marker_click)
        self._page.map_clicked.connect(self._on_manual_position)
        self._page.grafo_node_add.connect(self._on_grafo_add_node)
        self._page.grafo_edge_add.connect(self._on_grafo_add_edge)
        self._page.grafo_node_del.connect(self._on_grafo_del_node)
        self._page.rota_pronta.connect(self._on_rota_pronta)
        self._page.off_route.connect(self._on_off_route)
        self._page.eta_update.connect(self._on_eta_update)
        self._has_active_route = False  # estado da rota ativa
        self._edit_mode = False
        self._route_worker = None
        self.map_view = QWebEngineView(self)
        self.map_view.setPage(self._page)
        self.map_view.setContextMenuPolicy(Qt.ContextMenuPolicy.NoContextMenu)
        url = _start_local_server(map_path)
        self.map_view.setUrl(QUrl(url))
        self.map_view.loadFinished.connect(self._on_map_loaded)

    def _build_header(self):
        self.header = QWidget(self)
        self.header.setObjectName("header")
        lay = QHBoxLayout(self.header)
        lay.setContentsMargins(10, 0, 10, 0)
        lay.setSpacing(0)

        self.btn_menu = self._hdr_btn()
        self.btn_menu.clicked.connect(self._toggle_panel)

        self.lbl_title = QLabel("IFrota", self.header)
        self.lbl_title.setObjectName("title")
        self.lbl_title.setAlignment(Qt.AlignmentFlag.AlignCenter)

        self.btn_theme = self._hdr_btn()
        self.btn_theme.clicked.connect(self._toggle_theme)

        self.btn_minimize = self._hdr_btn()
        self.btn_minimize.setProperty("role", "minimize")
        self.btn_minimize.clicked.connect(self.showMinimized)

        self.btn_close = self._hdr_btn()
        self.btn_close.setProperty("role", "close")
        self.btn_close.clicked.connect(self.close)

        lay.addWidget(self.btn_menu)
        lay.addWidget(self.lbl_title, 1)
        lay.addWidget(self.btn_theme)
        lay.addWidget(self.btn_minimize)
        lay.addWidget(self.btn_close)

    def _hdr_btn(self):
        b = QPushButton("", self.header)
        b.setObjectName("hdr_btn")
        b.setIconSize(QSize(18, 18))
        b.setCursor(Qt.CursorShape.PointingHandCursor)
        return b

    def _build_search(self):
        self.search_bar = QWidget(self)
        self.search_bar.setObjectName("search_bar")
        outer = QHBoxLayout(self.search_bar)
        outer.setContentsMargins(14, 10, 14, 10)

        self.search_pill = QWidget(self.search_bar)
        self.search_pill.setObjectName("search_pill")
        inner = QHBoxLayout(self.search_pill)
        inner.setContentsMargins(16, 5, 5, 5)
        inner.setSpacing(8)

        self.search_input = QLineEdit(self.search_pill)
        self.search_input.setObjectName("search_input")
        self.search_input.setPlaceholderText("Buscar local no campus...")
        self.search_input.setClearButtonEnabled(True)
        self.search_input.textChanged.connect(self._on_search_changed)
        self.search_input.editingFinished.connect(
            lambda: QTimer.singleShot(180, self.results_panel.hide)
        )

        btn = QPushButton("", self.search_pill)
        btn.setObjectName("search_btn")
        btn.setIcon(qta.icon("mdi6.magnify", color="white"))
        btn.setIconSize(QSize(18, 18))
        btn.setCursor(Qt.CursorShape.PointingHandCursor)
        btn.clicked.connect(self._on_search_submit)
        self._search_btn = btn

        inner.addWidget(self.search_input, 1)
        inner.addWidget(btn)
        outer.addWidget(self.search_pill)

    def _build_dim(self):
        self.dim = DimOverlay(self)
        self.dim.clicked.connect(self._close_panel)
        # Toast flutuante para feedback de ações
        self.toast = Toast(self)
        # Banner flutuante de rota ativa
        self.route_banner = RouteBanner(self)
        self.route_banner.canceled.connect(self._clear_route)
        # Visualizador fullscreen de foto da galeria
        self.photo_viewer = PhotoFullscreen(self)

    def _build_panel(self):
        self.slide_panel = QWidget(self)
        self.slide_panel.setObjectName("slide_panel")

        sh = QGraphicsDropShadowEffect()
        sh.setBlurRadius(28); sh.setColor(QColor(0,0,0,90)); sh.setOffset(5, 0)
        self.slide_panel.setGraphicsEffect(sh)

        lay = QVBoxLayout(self.slide_panel)
        lay.setContentsMargins(24, 18, 24, 24)
        lay.setSpacing(0)

        # ── Topo: botão fechar no canto direito ──
        top = QHBoxLayout()
        top.addStretch()
        close = QPushButton("", self.slide_panel)
        close.setObjectName("close_btn")
        close.setIconSize(QSize(16, 16))
        close.setCursor(Qt.CursorShape.PointingHandCursor)
        close.clicked.connect(self._close_panel)
        self._panel_close_btn = close
        top.addWidget(close)
        lay.addLayout(top)
        lay.addSpacing(6)

        # ── Título ──
        title = QLabel("IFrota", self.slide_panel)
        title.setObjectName("panel_title")
        title.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(title)

        subtitle = QLabel("Mapa interativo do campus", self.slide_panel)
        subtitle.setObjectName("panel_subtitle")
        subtitle.setAlignment(Qt.AlignmentFlag.AlignCenter)
        lay.addWidget(subtitle)
        lay.addSpacing(22)

        # ── Seção AÇÕES ──
        lay.addWidget(self._section_header("AÇÕES"))
        lay.addSpacing(10)

        def panel_btn(txt, slot):
            b = QPushButton("   " + txt, self.slide_panel)
            b.setObjectName("panel_btn")
            b.setIconSize(QSize(18, 18))
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            b.setFixedHeight(42)
            b.clicked.connect(slot)
            lay.addWidget(b)
            lay.addSpacing(8)
            return b

        self._btn_home_panel    = panel_btn("Visão Geral",        self._reset_view)
        self._btn_locate_panel  = panel_btn("Minha Localização",  self._locate_user)
        self._btn_setpos_panel  = panel_btn("Definir Posição",    self._set_user_position)
        self._btn_clear_route   = panel_btn("Limpar Rota",        self._clear_route)
        self._btn_filters_panel = panel_btn("Restaurar filtros",  self._reset_filters)
        self._btn_edit_grafo    = panel_btn("Editar Grafo",       self._toggle_editor)

        lay.addSpacing(14)

        # ── Seção CATEGORIAS (filtros + legenda consolidados) ──
        lay.addWidget(self._section_header("CATEGORIAS"))
        lay.addSpacing(10)

        self._chips: list[tuple[QPushButton, str]] = []
        self._cat_colors: list[tuple[QPushButton, str | None]] = []
        for label, value, cor in CATEGORIAS:
            btn = QPushButton("  " + label, self.slide_panel)
            btn.setObjectName("cat_btn")
            btn.setCheckable(True)
            btn.setChecked(value == "Tudo")
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.setFixedHeight(38)
            btn.setIconSize(QSize(12, 12))
            btn.clicked.connect(lambda _, v=value: self._on_filter(v))

            self._chips.append((btn, value))
            self._cat_colors.append((btn, cor))
            lay.addWidget(btn)
            lay.addSpacing(4)

        lay.addStretch(1)

    def _section_header(self, text: str) -> QLabel:
        lbl = QLabel(text, self.slide_panel)
        lbl.setObjectName("section_header")
        return lbl

    def _build_card(self):
        self.bottom_card = QWidget(self)
        self.bottom_card.setObjectName("bottom_card")

        sh = QGraphicsDropShadowEffect()
        sh.setBlurRadius(36); sh.setColor(QColor(0,0,0,75)); sh.setOffset(0, -6)
        self.bottom_card.setGraphicsEffect(sh)

        outer = QVBoxLayout(self.bottom_card)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # ── Handle bar (arrastável) ──────────────────────────────────────────
        self._card_handle_bar = CardHandleBar(self.bottom_card)
        self._card_handle_bar.setFixedHeight(24)
        hwl = QHBoxLayout(self._card_handle_bar); hwl.setContentsMargins(0, 9, 0, 6)
        handle = QWidget(self._card_handle_bar)
        handle.setObjectName("card_handle"); handle.setFixedSize(44, 5)
        handle.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        hwl.addWidget(handle, 0, Qt.AlignmentFlag.AlignCenter)
        outer.addWidget(self._card_handle_bar)

        # ── Body compacto (altura natural, sem fixedHeight pra não apertar conteúdo) ──
        body = QWidget(self.bottom_card)
        bl = QVBoxLayout(body); bl.setContentsMargins(20, 6, 20, 16); bl.setSpacing(10)

        hrow = QHBoxLayout(); hrow.setSpacing(14)
        self._icon_frame = QWidget(body)
        self._icon_frame.setFixedSize(54, 54)
        ifl = QVBoxLayout(self._icon_frame); ifl.setContentsMargins(0,0,0,0)
        self._icon_lbl = QLabel(self._icon_frame)
        self._icon_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._icon_lbl.setPixmap(qta.icon("mdi6.map-marker", color="white").pixmap(28, 28))
        ifl.addWidget(self._icon_lbl)

        info_col = QVBoxLayout(); info_col.setSpacing(5)
        self._card_title = QLabel("", body); self._card_title.setObjectName("card_title")
        self._card_title.setWordWrap(True)
        self._card_cat   = QLabel("", body); self._card_cat.setObjectName("card_cat")
        info_col.addWidget(self._card_title)
        info_col.addWidget(self._card_cat, 0, Qt.AlignmentFlag.AlignLeft)

        self._fav_btn = QPushButton("", body)
        self._fav_btn.setObjectName("close_btn")
        self._fav_btn.setIconSize(QSize(18, 18))
        self._fav_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._fav_btn.clicked.connect(self._toggle_favorito)

        close_card = QPushButton("", body)
        close_card.setObjectName("close_btn")
        close_card.setIconSize(QSize(16, 16))
        close_card.setCursor(Qt.CursorShape.PointingHandCursor)
        close_card.clicked.connect(self._close_card)
        self._card_close_btn = close_card

        hrow.addWidget(self._icon_frame)
        hrow.addLayout(info_col, 1)
        hrow.addWidget(self._fav_btn)
        hrow.addWidget(close_card)
        bl.addLayout(hrow)

        div = QWidget(body); div.setObjectName("card_divider"); div.setFixedHeight(1)
        bl.addWidget(div)

        self._card_desc = QLabel("", body)
        self._card_desc.setObjectName("card_desc"); self._card_desc.setWordWrap(True)
        bl.addWidget(self._card_desc)

        # Distância/ETA — só aparece se posição do usuário estiver definida
        self._card_distance = QLabel("", body)
        self._card_distance.setObjectName("card_distance")
        self._card_distance.setMinimumHeight(36)
        self._card_distance.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)
        self._card_distance.hide()
        bl.addWidget(self._card_distance)

        self._nav_btn = QPushButton("   Ir para este local", body)
        self._nav_btn.setObjectName("nav_btn")
        self._nav_btn.setIcon(qta.icon("mdi6.navigation-variant", color="white"))
        self._nav_btn.setIconSize(QSize(18, 18))
        self._nav_btn.setCursor(Qt.CursorShape.PointingHandCursor)
        self._nav_btn.setMinimumHeight(48)
        self._nav_btn.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)
        self._nav_btn.clicked.connect(self._on_nav)
        bl.addWidget(self._nav_btn)

        # Trava o body pra usar exatamente sua altura natural —
        # impede que o scroll abaixo "roube" espaço quando o card expande.
        body.setSizePolicy(QSizePolicy.Policy.Preferred, QSizePolicy.Policy.Fixed)
        outer.addWidget(body)

        # ── Seção expandida (visível somente quando o card é puxado pra cima) ──
        self._build_card_expanded(outer)

        # Conecta o drag handle aos handlers de redimensionamento
        self._card_drag_start_h = None
        self._card_handle_bar.drag_started.connect(self._on_card_drag_start)
        self._card_handle_bar.drag_delta.connect(self._on_card_drag)
        self._card_handle_bar.drag_ended.connect(self._on_card_drag_end)

    def _build_card_expanded(self, outer):
        """Conteúdo extra: agenda semanal + galeria de fotos (em scroll vertical)."""
        # Scroll container — permite que o conteúdo extrapole sem comprimir as linhas
        scroll = QScrollArea(self.bottom_card)
        scroll.setObjectName("card_expanded_scroll")
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        scroll.setVerticalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAsNeeded)
        scroll.setFrameStyle(0)
        self._card_ext = scroll  # referência para mostrar/ocultar ao expandir/colapsar

        ext = QWidget(scroll)
        ext.setObjectName("card_expanded")
        el = QVBoxLayout(ext); el.setContentsMargins(20, 4, 20, 20); el.setSpacing(10)

        # ── Programação semanal ──
        wk_title = QLabel("PROGRAMAÇÃO SEMANAL", ext)
        wk_title.setObjectName("section_header")
        el.addWidget(wk_title)

        from datetime import datetime as _dt
        today_key = ['seg','ter','qua','qui','sex','sab','dom'][_dt.now().weekday()]

        week = QWidget(ext)
        wkl = QVBoxLayout(week); wkl.setContentsMargins(0, 0, 0, 0); wkl.setSpacing(4)
        self._day_widgets = {}
        dias = [("Segunda","seg"),("Terça","ter"),("Quarta","qua"),("Quinta","qui"),
                ("Sexta","sex"),("Sábado","sab"),("Domingo","dom")]
        for label, key in dias:
            is_today = (key == today_key)
            row = QWidget(week)
            row.setObjectName("day_row_today" if is_today else "day_row")
            row.setMinimumHeight(40)
            rl = QHBoxLayout(row); rl.setContentsMargins(12, 8, 12, 8); rl.setSpacing(12)

            day_label = QLabel(("HOJE · " + label.upper()) if is_today else label, row)
            day_label.setObjectName("day_label_today" if is_today else "day_label")
            day_label.setMinimumWidth(120)
            day_label.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)

            items_holder = QWidget(row)
            il = QVBoxLayout(items_holder); il.setContentsMargins(0, 0, 0, 0); il.setSpacing(2)
            il.setAlignment(Qt.AlignmentFlag.AlignVCenter)

            rl.addWidget(day_label, 0)
            rl.addWidget(items_holder, 1)
            wkl.addWidget(row)
            self._day_widgets[key] = {"layout": il, "is_today": is_today}
        el.addWidget(week)

        # ── Galeria de fotos (hero full-width + arrows + counter badge) ──
        ph_title = QLabel("GALERIA", ext)
        ph_title.setObjectName("section_header")
        el.addWidget(ph_title)

        self._photo_list = []
        self._photo_idx = 0

        # Container do carrossel — arrows e counter são posicionados absolutamente
        gal = QWidget(ext)
        gal.setObjectName("photo_carousel")
        gal.setFixedHeight(210)

        # Hero (foto principal) preenche todo o container
        self._photo_main = QLabel(gal)
        self._photo_main.setObjectName("photo_main")
        self._photo_main.setCursor(Qt.CursorShape.PointingHandCursor)
        self._photo_main.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self._photo_main.mousePressEvent = lambda _e: self._open_photo_fullscreen()

        # Botões de navegação sobrepostos
        self._photo_btn_prev = QPushButton("‹", gal)
        self._photo_btn_prev.setObjectName("photo_nav_btn")
        self._photo_btn_prev.setFixedSize(38, 38)
        self._photo_btn_prev.setCursor(Qt.CursorShape.PointingHandCursor)
        self._photo_btn_prev.clicked.connect(lambda: self._photo_navigate(-1))

        self._photo_btn_next = QPushButton("›", gal)
        self._photo_btn_next.setObjectName("photo_nav_btn")
        self._photo_btn_next.setFixedSize(38, 38)
        self._photo_btn_next.setCursor(Qt.CursorShape.PointingHandCursor)
        self._photo_btn_next.clicked.connect(lambda: self._photo_navigate(1))

        # Badge contador "2 / 5" no canto superior direito
        self._photo_counter = QLabel("", gal)
        self._photo_counter.setObjectName("photo_counter")
        self._photo_counter.setAlignment(Qt.AlignmentFlag.AlignCenter)

        # Reposiciona elementos sobrepostos quando o container muda de tamanho
        def _layout_carousel(_e=None):
            gw, gh = gal.width(), gal.height()
            self._photo_main.setGeometry(0, 0, gw, gh)
            self._photo_btn_prev.move(10, (gh - 38) // 2)
            self._photo_btn_next.move(gw - 38 - 10, (gh - 38) // 2)
            self._photo_counter.adjustSize()
            self._photo_counter.move(gw - self._photo_counter.width() - 12, 12)
            # Garantir que arrows/counter ficam por cima do photo_main
            self._photo_btn_prev.raise_()
            self._photo_btn_next.raise_()
            self._photo_counter.raise_()
        gal.resizeEvent = _layout_carousel
        self._photo_layout_carousel = _layout_carousel
        el.addWidget(gal)

        # Pontos de paginação (● ○ ○ ○) abaixo da foto principal
        self._photo_dots = QWidget(ext)
        self._photo_dots_layout = QHBoxLayout(self._photo_dots)
        self._photo_dots_layout.setContentsMargins(0, 6, 0, 0)
        self._photo_dots_layout.setSpacing(7)
        self._photo_dots_layout.setAlignment(Qt.AlignmentFlag.AlignCenter)
        el.addWidget(self._photo_dots)

        el.addStretch()
        scroll.setWidget(ext)
        outer.addWidget(scroll, 1)
        # Collapse total — só aparece quando o usuário arrasta o card pra cima.
        # Usa max-height + hide pra garantir que não ocupe espaço nem renderize.
        scroll.setMaximumHeight(0)
        scroll.hide()

    def _build_results(self):
        self.results_panel = QWidget(self)
        self.results_panel.setObjectName("results_panel")
        self.results_panel.hide()

        sh = QGraphicsDropShadowEffect()
        sh.setBlurRadius(18); sh.setColor(QColor(0,0,0,55)); sh.setOffset(0, 4)
        self.results_panel.setGraphicsEffect(sh)

        self.results_lay = QVBoxLayout(self.results_panel)
        self.results_lay.setContentsMargins(6, 6, 6, 6)
        self.results_lay.setSpacing(2)

    def _setup_anims(self):
        self._anim_card = QPropertyAnimation(self.bottom_card, b"geometry")
        self._anim_card.setDuration(ANIM_MS)
        self._anim_card.setEasingCurve(QEasingCurve.Type.OutCubic)
        self._anim_card.finished.connect(self._on_card_anim_done)

        self._anim_panel = QPropertyAnimation(self.slide_panel, b"geometry")
        self._anim_panel.setDuration(ANIM_MS)
        self._anim_panel.setEasingCurve(QEasingCurve.Type.OutQuart)
        self._anim_panel.finished.connect(self._on_panel_anim_done)

    # ── LAYOUT ───────────────────────────────────────────────────────────────

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self._reposition()

    def _reposition(self):
        w, h = self.width(), self.height()
        map_top = HEADER_H + SEARCH_H

        self.header.setGeometry(0, 0, w, HEADER_H)
        self.search_bar.setGeometry(0, HEADER_H, w, SEARCH_H)
        self.map_view.setGeometry(0, map_top, w, h - map_top)
        self.dim.setGeometry(0, 0, w, h)
        if hasattr(self, "photo_viewer") and self.photo_viewer.isVisible():
            self.photo_viewer.setGeometry(0, 0, w, h)

        if not self._card_open:
            self.bottom_card.setGeometry(0, h, w, getattr(self, "_card_height", CARD_H_COMPACT))
        if not self._panel_open:
            self.slide_panel.setGeometry(-PANEL_W, 0, PANEL_W, h)

        res_h = min(260, h - map_top - 16)
        self.results_panel.setGeometry(12, HEADER_H + SEARCH_H - 2, w - 24, res_h)

    # ── MAPA ─────────────────────────────────────────────────────────────────

    def _on_map_loaded(self, ok):
        if ok:
            self._map_loaded = True
            if self._dark:
                self.map_view.page().runJavaScript("aplicarTema(true);")

    def _run_js(self, code):
        if self._map_loaded:
            self.map_view.page().runJavaScript(code)

    def _reset_view(self):
        self._run_js("resetarMapa();")
        self._run_js("restaurarMarcadores();")
        self._close_panel()

    def _locate_user(self):
        """Centraliza no último ponto conhecido e pede atualização do GPS.
           Não entra em modo manual — para isso há o botão 'Definir Posição'."""
        cfg = carregar_config()
        pos = cfg.get("last_pos")
        if pos:
            self._run_js(f"mostrarUsuario({pos[0]}, {pos[1]}, 0);")
        else:
            print("[GPS] Posição ainda não definida. Use 'Definir Posição' para marcar.")

        if _POSITIONING_OK:
            if not hasattr(self, "_geo_source") or self._geo_source is None:
                self._geo_source = QGeoPositionInfoSource.createDefaultSource(self)
                if self._geo_source is not None:
                    self._geo_source.positionUpdated.connect(self._on_position)
                    self._geo_source.errorOccurred.connect(self._on_position_error)
                    self._geo_source.setUpdateInterval(2000)
            if self._geo_source is not None:
                # Inicia updates contínuos (1 leitura a cada ~2s) pra
                # alimentar tracking + ETA + off-route detection
                self._geo_source.startUpdates()
                # Também pede uma leitura imediata pra atualizar logo
                self._geo_source.requestUpdate(6000)
        self._close_panel()

    def _set_user_position(self):
        """Sempre ativa modo manual: o próximo clique no mapa define a posição."""
        print("[GPS] Modo definição de posição ATIVO. Clique no mapa onde você está.")
        self._run_js("ativarModoManual(true);")
        self._close_panel()

    def _on_position(self, info):
        coord = info.coordinate()
        lat, lon = coord.latitude(), coord.longitude()
        attr = QGeoPositionInfo.Attribute.HorizontalAccuracy
        acc = info.attribute(attr) if info.hasAttribute(attr) else 0
        self._run_js(f"mostrarUsuario({lat}, {lon}, {acc or 0});")
        # Throttled config save — só grava se a posição mudou significativamente
        cfg = carregar_config()
        last = cfg.get("last_pos") or [0, 0]
        if haversine(last[0], last[1], lat, lon) > 5:  # > 5m
            cfg["last_pos"] = [lat, lon]
            salvar_config(cfg)
        # Tracking: ETA dinâmica + detecção off-route
        if self._has_active_route:
            self._run_js(f"atualizarTracking({lat}, {lon});")

    def _on_position_error(self, err):
        print(f"[GPS] Erro ao obter posição: {err}. Use 'Definir Posição' para marcar manualmente.")

    # ── EDITOR DE GRAFO ──────────────────────────────────────────────────────

    def _toggle_editor(self):
        self._edit_mode = not self._edit_mode
        if self._edit_mode:
            self._push_grafo()
        self._run_js(f"ativarEditor({'true' if self._edit_mode else 'false'});")
        if self._edit_mode:
            print("[GRAFO] Modo edição ATIVO. Clique no mapa = adicionar nó. "
                  "Clique em 2 nós = aresta. Shift+clique em nó = deletar.")
        else:
            print("[GRAFO] Modo edição desativado.")
        self._close_panel()

    def _push_grafo(self):
        grafo = carregar_grafo()
        out = {"nodes": grafo["nodes"], "edges": grafo["edges"]}
        self._run_js(f"renderizarGrafo({json.dumps(out)});")

    def _on_grafo_add_node(self, lat, lon):
        if self._campus_poly and not ponto_dentro(lat, lon, self._campus_poly):
            print("[GRAFO] Nó rejeitado: fora do polígono do campus.")
            return
        grafo = carregar_grafo()
        nid = f"n{grafo['_next_id']}"
        grafo["nodes"][nid] = [lat, lon]
        salvar_grafo(grafo)
        self._push_grafo()

    def _on_grafo_add_edge(self, a, b):
        if a == b:
            return
        grafo = carregar_grafo()
        if a not in grafo["nodes"] or b not in grafo["nodes"]:
            return
        for ea, eb in grafo["edges"]:
            if {ea, eb} == {a, b}:
                return
        grafo["edges"].append([a, b])
        salvar_grafo(grafo)
        self._push_grafo()

    def _on_grafo_del_node(self, nid):
        grafo = carregar_grafo()
        if nid in grafo["nodes"]:
            del grafo["nodes"][nid]
            grafo["edges"] = [e for e in grafo["edges"] if nid not in e]
            salvar_grafo(grafo)
            self._push_grafo()

    def _clear_route(self):
        self._run_js("limparRota();")
        self._run_js("restaurarMarcadores();")
        self._has_active_route = False
        if hasattr(self, "route_banner"):
            self.route_banner.hide()
        self._close_panel()

    def _on_manual_position(self, lat, lon):
        dentro = ponto_dentro(lat, lon, self._campus_poly) if self._campus_poly else True
        local = "dentro do campus" if dentro else "fora do campus (rota externa via OSRM)"
        print(f"[GPS] Posição definida: ({lat:.6f}, {lon:.6f}) — {local}")
        self._run_js(f"mostrarUsuario({lat}, {lon}, 0);")
        self._run_js("ativarModoManual(false);")
        cfg = carregar_config()
        cfg["last_pos"] = [lat, lon]
        salvar_config(cfg)
        # Dispara tracking — atualiza ETA / detecta off-route se há rota ativa
        if self._has_active_route:
            self._run_js(f"atualizarTracking({lat}, {lon});")
        msg = "✓ Posição definida" if dentro else "✓ Posição definida (fora do campus)"
        self.toast.show_text(msg)

    def _reset_filters(self):
        for chip, value in self._chips:
            chip.setChecked(value == "Tudo")
        self._run_js("filtrarCat('Tudo');")
        # Refaz os resultados da busca sem filtro de categoria
        if self.search_input.text().strip():
            self._on_search_changed(self.search_input.text())

    def _on_marker_click(self, nome):
        local = next((l for l in self.locais if l["nome"] == nome), None)
        if local:
            self._open_card(local)

    # ── FAVORITAR ────────────────────────────────────────────────────────────
    def _toggle_favorito(self):
        if not self._current_local:
            return
        nome = self._current_local.get("nome", "")
        cfg = carregar_config()
        favoritos = cfg.get("favoritos", [])
        if nome in favoritos:
            favoritos.remove(nome)
            self.toast.show_text(f"☆ Removido dos favoritos")
        else:
            favoritos.append(nome)
            self.toast.show_text(f"★ {nome} favoritado")
        cfg["favoritos"] = favoritos
        salvar_config(cfg)
        self._update_fav_icon()

    def _update_fav_icon(self):
        if not hasattr(self, "_fav_btn") or not self._current_local:
            return
        cfg = carregar_config()
        favoritos = cfg.get("favoritos", [])
        is_fav = self._current_local.get("nome", "") in favoritos
        color = "#fbbf24" if is_fav else ("#e5e5e5" if self._dark else "#666666")
        icon = "mdi6.star" if is_fav else "mdi6.star-outline"
        self._fav_btn.setIcon(qta.icon(icon, color=color))

    # ── CARD ─────────────────────────────────────────────────────────────────

    def _open_card(self, local):
        self._current_local = local
        hex_cor = COR_HEX.get(local.get("cor", "green"), "#5cb85c")
        self._icon_frame.setStyleSheet(f"background-color:{hex_cor}; border-radius:16px;")
        mdi_name = MDI_ICONE.get(local.get("icone", ""), "mdi6.map-marker")
        self._icon_lbl.setPixmap(qta.icon(mdi_name, color="white").pixmap(28, 28))
        self._card_title.setText(local.get("nome", ""))
        self._card_cat.setText(local.get("cat", ""))
        self._card_desc.setText(local.get("desc", ""))

        self._update_fav_icon()

        # Distância/ETA baseado na posição salva do usuário
        cfg = carregar_config()
        user_pos = cfg.get("last_pos")
        if user_pos:
            dist = haversine(user_pos[0], user_pos[1], local["coords"][0], local["coords"][1])
            eta_min = max(1, round(dist / 1.4 / 60))
            self._card_distance.setText(f"📍 {dist:.0f}m · ~{eta_min}min a pé")
            self._card_distance.show()
        else:
            self._card_distance.hide()

        # Popula a seção expandida com a agenda e fotos do local
        self._populate_schedule(local.get("agenda", {}))
        self._populate_photos(local.get("fotos", []))

        # Sempre abre no estado compacto — ext totalmente colapsado
        if hasattr(self, "_card_ext"):
            self._card_ext.setMaximumHeight(0)
            self._card_ext.hide()
        self._card_height = CARD_H_COMPACT

        # Destaca o marker e centraliza nele acima do card (sem mudar zoom)
        nome_js = json.dumps(local.get("nome", ""))
        lat_v, lon_v = local.get("coords", [0, 0])
        self._run_js(f"selecionarMarcador({nome_js});")
        self._run_js(f"focarMarcador({lat_v}, {lon_v}, {CARD_H_COMPACT});")
        w, h = self.width(), self.height()
        self._anim_card.stop()
        self.bottom_card.setGeometry(0, h, w, self._card_height)
        self.bottom_card.raise_()
        self.bottom_card.show()
        self._anim_card.setStartValue(QRect(0, h, w, self._card_height))
        self._anim_card.setEndValue(QRect(0, h - self._card_height, w, self._card_height))
        self._anim_card.start()
        self._card_open = True

    def _close_card(self):
        if not self._card_open:
            return
        w, h = self.width(), self.height()
        cur_h = self.bottom_card.height() or CARD_H_COMPACT
        self._anim_card.stop()
        self._anim_card.setStartValue(self.bottom_card.geometry())
        self._anim_card.setEndValue(QRect(0, h, w, cur_h))
        self._anim_card.start()
        self._card_open = False
        # Remove o destaque do marker e reseta o padding
        self._run_js("limparSelecao();")
        self._run_js("setMapPadding(0, 0);")

    def _on_card_anim_done(self):
        if not self._card_open:
            self.bottom_card.hide()

    # ── DRAG do handle para expandir/colapsar o card ─────────────────────────
    def _on_card_drag_start(self):
        self._card_drag_start_h = self.bottom_card.height()
        self._anim_card.stop()
        # Mostra a seção expandida assim que o usuário começa a arrastar
        if hasattr(self, "_card_ext"):
            self._card_ext.setMaximumHeight(16777215)  # Qt default (sem limite)
            self._card_ext.show()

    def _on_card_drag(self, delta_y):
        if self._card_drag_start_h is None:
            self._card_drag_start_h = self.bottom_card.height()
        new_h = max(CARD_H_COMPACT, min(CARD_H_EXPANDED, self._card_drag_start_h + delta_y))
        w, h = self.width(), self.height()
        self.bottom_card.setGeometry(0, h - new_h, w, new_h)

    def _on_card_drag_end(self):
        current_h = self.bottom_card.height()
        target = CARD_H_EXPANDED if current_h > (CARD_H_COMPACT + CARD_H_EXPANDED) / 2 else CARD_H_COMPACT
        self._card_drag_start_h = None
        self._card_height = target
        w, h = self.width(), self.height()
        self._anim_card.stop()
        self._anim_card.setStartValue(self.bottom_card.geometry())
        self._anim_card.setEndValue(QRect(0, h - target, w, target))
        self._anim_card.start()
        # Oculta a seção expandida se o snap for pra compacto (após a animação)
        if target == CARD_H_COMPACT and hasattr(self, "_card_ext"):
            def _collapse_ext():
                self._card_ext.setMaximumHeight(0)
                self._card_ext.hide()
            QTimer.singleShot(ANIM_MS, _collapse_ext)

    # ── PROGRAMAÇÃO SEMANAL ──────────────────────────────────────────────────
    def _populate_schedule(self, agenda: dict):
        # Limpa entradas anteriores
        for w in self._day_widgets.values():
            layout = w["layout"]
            while layout.count():
                item = layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
        # Preenche com items do agenda atual
        for key, w in self._day_widgets.items():
            layout = w["layout"]
            is_today = w["is_today"]
            itens = agenda.get(key, []) if isinstance(agenda, dict) else []
            if not itens:
                lbl = QLabel("—" if not is_today else "Sem atividades hoje")
                lbl.setObjectName("day_empty")
                lbl.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
                layout.addWidget(lbl)
                continue
            for entry in itens:
                if isinstance(entry, (list, tuple)) and len(entry) >= 2:
                    hora, atividade = str(entry[0]), str(entry[1])
                    lbl = QLabel(f"<span style='font-weight:700;'>{hora}</span>  ·  {atividade}")
                else:
                    lbl = QLabel(str(entry))
                lbl.setObjectName("day_item_today" if is_today else "day_item")
                lbl.setWordWrap(True)
                lbl.setTextFormat(Qt.TextFormat.RichText)
                lbl.setAlignment(Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter)
                layout.addWidget(lbl)

    # ── GALERIA DE FOTOS ─────────────────────────────────────────────────────
    def _populate_photos(self, fotos: list):
        self._photo_list = list(fotos) if fotos else []
        self._photo_idx = 0
        self._update_photo_display()

    def _photo_navigate(self, direction: int):
        if not self._photo_list:
            return
        n = len(self._photo_list)
        self._photo_idx = (self._photo_idx + direction) % n
        self._update_photo_display()

    def _update_photo_display(self):
        n = len(self._photo_list)
        # Limpa os dots existentes antes de redesenhar
        while self._photo_dots_layout.count():
            it = self._photo_dots_layout.takeAt(0)
            if it.widget(): it.widget().deleteLater()

        if n == 0:
            self._photo_main.setText("Sem fotos disponíveis")
            self._photo_main.setStyleSheet("background:#808080; color:white; border-radius:10px;")
            self._photo_main.setPixmap(QPixmap())
            self._photo_main.setCursor(Qt.CursorShape.ArrowCursor)
            self._photo_btn_prev.hide()
            self._photo_btn_next.hide()
            self._photo_counter.hide()
            return

        self._photo_main.setStyleSheet("")
        self._photo_main.setText("")
        self._photo_main.setCursor(Qt.CursorShape.PointingHandCursor)
        # Usa tamanho real do widget pro melhor encaixe
        w = max(360, self._photo_main.width())
        h = max(200, self._photo_main.height())
        self._set_photo_image(self._photo_main, self._photo_list[self._photo_idx], w, h)

        # Counter sempre visível quando há fotos
        self._photo_counter.setText(f"{self._photo_idx + 1} / {n}")
        self._photo_counter.show()

        if n > 1:
            self._photo_btn_prev.show()
            self._photo_btn_next.show()
            # Renderiza dots de paginação
            for i in range(n):
                dot = QLabel(self._photo_dots)
                dot.setObjectName("photo_dot_active" if i == self._photo_idx else "photo_dot")
                dot.setFixedSize(8, 8)
                self._photo_dots_layout.addWidget(dot)
        else:
            self._photo_btn_prev.hide()
            self._photo_btn_next.hide()

        # Reposiciona overlays (counter pode ter mudado de tamanho)
        if hasattr(self, "_photo_layout_carousel"):
            self._photo_layout_carousel()

    def _open_photo_fullscreen(self):
        if not self._photo_list:
            return
        self.photo_viewer.show_photos(self._photo_list, self._photo_idx)

    def _set_photo_image(self, label: QLabel, path: str, w: int, h: int):
        if path and os.path.exists(path):
            # Cover: escala mantendo aspect ratio com expanding, depois corta centro
            pm = QPixmap(path).scaled(
                w, h,
                Qt.AspectRatioMode.KeepAspectRatioByExpanding,
                Qt.TransformationMode.SmoothTransformation,
            )
            # Crop centralizado pra caber exatamente em w x h
            x = max(0, (pm.width() - w) // 2)
            y = max(0, (pm.height() - h) // 2)
            pm = pm.copy(x, y, w, h)
            label.setPixmap(pm)
            label.setStyleSheet("")
        else:
            # Placeholder cinza pra arquivos faltantes
            label.setPixmap(QPixmap())
            label.setText("📷")
            label.setStyleSheet("background:#909090; color:white; font-size:24px; border-radius:10px;")

    def _on_nav(self):
        if not self._current_local:
            return
        dest = self._current_local["coords"]
        cfg = carregar_config()
        user_pos = cfg.get("last_pos")
        if not user_pos:
            self._run_js(f"flyToLocal({dest[0]},{dest[1]});")
            self._close_card()
            return
        # Pathfinding via rede viária das vector tiles do MapLibre — fallback no polígono
        nome_js = json.dumps(self._current_local.get("nome", ""))
        self._run_js(
            f"calcularRotaMapa({user_pos[0]}, {user_pos[1]}, "
            f"{dest[0]}, {dest[1]}, {nome_js});"
        )
        self._close_card()

    def _on_rota_pronta(self, info: dict):
        """Recebe metadados da rota calculada em JS e atualiza o banner."""
        dist  = info.get("dist", 0)
        eta   = info.get("eta", 0)
        modo  = info.get("modo", "?")
        print(f"[ROTA] {dist}m, ~{eta}min ({modo})")
        self._has_active_route = True
        if hasattr(self, "route_banner"):
            # Passa o dict do destino pra renderizar ícone + cor da categoria
            self.route_banner.show_route(self._current_local or {}, dist, eta)

    def _on_off_route(self, lat: float, lon: float):
        """JS detectou que o usuário saiu da rota — recalcula automaticamente."""
        if not self._has_active_route or not self._current_local:
            return
        print(f"[TRACK] Off-route detectado em ({lat:.6f}, {lon:.6f}) — recalculando rota")
        if hasattr(self, "toast"):
            self.toast.show_text("⟳ Recalculando rota...", duration_ms=1600)
        dest = self._current_local["coords"]
        nome_js = json.dumps(self._current_local.get("nome", ""))
        self._run_js(
            f"calcularRotaMapa({lat}, {lon}, {dest[0]}, {dest[1]}, {nome_js});"
        )

    def _on_eta_update(self, info: dict):
        """JS reportou ETA atualizado conforme o usuário avança."""
        if not self._has_active_route or not self._current_local:
            return
        dist = info.get("dist", 0)
        eta  = info.get("eta", 0)
        if hasattr(self, "route_banner"):
            self.route_banner.show_route(self._current_local, dist, eta)

    def _on_route_ready(self, rota):
        if not rota or len(rota) < 2:
            return
        coords_js = json.dumps(rota)
        if self._current_local:
            dest_lat, dest_lon = self._current_local["coords"]
            self._run_js(f"desenharRota({coords_js}, {dest_lat}, {dest_lon});")
            nome_js = json.dumps(self._current_local["nome"])
            self._run_js(f"isolarDestino({nome_js});")
        else:
            self._run_js(f"desenharRota({coords_js});")
        dist = comprimento_rota(rota)
        eta_min = max(1, round(dist / 1.4 / 60))
        print(f"[ROTA] {len(rota)} pontos, {dist:.0f}m, ~{eta_min}min a pé")
        # Mostra banner persistente com a rota (substitui o toast efêmero)
        if self._current_local:
            self.route_banner.show_route(self._current_local.get("nome", "destino"), dist, eta_min)

    # ── PAINEL LATERAL ───────────────────────────────────────────────────────

    def _toggle_panel(self):
        if self._panel_open:
            self._close_panel()
        else:
            self._open_panel()

    def _open_panel(self):
        h = self.height()
        self._anim_panel.stop()
        self.slide_panel.setGeometry(-PANEL_W, 0, PANEL_W, h)
        self.dim.raise_()
        self.dim.show()
        self.slide_panel.raise_()
        self.slide_panel.show()
        self._anim_panel.setStartValue(QRect(-PANEL_W, 0, PANEL_W, h))
        self._anim_panel.setEndValue(QRect(0, 0, PANEL_W, h))
        self._anim_panel.start()
        self._panel_open = True

    def _close_panel(self):
        if not self._panel_open:
            return
        h = self.height()
        self._anim_panel.stop()
        self._anim_panel.setStartValue(self.slide_panel.geometry())
        self._anim_panel.setEndValue(QRect(-PANEL_W, 0, PANEL_W, h))
        self._anim_panel.start()
        self._panel_open = False

    def _on_panel_anim_done(self):
        if not self._panel_open:
            self.slide_panel.hide()
            self.dim.hide()

    # ── ARRASTAR JANELA ──────────────────────────────────────────────────────

    def mousePressEvent(self, event):
        if event.button() == Qt.MouseButton.LeftButton:
            self._drag_offset = event.position().toPoint()
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        if self._drag_offset is not None and event.buttons() == Qt.MouseButton.LeftButton:
            self.move(self.pos() + event.position().toPoint() - self._drag_offset)
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        self._drag_offset = None
        super().mouseReleaseEvent(event)

    # ── FILTRO ───────────────────────────────────────────────────────────────

    def _on_filter(self, cat):
        for chip, value in self._chips:
            chip.setChecked(value == cat)
        self._run_js(f"filtrarCat('{cat}');")
        # Refaz a lista de resultados aplicando o novo filtro
        self._on_search_changed(self.search_input.text())

    # ── BUSCA ────────────────────────────────────────────────────────────────

    def _on_search_changed(self, text):
        if text.strip():
            self._run_js("restaurarMarcadores();")
        while self.results_lay.count():
            item = self.results_lay.takeAt(0)
            if item.widget():
                item.widget().deleteLater()

        resultados = buscar_locais(text, self.locais)
        # Aplica também o filtro de categoria ativo (selecionado no menu)
        cat_ativa = next((v for _c, v in self._chips if _c.isChecked()), "Tudo")
        if cat_ativa != "Tudo":
            resultados = [l for l in resultados if l.get("cat") == cat_ativa]

        if not resultados:
            self.results_panel.hide()
            return

        for local in resultados[:6]:
            btn = QPushButton(local["nome"], self.results_panel)
            btn.setObjectName("result_btn")
            btn.setCursor(Qt.CursorShape.PointingHandCursor)
            btn.clicked.connect(lambda _, l=local: self._select_result(l))
            self.results_lay.addWidget(btn)

        self.results_panel.raise_()
        self.results_panel.show()

    def _on_search_submit(self):
        resultados = buscar_locais(self.search_input.text(), self.locais)
        if resultados:
            self._select_result(resultados[0])

    def _select_result(self, local):
        self.search_input.setText(local["nome"])
        self.results_panel.hide()
        lat, lon = local["coords"]
        self._run_js(f"flyToLocal({lat},{lon});")
        self._open_card(local)

    # ── TEMA ─────────────────────────────────────────────────────────────────

    def _toggle_theme(self):
        self._apply_theme(not self._dark)
        salvar_config({"dark": self._dark})
        if self._panel_open:
            self._close_panel()
        if hasattr(self, "toast"):
            self.toast.show_text("☾ Tema escuro" if self._dark else "☀ Tema claro", duration_ms=1400)

    def _apply_theme(self, dark: bool):
        self._dark = dark
        self.setStyleSheet(_qss(dark))
        self._refresh_icons(dark)
        if self._map_loaded:
            js = "aplicarTema(true);" if dark else "aplicarTema(false);"
            self.map_view.page().runJavaScript(js)

    def _refresh_icons(self, dark: bool):
        # Cores dos ícones de acordo com o tema (escala de cinza neutra)
        hdr_c    = "#a5d6a7" if dark else "white"
        panel_c  = "#e5e5e5" if dark else "#333333"
        cls_c    = "#e5e5e5" if dark else "#666666"

        self.btn_menu.setIcon(qta.icon("mdi6.menu", color=hdr_c))
        self.btn_theme.setIcon(qta.icon(
            "mdi6.white-balance-sunny" if dark else "mdi6.weather-night",
            color=hdr_c,
        ))
        self.btn_minimize.setIcon(qta.icon("mdi6.window-minimize", color=hdr_c))
        self.btn_close.setIcon(qta.icon("mdi6.close", color=hdr_c))

        self._btn_home_panel.setIcon(qta.icon("mdi6.home-outline", color=panel_c))
        self._btn_locate_panel.setIcon(qta.icon("mdi6.crosshairs-gps", color=panel_c))
        self._btn_setpos_panel.setIcon(qta.icon("mdi6.map-marker-plus-outline", color=panel_c))
        self._btn_clear_route.setIcon(qta.icon("mdi6.map-marker-path", color=panel_c))
        self._btn_filters_panel.setIcon(qta.icon("mdi6.filter-remove-outline", color=panel_c))
        self._btn_edit_grafo.setIcon(qta.icon("mdi6.vector-polyline-edit", color=panel_c))

        # Ícones coloridos de cada categoria (bolinha ou anel)
        ring_c = "#9e9e9e" if not dark else "#6b6b6b"
        for btn, cor in self._cat_colors:
            if cor is None:
                btn.setIcon(qta.icon("mdi6.circle-outline", color=ring_c))
            else:
                btn.setIcon(qta.icon("mdi6.circle", color=cor))

        self._panel_close_btn.setIcon(qta.icon("mdi6.close", color=cls_c))
        self._card_close_btn.setIcon(qta.icon("mdi6.close", color=cls_c))
        # Ícone do botão de fechar do banner de rota (segue o tema do card)
        if hasattr(self, "route_banner"):
            self.route_banner._close_btn.setIcon(qta.icon("mdi6.close", color=cls_c))
        # Atualiza ícone do favorito (mantém amarelo se favoritado, senão tema)
        if hasattr(self, "_fav_btn"):
            self._update_fav_icon()

# ─── MAIN ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import traceback

    try:
        app = QApplication(sys.argv)
        app.setApplicationName("IFrota")

        locais       = carregar_dados()
        cfg_inicial  = carregar_config()
        dark_inicial = bool(cfg_inicial.get("dark", False))
        map_path     = gerar_mapa(locais, dark=dark_inicial)

        win = IFrotaWindow(locais, map_path)
        win.show()
        sys.exit(app.exec())

    except Exception:
        traceback.print_exc()
        input("\nErro ao iniciar. Pressione Enter para sair...")
