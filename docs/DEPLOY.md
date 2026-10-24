# Deploy

Live at **https://dry-runserver-production.up.railway.app** (Railway, Hobby plan, never sleeps).

One Node app: after `npm run build`, Fastify serves the built client from `client/dist` as well as the API (`server/src/app.ts`, `clientDir`). Every push to `main` on GitHub redeploys.

## Railway (project `reliable-courtesy`, service `@dry-run/server`)

Railway no longer reads `railway.json` for new services, so these live in the service's **Settings** page, not the repo:

| Setting | Value |
|---|---|
| Root directory | empty (repo root) |
| Build command | `npm run build` |
| Start command | `npm run start --workspace=@dry-run/server` (same as `npm start`) |
| Healthcheck path | `/api/health` (its Atlas ping gives up after 2 s, so a slow Atlas can't fail a deploy) |
| Watch paths | none, so any push redeploys |
| Region | EU West (Amsterdam) |
| Public domain | `dry-runserver-production.up.railway.app` → port 8080 (Railway sets `PORT`; the server reads it) |

**Variables:** `MONGODB_URI`, `GEMINI_API_KEY`, `MONGODB_DB=dryrun`, `CENTRE_ID=wanstead`, `DEMO_MODE=true`, `MONGOMS_DISABLE_POSTINSTALL=1` (skips the test-only mongod download). `ASP_CONNECTION` and `REPORT_BASE_URL` are set too but the server doesn't read them. Ignore Railway's "Suggested Variables": they're placeholders from `.env.example`.

Railway first made one service per workspace (`client`, `server`, `tools`); the other two were deleted. If it ever does that again, keep only the server.

## Atlas

Network Access has `0.0.0.0/0` (comment "Railway deploy"), because Railway has no fixed outgoing address. Only the database password protects the cluster now, so never show `MONGODB_URI` in a video or screenshot.

## Checking it

- `/api/health` should say `"mongo":"up"` and `"gemini":"configured"`.
- The game's top-left corner shows `server ok · mongo up`.
- End a test with Enter: the result screen says "Saved to Atlas · session …".
- `/api/live-token` returns a token: the 'tell me' question (T) can reach Gemini Live.
- `/instructor` opens the dashboard.

## Run the deployed build locally

```
npm run build
npm start          # http://localhost:3000 serves the game and the API
```

On this Windows machine Node can't look up Atlas's SRV record (`querySrv EBADRESP`), so local runs may show `mongo down`; Railway (Linux) is fine.
