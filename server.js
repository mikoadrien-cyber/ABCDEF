const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

let TikTokLiveConnection, WebcastEvent;
try {
  ({ TikTokLiveConnection, WebcastEvent } = require("tiktok-live-connector"));
} catch (_) {}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "change-me";
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || "";
const AUTO_EVENTS = process.env.AUTO_EVENTS !== "false";

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const COLORS = ["#36a3ff", "#ff405f", "#42d17b", "#ffd23f", "#a66cff", "#ff8a3d"];

const state = {
  version: 3,
  connected: false,
  liveUsername: TIKTOK_USERNAME,
  tick: 0,
  season: {
    startedAt: Date.now(),
    title: "THE GREAT WAR"
  },
  players: {},
  territories: [],
  alliances: [],
  activeEvents: [],
  timeline: [],
  pendingDiplomacy: [],
  stats: {
    gifts: 0,
    comments: 0,
    likes: 0,
    battles: 0,
    betrayals: 0,
    alliances: 0,
    territoryChanges: 0
  }
};

function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function now() {
  return Date.now();
}

function addTimeline(type, title, text, meta = {}) {
  const item = {
    id: uid("story"),
    ts: now(),
    type,
    title,
    text,
    meta
  };
  state.timeline.unshift(item);
  state.timeline = state.timeline.slice(0, 80);
  broadcast({ type: "STORY", item });
  return item;
}

function ensurePlayer(id, name = id) {
  if (!state.players[id]) {
    const color = COLORS[Object.keys(state.players).length % COLORS.length];
    state.players[id] = {
      id,
      name: String(name).slice(0, 18),
      color,
      territoryCount: 0,
      power: 100,
      coins: 0,
      shieldUntil: 0,
      heroUntil: 0,
      reputation: 0,
      alive: true,
      createdAt: now()
    };
  }
  return state.players[id];
}

function createMap() {
  const cols = 8;
  const rows = 5;
  const territories = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      territories.push({
        id: `t_${y}_${x}`,
        x, y,
        owner: null,
        hp: 100,
        fortified: false,
        vulnerableUntil: 0,
        special: (x === 3 && y === 2) ? "CAPITAL" : null
      });
    }
  }
  state.territories = territories;
}
createMap();

function recalcTerritories() {
  for (const p of Object.values(state.players)) p.territoryCount = 0;
  for (const t of state.territories) {
    if (t.owner && state.players[t.owner]) state.players[t.owner].territoryCount++;
  }
}

