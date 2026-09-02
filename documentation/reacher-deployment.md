# Reacher Deployment

> **Scope:** The self-hosted Reacher (check-if-email-exists) backend in `reacher-deploy/`: why it exists, network topology, container config, and how the app talks to it.

## Why self-hosted

The Next.js app runs on Vercel serverless, which cannot hold open SMTP connections, so it never runs Reacher's CLI in-process. Instead a Reacher HTTP backend runs as a Docker container on a VPS and the app calls it over HTTPS. Per-check cost is zero; the only cost is the VPS itself.

## Topology

```
Vercel app
   |  POST https://<tunnel-hostname>/v0/check_email
   |  header: x-reacher-secret
   v
Cloudflare Tunnel (TLS at Cloudflare's edge)
   |  forwards to http://localhost:8080 on the VPS
   v
reacherhq/backend container (binds 127.0.0.1:8080 only)
   |  SMTP probes via SOCKS5 proxy (VPS has no port 25)
   v
Target mail servers
```

- Reacher binds to localhost only (`127.0.0.1:8080:8080`); no inbound ports are opened on the VPS. `cloudflared` forwards a public hostname to it, configured in Cloudflare Zero Trust > Tunnels as a public hostname route to `http://localhost:8080`.
- Outbound SMTP goes through a SOCKS5 proxy because the VPS itself has no port 25 egress. Using a proxy also keeps the app's own infrastructure off SMTP blocklists.
- Requests must carry the shared secret header; the app sends `x-reacher-secret: $REACHER_SECRET` (see `lib/reacher.ts`), matching the container's `RCH__HEADER_SECRET`.

## Container configuration (docker-compose.yml)

| Env var | Purpose |
|---|---|
| `RCH__HTTP_HOST` | `0.0.0.0` inside the container (host mapping restricts it to localhost) |
| `RCH__HEADER_SECRET` | Shared secret required on every request |
| `RCH__PROXY__HOST` / `RCH__PROXY__PORT` | SOCKS5 proxy for SMTP probing |
| `RCH__PROXY__USERNAME` / `RCH__PROXY__PASSWORD` | Proxy credentials |
| `RCH__FROM_EMAIL` | Identity used in the SMTP conversation (compose comment: use your real domain) |
| `RCH__HELLO_NAME` | HELO/EHLO name used in the SMTP greeting |

All values come from a `.env` file next to the compose file. Image: `reacherhq/backend:latest`, `restart: unless-stopped`.

## Deploying on the VPS

Per the comments in `docker-compose.yml`:

```bash
cp .env.example .env   # then fill in real values
docker compose up -d
```

Then add the tunnel route in Cloudflare Zero Trust: `<tunnel-hostname> -> http://localhost:8080`.

Note: the compose comments reference a local `.env.example`; the checked-in `reacher-deploy/` directory contains only `docker-compose.yml`, so create the `.env` from the variable table above.

## App-side configuration

| App env var | Meaning |
|---|---|
| `REACHER_BACKEND_URL` | `https://<tunnel-hostname>` (trailing slash stripped by the client) |
| `REACHER_SECRET` | Must match `RCH__HEADER_SECRET` |
| `VERIFICATION_METHOD` | `RR` (Reacher only) or `BOTH` (Reacher primary, MV second opinion) to route checks here |

Because Reacher probes real SMTP through a single proxy IP, the bulk runner serializes real verifications to concurrency 1 (see `documentation/bulk-processing.md`); parallel probes get the IP throttled by large providers and produce false negatives.

## Related Files

| File | Purpose |
|---|---|
| `reacher-deploy/docker-compose.yml` | Container definition and deployment notes |
| `lib/reacher.ts` | HTTP client (endpoint, secret header) |
| `lib/reacherMap.ts` | Verdict mapping |
| `.env.example` | App-side Reacher variables |
