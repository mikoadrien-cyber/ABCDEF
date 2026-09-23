# TIKTOK WAR V3

A mobile-friendly TikTok LIVE territory game.

## Core loop

TikTok LIVE -> comments / likes / gifts -> Event Engine -> World State -> WebSocket -> LIVE + CONTROL

The game is designed so viewers influence the war, while the host remains the game master.

## Included

- Territory map
- Players and kingdoms
- Automatic gift events
- Alliances
- Betrayals
- Espionage
- Sabotage
- Invasions
- Shields
- Heroes
- Catastrophes
- Secret events
- Story timeline
- Live HUD
- Mobile control panel
- Manual event controls
- Player management
- TikTok connector adapter
- Demo mode for testing without TikTok

## Run locally

```bash
npm install
npm start
```

Open:

- `/` = LIVE screen
- `/control` = host control
- `/api/state` = current state

For testing without TikTok, use the DEMO buttons in the control panel.

## Render

Create a Web Service from this project.

Build:
`npm install`

Start:
`npm start`

Environment variables:

- `ADMIN_TOKEN`
- `TIKTOK_USERNAME`
- `AUTO_EVENTS=true`

Important: TikTok connector behavior can change independently of this project. The TikTok adapter is isolated in `server.js`, so it can be replaced without changing the game engine.

## Security

The control page uses `ADMIN_TOKEN` for API actions. Change it before deployment.

This project does not let viewers directly control the map. TikTok interactions create game events; the host controls sensitive diplomatic/manual actions.
