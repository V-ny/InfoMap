// Controlador da UI shell — header, search, side panel, bottom sheet, toast.
// Recebe callbacks de domínio (onNav, onThemeChange, onLocate, onSetPos...).
import { store } from "./store.js";
import { selecionarMarcador, limparSelecao, filtrarPorCategoria } from "./markers.js";
import { haversine, formatarDistancia } from "./geo.js";
import { HORARIOS_PADRAO, eventoAtivoHoje, eventoAtivoAgora, agoraReal } from "./eventos.js";
// Backend de fotos: LOCAL (IndexedDB + login local). Pra usar o Firebase (nuvem),
// veja docs/IMPLEMENTACAO-FUTURA-FIREBASE.md.
import { fotosAtivo, registrar, login, logout, onAuth, ehAdmin, listarFotos, enviarFoto, removerFoto } from "./fotos-store.js";
import {
  addLocalCustom, getLocaisCustom, removeLocalCustom,
  addEventoCustom, getEventosCustom, removeEventoCustom,
  getDesativados, desativarBase,
} from "./admin-store.js";

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

const COR_HEX = {
  green: "#5cb85c", lightgreen: "#8bc34a", red: "#d9534f", blue: "#428bca",
  orange: "#f0ad4e", purple: "#9B479F", pink: "#e91e8c", cadetblue: "#436978",
  darkgreen: "#2e7d32", darkred: "#a23336", darkpurple: "#5B396B",
};

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

  // ── GESTÃO ADMIN (criar pontos / eventos, desativar) ──
  const CATS_ADMIN = ["Ensino", "Administrativo", "Agropecuária", "Acessos", "Convivência", "Esporte"];
  const CAT_COR = {
    Ensino: "blue", Administrativo: "red", "Agropecuária": "green",
    Acessos: "lightgreen", "Convivência": "cadetblue", Esporte: "darkgreen",
  };
  // { icone: nome da classe FontAwesome, nome: rótulo em português }
  const ICONES_ADMIN = [
    { icone: "map-marker", nome: "Marcador / Local" },
    { icone: "book", nome: "Livro / Biblioteca" },
    { icone: "graduation-cap", nome: "Formatura / Ensino" },
    { icone: "briefcase", nome: "Maleta / Administração" },
    { icone: "bullhorn", nome: "Megafone / Anúncios" },
    { icone: "paint-brush", nome: "Pincel / Artes" },
    { icone: "cutlery", nome: "Talheres / Restaurante" },
    { icone: "futbol-o", nome: "Bola / Esporte" },
    { icone: "leaf", nome: "Folha / Natureza" },
    { icone: "sun-o", nome: "Sol" },
    { icone: "paw", nome: "Pata / Animais" },
    { icone: "road", nome: "Estrada / Portaria" },
    { icone: "building", nome: "Prédio" },
    { icone: "flask", nome: "Frasco / Laboratório" },
    { icone: "music", nome: "Música" },
    { icone: "coffee", nome: "Café / Convivência" },
    { icone: "heart", nome: "Coração / Saúde" },
    { icone: "star", nome: "Estrela" },
    { icone: "university", nome: "Universidade" },
    { icone: "medkit", nome: "Kit médico / Saúde" },
  ];
  const DIAS_ADMIN = [["seg", "S"], ["ter", "T"], ["qua", "Q"], ["qui", "Q"], ["sex", "S"], ["sab", "S"], ["dom", "D"]];
  const DIAS_NOME = { seg: "Seg", ter: "Ter", qua: "Qua", qui: "Qui", sex: "Sex", sab: "Sáb", dom: "Dom" };
  const GOLD = "linear-gradient(150deg, #ffe27a, #ffc107 45%, #d4a017)";

  function fillSelect(sel, itens, render) {
    sel.innerHTML = "";
    itens.forEach((it) => {
      const o = document.createElement("option");
      const { value, label } = render(it);
      o.value = value; o.textContent = label;
      sel.appendChild(o);
    });
  }
  function openAdmModal(id) { $(id).classList.add("open"); }
  function closeAdmModal(id) { $(id).classList.remove("open"); }
  [["ponto-modal", "ponto-close"], ["evento-modal", "evento-close"], ["gerenciar-modal", "gerenciar-close"]]
    .forEach(([mid, cid]) => {
      $(cid).onclick = () => closeAdmModal(mid);
      $(mid).addEventListener("click", (e) => { if (e.target === $(mid)) closeAdmModal(mid); });
    });

  // ----- NOVO PONTO -----
  let pontoCoords = null;
  $("pb-novo-ponto").onclick = () => {
    closePanel();
    pontoCoords = null;
    $("ponto-nome").value = ""; $("ponto-desc").value = "";
    $("ponto-erro").textContent = "";
    $("ponto-loc-info").textContent = "Local: não definido"; $("ponto-loc-info").classList.remove("ok");
    fillSelect($("ponto-cat"), CATS_ADMIN, (c) => ({ value: c, label: c }));
    fillSelect($("ponto-icone"), ICONES_ADMIN, (i) => ({ value: i.icone, label: i.nome }));
    openAdmModal("ponto-modal");
  };
  $("ponto-loc").onclick = () => {
    closeAdmModal("ponto-modal");
    cb.onPedirLocalMapa?.((latlon) => {
      pontoCoords = latlon;
      $("ponto-loc-info").textContent = `Local: ${latlon[0].toFixed(5)}, ${latlon[1].toFixed(5)}`;
      $("ponto-loc-info").classList.add("ok");
      openAdmModal("ponto-modal");
    });
  };
  $("ponto-salvar").onclick = () => {
    const nome = $("ponto-nome").value.trim();
    if (!nome) { $("ponto-erro").textContent = "Informe o nome."; return; }
    if (!pontoCoords) { $("ponto-erro").textContent = "Escolha o local no mapa."; return; }
    const cat = $("ponto-cat").value;
    addLocalCustom({
      nome, coords: pontoCoords, cat, cor: CAT_COR[cat] || "green",
      icone: $("ponto-icone").value, desc: $("ponto-desc").value.trim(),
    });
    closeAdmModal("ponto-modal");
    cb.onAdminChange?.();
    showToast("📍 Ponto criado");
  };

  // ----- NOVO EVENTO -----
  let eventoCoords = null;
  function renderDiasChips() {
    const wrap = $("evento-dias"); wrap.innerHTML = "";
    DIAS_ADMIN.forEach(([key, letra]) => {
      const b = document.createElement("button");
      b.className = "adm-dia"; b.dataset.dia = key; b.textContent = letra;
      b.onclick = () => b.classList.toggle("on");
      wrap.appendChild(b);
    });
  }
  function waypointsSelecionaveis() {
    return locais.filter((l) => !l._temp);   // exclui marcadores temporários de evento
  }
  $("pb-novo-evento").onclick = () => {
    closePanel();
    eventoCoords = null;
    ["evento-nome", "evento-desc", "evento-inicio", "evento-fim", "evento-atividade",
     "evento-hora-ini", "evento-hora-fim"]
      .forEach((id) => { $(id).value = ""; });
    $("evento-erro").textContent = "";
    $("evento-loc-info").textContent = "Local: não definido"; $("evento-loc-info").classList.remove("ok");
    $("evento-temp").style.display = "none";
    // alvo: waypoints existentes + opção de ponto temporário
    const sel = $("evento-alvo"); sel.innerHTML = "";
    const optVazio = document.createElement("option"); optVazio.value = ""; optVazio.textContent = "— escolher local existente —"; sel.appendChild(optVazio);
    waypointsSelecionaveis().forEach((l) => {
      const o = document.createElement("option"); o.value = l.nome; o.textContent = l.nome; sel.appendChild(o);
    });
    const optNovo = document.createElement("option"); optNovo.value = "__novo__"; optNovo.textContent = "+ Ponto temporário (no mapa)"; sel.appendChild(optNovo);
    fillSelect($("evento-icone"), ICONES_ADMIN, (i) => ({ value: i.icone, label: i.nome }));
    renderDiasChips();
    openAdmModal("evento-modal");
  };
  $("evento-alvo").onchange = () => {
    $("evento-temp").style.display = $("evento-alvo").value === "__novo__" ? "" : "none";
  };
  $("evento-loc").onclick = () => {
    closeAdmModal("evento-modal");
    cb.onPedirLocalMapa?.((latlon) => {
      eventoCoords = latlon;
      $("evento-loc-info").textContent = `Local: ${latlon[0].toFixed(5)}, ${latlon[1].toFixed(5)}`;
      $("evento-loc-info").classList.add("ok");
      openAdmModal("evento-modal");
    });
  };
  $("evento-salvar").onclick = () => {
    const nome = $("evento-nome").value.trim();
    const alvo = $("evento-alvo").value;
    const dias = [...$("evento-dias").querySelectorAll(".adm-dia.on")].map((b) => b.dataset.dia);
    if (!nome) { $("evento-erro").textContent = "Informe o nome do evento."; return; }
    if (!alvo) { $("evento-erro").textContent = "Escolha onde o evento acontece."; return; }
    if (!dias.length) { $("evento-erro").textContent = "Selecione ao menos um dia."; return; }
    const ev = { nome, dias, desc: $("evento-desc").value.trim() };
    const ini = $("evento-inicio").value, fim = $("evento-fim").value;
    if (ini) ev.inicio = ini;
    if (fim) ev.fim = fim;
    const hIni = $("evento-hora-ini").value, hFim = $("evento-hora-fim").value;
    const atv = $("evento-atividade").value.trim();
    if (hIni && hFim && hFim <= hIni) {
      $("evento-erro").textContent = "O horário de fim deve ser depois do início."; return;
    }
    if (hIni) {
      ev.horaInicio = hIni;             // o ícone aparece nesse horário (livre)…
      if (hFim) ev.horaFim = hFim;      // …e some nesse (senão, fica até o fim do dia)
      ev.atividade = atv || "";         // rótulo usado na marcação da agenda
      ev.horarios = {};
      dias.forEach((d) => { ev.horarios[d] = [[hIni, atv || "Atividade"]]; });
    }
    if (alvo === "__novo__") {
      if (!eventoCoords) { $("evento-erro").textContent = "Escolha o local do ponto temporário."; return; }
      ev.coords = eventoCoords; ev.icone = $("evento-icone").value; ev.cor = "orange"; ev.cat = "Eventos";
    } else {
      ev.local = alvo;
    }
    addEventoCustom(ev);
    closeAdmModal("evento-modal");
    cb.onAdminChange?.();
    showToast("⭐ Evento criado");
  };

  // ----- GERENCIAR -----
  function renderGerenciar() {
    const desativados = new Set(getDesativados());
    // eventos ativos: base (não desativados) + custom
    const baseAtivos = (baseEventos || []).filter((e) => !desativados.has(e.nome))
      .map((e) => ({ nome: e.nome, local: e.local, icone: e.icone, fonte: "base" }));
    const custom = getEventosCustom().map((e) => ({ id: e.id, nome: e.nome, local: e.local, icone: e.icone, fonte: "custom" }));
    const eventos = baseAtivos.concat(custom);
    const wrapE = $("gerenciar-eventos"); wrapE.innerHTML = "";
    if (!eventos.length) { wrapE.innerHTML = '<div class="adm-vazio">Nenhum evento ativo.</div>'; }
    eventos.forEach((e) => {
      const row = document.createElement("div"); row.className = "adm-item";
      row.innerHTML =
        `<span class="adm-item-ico" style="background:${GOLD}"><i class="fa fa-${e.icone || "star"}"></i></span>` +
        `<span class="adm-item-txt"><span class="adm-item-nome">${e.nome}</span>` +
        `<span class="adm-item-sub">${e.local ? e.local : "ponto temporário"} · ${e.fonte === "base" ? "padrão" : "criado por você"}</span></span>` +
        `<button class="adm-item-btn">Desativar</button>`;
      row.querySelector("button").onclick = () => {
        if (e.fonte === "custom") removeEventoCustom(e.id);
        else desativarBase(e.nome);
        cb.onAdminChange?.();
        renderGerenciar();
        showToast("Evento desativado");
      };
      wrapE.appendChild(row);
    });
    // pontos criados pelo admin
    const pontos = getLocaisCustom();
    const wrapP = $("gerenciar-pontos"); wrapP.innerHTML = "";
    if (!pontos.length) { wrapP.innerHTML = '<div class="adm-vazio">Nenhum ponto criado.</div>'; }
    pontos.forEach((p) => {
      const hex = COR_HEX[p.cor] || "#5cb85c";
      const row = document.createElement("div"); row.className = "adm-item";
      row.innerHTML =
        `<span class="adm-item-ico" style="background:${hex}"><i class="fa fa-${p.icone || "map-marker"}"></i></span>` +
        `<span class="adm-item-txt"><span class="adm-item-nome">${p.nome}</span>` +
        `<span class="adm-item-sub">${p.cat || ""}</span></span>` +
        `<button class="adm-item-btn">Remover</button>`;
      row.querySelector("button").onclick = () => {
        if (!confirm(`Remover o ponto "${p.nome}"?`)) return;
        removeLocalCustom(p.nome);
        cb.onAdminChange?.();
        renderGerenciar();
        showToast("Ponto removido");
      };
      wrapP.appendChild(row);
    });
  }
  $("pb-gerenciar").onclick = () => { closePanel(); renderGerenciar(); openAdmModal("gerenciar-modal"); };

  // ── EVENTOS (lista lateral, próximos 7 dias) ──
  // entries: [{ ev, local }]. Clicar direciona pro evento (sem popup).
  function setEventosSidebar(entries) {
    const lista = entries || [];
    const wrap = $("eventos-list");
    const section = $("eventos-section");
    section.style.display = lista.length ? "" : "none";
    wrap.innerHTML = "";
    lista.forEach(({ ev, local }) => {
      const item = document.createElement("button");
      item.className = "evento-item";
      const quando = ev._quando || "";
      item.innerHTML =
        `<span class="evento-ico"><i class="fa fa-${(local && local.icone) || ev.icone || "star"}"></i></span>` +
        `<span class="evento-txt"><span class="evento-nome">${ev.nome}</span>` +
        (quando ? `<span class="evento-quando">${quando}</span>` : "") + `</span>`;
      item.onclick = () => {
        closePanel();
        if (local) { cb.onSelectResult?.(local); openCard(local); }
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

  // ── BOTTOM CARD ──
  function openCard(local) {
    currentLocal = local;
    // Estilização de evento (interna E externa) só durante o PERÍODO ATIVO: selo,
    // ícone dourado e acentos aparecem apenas quando o evento está acontecendo agora.
    const ehEvento = !!(local.evento && eventoAtivoAgora(local.evento));
    const iconEl = $("card-icon");
    // Evento: fundo do ícone dourado (igual ao marcador/popup); senão cor da categoria.
    iconEl.style.background = ehEvento
      ? "linear-gradient(150deg, #ffe27a, #ffc107 45%, #d4a017)"
      : (local.cor_hex || COR_HEX[local.cor] || "#5cb85c");
    iconEl.innerHTML = `<i class="fa fa-${local.icone || "map-marker"}"></i>`;
    card.classList.toggle("event", ehEvento);   // acentos dourados via CSS
    $("card-evento-badge").style.display = ehEvento ? "" : "none";
    $("card-title").textContent = local.nome || "";
    $("card-cat").textContent = local.cat || "";
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
    // Agenda: mescla os horários do evento e deixa a popularAgenda decidir, por
    // DATA, em quais dias o evento ocorre (limitado por inicio/fim) e quando pintar
    // de dourado (só no período ativo).
    let agenda = local.agenda;
    if (local.evento) {
      agenda = { ...(local.agenda || {}), ...(local.evento.horarios || {}) };
    }
    popularAgenda(agenda, local.evento);
    popularGaleria(local.fotos, local.nome);
    selecionarMarcador(local.nome);
    card.classList.remove("expanded");   // sempre abre compacto
    card.classList.add("open");
  }

  function closeCard() {
    card.classList.remove("open", "expanded");
    currentLocal = null;
    limparSelecao();
  }

  $("card-close").onclick = closeCard;
  $("card-nav").onclick = () => { if (currentLocal) cb.onNav?.(currentLocal); };

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
      let resumo;
      if (gold) resumo = "Acontecendo agora";
      else if (ocorre && janela) resumo = "Evento";
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
  function renderResults(q) {
    const term = q.trim().toLowerCase();
    if (!term) { results.classList.remove("open"); results.innerHTML = ""; return; }
    const matches = locais.filter((l) => l.nome.toLowerCase().includes(term)).slice(0, 8);
    if (!matches.length) { results.classList.remove("open"); results.innerHTML = ""; return; }
    results.innerHTML = "";
    matches.forEach((l) => {
      const item = document.createElement("button");
      item.className = "result-item";
      const hex = l.cor_hex || COR_HEX[l.cor] || "#5cb85c";
      item.innerHTML = `<span class="dot" style="background:${hex}"></span>${l.nome}`;
      item.onclick = () => {
        results.classList.remove("open");
        searchInput.value = "";
        cb.onSelectResult?.(l);
        openCard(l);
      };
      results.appendChild(item);
    });
    results.classList.add("open");
  }
  searchInput.addEventListener("input", (e) => renderResults(e.target.value));
  $("search-btn").onclick = () => {
    const term = searchInput.value.trim().toLowerCase();
    const m = locais.find((l) => l.nome.toLowerCase().includes(term));
    if (m) { results.classList.remove("open"); searchInput.value = ""; cb.onSelectResult?.(m); openCard(m); }
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

  // API pública (main.js usa)
  return {
    openCard, closeCard, closePanel,
    showRouteBanner, hideRouteBanner,
    showToast, mostrarEventos, setEventosSidebar,
  };
}
