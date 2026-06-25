# Pathfinding — Análise técnica e aplicação ao IFrota

> Documento técnico cobrindo como Google Maps, Waze e outros sistemas de
> navegação modernos calculam e atualizam rotas em tempo real, com mapeamento
> direto pra arquitetura atual do IFrota.

---

## 1. Visão geral

Apps de navegação como **Waze**, **Google Maps** e **Apple Maps** combinam várias
técnicas pra resolver dois problemas fundamentais:

1. **Geração inicial da rota** — encontrar o melhor caminho entre A e B em um
   grafo de ruas com possivelmente bilhões de arestas, em milissegundos.
2. **Acompanhamento em tempo real** — saber onde o usuário está, se ele está
   seguindo a rota, e quando recalcular.

Os algoritmos clássicos (Dijkstra, A*) **não escalam** para mapas reais. Por isso
o estado-da-arte usa **estruturas pré-computadas** que aceleram a busca em ordens
de magnitude.

---

## 2. Algoritmos de pathfinding

### 2.1 Dijkstra — o tijolo fundamental

```
Para cada nó do grafo:
    distância[nó] = infinito
distância[origem] = 0
fila_prioridade = [origem]

Enquanto fila não vazia:
    atual = nó com menor distância
    Para cada vizinho:
        nova_dist = distância[atual] + peso_aresta
        Se nova_dist < distância[vizinho]:
            distância[vizinho] = nova_dist
            atualizar fila
```

- **Complexidade:** O((V + E) log V) com heap binário
- **Problema:** explora em todas as direções igualmente → lento em mapas grandes
- **Bom para:** grafos pequenos (< 10.000 nós), o que cabe perfeitamente no IFrota

### 2.2 A* — Dijkstra com heurística

Adiciona uma **estimativa do custo restante** até o destino (`h(n)`). Se a
heurística é **admissível** (nunca superestima), A* retorna caminho ótimo.

```
f(n) = g(n) + h(n)
       ^      ^
       custo  estimativa
       já     até o destino
       gasto  (haversine geralmente)
```

- **Heurística típica em mapas:** distância haversine ou euclidiana até o
  destino. Subestima sempre (linha reta ≤ qualquer caminho).
- **Quando usar:** grafos médios (10k–500k nós). É o que o **IFrota usa hoje**.

### 2.3 Contraction Hierarchies (CH) — o segredo do Google Maps

Pré-processa o grafo criando uma **hierarquia de "atalhos"**. Roads mais
importantes (autoestradas, avenidas) ficam em camadas superiores.

```
PRÉ-PROCESSAMENTO (uma vez):
    Para cada nó, calcula "importância" (degree, betweenness, etc.)
    Ordena nós da MENOS importante pra MAIS importante
    Para cada nó na ordem:
        Para cada par (vizinho_A, vizinho_B) por este nó:
            Se vai_pelo_nó é mais curto que vai_direto:
                Adiciona "atalho" A → B com peso = A → nó → B

CONSULTA (rápida):
    Busca bidirecional Dijkstra
    Mas só "sobe na hierarquia" — vai SEMPRE pra nós mais importantes
    Atalhos do pré-processamento aceleram cada salto
```

- **Speedup típico:** 1.000× a 10.000× sobre Dijkstra puro em grafos rodoviários
- **Custo:** pré-processamento demorado (horas para mapa-mundi), mas roda offline
- **Usado por:** OSRM (que IFrota chama opcionalmente), GraphHopper, todas
  grandes plataformas

### 2.4 Customizable Contraction Hierarchies (CCH)

Versão moderna do CH que separa **topologia** (estrutura) de **pesos**
(velocidades, tráfego). Permite recalcular rapidamente quando o tráfego muda.

```
1. Pré-processa topologia (offline, lento)
2. "Customiza" com pesos atuais (segundos)
3. Consulta com hierarquia (milissegundos)
```

**Esse é provavelmente o que Google Maps roda hoje** para suportar mudanças
constantes de tráfego sem recalcular tudo.

### 2.5 Hub Labeling — o mais rápido conhecido

Pré-computa para cada nó uma "label" com distâncias até nós-hub.

```
distância(u, v) = min(label[u].get(hub) + label[v].get(hub)
                       for hub in label[u] ∩ label[v])
```