function adjacent(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function randomTerritory(filter = () => true) {
  const list = state.territories.filter(filter);
  return list[Math.floor(Math.random() * list.length)];
}

function ownedTerritories(playerId) {
  return state.territories.filter(t => t.owner === playerId);
}

function enemyTerritories(playerId) {
  return state.territories.filter(t => t.owner && t.owner !== playerId);
}

function isAllied(a, b) {
  return state.alliances.some(x =>
    x.active &&
    ((x.a === a && x.b === b) || (x.a === b && x.b === a))
  );
}

function addAlliance(a, b, duration = 120000) {
  if (a === b || isAllied(a, b)) return false;
  state.alliances.push({
    id: uid("ally"),
    a, b,
    active: true,
    createdAt: now(),
    expiresAt: now() + duration
  });
  state.stats.alliances++;
  addTimeline("ALLIANCE", "🤝 ALLIANCE", `${state.players[a]?.name || a} and ${state.players[b]?.name || b} are now allies.`);
  broadcastState();
  return true;
}

function breakAlliance(a, b, reason = "betrayal") {
  const ally = state.alliances.find(x =>
    x.active && ((x.a === a && x.b === b) || (x.a === b && x.b === a))
  );
  if (!ally) return false;
  ally.active = false;
  state.stats.betrayals++;
  addTimeline("BETRAYAL", "☠️ BETRAYAL", `${state.players[a]?.name || a} has broken the alliance with ${state.players[b]?.name || b}.`, { reason });
  broadcastState();
  return true;
}

function claimTerritory(playerId, territoryId, reason = "conquest") {
  const p = ensurePlayer(playerId);
  const t = state.territories.find(x => x.id === territoryId);
  if (!t) return false;
  const previous = t.owner;
  if (previous === playerId) return false;

  if (previous && isAllied(previous, playerId)) return false;
  if (previous && state.players[previous]) state.players[previous].power = clamp(state.players[previous].power - 5, 0, 999);

  t.owner = playerId;
  t.hp = 100;
  t.fortified = false;
  state.stats.territoryChanges++;
  recalcTerritories();

  const oldName = previous ? state.players[previous]?.name || previous : "NEUTRAL";
  addTimeline("CONQUEST", "⚔️ TERRITORY FALLS", `${p.name} captured ${t.id} from ${oldName}.`, {
    territoryId, from: previous, to: playerId, reason
  });
  return true;
}

function attack(playerId, targetId, intensity = 1) {
  const attacker = ensurePlayer(playerId);
  const target = state.players[targetId];
  if (!target || targetId === playerId) return false;

  const candidates = ownedTerritories(targetId).filter(t => {
    return ownedTerritories(playerId).some(a => adjacent(a, t));
  });
  const targetTerritory = candidates[0] || ownedTerritories(targetId)[0];
  if (!targetTerritory) return false;

  if (isAllied(playerId, targetId)) {
    addTimeline("BLOCKED", "🕊️ ATTACK BLOCKED", `${attacker.name} tried to attack an ally.`);
    return false;
  }

  if (target.shieldUntil > now()) {
    addTimeline("DEFENSE", "🛡️ SHIELD HOLDS", `${target.name} resisted an attack.`);
    return false;
  }

  const damage = 20 + Math.floor(Math.random() * 35) * intensity + (attacker.heroUntil > now() ? 25 : 0);
  targetTerritory.hp -= damage;
  state.stats.battles++;

  if (targetTerritory.hp <= 0) {
    claimTerritory(playerId, targetTerritory.id, "battle");
    addTimeline("BATTLE", "💥 BREAKTHROUGH", `${attacker.name} broke through ${target.name}'s defenses.`);
  } else {
    addTimeline("BATTLE", "⚔️ BATTLE", `${attacker.name} attacked ${target.name} — ${Math.max(0, targetTerritory.hp)} HP remains.`);
  }

  attacker.power = clamp(attacker.power + 2 * intensity, 0, 999);
  return true;
}

function randomEnemy(playerId) {
  const candidates = Object.values(state.players).filter(p => p.id !== playerId && p.alive);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function activateEvent(type, actorId, data = {}) {
  const actor = ensurePlayer(actorId);
  let target = data.targetId ? state.players[data.targetId] : randomEnemy(actorId);

  if (type === "SCOUT") {
    addTimeline("SCOUT", "🕵️ SCOUT", `${actor.name} sent scouts across the map.`);
    const t = randomTerritory();
    if (t) {
      t.vulnerableUntil = now() + 30000;
      addTimeline("SECRET", "👁️ SECRET DISCOVERY", `${actor.name} discovered a weakness in ${t.id}.`, { territoryId: t.id });
    }
  }

  if (type === "REINFORCEMENT") {
    actor.power = clamp(actor.power + 20, 0, 999);
    addTimeline("REINFORCEMENT", "🪖 REINFORCEMENTS", `${actor.name} receives reinforcements.`);
  }

  if (type === "INVASION") {
    if (target) attack(actorId, target.id, 2);
    else addTimeline("INVASION", "⚔️ INVASION", `${actor.name} prepares an invasion.`);
  }

  if (type === "HERO") {
    actor.heroUntil = now() + 90000;
    actor.power = clamp(actor.power + 60, 0, 999);
    addTimeline("HERO", "👑 HERO ARRIVES", `${actor.name}'s hero joins the war for 90 seconds.`);
  }

  if (type === "SHIELD") {
    actor.shieldUntil = now() + 60000;
    addTimeline("SHIELD", "🛡️ FORTRESS SHIELD", `${actor.name} is protected for 60 seconds.`);
  }

  if (type === "ALLIANCE") {
    if (target) addAlliance(actorId, target.id, 90000);
  }

  if (type === "BETRAYAL") {
    if (target) {
      if (isAllied(actorId, target.id)) {
        breakAlliance(actorId, target.id);
        attack(actorId, target.id, 2);
      } else {
        addTimeline("BETRAYAL", "☠️ BETRAYAL FAILED", `${actor.name} has no alliance to betray with ${target.name}.`);
      }
    }
  }

  if (type === "ESPIONAGE") {
    const t = target ? ownedTerritories(target.id)[0] : randomTerritory();
    if (t) {
      t.vulnerableUntil = now() + 60000;
      addTimeline("ESPIONAGE", "🕵️ ESPIONAGE", `${actor.name} discovered a weakness near ${target?.name || "an enemy"}.`, { territoryId: t.id });
    }
  }

  if (type === "SABOTAGE") {
    const t = target ? ownedTerritories(target.id)[0] : randomTerritory();
    if (t) {
      t.hp = Math.max(1, t.hp - 50);
      t.fortified = false;
      addTimeline("SABOTAGE", "💣 SABOTAGE", `${actor.name} sabotaged ${t.id}.`, { territoryId: t.id });
    }
  }

  if (type === "CATASTROPHE") {
    const t = randomTerritory(x => x.owner !== actorId);
    if (t) {
      t.hp = Math.max(1, t.hp - 80);
      addTimeline("CATASTROPHE", "🌋 CATASTROPHE", `A catastrophe struck ${t.id}.`, { territoryId: t.id });
    }
  }

  if (type === "WAR") {
    const enemy = target || randomEnemy(actorId);
    if (enemy) {
      addTimeline("WAR", "🔥 TOTAL WAR", `${actor.name} declared total war on ${enemy.name}.`);
      for (let i = 0; i < 2; i++) attack(actorId, enemy.id, 1);
    }
  }

  broadcastState();
}

const giftRules = [
  { min: 1, max: 5, event: "SCOUT" },
  { min: 6, max: 20, event: "REINFORCEMENT" },
  { min: 21, max: 100, event: "INVASION" },
  { min: 101, max: 300, event: "ESPIONAGE" },
  { min: 301, max: 700, event: "SABOTAGE" },
  { min: 701, max: 1500, event: "HERO" },
  { min: 1501, max: 3000, event: "SHIELD" },
  { min: 3001, max: Infinity, event: "WAR" }
];

function eventForCoins(coins) {
  const rule = giftRules.find(r => coins >= r.min && coins <= r.max);
  return rule ? rule.event : "SCOUT";
}

function processGift({ userId, username, coins = 1, giftName = "Gift" }) {
  const player = ensurePlayer(userId || username, username || userId);
  player.coins += Number(coins) || 1;
  state.stats.gifts++;

  const event = eventForCoins(Number(coins) || 1);
  addTimeline("GIFT", "🎁 GIFT RECEIVED", `${player.name} sent ${giftName} → ${event}.`, { coins, giftName, event });
  activateEvent(event, player.id);
}

function processComment({ userId, username, comment }) {
  const player = ensurePlayer(userId || username, username || userId);
  state.stats.comments++;

  const text = String(comment || "").toLowerCase().trim();

  if (text === "!alliance" || text === "!ally") {
    const target = randomEnemy(player.id);
    if (target) addAlliance(player.id, target.id, 60000);
  } else if (text === "!war") {
    activateEvent("WAR", player.id);
  } else if (text === "!attack") {
    activateEvent("INVASION", player.id);
  } else if (text === "!shield") {
    activateEvent("SHIELD", player.id);
  } else {
    addTimeline("COMMENT", "💬 COMMENT", `${player.name}: ${String(comment).slice(0, 100)}`);
  }
  broadcastState();
}

function processLike({ userId, username }) {
  const player = ensurePlayer(userId || username, username || userId);
  state.stats.likes++;
  if (state.stats.likes % 25 === 0) {
    activateEvent("REINFORCEMENT", player.id);
  }
}

function snapshot() {
  return JSON.parse(JSON.stringify(state));
}

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

function broadcastState() {
  broadcast({ type: "STATE", state: snapshot() });
}

function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.body?.token || req.query?.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.get("/api/state", (_, res) => res.json(snapshot()));

app.post("/api/player", requireAdmin, (req, res) => {
  const { id, name } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: "id and name required" });
  const p = ensurePlayer(id, name);
  if (state.territories.every(t => !t.owner)) {
    const t = randomTerritory();
    if (t) claimTerritory(id, t.id, "founding");
  }
  broadcastState();
  res.json(p);
});

