# KZ Dashboard

A container operations dashboard for managing Docker workloads from a web UI, with a NestJS backend using Dockerode and a Next.js frontend using App Router + Tailwind + shadcn/ui.

---

## 1) Project Overview

### What this system does

KZ Dashboard gives operators a single web interface to:

- Discover running/stopped containers
- Start, stop, restart individual containers
- Execute bulk actions safely
- Group and control containers by cluster
- View container logs and live resource usage (CPU/RAM)
- Monitor host-level CPU, memory, and uptime

### What problem it solves

In many lab/server environments, container operations are fragmented between terminal commands, scripts, and ad-hoc tooling. That makes operational visibility and demos difficult. This project centralizes those operations into one dashboard so users can manage containers quickly and consistently without manually running Docker CLI commands.

### Why it was built

This system was built to provide:

- **Operational clarity**: one place to see service state
- **Faster actions**: UI-driven start/stop/restart workflows
- **Safer control**: protected containers and filtered bulk actions
- **Presentation readiness**: clear, explainable end-to-end architecture for demos and project defense

---

## 2) System Architecture (Very Important)

## End-to-end flow

Frontend UI → Next.js API Proxy → NestJS Backend → Dockerode SDK → Docker Engine (socket) → Containers

```mermaid
flowchart LR
    A[User in Browser]\nDashboard UI --> B[Next.js App Router]\n/api/* proxy routes
    B --> C[NestJS API]\n/containers /clusters /stats
    C --> D[Dockerode]
    D --> E[/var/run/docker.sock]
    E --> F[Host Docker Engine]
    F --> G[Containers]
    G --> F --> E --> D --> C --> B --> A
```

### Layer responsibilities

- **Frontend (Next.js + React)**
  - Renders dashboard, cards, tables, logs panel, and controls.
  - Polls container/host stats and updates UI state.
  - Sends user actions (start/stop/restart/bulk/cluster) to internal Next API routes.

- **Next.js proxy layer (`web/app/api/**`)\*\*
  - Receives browser calls on same-origin endpoints like `/api/containers`.
  - Validates simple route params (allowed actions).
  - Forwards requests to backend using `BACKEND_URL`.
  - Returns backend response transparently to the UI.

- **Backend (NestJS)**
  - Exposes operational endpoints: containers, clusters, host stats, health.
  - Encapsulates Docker logic in services.
  - Applies protections (skip dashboard infrastructure containers in bulk/cluster operations).
  - Computes container and host metrics.

- **Dockerode integration**
  - Programmatic Node.js client for Docker Engine API.
  - Executes inspect/list/start/stop/restart/stats/logs operations.

- **Docker Engine + containers**
  - Real execution layer for lifecycle changes and metrics/log streams.

---

## 3) How Container Management Works Internally

### Example: user clicks **Stop container**

1. User clicks **Stop** in the dashboard row.
2. Frontend calls `POST /api/containers/:id/stop` (Next.js route handler).
3. Next.js proxy forwards to backend: `POST /containers/:id/stop`.
4. NestJS controller delegates to `ContainersService.stopContainer(id)`.
5. Service resolves Docker container via Dockerode and calls `container.stop()`.
6. Docker Engine stops the container process.
7. Backend returns success payload.
8. Next proxy relays response to browser.
9. Frontend refreshes container list and updates status badges/cards.

This same path pattern applies to **start**, **restart**, **bulk**, and **cluster** actions.

---

## 4) Backend Explanation

### What Dockerode is

Dockerode is a Node.js client library for the Docker Remote API. Instead of shelling out to `docker` CLI commands, backend code performs strongly-typed SDK calls (`listContainers`, `getContainer`, `start`, `stop`, `stats`, `logs`, etc.).

### How backend connects to Docker socket

In `ContainersService`, Dockerode is initialized with a socket path:

- Linux VM: `/var/run/docker.sock`
- Windows dev fallback: `//./pipe/docker_engine`

That means the backend talks directly to Docker Engine through the host socket mount.

### How container listing works

- Endpoint: `GET /containers`
- Service calls `docker.listContainers({ all: true })`
- Maps each Docker summary into `ContainerDto` with:
  - `id`, `name`, `image`, `state`, `status`, `labels`, `cluster`
- `cluster` is resolved by:
  1. `kz.cluster` label
  2. `com.docker.compose.project` label
  3. Name heuristics (`monitoring`, `logging`, `databases`, fallback `other`)

### How start/stop/restart works

- Endpoints:
  - `POST /containers/:id/start`
  - `POST /containers/:id/stop`
  - `POST /containers/:id/restart`
