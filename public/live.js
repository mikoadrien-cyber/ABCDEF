(function () {
  const wheelEl = document.getElementById("wheel");
  const lastSpinEl = document.getElementById("lastSpin");
  const lbListEl = document.getElementById("lbList");
  const tickListEl = document.getElementById("tickList");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  let prizes = null;
  let sliceLabels = [];
  let totalRotation = 0;
  let builtWheel = false;

  function connect() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}`);
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "STATE") applyState(msg.state);
      if (msg.type === "SPIN") animateSpin(msg.spin);
      if (msg.type === "STORY") prependTick(msg.item);
    };
    ws.onclose = () => setTimeout(connect, 1500);
  }

  function buildWheel() {
    if (!prizes || builtWheel) return;
    const n = prizes.length;
    const sliceAngle = 360 / n;
    const stops = prizes.map((p, i) => `${p.color} ${i * sliceAngle}deg ${(i + 1) * sliceAngle}deg`).join(", ");
    wheelEl.style.background = `conic-gradient(${stops})`;

    // Remove old labels
    sliceLabels.forEach(l => l.remove());
    sliceLabels = [];

    const rect = wheelEl.getBoundingClientRect();
    const radius = rect.width * 0.36;

    prizes.forEach((p, i) => {
      const center = i * sliceAngle + sliceAngle / 2;
      const label = document.createElement("div");
      label.className = "slice-label";
      label.textContent = p.label;
      label.style.transform = `rotate(${center}deg) translate(0, -${radius}px) rotate(90deg)`;
      wheelEl.appendChild(label);
      sliceLabels.push(label);
    });

    builtWheel = true;
  }

  function applyState(state) {
    if (state.prizes) {
      prizes = state.prizes;
      requestAnimationFrame(buildWheel);
    }

    statusDot.classList.toggle("live", !!state.connected);
    statusText.textContent = state.connected
      ? `live · @${state.liveUsername}`
      : "demo mode";

    document.getElementById("statGifts").textContent = state.stats.gifts;
    document.getElementById("statSpins").textContent = state.stats.spins;
    document.getElementById("statJackpots").textContent = state.stats.jackpots;
    document.getElementById("statLikes").textContent = state.stats.likes;

    renderLeaderboard(state.players);
  }

  function renderLeaderboard(players) {
    const list = Object.values(players).sort((a, b) => b.points - a.points).slice(0, 8);
    if (!list.length) {
      lbListEl.innerHTML = `<div class="lb-empty">No players yet.</div>`;
      return;
    }
    lbListEl.innerHTML = list.map((p, i) => `
      <div class="lb-row">
        <div class="lb-rank">${i === 0 ? "👑" : i + 1}</div>
        <div class="lb-swatch" style="background:${p.color}"></div>
        <div class="lb-name">${escapeHtml(p.name)}</div>
        <div class="lb-pts">${p.points}</div>
      </div>
    `).join("");
  }

  function prependTick(item) {
    const row = document.createElement("div");
    row.className = "tick-item";
    row.innerHTML = `<b>${escapeHtml(item.title)}</b> — ${escapeHtml(item.text)}`;
    tickListEl.prepend(row);
    while (tickListEl.children.length > 40) tickListEl.removeChild(tickListEl.lastChild);
  }

  function animateSpin(spin) {
    if (!prizes) return;
    const n = prizes.length;
    const sliceAngle = 360 / n;
    const targetCenter = spin.prizeIndex * sliceAngle + sliceAngle / 2;
    // Land the target slice under the top pointer, spinning forward several turns.
    const extraTurns = 4 + Math.floor(Math.random() * 2);
    const targetAbsolute = extraTurns * 360 + (360 - targetCenter);
    totalRotation += (targetAbsolute - (totalRotation % 360));
    wheelEl.style.transform = `rotate(${totalRotation}deg)`;

    const prize = prizes[spin.prizeIndex];
    setTimeout(() => {
      lastSpinEl.innerHTML = `
        <div class="name" style="color:${spin.playerColor}">${escapeHtml(spin.playerName)}</div>
        <div class="prize" style="color:${prize.color}">${prize.short}</div>
      `;
    }, 3400);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  window.addEventListener("resize", () => { builtWheel = false; buildWheel(); });

  connect();
})();