app.delete("/api/player/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  delete state.players[id];
  for (const t of state.territories) if (t.owner === id) t.owner = null;
  state.alliances = state.alliances.filter(a => a.a !== id && a.b !== id);
  recalcTerritories();
  broadcastState();
  res.json({ ok: true });
});

app.post("/api/event", requireAdmin, (req, res) => {
  const { type, actorId, targetId } = req.body || {};
  if (!type || !actorId) return res.status(400).json({ error: "type and actorId required" });
  ensurePlayer(actorId, actorId);
  if (targetId) ensurePlayer(targetId, targetId);
  activateEvent(String(type).toUpperCase(), actorId, { targetId });
  res.json({ ok: true, state: snapshot() });
});

app.post("/api/claim", requireAdmin, (req, res) => {
  const { playerId, territoryId } = req.body || {};
  ensurePlayer(playerId, playerId);
  claimTerritory(playerId, territoryId, "manual");
  broadcastState();
  res.json({ ok: true });
});

app.post("/api/alliance", requireAdmin, (req, res) => {
  const { a, b, action = "create" } = req.body || {};
  if (action === "break") breakAlliance(a, b, "manual");
  else addAlliance(a, b);
  res.json({ ok: true, state: snapshot() });
});

app.post("/api/reset", requireAdmin, (_, res) => {
  for (const t of state.territories) {
    t.owner = null;
    t.hp = 100;
    t.fortified = false;
    t.vulnerableUntil = 0;
  }
  state.players = {};
  state.alliances = [];
  state.activeEvents = [];
  state.timeline = [];
  state.pendingDiplomacy = [];
  state.stats = { gifts: 0, comments: 0, likes: 0, battles: 0, betrayals: 0, alliances: 0, territoryChanges: 0 };
  state.season.startedAt = now();
  addTimeline("SYSTEM", "🆕 NEW SEASON", "A new war has begun.");
  broadcastState();
  res.json({ ok: true });
});

