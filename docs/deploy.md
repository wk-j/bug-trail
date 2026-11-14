# Deploy a shared server

Run one dashboard for the whole team. Agents on any machine upload their trails to it.

## Docker Compose

```bash
cp .env.example .env
# set BUG_TRAIL_TOKEN in .env, for example to the output of: openssl rand -hex 32
docker compose up -d --build
```

The dashboard is on port 4317. Trails live in the `trails` Docker volume, so they survive restarts
and upgrades. Compose refuses to start without `BUG_TRAIL_TOKEN`.

`.env` options:

| Variable | Meaning |
|---|---|
| `BUG_TRAIL_TOKEN` | Token that uploads must present. Required. |
| `BUG_TRAIL_PORT` | Port on the host (default 4317). |
| `BUG_TRAIL_BIND` | Interface to publish on (default `0.0.0.0`). Use `127.0.0.1` behind a reverse proxy on the same host. |
| `BUG_TRAIL_VERSION` | Image tag and the version `bug-trail version` reports. |

The image is a static binary on `distroless/static:nonroot`: no shell, a non-root user and a
read-only root filesystem. `bug-trail healthcheck` drives the Docker health check.

## Connect agents

On each machine where an agent runs, install `bug-trail` and the [skill](agents.md), then point
it at the server once:

```bash
bug-trail config set server http://your-server:4317
bug-trail config set token        # the token from the server's .env; it isn't echoed
```

With a server configured, the skill writes each trail locally, validates it, and uploads it with
`bug-trail push`. You can push files by hand too: `bug-trail push ~/.bug-trail/trails/*.json`.
See [Configuration](configuration.md).

## Security

Reading (the dashboard and `GET /api/…`) is open to anyone who can reach the port. Writing
(`PUT` and `DELETE /api/trails/{id}`) needs the bearer token, and the server rejects files with
format errors or over 5 MB.

Trails can contain code snippets from private repositories. To keep them private, put the server
behind a reverse proxy that adds TLS and login (Caddy, nginx, Traefik, Cloudflare Access) or on a
private network such as a VPN or tailnet, and set `BUG_TRAIL_BIND=127.0.0.1` so only the proxy
can reach it. Live updates use server-sent events, so turn off response buffering for `/events`
in the proxy.

## HTTP API

| Endpoint | Auth | |
|---|---|---|
| `GET /api/trails` | – | list trails |
| `GET /api/trails/{id}` | – | one trail plus its validation result |
| `PUT /api/trails/{id}` | Bearer token | create (201) or replace (200); 422 if invalid, 413 if too large |
| `DELETE /api/trails/{id}` | Bearer token | remove (204) |
| `GET /events` | – | server-sent events, `data: {"id": …}` on every change |
| `GET /healthz` | – | health check |