- **Consulta:** apenas dezenas de microssegundos
- **Custo:** labels podem ocupar gigabytes
- **Usado em:** alguns sistemas de navegação especializados

### 2.6 Comparação prática

| Algoritmo | Pré-proc | Consulta | Memória | Caso ideal |
|---|---|---|---|---|
| Dijkstra | 0 | Lento | Mínima | Grafos < 10k nós |
| A\* | 0 | Médio | Mínima | Grafos < 500k nós |
| CH | Horas | ~1ms | Média | Mapa de cidade/estado |
| CCH | Horas | ~10ms | Média | + Tráfego dinâmico |
| Hub Labeling | Dias | ~50µs | GB | Roteamento de servidor |

---

## 3. Como Google Maps faz

### Stack confirmado pela engenharia da Google:

1. **Backend principal:** **CCH** (Customizable Contraction Hierarchies) sobre
   grafo OSM + dados proprietários
2. **Mapa do mundo dividido** em regiões. Cada região tem seu CH pré-processado.
3. **Servidores de borda** mantêm CH atualizado por região.
4. **Cliente envia (origem, destino, modo)** → servidor faz query CH → retorna
   geometria + turn-by-turn
5. **Trânsito dinâmico** entra via "weight customization" — atualiza pesos das
   arestas em segundos.

### Atualização durante a navegação:

```
Cada 1-2s o app envia: (lat, lon, accuracy, speed, bearing)
Servidor:
  1. Map matching: descobre em qual aresta do grafo o usuário está
  2. Compara progresso com rota planejada
  3. Se desvio > 100m ou usuário em rua diferente por > 10s → REROTA
  4. Recalcula CH-quick (não full A*)
  5. Devolve nova rota incremental
```

### Predição de trânsito:

Usa **históricos por hora/dia** + **dados real-time anônimos** dos próprios
usuários do Maps. Ajusta pesos das arestas conforme:
- Hora do dia
- Dia da semana
- Eventos próximos
- Padrões sazonais

---

## 4. Como Waze faz

Stack similar ao Google (CH-based), mas com diferenças importantes:

### Crowdsourcing pesado:

```
Cada usuário Waze ativo é um "sensor":
  - Posição GPS contínua (alimenta tráfego real)
  - Velocidade média no segmento (alimenta delays)
  - Reportes manuais (acidente, polícia, blitz, buraco)
  - Avaliação de rotas (estrelas pós-uso)
```

### Diferença fundamental:

Google otimiza pra **ETA real**. Waze otimiza pra **menor tempo absoluto** —
mesmo sacrificando rotas "previsíveis", levando o usuário por ruelas
desconhecidas mas mais rápidas naquele momento.

### Algoritmo de reroteamento Waze:

```
A cada 3s do GPS:
  1. Map match no grafo (HMM Viterbi)
  2. Verifica se há "evento" novo na rota planejada
     (acidente reportado, congestionamento detectado)
  3. Recalcula candidatos alternativos
  4. Se nova_rota tempo < rota_atual tempo - threshold:
       Sugere mudança
```

### Predição social:

Waze conhece **destinos típicos** do usuário (casa, trabalho, escola). Pré-calcula
rotas antes mesmo da pessoa pedir. Quando você abre o app de manhã, a rota pro
trabalho já está carregada.

---

## 5. Map Matching — alinhar GPS ao grafo

GPS é **ruidoso**. Erro típico:
- Céu aberto: 5–10m
- Cidade densa: 20–50m
- Túnel/garagem: > 100m ou perdido

### Problema:

Onde no grafo o usuário **realmente está**? Snap simples ao nó mais próximo
falha em ruas paralelas.

### Solução: Hidden Markov Model (HMM)

Trata o problema como inferência probabilística:

```
Estados ocultos = arestas possíveis em que o usuário está
Observações = posições GPS lidas

P(aresta | gps) ∝ P(gps | aresta) · P(aresta | aresta_anterior)
                  ^                     ^
                  probabilidade         transição
                  emissão               (caminhos válidos no grafo)
                  (distância)
```

### Algoritmo de Viterbi:

Para cada nova leitura GPS, calcula a sequência MAIS PROVÁVEL de arestas
considerando o histórico.

