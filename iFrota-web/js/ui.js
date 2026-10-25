// Controlador da UI shell — header, search, side panel, bottom sheet, toast.
// Recebe callbacks de domínio (onNav, onThemeChange, onLocate, onSetPos...).
// Os editores do admin (pontos/eventos/prédios/cardápio) vivem no ui-admin.js.
import { store } from "./store.js";
import { COR_HEX } from "./config.js";
import { initAdminUI } from "./ui-admin.js";
import { selecionarMarcador, limparSelecao, filtrarPorCategoria } from "./markers.js";
import { haversine, formatarDistancia } from "./geo.js";
import { HORARIOS_PADRAO, eventoAtivoHoje, eventoAtivoAgora, agoraReal, eventoAtivoNoContainer, formatarJanela } from "./eventos.js";
import { somPonto, sonsAtivos, setSons } from "./sons.js";
// Backend de fotos: LOCAL (IndexedDB + login local). Pra usar o Firebase (nuvem),
// veja docs/IMPLEMENTACAO-FUTURA-FIREBASE.md.
import { fotosAtivo, registrar, login, logout, onAuth, ehAdmin, listarFotos, enviarFoto, removerFoto } from "./fotos-store.js";

// Categorias (espelha CATEGORIAS do IFrota.py) com ícone FA por categoria
const CATEGORIAS = [
  ["Tudo",           null,      "fa-th-large"],
  ["Ensino",         "#428bca", "fa-graduation-cap"],
  ["Administrativo", "#d9534f", "fa-briefcase"],
  ["Agropecuária",   "#5cb85c", "fa-leaf"],
  ["Acessos",        "#8bc34a", "fa-road"],
  ["Convivência",    "#436978", "fa-coffee"],
  ["Esporte",        "#2e7d32", "fa-futbol-o"],
];

// COR_HEX vem do config.js (mesma paleta usada por eventos.js e ui-admin.js).

const $ = (id) => document.getElementById(id);

