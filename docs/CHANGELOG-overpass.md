# Changelog — Integração Overpass API (raw OSM)

> Documento de mudanças para permitir rollback. Cada alteração tem
> **localização exata** + **versão anterior** + **como reverter**.

## Resumo

Antes:
- Rede viária extraída apenas de `map.querySourceFeatures('openmaptiles',
  'transportation')` — limitado ao que está renderizado nas vector tiles.

Depois:
- Rede viária combina **vector tiles + Overpass API**. Overpass dá acesso
  **direto ao banco OSM** com TODAS as features de `highway` no bbox do campus,
  incluindo footways/paths que podem não estar renderizados.
- Cache local em `.cache/overpass_campus.json` — só faz fetch da rede uma vez.
- Feature flag `USE_OVERPASS = True` no topo do arquivo permite desativar.

---

## Arquivos alterados

### `IFrota.py`

#### 1. Adicionado: constante `USE_OVERPASS`
**Local:** Topo do arquivo, junto às outras flags
**Versão atual:**
```python
USE_OVERPASS = True  # False = comportamento anterior, só vector tiles
```
**Reverter:** Setar `USE_OVERPASS = False`. Ou apagar a linha.

---

#### 2. Adicionado: função `fetch_overpass_caminhos(bbox, force_refresh=False)`
**Local:** Bloco de helpers de pathfinding, perto de `osrm_route`
**O que faz:**
- Consulta Overpass API com `[bbox]["highway"=*]`
- Cacheia em `.cache/overpass_campus.json` (persiste entre execuções)
- Retorna lista de features no formato `[{geometry, properties}, ...]`
**Reverter:** Apagar a função inteira.

---

#### 3. Adicionado: injeção `overpass_js` no template HTML
**Local:** Em `gerar_mapa(locais, dark=False)`, junto a `dados_js`/`poly_js`
**Versão atual:**
```python
overpass_features = (fetch_overpass_caminhos(((sw_lat, sw_lon), (ne_lat, ne_lon)))
                     if USE_OVERPASS else [])
overpass_js = json.dumps(overpass_features)
```
**Reverter:** Apagar essas 2 linhas e a constante `_overpassFeats` injetada no JS.

---

#### 4. Modificado: template JS — constante `_overpassFeats` global
**Local:** Dentro do `<script>` gerado por `gerar_mapa`, perto de `_locais` e
`_campusPoly`.
**Versão atual:**
```js
const _overpassFeats = {overpass_js};
```
**Versão anterior:** _(não existia)_
**Reverter:** Apagar essa linha.

---

#### 5. Modificado: função JS `_construirRedeViaria`
**Local:** Dentro do `<script>` no template, função que monta a rede de routing.
**O que mudou:** Após processar features das vector tiles, processa também
`_overpassFeats` adicionando ao mesmo `nodes`/`adj`.

**Versão atual (trecho relevante):**
```js
// ... loop sobre feats de querySourceFeatures (igual antes) ...

// NOVO: também processa features do Overpass se disponíveis
if (typeof _overpassFeats !== 'undefined' && _overpassFeats.length > 0) {{
    for (const f of _overpassFeats) {{
        const g = f.geometry;
        if (!g || g.type !== 'LineString') continue;
        const coords = g.coordinates;
        const cls = (f.properties && f.properties.class) || 'overpass';
        classCount[cls] = (classCount[cls] || 0) + 1;
        handleLine(coords);
    }}
    console.log('IFROTA:DBG: features Overpass adicionadas: ' + _overpassFeats.length);
}}
```

**Reverter:** Apagar o bloco `if (typeof _overpassFeats ...)` inteiro.

---

## Cache local

**Arquivo:** `.cache/overpass_campus.json`
**Tamanho:** ~50-200 KB
**Vida útil:** Persiste entre execuções. Pra forçar refresh:
- Delete o arquivo manualmente, OU
- Chame `fetch_overpass_caminhos(bbox, force_refresh=True)` em algum lugar.

---

## Rollback completo

Pra voltar ao estado anterior à integração Overpass:

```python
# Opção 1 — desativa via flag (mais simples)
USE_OVERPASS = False

# Opção 2 — remove código completamente
# 1. Apaga constante USE_OVERPASS
# 2. Apaga função fetch_overpass_caminhos
# 3. Apaga 2 linhas de injeção overpass_features/overpass_js em gerar_mapa
# 4. Apaga constante _overpassFeats do template JS
# 5. Apaga bloco if (typeof _overpassFeats ...) em _construirRedeViaria
# 6. Apaga .cache/overpass_campus.json
```

Após reverter, o sistema volta a usar **apenas** `querySourceFeatures` (vector
tiles do OpenFreeMap), comportamento idêntico ao anterior à integração.

---

## Diferenças observáveis

Após a integração, o terminal deve mostrar:

```
[DBG] features Overpass adicionadas: 15-50  (typical for a campus)
[DBG] classes OSM no campus: {... + footway, pedestrian, service, etc}
[DBG] rede viária — 120-200 nós, 80-150/2000 segmentos no campus, ...
```

Antes mostrava apenas:
```
[DBG] classes OSM no campus: {minor: 45, tertiary: 14, ...}
[DBG] rede viária — 94 nós, 54/1606 segmentos no campus, ...
```

Mais nós/segmentos = mais opções de path, A* tende a encontrar rotas mais
próximas dos caminhos reais que você vê no mapa.