- Service verifies existence via `inspect()` and then calls the corresponding Dockerode operation.
- Bulk endpoints (`/containers/bulk/{action}`) and cluster endpoints (`/clusters/:cluster/{action}`) run operations concurrently with capped worker count.

### How CPU and RAM container stats are calculated

Endpoint: `GET /containers/:id/stats`

From Docker stats snapshots:

- $\Delta cpu = cpu\_total\_usage - precpu\_total\_usage$
- $\Delta system = system\_cpu\_usage - presystem\_cpu\_usage$
- $CPU\% = \left(\frac{\Delta cpu}{\Delta system}\right) \times online\_cpus \times 100$ (when deltas > 0)
- $MEM\% = \left(\frac{memory\_usage}{memory\_limit}\right) \times 100$

Returned payload includes:

- `cpuPercent`
- `memUsageBytes`
- `memLimitBytes`
- `memPercent`
- `pids`

### Host metrics

Endpoint: `GET /stats/host`

- CPU sampled over 500ms via Node `os.cpus()` time deltas
- Memory from `os.totalmem()` and `os.freemem()`
- Uptime from `os.uptime()`

---

## 5) Frontend Explanation

### How dashboard fetches data

The dashboard component periodically fetches:

- `/api/containers`
- `/api/stats/host`
- `/api/containers/:id/stats` for visible rows

It refreshes automatically on an interval (5s) when no action is currently pending, and also supports manual refresh.

### How actions are triggered

User controls call Next.js API routes:

- Single: `/api/containers/:id/{start|stop|restart}`
- Bulk: `/api/containers/bulk/{start|stop|restart}`
- Cluster: `/api/clusters/:cluster/{start|stop|restart}`

UI then refreshes to reflect updated state and shows toast notifications.

### How proxy routes work

Each route in `web/app/api/**/route.ts`:

1. Reads params/body from browser request
2. Validates allowed action values where needed
3. Calls backend URL (`BACKEND_URL`)
4. Returns backend response content + status

### Why proxy is used

- Keeps browser calls same-origin (`/api/*`), simplifying networking and CORS posture.
- Avoids exposing backend topology directly to browser clients.
- Centralizes request forwarding and action validation logic in one layer.

---

## 6) Docker Deployment Explanation

### How Compose builds API and Web

`deploy/dashboard.compose.yml` defines two services:

- `dashboard-api` (builds from `api/`)
- `dashboard-web` (builds from `web/`)

### How containers communicate

Both services join the same external Docker network (`kz-sploitable_vuln_net`).
The web service talks to backend by service DNS name:

- `BACKEND_URL=http://dashboard-api:3001`

### How dashboard accesses host Docker

The API service mounts host socket:

- `/var/run/docker.sock:/var/run/docker.sock`

So backend Dockerode calls control the host’s Docker Engine directly.

### Exposed access

Web is published on loopback only:

- `127.0.0.1:9010 -> container:3000`

---

## 7) Security Considerations

### Docker socket risk

Mounting `docker.sock` is high privilege. Any code with socket access can effectively control host containers and potentially escalate to host-level impact.

### Protected containers

Backend intentionally excludes protected service containers from destructive bulk/cluster actions:

- Defaults include `kz-dashboard-api`, `kz-dashboard-web` (and other system names)
- Can be overridden via `PROTECTED_CONTAINERS` environment variable

This reduces chance of shutting down the dashboard itself during mass operations.

### Why proxy over direct backend exposure

The proxy layer avoids direct browser-to-backend topology exposure and keeps control endpoints behind Next.js same-origin routing. It also allows lightweight server-side validation before forwarding.

### Recommended hardening for production

- Restrict dashboard access behind VPN/reverse proxy auth.
- Keep web port bound to localhost unless explicitly needed.
- Use least-privilege host/network controls around VM.
- Audit/rotate container images and dependencies.

---

## 8) Feature List

- Container list with state/status, image, and cluster grouping
- Single-container actions: Start / Stop / Restart
- Bulk actions across all non-protected containers
- Cluster-level actions for selected cluster
- Logs viewer with adjustable tail and copy support
- Per-container CPU/RAM monitoring + host CPU/RAM/uptime
- Dark mode toggle (theme support)

---

## 9) How to Run Locally

## Prerequisites

- Node.js 20+
- npm
- Docker Engine available on your machine

## A) Run with Node (dev mode)

### 1) Start backend

```bash
cd api
npm install
npm run start:dev
```

Backend runs on `http://localhost:3001`.

### 2) Start frontend

In a new terminal:

```bash
cd web
npm install
# optional if backend is not at localhost:3001
# set BACKEND_URL=http://localhost:3001
npm run dev
```

Frontend runs on `http://localhost:3000`.

### 3) Open dashboard

Visit:

- `http://localhost:3000`

## B) Run with Docker Compose (project-like environment)

From the repo root:

```bash
docker compose -f deploy/dashboard.compose.yml up --build -d
```

Then open:

- `http://127.0.0.1:9010`

---

## 10) How to Deploy on Server

## Target model

- Linux VM host
- Docker installed and running
- Existing external network: `kz-sploitable_vuln_net`

## Steps

1. Copy project to VM.
2. Ensure external network exists:
   ```bash
   docker network create kz-sploitable_vuln_net || true
   ```
3. Deploy services:
   ```bash
   docker compose -f deploy/dashboard.compose.yml up --build -d
   ```
4. Verify containers:
   ```bash
   docker ps --filter name=dashboard-
   ```
5. Access dashboard on VM loopback: `127.0.0.1:9010`.

## Operational checks

- API health: `GET /health` via backend container network
- UI should show container list and host metrics
- Test start/stop/restart on a non-critical container

---

## 11) Technical Decisions

### Why NestJS

- Clear module/controller/service architecture for maintainable ops APIs
- Strong TypeScript ergonomics and dependency injection
- Good fit for structured backend logic (container actions, stats, policy checks)

### Why Next.js App Router

- Unified frontend + server route handlers (proxy layer)
- Clean same-origin API abstraction for browser clients
- Good DX for React UI with production-ready build output (`standalone`)

### Why Docker Compose

- Simple multi-service packaging for API + Web
- Deterministic networking and environment wiring
- Easy replication between local VM and server deployment

---

## 12) Demo Explanation Section (Critical)

Use this script during presentation to explain both value and internals.

### Suggested live narration

- “This dashboard gives me a centralized control plane for Docker containers. I can see what is running, what is stopped, and current resource usage.”
- “When I press **Restart** on a container, the browser calls an internal Next.js API route, not the backend directly.”
- “That proxy route forwards the request to the NestJS backend, which calls Dockerode.”
- “Dockerode sends the command to Docker Engine through the mounted socket, the container restarts, and the response flows back to the UI.”
- “The UI then refreshes every few seconds, so status and metrics reflect the new container state quickly.”
- “For safety, bulk and cluster actions skip protected dashboard containers to avoid accidental self-shutdown.”

### Demo path (recommended)

1. Show container list and cluster filter.
2. Open one container logs panel.
3. Restart a safe container and observe status/uptime change.
4. Trigger a cluster action and show success/failure summary.
5. Highlight host CPU/RAM and container CPU/RAM cards.
6. Toggle dark mode to show UI completeness and usability.

### Defense-ready talking points

- **Architecture clarity**: Frontend concerns are separated from Docker control logic.
- **Operational safety**: protected container policy + scoped routes.
- **Scalability approach**: bulk operations use bounded concurrency.
- **Maintainability**: strongly typed DTOs and modular backend structure.

---

## 13) Summary

KZ Dashboard is a practical, explainable Docker operations platform: a Next.js UI and proxy layer on top of a NestJS + Dockerode control API. It enables real container lifecycle management, logs inspection, and resource monitoring from one place, while preserving a clear architecture that is easy to present and defend in technical reviews.

---

## API Surface Reference

### Backend routes

- `GET /health`
- `GET /containers`
- `POST /containers/:id/start`
- `POST /containers/:id/stop`
- `POST /containers/:id/restart`
- `GET /containers/:id/stats`
- `GET /containers/:id/logs?tail=200`
- `POST /containers/bulk/start`
- `POST /containers/bulk/stop`
- `POST /containers/bulk/restart`
- `POST /clusters/:cluster/start`
- `POST /clusters/:cluster/stop`
- `POST /clusters/:cluster/restart`
- `GET /stats/host`

### Frontend proxy routes

- `GET /api/containers`
- `POST /api/containers/:id/:action`
- `POST /api/containers/bulk/:action`
- `GET /api/containers/:id/stats`
- `GET /api/containers/:id/logs?tail=200`
- `POST /api/clusters/:cluster/:action`
- `GET /api/stats/host`

---

## Notes

- Compose file expects an external network named `kz-sploitable_vuln_net`.
- Web service is bound to localhost by default (`127.0.0.1:9010`).
- `deploy/.env.example` currently contains a placeholder `JWT_SECRET`; this dashboard version does not yet enforce authentication in the shown code path.