```python
# Pseudocódigo simplificado
def map_match(gps_pontos, grafo):
    estados_atuais = arestas_candidatas(gps_pontos[0])
    probs = {e: prob_emissao(e, gps_pontos[0]) for e in estados_atuais}
    historico = {e: [e] for e in estados_atuais}
    
    for ponto in gps_pontos[1:]:
        novos_estados = arestas_candidatas(ponto)
        novas_probs = {}
        novo_hist = {}
        for e_novo in novos_estados:
            melhor_prob = 0
            melhor_anterior = None
            for e_velho in estados_atuais:
                p = probs[e_velho] \
                  * prob_transicao(e_velho, e_novo, grafo) \
                  * prob_emissao(e_novo, ponto)
                if p > melhor_prob:
                    melhor_prob = p
                    melhor_anterior = e_velho
            novas_probs[e_novo] = melhor_prob
            novo_hist[e_novo] = historico[melhor_anterior] + [e_novo]
        probs = novas_probs
        historico = novo_hist
        estados_atuais = novos_estados
    
    melhor_final = max(probs, key=probs.get)
    return historico[melhor_final]
```

Onde:
- `prob_emissao(e, gps)` = gaussiana decrescente com a distância do gps ao centro
  da aresta `e`
- `prob_transicao(e_velho, e_novo)` = 1 se há caminho válido entre `e_velho` e
  `e_novo` no grafo (e penalizado pela distância do caminho), 0 caso contrário

### Vantagens HMM sobre snap simples:

| Caso | Snap nearest | HMM |
|---|---|---|
| Ruas paralelas próximas | Pula entre elas | Mantém na correta |
| Curva fechada | Snap no nó errado | Detecta a curva |
| GPS spike (erro grande) | Vai pro erro | Ignora outlier |

---

## 6. Detecção de "off-route" e reroteamento

### Quando recalcular?

Heurísticas que apps usam:

```
SE distância(gps, polilinha_da_rota) > THRESHOLD:
    Se isso acontecer por N leituras consecutivas (ex: 3-5):
        → REROTA

OU:

Se map matcher coloca o usuário em uma aresta que não estava no plano:
    Aguarda 2 leituras pra confirmar (evitar reroute em falsos positivos)
    → REROTA
```

### Threshold típico:

- **Walking (pedestre):** 15–30m
- **Carro:** 50–100m  
- **Bike:** 20–40m

### Estratégia de reroute "incremental":

Em vez de recalcular tudo, alguns sistemas:

```
1. Encontra nó da rota atual mais próximo do GPS
2. Vê se há atalho desse nó até continuar na rota original
3. Se há, anexa o atalho; se não, calcula rota completa do GPS atual ao destino
```

Isso evita recálculo completo quando o usuário fez só um pequeno desvio.

### Penalização de rotas alternativas:

Pra evitar oscilação ("agora vá direita, agora reto, agora esquerda"), apps
adicionam **resistência**:

```
custo_nova_rota_proposta += PENALIDADE_MUDANÇA

Só re-rota se: nova_rota.tempo < rota_atual.tempo - 30s (carro)
                                                   - 10s (pedestre)
```

---

## 7. Acompanhamento durante a navegação

### Pipeline real-time:

```
GPS chip → Sensor fusion (acelerômetro/giro) → Filtro Kalman
                                                       ↓
                                            posição estimada
                                                       ↓
                                            Map matching (HMM)
                                                       ↓
                                            aresta atual + offset
                                                       ↓
                                    Comparação com rota planejada
                                          ↓                ↓
                                  ainda na rota?    saiu da rota?
                                       ↓                 ↓
                              recalcula ETA      decisão de rerotear
                                                       ↓
                                            Reroute (CH/A*) se decisão = sim
```

### Sensor Fusion + Kalman:

Apps modernos não usam só o GPS. Combinam:

- **GPS**: posição absoluta (preciso ~10m)
- **Acelerômetro**: detecta paradas, partidas, curvas
- **Giroscópio**: rotação do dispositivo
- **Magnetômetro**: bússola
- **WiFi**: triangulação em áreas urbanas
- **Bluetooth beacons**: alta precisão indoor

O **filtro de Kalman** combina essas fontes pesando cada uma pela sua
confiabilidade momentânea. Quando GPS some (túnel), usa
"dead reckoning" baseado em velocidade × tempo + aceleração.

### Frequência de updates:

