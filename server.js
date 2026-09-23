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

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Prize table. `rarity` (0 = most common) drives how gift size shifts odds.
// ---------------------------------------------------------------------------
const PRIZES = [
  { id: "spark",   label: "+10",  short: "Spark",       color: "#35E0C7", points: 10,  rarity: 0, weight: 30 },
  { id: "glow",    label: "+25",  short: "Glow",        color: "#FFC145", points: 25,  rarity: 1, weight: 22 },
  { id: "shield",  label: "60s",  short: "Shield",      color: "#4C8DFF", points: 5,   rarity: 2, weight: 12, effect: "shield" },
  { id: "surge",   label: "+50",  short: "Surge",       color: "#FF3D7F", points: 50,  rarity: 2, weight: 15 },
  { id: "double",  label: "x2",   short: "Double",      color: "#B46CFF", points: 5,   rarity: 3, weight: 9,  effect: "double" },
  { id: "blast",   label: "+100", short: "Blast",       color: "#FFC145", points: 100, rarity: 3, weight: 7 },
  { id: "steal",   label: "20%",  short: "Crown Steal", color: "#FF5C3D", points: 0,   rarity: 4, weight: 3,  effect: "steal" },
  { id: "jackpot", label: "+300", short: "JACKPOT",     color: "#FFD23F", points: 300, rarity: 5, weight: 2 }
];

const SLICE_ANGLE = 360 / PRIZES.length;

const COLORS = ["#35E0C7", "#FF3D7F", "#FFC145", "#B46CFF", "#4C8DFF", "#FF5C3D"];

const state = {
  version: 1,
  connected: false,
  liveUsername: TIKTOK_USERNAME,
  startedAt: Date.now(),
  title: "GACHA ARENA",
  players: {},
  timeline: [],
  lastSpin: null,
  stats: { gifts: 0, comments: 0, likes: 0, spins: 0, jackpots: 0, steals: 0 }
};

function uid(prefix = "id") {
  return prefix + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function now() { return Date.now(); }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

function addTimeline(type, title, text, meta = {}) {
  const item = { id: uid("evt"), ts: now(), type, title, text, meta };
  state.timeline.unshift(item);
  state.timeline = state.timeline.slice(0, 60);
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
      points: 0,
      spins: 0,
      coins: 0,
      shieldUntil: 0,
      doubleNext: false,
      bestPrize: null,
      createdAt: now()
    };
  }
  return state.players[id];
}

// ---------------------------------------------------------------------------
// Odds: bigger gifts skew the wheel toward rarer prizes without changing
// how many times it spins — one gift, one spin, better luck.
// ---------------------------------------------------------------------------
const GIFT_TIERS = [
  { min: 1,    max: 5,    luck: 0 },
  { min: 6,    max: 20,   luck: 0.15 },
  { min: 21,   max: 100,  luck: 0.3 },
  { min: 101,  max: 300,  luck: 0.5 },
  { min: 301,  max: 700,  luck: 0.7 },
  { min: 701,  max: 1500, luck: 0.85 },
  { min: 1501, max: Infinity, luck: 1 }
];

function luckForCoins(coins) {
  const tier = GIFT_TIERS.find(t => coins >= t.min && coins <= t.max);
  return tier ? tier.luck : 0;
}

function weightedPick(luck) {
  const weights = PRIZES.map(p => p.weight * (1 + luck * p.rarity * 0.6));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < PRIZES.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return i;
  }
  return PRIZES.length - 1;
}

function getLeader(excludeId) {
  let leader = null;
  for (const p of Object.values(state.players)) {
    if (p.id === excludeId) continue;
    if (!leader || p.points > leader.points) leader = p;
  }
  return leader;
}

function applyPrize(player, prize) {
  let pts = prize.points || 0;
  let note = "";

  if (player.doubleNext) {
    pts *= 2;
    player.doubleNext = false;
    note = " (doubled!)";
  }

  if (prize.effect === "shield") {
    player.shieldUntil = now() + 60000;
  }

  if (prize.effect === "double") {
    player.doubleNext = true;
  }

  if (prize.effect === "steal") {
    const leader = getLeader(player.id);
    if (leader && leader.shieldUntil <= now() && leader.points > 0) {
      const stolen = Math.floor(leader.points * 0.2);
      leader.points = clamp(leader.points - stolen, 0, 9999999);
      pts += stolen;
      state.stats.steals++;
      addTimeline("STEAL", "⚔️ CROWN STOLEN", `${player.name} stole ${stolen} pts from ${leader.name}.`);
    } else {
      note = " (no target)";
    }
  }

  player.points = clamp(player.points + pts, 0, 9999999);
  player.spins++;
  if (prize.id === "jackpot") state.stats.jackpots++;

  return note;
}

