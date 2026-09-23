let state = null;
let token = localStorage.getItem("warToken") || "";

document.getElementById("token").value = token;

const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
ws.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (msg.type === "STATE") {
    state = msg.state;
    render();
  }
};

function saveToken() {
  token = document.getElementById("token").value;
  localStorage.setItem("warToken", token);
  alert("Token enregistré.");
}

async function api(url, options = {}) {
  options.headers = Object.assign({}, options.headers, {
    "Content-Type": "application/json",
    "x-admin-token": token
  });
  const r = await fetch(url, options);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function addPlayer() {
  const id = document.getElementById("playerId").value.trim();
  const name = document.getElementById("playerName").value.trim();
  if (!id || !name) return alert("ID et pseudo requis.");
  await api("/api/player", {method:"POST", body:JSON.stringify({id,name})});
  document.getElementById("playerId").value = "";
  document.getElementById("playerName").value = "";
}

async function gift() {
  const actorId = document.getElementById("giftActor").value;
  if (!actorId) return alert("Ajoute d'abord un joueur.");
  const coins = Number(document.getElementById("coins").value || 1);
  const giftName = document.getElementById("giftName").value;
  // Directly reproduce the same game-engine effect as a TikTok gift.
  await api("/api/event", {method:"POST", body:JSON.stringify({type:giftEvent(coins), actorId})});
  // Also add a visible story entry by using a harmless comment-like event is unnecessary;
  // the actual event is what matters.
}

function giftEvent(coins) {
  if (coins <= 5) return "SCOUT";
  if (coins <= 20) return "REINFORCEMENT";
  if (coins <= 100) return "INVASION";
  if (coins <= 300) return "ESPIONAGE";
  if (coins <= 700) return "SABOTAGE";
  if (coins <= 1500) return "HERO";
  if (coins <= 3000) return "SHIELD";
  return "WAR";
}

async function event(type) {
  const actorId = document.getElementById("actor").value;
  const targetId = document.getElementById("target").value || undefined;
  if (!actorId) return alert("Ajoute un joueur.");
  await api("/api/event", {method:"POST", body:JSON.stringify({type, actorId, targetId})});
}

async function alliance(action) {
  const a = document.getElementById("actor").value;
  const b = document.getElementById("target").value;
  if (!a || !b || a === b) return alert("Choisis deux royaumes.");
  await api("/api/alliance", {method:"POST", body:JSON.stringify({a,b,action})});
}

async function resetGame() {
  if (!confirm("Effacer la guerre actuelle ?")) return;
  await api("/api/reset", {method:"POST", body:"{}"});
}

function options(selected = "") {
  return Object.values(state.players).map(p =>
    `<option value="${p.id}" ${p.id===selected?"selected":""}>${escapeHtml(p.name)}</option>`
  ).join("");
}

function render() {
  if (!state) return;
  const opts = options();
  document.getElementById("actor").innerHTML = opts;
  document.getElementById("target").innerHTML = `<option value="">Cible aléatoire</option>${opts}`;
  document.getElementById("giftActor").innerHTML = opts;

  const box = document.getElementById("players");
  box.innerHTML = Object.values(state.players).map(p => `
    <div class="player-row">
      <span>${escapeHtml(p.name)}</span>
      <span>${p.territoryCount} zones · ${p.power} ⚡</span>
    </div>
  `).join("");

  const timeline = document.getElementById("timeline");
  timeline.innerHTML = state.timeline.map(i => `
    <div class="story-item">
      <strong>${escapeHtml(i.title)}</strong>
      <div>${escapeHtml(i.text)}</div>
    </div>
  `).join("");

  document.getElementById("status").textContent = state.connected ? "🟢 TIKTOK" : "🧪 DEMO";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}