app.get("/control", (_, res) => res.sendFile(path.join(__dirname, "public", "control.html")));

wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "STATE", state: snapshot() }));
});

function startTikTok() {
  if (!TIKTOK_USERNAME || !TikTokLiveConnection || !WebcastEvent) {
    addTimeline("SYSTEM", "🧪 DEMO MODE", "TikTok is not connected. Use the control panel to simulate events.");
    return;
  }

  try {
    const connection = new TikTokLiveConnection(TIKTOK_USERNAME);

    connection.connect()
      .then(() => {
        state.connected = true;
        addTimeline("SYSTEM", "🟢 TIKTOK CONNECTED", `Connected to @${TIKTOK_USERNAME}.`);
        broadcastState();
      })
      .catch(err => {
        state.connected = false;
        addTimeline("SYSTEM", "🟠 TIKTOK CONNECTION FAILED", String(err?.message || err));
        broadcastState();
      });

    connection.on(WebcastEvent.GIFT, data => {
      const user = data.user || {};
      const gift = data.gift || {};
      const repeatEnd = data.repeatEnd;
      const repeatCount = Number(data.repeatCount || 1);

      // Only process the final repeat packet for streak gifts.
      if (repeatEnd === false) return;

      const baseCoins = Number(gift.diamond_count || gift.diamondCount || 1);
      processGift({
        userId: user.userId || user.uniqueId || user.unique_id,
        username: user.uniqueId || user.nickname || "viewer",
        coins: Math.max(1, baseCoins * repeatCount),
        giftName: gift.name || giftNameFallback(data)
      });
    });

    connection.on(WebcastEvent.CHAT, data => {
      const user = data.user || {};
      processComment({
        userId: user.userId || user.uniqueId,
        username: user.uniqueId || user.nickname || "viewer",
        comment: data.comment || ""
      });
    });

    connection.on(WebcastEvent.LIKE, data => {
      const user = data.user || {};
      processLike({
        userId: user.userId || user.uniqueId,
        username: user.uniqueId || user.nickname || "viewer"
      });
    });
  } catch (err) {
    addTimeline("SYSTEM", "🔴 TIKTOK ADAPTER ERROR", String(err?.message || err));
  }
}

function giftNameFallback(data) {
  return data.gift?.giftName || data.gift?.name || "Gift";
}

// Automatic story events keep the world alive between gifts.
setInterval(() => {
  state.tick++;

  const nowMs = now();

  state.alliances = state.alliances.filter(a => a.active && a.expiresAt > nowMs);

  if (AUTO_EVENTS && state.tick % 45 === 0 && Object.keys(state.players).length >= 2) {
    const players = Object.values(state.players);
    const actor = players[Math.floor(Math.random() * players.length)];
    if (Math.random() < 0.35) {
      const enemy = randomEnemy(actor.id);
      if (enemy) {
        addTimeline("RUMOR", "👀 WAR RUMOR", `Rumors say ${actor.name} is preparing something against ${enemy.name}...`);
      }
    }
  }

  if (state.tick % 5 === 0) {
    recalcTerritories();
    broadcastState();
  }
}, 1000);

startTikTok();

server.listen(PORT, () => {
  console.log(`TIKTOK WAR V3 listening on ${PORT}`);
});