function processGift({ userId, username, coins = 1, giftName = "Gift" }) {
  const player = ensurePlayer(userId || username, username || userId);
  const cleanCoins = Math.max(1, Number(coins) || 1);
  player.coins += cleanCoins;
  state.stats.gifts++;
  state.stats.spins++;

  const luck = luckForCoins(cleanCoins);
  const prizeIndex = weightedPick(luck);
  const prize = PRIZES[prizeIndex];
  const note = applyPrize(player, prize);

  state.lastSpin = {
    playerId: player.id,
    playerName: player.name,
    playerColor: player.color,
    prizeIndex,
    prizeId: prize.id,
    coins: cleanCoins,
    ts: now()
  };

  broadcast({ type: "SPIN", spin: state.lastSpin });
  addTimeline(
    prize.id === "jackpot" ? "JACKPOT" : "GIFT",
    prize.id === "jackpot" ? "👑 JACKPOT!" : "🎡 SPIN",
    `${player.name} sent ${giftName} (${cleanCoins}) → ${prize.short}${note}`,
    { giftName, coins: cleanCoins, prize: prize.id }
  );
  broadcastState();
}

function processComment({ userId, username, comment }) {
  const player = ensurePlayer(userId || username, username || userId);
  state.stats.comments++;
  addTimeline("COMMENT", "💬 COMMENT", `${player.name}: ${String(comment || "").slice(0, 100)}`);
  broadcastState();
}

function processLike({ userId, username, count = 1 }) {
  const player = ensurePlayer(userId || username, username || userId);
  state.stats.likes += Number(count) || 1;
  broadcastState();
}

function snapshot() {
  return JSON.parse(JSON.stringify({ ...state, prizes: PRIZES }));
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
  const token = req.headers["x-admin-token"] || req.body?.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: "Unauthorized" });
  next();
}

app.get("/api/state", (_, res) => res.json(snapshot()));

app.post("/api/gift", requireAdmin, (req, res) => {
  const { name, coins, giftName } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  processGift({ userId: name, username: name, coins: coins || 1, giftName: giftName || "Gift" });
  res.json({ ok: true, state: snapshot() });
});

app.post("/api/comment", requireAdmin, (req, res) => {
  const { name, comment } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  processComment({ userId: name, username: name, comment: comment || "..." });
  res.json({ ok: true });
});

app.post("/api/like", requireAdmin, (req, res) => {
  const { name, count } = req.body || {};
  if (!name) return res.status(400).json({ error: "name required" });
  processLike({ userId: name, username: name, count: count || 1 });
  res.json({ ok: true });
});

app.delete("/api/player/:id", requireAdmin, (req, res) => {
  delete state.players[req.params.id];
  broadcastState();
  res.json({ ok: true });
});

app.post("/api/reset", requireAdmin, (_, res) => {
  state.players = {};
  state.timeline = [];
  state.lastSpin = null;
  state.stats = { gifts: 0, comments: 0, likes: 0, spins: 0, jackpots: 0, steals: 0 };
  state.startedAt = now();
  addTimeline("SYSTEM", "🆕 NEW SEASON", "The wheel resets. Good luck.");
  broadcastState();
  res.json({ ok: true });
});

app.get("/control", (_, res) => res.sendFile(path.join(__dirname, "public", "control.html")));

wss.on("connection", ws => {
  ws.send(JSON.stringify({ type: "STATE", state: snapshot() }));
});

function giftNameFallback(data) {
  return data.gift?.giftName || data.gift?.name || "Gift";
}

function startTikTok() {
  if (!TIKTOK_USERNAME || !TikTokLiveConnection || !WebcastEvent) {
    addTimeline("SYSTEM", "🧪 DEMO MODE", "TikTok is not connected. Use the control panel to simulate gifts.");
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
        username: user.uniqueId || user.nickname || "viewer",
        count: Number(data.likeCount || 1)
      });
    });
  } catch (err) {
    addTimeline("SYSTEM", "🔴 TIKTOK ADAPTER ERROR", String(err?.message || err));
  }
}

startTikTok();

server.listen(PORT, () => {
  console.log(`GACHA ARENA listening on ${PORT}`);
});