| Componente | Frequência |
|---|---|
| GPS raw | 1 Hz (1s) |
| Sensor fusion | 10–30 Hz |
| Map matching | 1 Hz |
| Reroute check | 1 Hz |
| ETA recompute | 0.2–1 Hz |
| Voz de instrução | em eventos (curvas, etc.) |

---

## 8. ETA dinâmica

Tempo estimado de chegada não é só `distância / velocidade`. Apps levam em conta:

```
ETA = Σ (comprimento_aresta_i / velocidade_aresta_i_no_horário_X)
       i ∈ rota

velocidade_aresta = histórico_médio_no_horário × fator_tempo_real
fator_tempo_real = velocidade_atual_medida / velocidade_históriaca
```

### Para pedestres:

- Velocidade média base: **1.4 m/s** (5 km/h) — IFrota usa isso
- Ajustes:
  - Subida: -20% (~1.1 m/s)
  - Descida: +10% (~1.55 m/s)  
  - Escadas: -50%
  - Multidão: -30%
  - Calor extremo: -10%

Google Walking Maps usa um modelo combinando inclinação + densidade urbana
+ velocidade observada de outros pedestres.

---

## 9. Aplicação ao IFrota — recomendações

Estado atual do IFrota (em ordem de implementação):

- ✅ A* puro em JS sobre rede viária do MapLibre
- ✅ Filtro polygonal do campus
- ✅ Bridge de componentes desconectados (arestas virtuais)
- ✅ Snap perpendicular (injeção de nó virtual)
- ✅ ETA = `distância / 1.4 / 60` (1.4 m/s)
- ❌ Map matching
- ❌ Reroute em tempo real
- ❌ Sensor fusion

### Recomendações por prioridade

#### 🟢 Fácil — alto impacto

**1. Live tracking básico**

Mostra o ponto azul do usuário se movendo. Já temos o `mostrarUsuario(lat, lon)`.
Bastaria:
- Pegar posição via `QGeoPositionInfoSource` continuamente (não só sob demanda)
- Atualizar `mostrarUsuario` a cada nova leitura

```python
self._geo_source.setUpdateInterval(2000)
self._geo_source.startUpdates()  # contínuo, não requestUpdate
```

**2. Detecção simples de off-route**

```python
def on_position_update(self, info):
    lat, lon = info.coordinate().latitude(), info.coordinate().longitude()
    self._run_js(f"mostrarUsuario({lat}, {lon}, 0);")
    if self._current_route:
        d = distancia_ao_polyline(lat, lon, self._current_route)
        if d > 30:  # 30m off-route
            self._off_count += 1
            if self._off_count > 3:
                # Recalcula rota do ponto atual
                self._on_nav()  # recalcula
                self._off_count = 0
        else:
            self._off_count = 0
```

**3. ETA dinâmico**

A cada update GPS, mede progresso na rota e atualiza `route_banner` com:
```
ETA = tempo_restante_no_segmento_atual + Σ tempo_segmentos_futuros
```

#### 🟡 Médio — bom impacto

**4. Snap visual do usuário ao caminho**

Em vez de mostrar o ponto azul no GPS raw (que tremula), faz snap perpendicular
ao caminho da rota. Visualmente o ponto "desliza" pela rota.

```js
function _snapUsuarioParaRota() {
    if (!_currentRoute || !_userMarker) return;
    const ll = _userMarker.getLngLat();
    let melhor = null;
    let menorDist = Infinity;
    for (let i = 0; i < _currentRoute.length - 1; i++) {
        const a = _currentRoute[i], b = _currentRoute[i+1];
        const [d, ponto, t] = _distPontoSegmento(ll.lat, ll.lng, a, b);
        if (d < menorDist) { menorDist = d; melhor = ponto; }
    }
    if (melhor && menorDist < 20) {
        _userMarker.setLngLat([melhor[1], melhor[0]]);
    }
}
```

**5. Map matching simples**

HMM completo é overkill. Mas pode-se implementar uma versão simplificada:
- Em vez de snap geometric simples, escolher entre as 3 arestas mais próximas
  a que MELHOR se conecta à anterior (continuidade)