export function initUI({ locais, baseEventos = [], callbacks }) {
  const cb = callbacks || {};
  let currentLocal = null;
  let toastTimer = null;
  let catAtiva = "Tudo";
  let isAdmin = false;   // admin logado (Firebase) — libera upload/delete de fotos

  // ── elementos ──
  const dim = $("dim");
  const sidePanel = $("side-panel");
  const card = $("bottom-card");
  const results = $("results-panel");
  const searchInput = $("search-input");

  // ── TEMA ──
  function refreshThemeIcon() {
    const dark = document.body.classList.contains("dark");
    $("btn-theme").innerHTML = dark
      ? '<i class="fa fa-sun-o"></i>'
      : '<i class="fa fa-moon-o"></i>';
  }
  $("btn-theme").onclick = () => {
    const dark = !document.body.classList.contains("dark");
    document.body.classList.toggle("dark", dark);
    store.setDark(dark);
    refreshThemeIcon();
    cb.onThemeChange?.(dark);
  };
  refreshThemeIcon();

  // ── SOM (feedback sonoro sutil — liga/desliga) ──
  function refreshSomIcon() {
    $("btn-som").innerHTML = sonsAtivos()
      ? '<i class="fa fa-volume-up"></i>'
      : '<i class="fa fa-volume-off"></i>';
  }
  $("btn-som").onclick = () => {
    const on = !sonsAtivos();
    setSons(on);
    refreshSomIcon();
    if (on) somPonto();   // confirma e libera o áudio neste gesto
  };
  refreshSomIcon();

  // ── SIDE PANEL ──
  function openPanel() {
    esconderEventos();   // não deixa o popup de eventos sobrepor o painel
    sidePanel.classList.add("open"); dim.classList.add("show");
  }
  function closePanel() { sidePanel.classList.remove("open"); dim.classList.remove("show"); }
  $("btn-menu").onclick = openPanel;
  dim.onclick = () => { closePanel(); closeCard(); };

  $("pb-locate").onclick = () => { closePanel(); cb.onLocate?.(); };
  $("pb-setpos").onclick = () => { closePanel(); cb.onSetPos?.(); };

  // ── CONTA / LOGIN (backend de fotos local — sempre disponível) ──
  const loginModal = $("login-modal");
  let modoCadastro = false;
  if (fotosAtivo()) {
    $("admin-section").style.display = "";
    onAuth((user) => {
      isAdmin = !!user;
      $("pb-login").style.display = user ? "none" : "";
      $("admin-logado").style.display = user ? "" : "none";
      $("admin-email").textContent = user ? (user.email || "") : "";
      $("gal-admin").style.display = user ? "" : "none";
      const admin = ehAdmin();
      $("admin-gestao").style.display = admin ? "" : "none";  // gestão só p/ admin
      const badge = $("admin-badge");
      badge.textContent = admin ? "Administrador" : "Usuário";
      badge.classList.toggle("admin", admin);
      renderGaleria();  // mostra/esconde botão de delete conforme o login
    });
  }
  function setModoCadastro(v) {
    modoCadastro = v;
    $("login-title").textContent = v ? "Criar conta" : "Entrar";
    $("login-submit").textContent = v ? "Cadastrar" : "Entrar";
    $("login-toggle").textContent = v ? "Já tenho conta" : "Criar conta";
    $("login-erro").textContent = "";
  }
  $("pb-login").onclick = () => {
    closePanel();
    $("login-email").value = ""; $("login-senha").value = "";
    setModoCadastro(false);
    loginModal.classList.add("open");
    $("login-email").focus();
  };
  $("login-close").onclick = () => loginModal.classList.remove("open");
  $("login-toggle").onclick = () => setModoCadastro(!modoCadastro);
  loginModal.addEventListener("click", (e) => { if (e.target === loginModal) loginModal.classList.remove("open"); });
  $("pb-logout").onclick = async () => { closePanel(); await logout(); showToast("Sessão encerrada"); };
  async function submitLogin() {
    const email = $("login-email").value.trim();
    const senha = $("login-senha").value;
    if (!email || !senha) { $("login-erro").textContent = "Preencha e-mail e senha."; return; }
    const btn = $("login-submit"); const txt = btn.textContent;
    btn.disabled = true; btn.textContent = "...";
    try {
      if (modoCadastro) { await registrar(email, senha); showToast("✓ Conta criada"); }
      else { await login(email, senha); showToast("✓ Bem-vindo"); }
      loginModal.classList.remove("open");
    } catch (err) {
      $("login-erro").textContent = err.message || "Erro ao entrar.";
    } finally {
      btn.disabled = false; btn.textContent = txt;
    }
  }
  $("login-submit").onclick = submitLogin;
  $("login-senha").addEventListener("keydown", (e) => { if (e.key === "Enter") submitLogin(); });

  // ── GESTÃO ADMIN (pontos, eventos, prédios, cardápio, gerenciar, backup) ──
  // Vive em módulo próprio (ui-admin.js); devolve os editores usados pelo card.
  const admin = initAdminUI({ locais, baseEventos, cb, closePanel, showToast });

  // ── EVENTOS (lista lateral, horizonte 31 dias) ──
  // entries: [{ ev, local }]. Clicar direciona pro evento (sem popup).
  function setEventosSidebar(entries) {
    const lista = entries || [];
    const wrap = $("eventos-list");
    const section = $("eventos-section");
    section.style.display = lista.length ? "" : "none";
    wrap.innerHTML = "";
    lista.forEach(({ ev, local, salaPath }) => {
      const item = document.createElement("button");
      item.className = "evento-item";
      const quando = ev._quando || "";
      const janela = formatarJanela(ev);   // duração (ex.: 20:15–22:00)
      // eventos de sala mostram onde (Prédio · Sala)
      const onde = ev._sala && local ? `${local.nome} · ${ev._sala}` : "";
      const sub = [quando, janela, onde].filter(Boolean).join(" · ");
      item.innerHTML =
        `<span class="evento-ico"><i class="fa fa-${(local && local.icone) || ev.icone || "star"}"></i></span>` +
        `<span class="evento-txt"><span class="evento-nome">${ev.nome}</span>` +
        (sub ? `<span class="evento-quando">${sub}</span>` : "") + `</span>`;
      item.onclick = () => {
        closePanel();
        if (local) { cb.onSelectResult?.(local); openCard(local, salaPath ? { salaPath } : {}); }
      };
      wrap.appendChild(item);
    });
  }

  // ── CATEGORIAS ──
  const catList = $("cat-list");
  CATEGORIAS.forEach(([nome, cor, icon]) => {
    const btn = document.createElement("button");
    btn.className = "cat-btn" + (nome === "Tudo" ? " active" : "");
    btn.innerHTML = cor
      ? `<span class="swatch" style="background:${cor}"></span>${nome}`
      : `<span class="ico"><i class="fa ${icon}"></i></span>${nome}`;
    btn.onclick = () => {
      catAtiva = nome;
      catList.querySelectorAll(".cat-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      filtrarPorCategoria(nome);
    };
    catList.appendChild(btn);
  });

  // ── FAVORITOS ──
  function renderFavoritos() {
    const wrap = $("fav-list");
    wrap.innerHTML = "";
    const favs = store.getFavoritos();
    if (!favs.length) {
      const e = document.createElement("div");
      e.className = "fav-empty";
      e.textContent = "Nenhum favorito ainda";
      wrap.appendChild(e);
      return;
    }
    favs.forEach((nome) => {
      const local = locais.find((l) => l.nome === nome);
      if (!local) return;
      const hex = local.cor_hex || COR_HEX[local.cor] || "#5cb85c";
      const item = document.createElement("button");
      item.className = "fav-item";
      item.innerHTML =
        `<span class="fav-ico" style="background:${hex}"><i class="fa fa-${local.icone || "map-marker"}"></i></span>` +
        `<span class="fav-nome">${local.nome}</span>` +
        `<span class="fav-star"><i class="fa fa-star"></i></span>`;
      item.onclick = () => {
        closePanel();
        cb.onSelectResult?.(local);
        openCard(local);
      };
      wrap.appendChild(item);
    });
  }
  renderFavoritos();

  // ── CARDÁPIO SEMANAL (refeitório) ──
  const DIAS_CARD = [["seg", "Segunda"], ["ter", "Terça"], ["qua", "Quarta"], ["qui", "Quinta"], ["sex", "Sexta"]];
  const ddmm = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  function parseData(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const reVeg = /^\s*(op(ç|c)[aã]o\s+vegetariana|vegetariano)\s*:\s*/i;
  function popularCardapio(card) {
    const sec = $("card-cardapio-sec"), wrap = $("cardapio");
    if (!card || !card.dias) { sec.style.display = "none"; return; }
    sec.style.display = ""; wrap.innerHTML = "";

    const ini = parseData(card.inicio), fim = parseData(card.fim);
    const ag = agoraReal();
    const hoje = new Date(ag); hoje.setHours(0, 0, 0, 0);
    const nowMin = ag.getHours() * 60 + ag.getMinutes();
    const naSemana = !!(ini && fim && hoje.getTime() >= ini.getTime() && hoje.getTime() <= fim.getTime());
    const vencido = !!(fim && hoje.getTime() > fim.getTime());

    const head = document.createElement("div"); head.className = "cardapio-head";
    let htm = "";
    if (vencido) htm += `<div class="cardapio-aviso"><i class="fa fa-exclamation-triangle"></i> Cardápio desatualizado — semana de ${ddmm(ini)} a ${ddmm(fim)} já passou.</div>`;
    if (ini && fim) htm += `<div class="cardapio-semana"><i class="fa fa-calendar-o"></i> Semana de ${ddmm(ini)} a ${ddmm(fim)}</div>`;
    if (card.refeicoes && card.refeicoes.length)
      htm += `<div class="cardapio-refeicoes">${card.refeicoes.map(([n, h]) => {
        const m = /(\d{1,2}):(\d{2}).*?(\d{1,2}):(\d{2})/.exec(h);
        const aberto = naSemana && m && nowMin >= (+m[1]) * 60 + (+m[2]) && nowMin < (+m[3]) * 60 + (+m[4]);
        return `<span class="${aberto ? "aberto" : ""}"><b>${n}</b> · ${h}${aberto ? ' <em>· aberto agora</em>' : ""}</span>`;
      }).join("")}</div>`;
    head.innerHTML = htm; if (htm) wrap.appendChild(head);

    const hojeKey = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][hoje.getDay()];
    let openIdx = 0;   // padrão: segunda
    if (ini && fim && hoje.getTime() >= ini.getTime() && hoje.getTime() <= fim.getTime()) {
      const di = DIAS_CARD.findIndex(([k]) => k === hojeKey);
      if (di >= 0) openIdx = di;
    }

    DIAS_CARD.forEach(([key, label], i) => {
      const itens = card.dias[key] || [];
      const data = ini ? new Date(ini) : null; if (data) data.setDate(ini.getDate() + i);
      const ehHoje = !!(data && data.getTime() === hoje.getTime());
      const row = document.createElement("div");
      row.className = "day-acc" + (ehHoje ? " today" : "");
      const hb = document.createElement("button"); hb.className = "day-head";
      hb.innerHTML =
        `<span class="day-label">${ehHoje ? "HOJE" : label}<span class="day-date">${data ? ddmm(data) : ""}</span></span>` +
        `<span class="day-sum">${itens.length ? `${itens.length} itens` : "—"}</span>` +
        `<span class="day-chevron"><i class="fa fa-chevron-down"></i></span>`;
      const body = document.createElement("div"); body.className = "day-body";
      if (!itens.length) body.innerHTML = '<div class="day-empty">Sem cardápio neste dia</div>';
      else itens.forEach((it, idx) => {
        const veg = reVeg.test(it);
        const el = document.createElement("div");
        el.className = "cardapio-item" + (idx === 0 && !veg ? " principal" : "") + (veg ? " veg" : "");
        el.innerHTML = veg ? `<i class="fa fa-leaf"></i> ${it.replace(reVeg, "")}` : it;
        body.appendChild(el);
      });
      hb.onclick = () => row.classList.toggle("open");
      if (i === openIdx) row.classList.add("open");
      row.appendChild(hb); row.appendChild(body);
      wrap.appendChild(row);
    });
    if (card.obs) {
      const obs = document.createElement("div"); obs.className = "cardapio-obs"; obs.textContent = card.obs;
      wrap.appendChild(obs);
    }
  }

  // ── NAVEGADOR DE ANDARES/SALAS (prédios e blocos) ──
  // Um ponto é "container" quando tem `salas` (bloco, 1 nível) ou `andares`
  // (prédio: andares → salas). Cada sala é um mini-ponto com tipo/desc/agenda/fotos.
  const ICONES_SALA = {
    "Sala": "users", "Laboratório": "flask", "Banheiro": "tint",
    "Administração": "briefcase", "Auditório": "bullhorn", "Biblioteca": "book",
    "Coordenação": "id-badge",
  };
  const COR_SALA = {
    "Sala": "#428bca", "Laboratório": "#9B479F", "Banheiro": "#436978",
    "Administração": "#d9534f", "Auditório": "#e6b422", "Biblioteca": "#2e7d32",
    "Coordenação": "#a23336",
  };
  const DOW_KEY = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
  function ehContainer(l) { return !!(l && (Array.isArray(l.andares) || Array.isArray(l.salas))); }
  function salaTemHoje(sala) {
    const itens = sala.agenda && sala.agenda[DOW_KEY[agoraReal().getDay()]];
    return Array.isArray(itens) && itens.length > 0;
  }
  // Há programação semanal real? (algum dia com itens). Banheiros/instalações sem
  // horário ficam vazios — não mostramos a grade só com "vago".
  function temAgenda(ag) {
    return !!ag && Object.keys(ag).some((k) => Array.isArray(ag[k]) && ag[k].length);
  }
  // Status de disponibilidade (interdição / obra). Vale p/ ponto OU sala.
  function renderStatus(obj) {
    const el = $("card-status");
    const interdito = !!(obj && obj.disponivel === false);
    card.classList.toggle("interdito", interdito);
    if (!interdito) { el.style.display = "none"; el.innerHTML = ""; return; }
    el.style.display = "";
    const motivo = (obj.motivo || "").trim();
    el.innerHTML = `<i class="fa fa-exclamation-triangle"></i> <span><b>Interditado</b>${motivo ? " · " + motivo : ""}</span>`;
  }
  // Partes DEPENDENTES DO TEMPO (cardápio + agenda + status) — re-renderizáveis ao vivo.
  function renderTempoDe(obj) {
    const ehRef = obj.tipo === "refeitorio";
    // cardápio é EXCLUSIVO da classe "refeitorio" (como prédio/bloco têm a sua)
    popularCardapio(ehRef ? obj.cardapio : null);
    let ag = obj.agenda;
    if (obj.evento) ag = { ...(obj.agenda || {}), ...(obj.evento.horarios || {}) };
    // Agenda só quando há programação/evento. Refeitório não mostra (o cardápio já
    // cumpre essa função); instalações sem horário (banheiros) também ficam sem grade.
    const aSec = $("card-agenda-sec");
    const temProg = !ehRef && (!!obj.evento || temAgenda(ag));
    if (temProg) { aSec.style.display = ""; popularAgenda(ag, obj.evento); }
    else { aSec.style.display = "none"; $("agenda").innerHTML = ""; }
    renderStatus(obj);
  }
  // Conteúdo completo de um objeto (ponto OU sala): tempo + galeria.
  function exibirConteudo(obj) {
    renderTempoDe(obj);
    popularGaleria(obj.fotos, obj.nome);
  }
  // Atualiza o card ABERTO em tempo real (chrome + cardápio + agenda), sem mexer
  // na galeria (evitar re-fetch e resetar a foto que o usuário está vendo).
  function atualizarCardAoVivo() {
    if (!currentLocal || !card.classList.contains("open")) return;
    const local = currentLocal;
    const ehEvento = ehContainer(local)
      ? eventoAtivoNoContainer(local)
      : !!(local.evento && eventoAtivoAgora(local.evento));
    $("card-icon").style.background = ehEvento
      ? "linear-gradient(150deg, #ffe27a, #ffc107 45%, #d4a017)"
      : (local.cor_hex || COR_HEX[local.cor] || "#5cb85c");
    card.classList.toggle("event", ehEvento);
    $("card-evento-badge").style.display = ehEvento ? "" : "none";
    if (ehContainer(local)) cnRender(true);   // preserva cnPath; re-avalia tudo
    else renderTempoDe(local);
  }

  let cnLocal = null, cnPath = [];
  function abrirNavegador(local, alvoPath) {
    cnLocal = local; cnPath = Array.isArray(alvoPath) ? alvoPath.slice() : [];
    $("card-niveis").style.display = "";
    cnRender();
  }
  function cnNode() {
    const l = cnLocal;
    if (l.andares) {
      if (cnPath.length === 0) return { nivel: "andares", itens: l.andares };
      const andar = l.andares[cnPath[0]] || {};
      if (cnPath.length === 1) return { nivel: "salas", itens: andar.salas || [] };
      return { nivel: "sala", sala: (andar.salas || [])[cnPath[1]] || {} };
    }
    if (cnPath.length === 0) return { nivel: "salas", itens: l.salas || [] };
    return { nivel: "sala", sala: (l.salas || [])[cnPath[0]] || {} };
  }
  // Reposiciona a galeria: logo APÓS o navegador de andares/salas (fachada do
  // prédio/bloco, abaixo da seleção) ou no fim (galeria normal de sala/ponto).
  // No-op se já está na posição.
  function galeriaNoTopo(aposNiveis) {
    const exp = $("card-expanded"), g = $("card-galeria-sec"), niveis = $("card-niveis");
    if (aposNiveis) { if (niveis.nextElementSibling !== g) exp.insertBefore(g, niveis.nextSibling); }
    else { if (exp.lastChild !== g) exp.appendChild(g); }
  }
  function cnRender(semGaleria) {
    const node = cnNode();
    cnRenderCrumb();
    const lista = $("cn-lista"), label = $("cn-label");
    const aSec = $("card-agenda-sec"), gSec = $("card-galeria-sec"), cSec = $("card-cardapio-sec");
    if (node.nivel === "sala") {
      lista.style.display = "none"; lista.innerHTML = ""; label.style.display = "none";
      galeriaNoTopo(false);   // galeria da sala fica no lugar normal (fim)
      aSec.style.display = ""; gSec.style.display = "";
      if (semGaleria) renderTempoDe(node.sala); else exibirConteudo(node.sala);
    } else {
      lista.style.display = ""; label.style.display = "";
      label.textContent = node.nivel === "andares" ? "ANDARES" : "SALAS";
      aSec.style.display = "none"; cSec.style.display = "none";
      renderStatus(cnLocal);   // interdição do prédio/bloco inteiro (se houver)
      // Galeria da FACHADA do prédio/bloco — só no nível principal do navegador.
      const noTopo = cnPath.length === 0;
      const temFotos = noTopo && Array.isArray(cnLocal.fotos) && cnLocal.fotos.length > 0;
      galeriaNoTopo(temFotos);   // fachada do prédio/bloco vai pro TOPO do card
      gSec.style.display = temFotos ? "" : "none";
      if (temFotos && !semGaleria) popularGaleria(cnLocal.fotos, cnLocal.nome);
      cnRenderLista(node);
    }
  }
  function cnItemRow({ ico, badge, cor, nome, sub, evento, interd }) {
    const row = document.createElement("button");
    row.className = "cn-item" + (evento ? " evento" : "") + (interd ? " interdito" : "");
    // evento ativo → ícone dourado (sobrepõe a cor do tipo)
    const bg = evento ? "linear-gradient(150deg,#ffe27a,#ffc107 45%,#d4a017)" : (cor || "var(--panel-tit)");
    const ic = badge != null
      ? `<span class="cn-ico badge"${evento ? ` style="background:${bg}"` : ""}>${badge}</span>`
      : `<span class="cn-ico" style="background:${bg}"><i class="fa fa-${ico}"></i></span>`;
    row.innerHTML = ic +
      `<span class="cn-txt"><span class="cn-nome">${nome}${evento ? ' <i class="fa fa-star cn-star"></i>' : ""}</span>` +
      (sub ? `<span class="cn-sub">${sub}</span>` : "") + "</span>" +
      `<span class="cn-chevron"><i class="fa fa-chevron-right"></i></span>`;
    return row;
  }
  function cnRenderLista(node) {
    const lista = $("cn-lista"); lista.innerHTML = "";
    if (node.nivel === "andares") {
      node.itens.forEach((andar, i) => {
        const n = (andar.salas || []).length;
        // andar fica dourado se contém alguma sala com evento ativo agora
        const ev = (andar.salas || []).some((s) => s.evento && eventoAtivoAgora(s.evento));
        const row = cnItemRow({
          badge: i === 0 ? "T" : `${i}º`, nome: andar.nome,
          sub: ev ? "evento acontecendo agora" : `${n} ${n === 1 ? "espaço" : "espaços"}`, evento: ev,
        });
        row.onclick = () => { cnPath = [i]; cnRender(); };
        lista.appendChild(row);
      });
    } else {
      node.itens.forEach((sala, i) => {
        const tp = sala.tipo || "Sala";
        const interd = sala.disponivel === false;
        const ev = !interd && !!(sala.evento && eventoAtivoAgora(sala.evento));
        const motivo = (sala.motivo || "").trim();
        let sub;
        if (interd) sub = motivo ? `${tp} · interditado · ${motivo}` : `${tp} · interditado`;
        else if (ev) sub = `${tp} · evento agora`;
        else sub = tp + (salaTemHoje(sala) ? " · programação hoje" : "");
        const row = cnItemRow({ ico: ICONES_SALA[tp] || "map-pin", cor: COR_SALA[tp], nome: sala.nome, sub, evento: ev, interd });
        row.onclick = () => { cnPath = [...cnPath, i]; cnRender(); };
        lista.appendChild(row);
      });
    }
  }
  function cnRenderCrumb() {
    const crumb = $("cn-crumb"); crumb.innerHTML = "";
    const l = cnLocal;
    const segs = [{ label: l.nome, path: [] }];
    if (l.andares) {
      if (cnPath.length >= 1) segs.push({ label: (l.andares[cnPath[0]] || {}).nome, path: [cnPath[0]] });
      if (cnPath.length >= 2) segs.push({ label: ((l.andares[cnPath[0]] || {}).salas || [])[cnPath[1]].nome, path: cnPath.slice() });
    } else if (cnPath.length >= 1) {
      segs.push({ label: (l.salas || [])[cnPath[0]].nome, path: cnPath.slice() });
    }
    segs.forEach((s, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "cn-sep"; sep.innerHTML = "<i class='fa fa-angle-right'></i>";
        crumb.appendChild(sep);
      }
      const last = i === segs.length - 1;
      const el = document.createElement(last ? "span" : "button");
      el.className = "cn-seg" + (last ? " atual" : "");
      el.textContent = s.label;
      if (!last) el.onclick = () => { cnPath = s.path; cnRender(); };
      crumb.appendChild(el);
    });
  }

  // ── BOTTOM CARD ──
  function openCard(local, opts = {}) {
    somPonto();   // toque sutil ao abrir um ponto de interesse
    currentLocal = local;
    // Estilização de evento (interna E externa) só durante o PERÍODO ATIVO: selo,
    // ícone dourado e acentos. Em prédios/blocos, vale se ALGUMA sala tem evento ativo.
    const ehEvento = ehContainer(local)
      ? eventoAtivoNoContainer(local)
      : !!(local.evento && eventoAtivoAgora(local.evento));
    const iconEl = $("card-icon");
    // Evento: fundo do ícone dourado (igual ao marcador/popup); senão cor da categoria.
    iconEl.style.background = ehEvento
      ? "linear-gradient(150deg, #ffe27a, #ffc107 45%, #d4a017)"
      : (local.cor_hex || COR_HEX[local.cor] || "#5cb85c");
    iconEl.innerHTML = `<i class="fa fa-${local.icone || "map-marker"}"></i>`;
    card.classList.toggle("event", ehEvento);   // acentos dourados via CSS
    $("card-evento-badge").style.display = ehEvento ? "" : "none";
    $("card-title").textContent = local.nome || "";
    const tipoLabel = local.andares ? "Prédio" : (local.salas ? "Bloco" : (local.tipo === "refeitorio" ? "Refeitório" : ""));
    $("card-cat").textContent = (local.cat || "") + (tipoLabel ? ` · ${tipoLabel}` : "");
    $("card-desc").textContent = local.desc || "";

    // distância se houver posição
    const pos = store.getLastPos();
    const distEl = $("card-distance");
    if (pos) {
      const d = haversine(pos[0], pos[1], local.coords[0], local.coords[1]);
      const eta = Math.max(1, Math.round(d / 1.4 / 60));
      distEl.textContent = `📍 ${formatarDistancia(d)} · ~${eta} min a pé`;
      distEl.style.display = "";
    } else {
      distEl.style.display = "none";
    }

    refreshFavIcon();
    $("card-edit").style.display = ehAdmin() ? "" : "none";
    // Prédios/blocos: navegador de andares/salas (opcionalmente já numa sala alvo).
    // Pontos normais: agenda+galeria direto.
    if (ehContainer(local)) {
      abrirNavegador(local, opts.salaPath);
    } else {
      galeriaNoTopo(false);   // ponto simples: galeria no fim (após agenda)
      $("card-niveis").style.display = "none";
      $("card-agenda-sec").style.display = "";
      $("card-galeria-sec").style.display = "";
      exibirConteudo(local);
    }
    selecionarMarcador(local.nome);
    // Abre numa sala-alvo (busca/sidebar) → já expandido; senão compacto.
    card.classList.toggle("expanded", !!opts.salaPath);
    card.classList.add("open");
  }

  function closeCard() {
    card.classList.remove("open", "expanded");
    currentLocal = null;
    limparSelecao();
  }

  $("card-close").onclick = closeCard;
  $("card-nav").onclick = () => { if (currentLocal) cb.onNav?.(currentLocal); };
  // Editar (admin): abre o editor certo pré-preenchido.
  $("card-edit").onclick = () => {
    if (!currentLocal) return;
    const l = currentLocal;
    closeCard();
    if (ehContainer(l)) admin.abrirEditorPredio(l);
    else admin.abrirEditorPonto(l);
  };

  // ── EXPANDIR/COLAPSAR (swipe) ──
  function setExpanded(v) { card.classList.toggle("expanded", v); }
  (function initCardDrag() {
    // Área de gesto ampliada: a alça + a linha do cabeçalho do card.
    const zonas = [card.querySelector(".card-handle-bar"), card.querySelector(".card-head-row")];
    let startY = null, dragging = false, sobreBotao = false;
    const ehBotao = (el) => !!(el && el.closest && el.closest("button"));
    const onDown = (e) => { startY = e.clientY; dragging = true; sobreBotao = ehBotao(e.target); };
    const onUp = (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 28) {
        setExpanded(dy < 0);                  // swipe vertical (mesmo iniciando sobre botão)
      } else if (!sobreBotao) {
        setExpanded(!card.classList.contains("expanded"));  // toque (fora de botão) alterna
      }
    };
    zonas.forEach((z) => {
      if (!z) return;
      z.addEventListener("pointerdown", onDown);
      z.addEventListener("pointerup", onUp);
    });
  })();

  // ── AGENDA SEMANAL (accordion: cada dia abre mostrando os horários) ──
  const DIAS = [["Segunda","seg"],["Terça","ter"],["Quarta","qua"],["Quinta","qui"],
                ["Sexta","sex"],["Sábado","sab"],["Domingo","dom"]];
  // diasEvento: Set de chaves de dia que são dias de evento (pintados de dourado).
  const minDe = (hhmm) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
    return m ? (+m[1]) * 60 + (+m[2]) : null;
  };
  // Monta a grade de horários-padrão do campus (anexo) para um dia: todos os slots
  // dos 3 turnos, com --- separando os turnos. Cada slot mostra a atividade
  // agendada (se houver alguma cujo horário caia na faixa) ou fica "vago".
  // `janela` (opcional) = { iniMin, fimMin, label }: início/fim LIVRES do evento.
  // Os slots-padrão que se sobrepõem à janela são marcados como evento — ou seja,
  // o início é livre mas a marcação cobre só esses horários (slots) do dia.
  function montarGradeHorarios(lista, janela) {
    const itens = (lista || [])
      .filter((e) => Array.isArray(e) && e.length >= 2)
      .map(([hora, atv]) => ({ min: minDe(hora), hora, atv }))
      .filter((x) => x.min != null);
    const usados = new Set();
    const frag = document.createDocumentFragment();
    HORARIOS_PADRAO.forEach(({ turno, slots }, ti) => {
      if (ti > 0) {
        const sep = document.createElement("div");
        sep.className = "agenda-sep"; sep.textContent = "———";
        frag.appendChild(sep);
      }
      const cap = document.createElement("div");
      cap.className = "agenda-turno"; cap.textContent = turno;
      frag.appendChild(cap);
      slots.forEach(([ini, fim]) => {
        const iniM = minDe(ini), fimM = minDe(fim);
        const aqui = [];
        itens.forEach((x, idx) => { if (x.min >= iniM && x.min < fimM) { usados.add(idx); aqui.push(x); } });
        const coberto = !!janela && iniM < janela.fimMin && fimM > janela.iniMin;
        const slot = document.createElement("div");
        let atv;
        if (aqui.length) { atv = aqui.map((a) => a.atv).join(" · "); slot.className = "agenda-slot cheio" + (coberto ? " evento" : ""); }
        else if (coberto) { atv = janela.label || "Evento"; slot.className = "agenda-slot cheio evento"; }
        else { atv = "vago"; slot.className = "agenda-slot vago"; }
        slot.innerHTML = `<span class="as-hora">${ini} – ${fim}</span><span class="as-atv">${atv}</span>`;
        frag.appendChild(slot);
      });
    });
    // Atividades com horário fora dos slots-padrão — não some, vai pro fim.
    const sobra = itens.filter((x, idx) => !usados.has(idx));
    if (sobra.length) {
      const sep = document.createElement("div");
      sep.className = "agenda-sep"; sep.textContent = "———";
      frag.appendChild(sep);
      const cap = document.createElement("div");
      cap.className = "agenda-turno"; cap.textContent = "Outros horários";
      frag.appendChild(cap);
      sobra.forEach((x) => {
        const slot = document.createElement("div");
        slot.className = "agenda-slot cheio";
        slot.innerHTML = `<span class="as-hora">${x.hora}</span><span class="as-atv">${x.atv}</span>`;
        frag.appendChild(slot);
      });
    }
    return frag;
  }

  // Janela LIVRE do evento (início/fim em minutos) p/ marcar a grade. null se o
  // evento não tem horaInicio (= ativo o dia todo, sem marcação específica).
  function janelaDoEventoUI(evento) {
    if (!evento) return null;
    const ini = minDe(evento.horaInicio);
    if (ini == null) return null;
    const fim = minDe(evento.horaFim);
    return { iniMin: ini, fimMin: fim != null ? fim : 24 * 60, label: evento.atividade || evento.nome || "Evento" };
  }

  function popularAgenda(agenda, evento) {
    const wrap = $("agenda");
    wrap.innerHTML = "";
    const ag = agenda || {};
    const janelaBase = janelaDoEventoUI(evento);
    const ativoAgora = evento ? eventoAtivoAgora(evento) : false;

    // Datas reais da SEMANA atual (segunda → domingo), para cada dia ter sua data.
    // Assim a programação não é "infinita": cada ocorrência é uma data concreta,
    // limitada por inicio/fim do evento.
    const hoje = agoraReal(); hoje.setHours(0, 0, 0, 0);
    const hojeMs = hoje.getTime();
    const monday = new Date(hoje);
    monday.setDate(hoje.getDate() + (hoje.getDay() === 0 ? -6 : 1 - hoje.getDay()));

    DIAS.forEach(([label, key], i) => {
      const data = new Date(monday);
      data.setDate(monday.getDate() + i);
      data.setHours(0, 0, 0, 0);
      const ehHoje = data.getTime() === hojeMs;
      const passou = data.getTime() < hojeMs;
      const dataStr = `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;

      // o evento OCORRE nesta data? (dia da semana + dentro de inicio/fim)
      const ocorre = !!(evento && eventoAtivoHoje(evento, data));
      // dourado só quando o evento está ATIVO AGORA (hoje e dentro da janela)
      const gold = ehHoje && ativoAgora;
      const janela = ocorre ? janelaBase : null;

      const lista = (ag[key] || []).filter((e) => Array.isArray(e) && e.length >= 2);

      const row = document.createElement("div");
      row.className = "day-acc" + (ehHoje ? " today" : "") + (passou ? " past" : "") + (gold ? " evento" : "");

      const head = document.createElement("button");
      head.className = "day-head";
      const n = lista.length;
      const dur = evento ? formatarJanela(evento) : "";
      let resumo;
      if (gold) resumo = dur ? `Agora · ${dur}` : "Acontecendo agora";
      else if (ocorre && janela) resumo = dur || "Evento";
      else if (n) resumo = `${n} ${n > 1 ? "atividades" : "atividade"}`;
      else resumo = "Sem programação";
      head.innerHTML =
        `<span class="day-label">${ehHoje ? "HOJE" : label}<span class="day-date">${dataStr}</span></span>` +
        `<span class="day-sum">${resumo}</span>` +
        `<span class="day-chevron"><i class="fa fa-chevron-down"></i></span>`;

      const body = document.createElement("div");
      body.className = "day-body";
      body.appendChild(montarGradeHorarios(lista, janela));   // grade-padrão (anexo) + marcação da janela

      head.onclick = () => row.classList.toggle("open");
      if (ehHoje) row.classList.add("open");   // dia atual já vem expandido
      row.appendChild(head); row.appendChild(body);
      wrap.appendChild(row);
    });
  }

  // ── GALERIA ──
  // galFotos: [{ src, cloud, foto }]. Fotos locais (locais.json) + fotos da nuvem
  // (Firebase) ficam juntas; todos os usuários veem as da nuvem.
  let galFotos = [], galIdx = 0, galLocalNome = null;
  function popularGaleria(fotos, localNome) {
    galLocalNome = localNome || null;
    galFotos = (Array.isArray(fotos) ? fotos.filter(Boolean) : [])
      .map((src) => ({ src, cloud: false, foto: null }));
    galIdx = 0;
    renderGaleria();
    carregarFotosNuvem(localNome);  // async: anexa fotos da nuvem quando chegarem
  }
  async function carregarFotosNuvem(localNome) {
    if (!fotosAtivo() || !localNome) return;
    const cloud = await listarFotos(localNome);
    if (galLocalNome !== localNome) return;  // card já mudou
    const novos = cloud.map((f) => ({ src: f.url, cloud: true, foto: f }));
    // evita duplicar se recarregar
    galFotos = galFotos.filter((g) => !g.cloud).concat(novos);
    renderGaleria();
  }
  function renderGaleria() {
    const hero = $("gal-hero");
    const n = galFotos.length;
    const temNav = n > 1;
    $("gal-prev").style.display = temNav ? "flex" : "none";
    $("gal-next").style.display = temNav ? "flex" : "none";
    $("gal-counter").style.display = n ? "block" : "none";
    $("gal-dots").innerHTML = "";
    const item = galFotos[galIdx];
    // botão de remover: só admin e só em foto da nuvem
    $("gal-del").style.display = (isAdmin && item && item.cloud) ? "flex" : "none";
    if (!n) {
      hero.style.backgroundImage = "";
      hero.innerHTML = '<i class="fa fa-camera"></i>';
      hero.onclick = null;
      return;
    }
    const path = item.src;
    const img = new Image();
    img.onload = () => { hero.style.backgroundImage = `url("${path}")`; hero.innerHTML = ""; };
    img.onerror = () => { hero.style.backgroundImage = ""; hero.innerHTML = '<i class="fa fa-camera"></i>'; };
    img.src = path;
    hero.onclick = () => abrirViewer(galIdx);
    $("gal-counter").textContent = `${galIdx + 1} / ${n}`;
    if (temNav) {
      for (let i = 0; i < n; i++) {
        const d = document.createElement("div");
        d.className = "gal-dot" + (i === galIdx ? " active" : "");
        $("gal-dots").appendChild(d);
      }
    }
  }
  function navGaleria(delta) {
    if (galFotos.length < 2) return;
    galIdx = (galIdx + delta + galFotos.length) % galFotos.length;
    renderGaleria();
  }
  $("gal-prev").onclick = () => navGaleria(-1);
  $("gal-next").onclick = () => navGaleria(1);

  // ── UPLOAD / DELETE (admin) ──
  $("gal-upload").onclick = () => $("gal-file").click();
  $("gal-file").onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";  // permite reenviar o mesmo arquivo
    if (!file || !galLocalNome) return;
    const btn = $("gal-upload");
    btn.disabled = true; btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Enviando...';
    try {
      await enviarFoto(galLocalNome, file);
      showToast("📷 Foto adicionada");
      await carregarFotosNuvem(galLocalNome);
      galIdx = galFotos.length - 1;  // mostra a recém-enviada
      renderGaleria();
    } catch (err) {
      showToast("Erro ao enviar: " + (err.message || err));
    } finally {
      btn.disabled = false; btn.innerHTML = '<i class="fa fa-plus"></i> Adicionar foto';
    }
  };
  $("gal-del").onclick = async () => {
    const item = galFotos[galIdx];
    if (!item || !item.cloud || !item.foto) return;
    if (!confirm("Remover esta foto?")) return;
    try {
      await removerFoto(item.foto);
      showToast("Foto removida");
      galIdx = Math.max(0, galIdx - 1);
      await carregarFotosNuvem(galLocalNome);
      renderGaleria();
    } catch (err) {
      showToast("Erro ao remover: " + (err.message || err));
    }
  };

  // ── VISUALIZADOR FULLSCREEN ──
  const viewer = $("photo-viewer");
  let pvIdx = 0;
  function abrirViewer(idx) {
    if (!galFotos.length) return;
    pvIdx = idx;
    renderViewer();
    viewer.classList.add("open");
  }
  function fecharViewer() { viewer.classList.remove("open"); }
  function renderViewer() {
    const n = galFotos.length;
    const path = galFotos[pvIdx] && galFotos[pvIdx].src;
    const img = $("pv-img");
    const probe = new Image();
    probe.onload = () => { img.src = path; viewer.classList.remove("no-img"); };
    probe.onerror = () => { img.removeAttribute("src"); viewer.classList.add("no-img"); };
    probe.src = path;
    $("pv-counter").textContent = `${pvIdx + 1} / ${n}`;
    $("pv-prev").style.display = n > 1 ? "flex" : "none";
    $("pv-next").style.display = n > 1 ? "flex" : "none";
  }
  function navViewer(delta) {
    if (galFotos.length < 2) return;
    pvIdx = (pvIdx + delta + galFotos.length) % galFotos.length;
    renderViewer();
  }
  $("pv-close").onclick = fecharViewer;
  $("pv-prev").onclick = () => navViewer(-1);
  $("pv-next").onclick = () => navViewer(1);
  viewer.addEventListener("click", (e) => { if (e.target === viewer) fecharViewer(); });
  document.addEventListener("keydown", (e) => {
    if (!viewer.classList.contains("open")) return;
    if (e.key === "Escape") fecharViewer();
    else if (e.key === "ArrowLeft") navViewer(-1);
    else if (e.key === "ArrowRight") navViewer(1);
  });

  function refreshFavIcon() {
    if (!currentLocal) return;
    const fav = store.isFavorito(currentLocal.nome);
    const btn = $("card-fav");
    btn.classList.toggle("active", fav);
    btn.innerHTML = fav ? '<i class="fa fa-star"></i>' : '<i class="fa fa-star-o"></i>';
  }
  $("card-fav").onclick = () => {
    if (!currentLocal) return;
    const agora = store.toggleFavorito(currentLocal.nome);
    refreshFavIcon();
    renderFavoritos();   // mantém a lista do painel sincronizada
    showToast(agora ? `★ ${currentLocal.nome} favoritado` : "☆ Removido dos favoritos");
  };

  // ── SEARCH ──
  // Índice de busca: pontos de topo + salas (com caminho Prédio › Andar › Sala).
  function indiceBusca() {
    const out = [];
    for (const l of locais) {
      if (l._temp) continue;
      out.push({ nome: l.nome, sub: l.cat || "", ico: l.icone || "map-marker", cor: l.cor_hex || COR_HEX[l.cor] || "#5cb85c", local: l, path: null });
      if (l.andares) {
        l.andares.forEach((a, ai) => (a.salas || []).forEach((s, si) => {
          out.push({ nome: s.nome, sub: `${l.nome} › ${a.nome}`, cor: COR_SALA[s.tipo] || "#5cb85c", ico: ICONES_SALA[s.tipo], local: l, path: [ai, si] });
        }));
      } else if (l.salas) {
        l.salas.forEach((s, si) => out.push({ nome: s.nome, sub: l.nome, cor: COR_SALA[s.tipo] || "#5cb85c", ico: ICONES_SALA[s.tipo], local: l, path: [si] }));
      }
    }
    return out;
  }
  function abrirResultado(r) {
    results.classList.remove("open"); searchInput.value = "";
    cb.onSelectResult?.(r.local);              // voa até o ponto/prédio
    openCard(r.local, r.path ? { salaPath: r.path } : {});
  }
  function renderResults(q) {
    const term = q.trim().toLowerCase();
    if (!term) { results.classList.remove("open"); results.innerHTML = ""; return; }
    const matches = indiceBusca()
      .filter((r) => r.nome.toLowerCase().includes(term) || r.sub.toLowerCase().includes(term))
      .slice(0, 10);
    results.innerHTML = "";
    if (!matches.length) {
      results.innerHTML = '<div class="result-vazio">Nenhum resultado</div>';
      results.classList.add("open"); return;
    }
    matches.forEach((r) => {
      const item = document.createElement("button");
      item.className = "result-item";
      const icone = `<span class="result-ico" style="background:${r.cor}"><i class="fa fa-${r.ico || "map-marker"}"></i></span>`;
      item.innerHTML = `${icone}<span class="result-txt"><span class="result-nome">${r.nome}</span>${r.sub ? `<span class="result-sub">${r.sub}</span>` : ""}</span>`;
      item.onclick = () => abrirResultado(r);
      results.appendChild(item);
    });
    results.classList.add("open");
  }
  searchInput.addEventListener("input", (e) => renderResults(e.target.value));
  $("search-btn").onclick = () => {
    const term = searchInput.value.trim().toLowerCase();
    if (!term) return;
    const m = indiceBusca().find((r) => r.nome.toLowerCase().includes(term));
    if (m) abrirResultado(m);
  };
  document.addEventListener("click", (e) => {
    if (!results.contains(e.target) && e.target !== searchInput && !$("search-btn").contains(e.target)) {
      results.classList.remove("open");
    }
  });

  // ── ROUTE BANNER ──
  function showRouteBanner(local, distM, etaMin) {
    const hex = local.cor_hex || COR_HEX[local.cor] || "#5cb85c";
    $("rb-icon").style.background = hex;
    $("rb-icon").innerHTML = `<i class="fa fa-${local.icone || "map-marker"}"></i>`;
    $("rb-name").textContent = local.nome || "";
    const arr = new Date(Date.now() + etaMin * 60000);
    $("rb-arrival").textContent =
      `${String(arr.getHours()).padStart(2, "0")}:${String(arr.getMinutes()).padStart(2, "0")}`;
    $("rb-summary").textContent = `${etaMin} min · ${formatarDistancia(distM)}`;
    $("route-banner").classList.add("open");
  }
  function hideRouteBanner() { $("route-banner").classList.remove("open"); }
  $("rb-close").onclick = () => { hideRouteBanner(); cb.onClearRoute?.(); };

  // ── TOAST ──
  function showToast(text, ms = 1800) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ── POPUP DE EVENTOS ──
  const eventPopup = $("event-popup");
  let epTimer = null;
  function focarEvento(local) {
    esconderEventos();
    cb.onSelectResult?.(local);   // voa até o evento
    openCard(local);
  }
  function esconderEventos() {
    clearTimeout(epTimer);
    eventPopup.classList.add("hiding");
    eventPopup.classList.remove("show");
    setTimeout(() => eventPopup.classList.remove("hiding"), 450);
  }
  // eventLocais: locais marcados como evento ativos hoje.
  function mostrarEventos(eventLocais) {
    if (!eventLocais || !eventLocais.length) return;
    const body = $("ep-body");
    body.innerHTML = "";
    const nomeEv = (l) => (l.evento ? l.evento.nome : l.nome);
    const subEv = (l) => (nomeEv(l) === l.nome ? (l.cat || "Evento no campus") : l.nome);
    if (eventLocais.length === 1) {
      const l = eventLocais[0];
      const el = document.createElement("div");
      el.className = "ep-single";
      el.innerHTML =
        `<div class="ep-badge"><i class="fa fa-${l.icone || "star"}"></i></div>` +
        `<div class="ep-info">` +
          `<div class="ep-head"><span class="ep-live"></span>EVENTO ACONTECENDO AGORA</div>` +
          `<div class="ep-name">${nomeEv(l)}</div>` +
          `<div class="ep-sub"><i class="fa fa-map-marker"></i>${subEv(l)}</div>` +
        `</div>` +
        `<div class="ep-go"><i class="fa fa-chevron-right"></i></div>`;
      el.onclick = () => focarEvento(l);
      body.appendChild(el);
    } else {
      const head = document.createElement("div");
      head.className = "ep-multi-head";
      head.innerHTML = `<span class="ep-live"></span>${eventLocais.length} eventos acontecendo agora`;
      body.appendChild(head);
      eventLocais.forEach((l) => {
        const it = document.createElement("button");
        it.className = "ep-item";
        it.innerHTML =
          `<span class="ep-dot"><i class="fa fa-${l.icone || "star"}"></i></span>` +
          `<span class="ep-item-txt"><span class="ep-item-nome">${nomeEv(l)}</span>` +
          `<span class="ep-item-sub">${subEv(l)}</span></span>` +
          `<span class="ep-arrow"><i class="fa fa-chevron-right"></i></span>`;
        it.onclick = () => focarEvento(l);
        body.appendChild(it);
      });
    }
    // reinicia slide + barra de descarga
    eventPopup.classList.remove("show", "hiding");
    void eventPopup.offsetWidth;   // reflow força reinício das animações
    eventPopup.classList.add("show");
    clearTimeout(epTimer);
    epTimer = setTimeout(esconderEventos, 5000);
  }

  // ── ACESSIBILIDADE & POLISH ──
  // Esc fecha o que estiver aberto (modais admin → login → foto → popup → busca).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const adm = document.querySelector(".adm-modal.open");
    if (adm) return void adm.classList.remove("open");
    if ($("login-modal").classList.contains("open")) return void $("login-modal").classList.remove("open");
    if ($("photo-viewer").classList.contains("open")) return void $("photo-viewer").classList.remove("open");
    if ($("event-popup").classList.contains("show")) return void esconderEventos();
    if ($("results-panel").classList.contains("open")) return void $("results-panel").classList.remove("open");
  });
  // aria-label a partir do title nos botões só-ícone (sem rótulo de texto).
  document.querySelectorAll("button[title]:not([aria-label])").forEach((b) => b.setAttribute("aria-label", b.getAttribute("title")));
  $("search-input").setAttribute("aria-label", "Buscar local no campus");

  // Instalar PWA: mostra o botão quando o navegador permite instalar.
  let deferredInstall = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferredInstall = e; $("install-section").style.display = "";
  });
  $("pwa-install").onclick = async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    await deferredInstall.userChoice.catch(() => {});
    deferredInstall = null; $("install-section").style.display = "none";
  };
  window.addEventListener("appinstalled", () => { $("install-section").style.display = "none"; });

  // API pública (main.js usa)
  return {
    openCard, closeCard, closePanel,
    showRouteBanner, hideRouteBanner,
    showToast, mostrarEventos, setEventosSidebar, atualizarCardAoVivo,
  };
}
