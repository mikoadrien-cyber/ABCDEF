# GACHA ARENA

A TikTok LIVE gacha-wheel game. Every gift spins the wheel; bigger gifts skew the odds
toward rarer prizes. Viewers climb a live leaderboard. Built for maximum gift volume:
the wheel pays out on every single gift, no waiting for a "big moment".

## Core loop

TikTok LIVE gift -> weighted spin -> points / shield / double / crown-steal -> leaderboard update -> WebSocket -> LIVE screen + CONTROL panel

## Prizes

| Prize | Effect |
|---|---|
| Spark / Glow / Surge / Blast | Flat points |
| Shield | 60s immunity from Crown Steal |
| Double | Next spin's points are doubled |
| Crown Steal | Takes 20% of the current leader's points |
| Jackpot | +300 points, rarest slice |

Bigger gifts don't add more spins — they shift the odds toward the rarer, juicier
prizes. One gift, one spin, better luck.

## Run locally

```bash
npm install
npm start
```

- `/` = LIVE screen (use as an OBS browser source)
- `/control` = host control panel (simulate gifts without a live TikTok stream)
- `/api/state` = current state (JSON)

## Deploy on Render

- Build: `npm install`
- Start: `npm start`
- Env vars: `ADMIN_TOKEN` (required), `TIKTOK_USERNAME` (optional — leave empty for demo mode)

## Security

`/control` and all `/api/*` write endpoints require `ADMIN_TOKEN`. Change it before
going live — anyone with the token can trigger gifts and steal points.