```js
function _mapMatchSimples(lat, lon, ultimaAresta) {
    const candidatas = arestasNoRaio(lat, lon, 50);
    let melhor = null, melhorScore = -Infinity;
    for (const aresta of candidatas) {
        const dGeom = distanciaAresta(lat, lon, aresta);
        const dTopo = ultimaAresta 
            ? distanciaTopologica(ultimaAresta, aresta) 
            : 0;
        const score = -dGeom - dTopo * 10;
        if (score > melhorScore) { melhorScore = score; melhor = aresta; }
    }
    return melhor;
}
```

#### 🔴 Avançado — pra produção

**6. Filtro Kalman 1D pra suavizar GPS**

Reduz tremulação visual.

```python
class GPSKalman:
    def __init__(self, R=10.0, Q=1.0):  
        self.R = R  # incerteza GPS
        self.Q = Q  # incerteza do modelo
        self.x = None
        self.P = 1.0
    
    def update(self, z):  # z = nova leitura
        if self.x is None:
            self.x = z
            return self.x
        # Predição
        self.P += self.Q
        # Atualização
        K = self.P / (self.P + self.R)
        self.x = self.x + K * (z - self.x)
        self.P = (1 - K) * self.P
        return self.x
```

Aplicar separadamente em lat e lon.

**7. Reroute incremental**

Em vez de calcular do GPS atual ao destino completo:
1. Vê se há aresta da rota original a < 50m do GPS atual
2. Se sim, calcula só do GPS → essa aresta → continua rota original
3. Senão, A* completo

**8. Turn-by-turn**

Análise dos ângulos de virada na polyline pra detectar:
- "Vire à direita em 50m"
- "Continue reto"
- "Em 20m, vire à esquerda"

Pode anunciar via QSpeech (text-to-speech do Qt) ou só mostrar no banner.

---

## 10. Roadmap sugerido pro IFrota

### Sprint 1 — Navigation MVP (3-4h)

- [ ] Live tracking contínuo do GPS
- [ ] Detecção off-route com threshold de 30m
- [ ] Reroute automático após 3 leituras off-route consecutivas
- [ ] ETA dinâmico atualizado a cada GPS update

### Sprint 2 — Suavização (2h)

- [ ] Filtro Kalman 1D em lat/lon
- [ ] Snap visual do user-dot ao polyline da rota
- [ ] Smoothing das transições de marcador

### Sprint 3 — Turn-by-turn (4h)

- [ ] Análise da polyline → instruções discretas
- [ ] Banner dinâmico mostrando próxima instrução
- [ ] Opcional: voz via QSpeech

### Backlog

- Map matching com HMM (simplificado)
- Sensor fusion com QSensors (acelerômetro)
- Múltiplas rotas alternativas (Yen's K-shortest paths)

---

## 11. Referências

### Algoritmos
- **Dijkstra (1959):** "A note on two problems in connexion with graphs"
- **A\* (1968):** Hart, Nilsson, Raphael — "A Formal Basis for the Heuristic
  Determination of Minimum Cost Paths"
- **Contraction Hierarchies (2008):** Geisberger et al. — "Contraction
  Hierarchies: Faster and Simpler Hierarchical Routing in Road Networks"
- **CCH (2017):** Dibbelt, Strasser, Wagner — "Customizable Contraction
  Hierarchies"
- **Hub Labels (2011):** Abraham et al. — "A Hub-Based Labeling Algorithm for
  Shortest Paths in Road Networks"

### Map Matching
- **HMM Map Matching (2009):** Newson, Krumm — "Hidden Markov Map Matching
  Through Noise and Sparseness"
- **Viterbi (1967):** Original do algoritmo, adaptado para HMM por Forney (1973)

### Implementações open source
- **OSRM:** [project-osrm.org](http://project-osrm.org) — implementa CH em C++
- **GraphHopper:** [graphhopper.com](https://www.graphhopper.com) — Java, CH e
  CCH
- **Valhalla:** [valhalla.github.io](https://valhalla.github.io) — Mapbox,
  routing modal
- **Barefoot:** [github.com/bmwcarit/barefoot](https://github.com/bmwcarit/barefoot)
  — map matching HMM da BMW, em Java

### Posts técnicos relevantes
- [Engineering at Meta — Routing](https://engineering.fb.com/category/data-infrastructure/)
- [Google Research blog — Maps](https://research.google/blog/?categories=software-engineering)
- [Anatomia do OSRM — gisellestphn](https://gisellestphn.medium.com/)
