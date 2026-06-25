// Cria os marcadores dos waypoints (círculo colorido com ícone + seta inferior).
// Substitui _addWaypointMarkers do IFrota.py.

const todosMarkers = [];
let _map = null;

// Ordena os marcadores por profundidade (painter's order): o que está mais
// EMBAIXO na tela está mais perto do observador → fica na FRENTE (z-index maior).
// O MapLibre não faz isso sozinho; sem isso os ícones se sobrepõem em ordem de DOM.
function atualizarOrdemZ() {
  if (!_map) return;
  todosMarkers.forEach((m) => {
    if (m._el.classList.contains("selected")) {
      m._el.style.zIndex = "10000";   // selecionado sempre no topo
      return;
    }
    const y = _map.project(m.getLngLat()).y;
    m._el.style.zIndex = String(Math.round(y) + 1000);  // +1000 evita negativos
  });
}

export function adicionarMarcadores(map, locais, { onClick } = {}) {
  _map = map;
  locais.forEach((local) => {
    const wrap = document.createElement("div");
    // Eventos usam estrela dourada (ponta pra baixo) com reluzência; demais, o
    // círculo+seta padrão.
    if (local.isEvento) {
      // Evento: mantém o círculo+ícone original (cor da categoria). A diferença
      // são 5 pontas DOURADAS (triângulos iguais ao conector de baixo) ao redor
      // do círculo, com reluzência. Uma das pontas aponta pra baixo (o conector).
      wrap.className = "wp-marker event";
      const angulos = [0, 72, 144, 216, 288];  // 5 pontas (0° = a de baixo, o conector)
      const spikes = angulos
        .map((a) => `<span class="wp-spike" style="transform:rotate(${a}deg)"></span>`)
        .join("");
      wrap.innerHTML = `
        <div class="wp-content">
          <div class="wp-spikes">${spikes}</div>
          <div class="wp-circle">
            <i class="fa fa-${local.icone}"></i>
          </div>
        </div>`;
    } else {
      wrap.className = "wp-marker";
      // Wrapper interno .wp-content recebe a animação de pulse, deixando
      // o .wp-marker externo livre pro MapLibre aplicar translate de posição.
      wrap.innerHTML = `
        <div class="wp-content">
          <div class="wp-circle" style="background:${local.cor_hex};">
            <i class="fa fa-${local.icone}"></i>
          </div>
          <div class="wp-arrow"></div>
        </div>`;
    }

    wrap.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick?.(local);
    });

    const m = new maplibregl.Marker({ element: wrap, anchor: "bottom" })
      .setLngLat([local.coords[1], local.coords[0]])
      .addTo(map);
    m._cat = local.cat;
    m._nome = local.nome;
    m._el = wrap;
    todosMarkers.push(m);
  });
  // Reordena por profundidade no load e sempre que a câmera muda (pan/zoom/rotate/pitch).
  atualizarOrdemZ();
  map.on("move", atualizarOrdemZ);
  return todosMarkers;
}

// Remove todos os marcadores do mapa (usado no refresh dinâmico após o admin
// criar/remover pontos ou eventos).
export function limparMarcadores() {
  todosMarkers.forEach((m) => m.remove());
  todosMarkers.length = 0;
}

export function selecionarMarcador(nome) {
  todosMarkers.forEach((m) => {
    m._el.classList.toggle("selected", m._nome === nome);
  });
  atualizarOrdemZ();
}

export function limparSelecao() {
  todosMarkers.forEach((m) => m._el.classList.remove("selected"));
  atualizarOrdemZ();
}

let _catAtual = "Tudo";
let _isolado = null;

function _aplicarFiltro() {
  todosMarkers.forEach((m) => {
    let mostra;
    if (_isolado !== null) mostra = m._nome === _isolado;
    else mostra = _catAtual === "Tudo" || m._cat === _catAtual;
    m._el.style.display = mostra ? "" : "none";
  });
}

export function filtrarPorCategoria(cat) {
  _catAtual = cat;
  _isolado = null;   // trocar filtro cancela o isolamento
  _aplicarFiltro();
}

// Durante uma rota ativa, mostra só o marcador do destino.
export function isolarDestino(nome) {
  _isolado = nome;
  _aplicarFiltro();
}

// Restaura a visibilidade conforme a categoria atual (fim da rota).
export function restaurarMarcadores() {
  _isolado = null;
  _aplicarFiltro();
}
