let state = null;

const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host);
ws.onopen = () => setConnection(true);
ws.onclose = () => setConnection(false);
ws.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (msg.type === "STATE") {
    state = msg.state;
    render();
  }
  if (msg.type === "STORY" && state) {
    state.timeline.unshift(msg.item);
    renderStory();
  }
};

function setConnection(ok) {
  const el = document.getElementById("connection");
  el.textContent = ok ? "🟢 LIVE" : "🔴 OFFLINE";
}

function render() {
  if (!state) return;
  document.getElementById("season").textContent = state.season.title;
  document.getElementById("eventCounter").textContent = `${state.stats.gifts} cadeaux`;
  renderMap();
  renderStory();
  renderLeaders();
}

function renderMap() {
  const map = document.getElementById("map");
  map.innerHTML = "";
  for (const t of state.territories) {
    const owner = state.players[t.owner];
    const div = document.createElement("div");
    div.className = "tile" + (owner ? " owner" : "") + (t.special ? " capital" : "");
    if (owner) {
      div.style.setProperty("--c", owner.color);
      div.style.background = `linear-gradient(135deg, ${owner.color}22, #111827)`;
    }
    div.innerHTML = `
      <div class="hp"><i style="width:${Math.max(0,t.hp)}%"></i></div>
      <div class="name">${owner ? owner.name : "NEUTRE"}</div>
    `;
    map.appendChild(div);
  }
}

function renderStory() {
  const box = document.getElementById("story");
  box.innerHTML = "";
  (state?.timeline || []).slice(0, 18).forEach(item => {
    const d = new Date(item.ts);
    const el = document.createElement("div");
    el.className = "story-item";
    el.innerHTML = `<strong>${item.title}</strong><div>${escapeHtml(item.text)}</div><small>${d.toLocaleTimeString()}</small>`;
    box.appendChild(el);
  });
}

function renderLeaders() {
  const box = document.getElementById("leaders");
  box.innerHTML = "";
  const players = Object.values(state.players).sort((a,b)=>b.territoryCount-a.territoryCount);
  players.forEach(p => {
    const el = document.createElement("div");
    el.className = "leader";
    el.innerHTML = `
      <span><i class="swatch" style="background:${p.color}"></i>${escapeHtml(p.name)}</span>
      <b>${p.territoryCount} zones</b>
      <span>${p.power} ⚡</span>
    `;
    box.appendChild(el);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

setInterval(() => {
  const el = document.getElementById("clock");
  if (el) el.textContent = new Date().toLocaleTimeString();
}, 1000);