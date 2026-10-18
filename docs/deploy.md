# Deploying Keystone (one EC2 instance + Vercel)

This guide takes you from nothing to a public Keystone: the API, worker, FalkorDB,
Redis and Caddy run with Docker Compose on **one EC2 instance**; the web app runs on
**Vercel**. Follow the steps in order. Commands marked **(laptop)** run on your machine,
**(server)** run over SSH on the instance.

```
 browser ──HTTPS──> Vercel (apps/web)
    │
    └──HTTPS──> EC2 :443  caddy ──> api:4000 ──> falkordb:6379  (graph, never published)
                                      │     └──> redis:6379     (BullMQ, never published)
                                    worker (ingest jobs, backups, actions export)
```

What you need: an AWS account, a GitHub account with this repository, a Vercel account,
and on your laptop the `data/` folder that built your graph (with `cache/` and `llm-cache/`).

---

## 0. Before you start (laptop)

1. Commit and push this deployment work and merge it into `main` (the server clones `main`):

   ```bash
   git status            # data/, .env and .env.prod must NOT appear (they are gitignored)
   git push
   ```

2. Check the data the seed needs is complete. The seed never calls an API, so every
   cache entry must already exist. With your local stack running:

   ```bash
   pnpm --filter @keystone/api build
   pnpm seed             # "skipped: apex already has 44 people" is fine
   ```

   Optional, stronger: `LLM_CACHE_ONLY=yes pnpm extract --dry-run` must plan 0 LLM calls.
   The real proof is step 6: if any entry is missing, the seed stops with the full list
   before it writes anything.

3. Optional: to carry approvals you already made locally into production, set `ADMIN_TOKEN`
   in your local `.env`, restart the API and run
   `curl -X POST -H "x-admin-token: $ADMIN_TOKEN" http://localhost:4000/admin/export-actions`.
   This writes `data/exports/actions-latest.jsonl`, which the server's seed restores.

---

## 1. Launch the EC2 instance (AWS console)

1. **Region:** top right of the console, pick the region closest to you
   (from India: *Asia Pacific (Mumbai) ap-south-1*). Everything below happens in that region.
2. **EC2 → Instances → Launch instances**
   - Name: `keystone`
   - AMI: **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type**, 64-bit (x86)
   - Instance type: **t3.large** (2 vCPU, 8 GB RAM)
   - Key pair: **Create new key pair** → `keystone`, RSA, `.pem` → it downloads `keystone.pem`
   - Network settings → **Edit** → *Create security group* named `keystone-sg` with exactly these inbound rules:

     | Type | Port | Source | Why |
     |---|---|---|---|
     | SSH | 22 | **My IP** | only you can log in |
     | HTTP | 80 | Anywhere (0.0.0.0/0) | Let's Encrypt challenge, redirect to HTTPS |
     | HTTPS | 443 | Anywhere (0.0.0.0/0) | the API |
     | Custom UDP | 443 | Anywhere (0.0.0.0/0) | optional: HTTP/3 |

     > **Never** add rules for **6379** (FalkorDB/Redis), **3000** / **3100** (FalkorDB Browser,
     > web dev), **6380** or **4000** (the API directly). Those services are only reachable
     > inside Docker's network; Caddy on 443 is the only way in.

   - Configure storage: **30 GiB**, volume type **gp3**
   - **Launch instance**.
3. **Elastic IP:** EC2 → Network & Security → **Elastic IPs → Allocate Elastic IP address →
   Allocate**. Select it → **Actions → Associate Elastic IP address** → Instance `keystone` →
   **Associate**. Write the address down; this guide calls it `203.0.113.10`.

> "My IP" changes when your network does. If SSH later times out, edit the SSH rule of
> `keystone-sg` and choose *My IP* again.

On your laptop, keep the key safe and set two shell variables used below:

```bash
# (laptop)
mv ~/Downloads/keystone.pem ~/.ssh/keystone.pem && chmod 400 ~/.ssh/keystone.pem
export EIP=203.0.113.10                     # your Elastic IP
ssh -i ~/.ssh/keystone.pem ubuntu@$EIP       # answer "yes" once; you are now on the server
```

---

## 2. Install Docker Engine and the compose plugin (server)

Docker's official apt repository for Ubuntu:

```bash
# (server)
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start Docker on every boot, and let the ubuntu user run docker without sudo.
sudo systemctl enable --now docker containerd
sudo usermod -aG docker ubuntu
exit
```

Log in again (the group change needs a new session) and check:

```bash
# (laptop)
ssh -i ~/.ssh/keystone.pem ubuntu@$EIP
# (server)
docker version --format '{{.Server.Version}}' && docker compose version
systemctl is-enabled docker        # enabled
```

---

## 3. Domain name

Caddy needs a hostname that points at the Elastic IP to get an HTTPS certificate.

- **You have a domain:** create an `A` record, e.g. `api.example.com → 203.0.113.10`, and use
  `API_DOMAIN=api.example.com`.
- **No domain:** use [sslip.io](https://sslip.io), which resolves a name made from the IP to
  that IP. Replace the dots with dashes: `API_DOMAIN=203-0-113-10.sslip.io`. Check it resolves
  from your laptop: `nslookup 203-0-113-10.sslip.io` → `203.0.113.10`.

---

## 4. Get the code and configure it (server)

```bash
# (server)
git clone --branch main https://github.com/amanraj069/KeyStone.git ~/keystone
cd ~/keystone
cp .env.prod.example .env.prod
chmod 600 .env.prod
ln -s .env.prod .env        # docker compose reads FALKOR_PASSWORD and API_DOMAIN from .env
openssl rand -hex 32        # run twice: one value for FALKOR_PASSWORD, one for ADMIN_TOKEN
nano .env.prod
```

(If the repository is private, clone with a GitHub fine-grained personal access token
with read-only *Contents* access: `git clone https://<token>@github.com/amanraj069/KeyStone.git ~/keystone`.)

Fill in at least:

| Variable | Value |
|---|---|
| `API_DOMAIN` | `203-0-113-10.sslip.io` (or your domain), no `https://` |
| `WEB_ORIGIN` | keep the placeholder `https://replace-me.vercel.app` for now; set in step 8 |
| `FALKOR_PASSWORD` | first `openssl rand -hex 32` value |
| `ADMIN_TOKEN` | second value; keep it in your password manager |
| `USE_OPENAI`, `OPENAI_API_KEY` (or `GEMINI_API_KEYS`) | the provider and key the agent uses for new questions |
| models, `EMBED_DIM`, `CORE_MIN_MENTIONS` | **exactly** what built your local graph (the defaults in the file match this repo's caches) |

The provider, model names and `EMBED_DIM` are part of every cache key: if they differ from
what built `data/`, the seed finds nothing in the cache and stops with a list of missing entries.

`WEB_ORIGIN` must be a valid URL for the API to start, which is why the file ships with a
placeholder.

---

## 5. Copy the data to the server (laptop)

`data/` is never committed to git (it is in `.gitignore`). The seed needs:

| Path | Why |
|---|---|
| `data/artifacts.jsonl` | Stage 4 ingest |
| `data/calendar.json` | day numbers ↔ dates (ingest reads it) |
| `data/cache/` | Stage 5 extraction results |
| `data/llm-cache/` | second-pass link answers, embeddings (Stage 6), agent answers |
| `data/text/` | TextStore (also rewritten by the seed) |
| `data/exports/` | only if you made one in step 0.3 |

Do **not** copy `data/answer_key/` or `data/bench/`: the answer key never goes near production.

`llm-cache/` holds tens of thousands of small files, so pack them into one file and copy that with scp:

```bash
# (laptop, in the repo root)
tar czf /tmp/keystone-data.tgz -C data artifacts.jsonl calendar.json cache llm-cache text $( [ -d data/exports ] && echo exports )
scp -i ~/.ssh/keystone.pem /tmp/keystone-data.tgz ubuntu@$EIP:/tmp/
ssh -i ~/.ssh/keystone.pem ubuntu@$EIP 'mkdir -p ~/keystone/data && tar xzf /tmp/keystone-data.tgz -C ~/keystone/data && rm /tmp/keystone-data.tgz && du -sh ~/keystone/data && ls ~/keystone/data'
```

The containers run as the non-root user `node` (uid 1000), the same uid as `ubuntu`, so
`data/` needs no permission changes. (If you copied it as another user: `sudo chown -R 1000:1000 ~/keystone/data`.)

---

## 6. Start the stack and seed the graph (server)

```bash
# (server)
cd ~/keystone
docker compose -f docker-compose.prod.yml up -d --build      # first build: a few minutes
docker compose -f docker-compose.prod.yml ps                 # falkordb, redis healthy; api, worker, caddy up
```

On startup the API sees that `apex` is empty and there is no `apex_backup`, so it **seeds by
itself** in the background. You can instead (or additionally; it waits for a running seed)
run it yourself and see every step:

```bash
docker compose -f docker-compose.prod.yml exec api pnpm seed
```

Watch `/health` go from `"seeding"` to `"up"` (about 1-3 minutes):

```bash
D=$(sed -n 's/^API_DOMAIN=//p' .env.prod)
watch -n 5 "curl -s https://$D/health | head -c 400"
docker compose -f docker-compose.prod.yml logs -f api      # in another terminal: the "Seed: ..." steps
```

`{"status":"up",...,"graph":{"name":"apex","people":44}` means done (Ctrl+C to leave `watch`). The first request
may take a few seconds while Caddy gets the certificate.

If it ends in **`degraded`**, the seed failed. `curl -s https://API_DOMAIN/health` shows
`seed.error` and `seed.missing` (for example `extract:CONF-ENG-001` or `embed:<chunk id>`). No API
call was made and nothing was half-written. Regenerate those entries on your laptop
(`pnpm extract`, `pnpm extract --relink-stale`, `pnpm embed`), copy `cache/` and `llm-cache/`
again (step 5), then run `docker compose -f docker-compose.prod.yml exec api pnpm seed`.

**Check nothing is exposed** (server, then laptop):

```bash
sudo ss -tlnp | grep -vE '127.0.0.53|127.0.0.54'   # only :22, :80 and :443 listen publicly
# (laptop) both must fail / time out:
nc -vz -w 5 $EIP 6379 ; nc -vz -w 5 $EIP 4000
```

### Back up the finished graph

Take a backup and an export right away, then snapshot the disk:

```bash
# (server)
cd ~/keystone && set -a && . ./.env.prod && set +a
curl -s -X POST -H "x-admin-token: $ADMIN_TOKEN" https://$API_DOMAIN/admin/backup          # {"status":"done",...}
curl -s -X POST -H "x-admin-token: $ADMIN_TOKEN" https://$API_DOMAIN/admin/export-actions  # {"status":"done",...}
# Make FalkorDB write its snapshot to disk now, so the EBS snapshot contains it:
docker compose -f docker-compose.prod.yml exec falkordb sh -c 'redis-cli -a "$FALKOR_PASSWORD" --no-auth-warning SAVE'
```

Then in the AWS console: **EC2 → Instances → keystone → Storage tab** → click the volume id →
**Actions → Create snapshot** → description `keystone after seed` → **Create snapshot**.
It holds the whole disk: code, `data/`, the FalkorDB volume and Caddy's certificates. To
recover from it: *Snapshots → Actions → Create volume from snapshot* (same availability zone),
stop the instance, detach the old root volume, attach the new one as `/dev/sda1`, start.

---

## 7. Optional: FalkorDB Browser (off by default)

A second subdomain behind Caddy basic auth. Leave it off unless you need it during judging.

```bash
# (server)
cd ~/keystone
docker run --rm caddy:2 caddy hash-password --plaintext 'a-long-browser-password'   # copy the $2a$... hash
cp deploy/caddy/browser.caddy.example deploy/caddy/sites/browser.caddy
nano .env.prod
#   BROWSER_DOMAIN=browser.203-0-113-10.sslip.io
#   BROWSER_USER=admin
#   BROWSER_PASSWORD_HASH='$2a$14$...'        <- single quotes, the hash contains $
docker compose -f docker-compose.prod.yml --profile browser up -d
```

Open `https://browser.203-0-113-10.sslip.io`, log in with the basic-auth user, then connect with
host `falkordb`, port `6379`, password `FALKOR_PASSWORD`. To turn it off again:
`rm deploy/caddy/sites/browser.caddy && docker compose -f docker-compose.prod.yml --profile browser stop falkordb-browser && docker compose -f docker-compose.prod.yml restart caddy`.

---

## 8. Web app on Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** the GitHub repository.
2. Configure the project:
   - **Root Directory:** `apps/web` (keep *Include files outside the root directory* enabled)
   - **Framework Preset:** Next.js
   - **Build Command** (override): `cd ../.. && pnpm --filter @keystone/shared build && pnpm --filter @keystone/web build`
   - **Install Command:** leave the default (Vercel detects pnpm from `pnpm-lock.yaml`)
   - **Environment Variables:** `NEXT_PUBLIC_API_BASE_URL` = `https://203-0-113-10.sslip.io` (your `API_DOMAIN`, with `https://`, no trailing slash)
3. **Deploy.** Then *Settings → General → Node.js Version*: **22.x** (the repo requires Node ≥ 22).
4. Copy the production URL (e.g. `https://keystone-abc.vercel.app`) and allow it in the API's CORS:

   ```bash
   # (server)
   cd ~/keystone
   nano .env.prod                                   # WEB_ORIGIN=https://keystone-abc.vercel.app  (no trailing slash)
   docker compose -f docker-compose.prod.yml up -d --force-recreate api
   ```

   CORS allows exactly one origin, so only the production URL works (not Vercel preview URLs).
   `NEXT_PUBLIC_API_BASE_URL` is baked in at build time: after changing it, redeploy on Vercel.

---

## 9. Smoke test

Run these in order. `API` is `https://API_DOMAIN`.

1. **Health:** `curl -s https://$API_DOMAIN/health` → `"status":"up"`, `"falkordb":"up"`,
   `"redis":"up"`, `"people":44`.
2. **Org Pulse loads:** open the Vercel URL; the dashboard shows people, systems and risk counts,
   and the health pills are green.
3. **Ask streams:** on *Ask*, ask "Who knows TitanDB best?". Tool steps and then the answer
   appear word by word, with citations. (Streaming goes through Caddy's `flush_interval -1`.)
4. **What-if runs:** on *What-if*, pick a person and run it; the before/after graph and the
   bus-factor diff appear within a few seconds.
5. **Approve one action:** draft a handover plan for someone, open one *reassign* proposal and
   click **Approve**. The first time it asks for the admin token: paste `ADMIN_TOKEN`. The status
   becomes *approved* and the ticket shows its new owner.
6. **Reboot:** export the actions (so the approval is in `actions-latest.jsonl`), then reboot:

   ```bash
   # (server)
   cd ~/keystone && set -a && . ./.env.prod && set +a
   curl -s -X POST -H "x-admin-token: $ADMIN_TOKEN" https://$API_DOMAIN/admin/export-actions
   sudo reboot
   ```

   Wait about a minute, then from your laptop: `curl -s https://API_DOMAIN/health` → `"up"` with
   `"people":44`. In the web app the approved action is still *approved*. Docker starts on boot
   and every service has `restart: unless-stopped`; FalkorDB reloads its snapshot from its volume
   (it saves within 60 s of any change and again on shutdown).

---

## 10. Judging-period checklist

- [ ] **Backups running.** The worker backs up `apex` to `apex_backup` and exports actions every 6 hours:

  ```bash
  # (server)
  cd ~/keystone
  docker compose -f docker-compose.prod.yml logs worker | grep -E "Backed up|Exported|skipped"
  ls -lt data/exports | head
  ```

  A backup is *skipped* (old one kept) while `apex` is empty or a seed/restore is running, and a
  copy that fails also keeps the old backup (the new copy only replaces it once it is complete).
  During each copy FalkorDB pauses for a few seconds; `/health` then says `seeding`, not `down`.
- [ ] **Uptime monitor.** Free [UptimeRobot](https://uptimerobot.com) account → *Add New Monitor* →
  type **Keyword**, URL `https://API_DOMAIN/health`, keyword `"status":"up"`, alert when
  *keyword not exists*, interval **5 minutes**, your email as alert contact. A check that lands
  in the few seconds of a backup copy (every 6 hours) sees `"status":"seeding"`; a single alert
  that clears on the next check at that time is that, not an outage.
- [ ] **AWS billing alarm.** *Billing and Cost Management → Billing preferences* → enable
  **Receive CloudWatch billing alerts**. Then switch the console to **US East (N. Virginia)**
  (billing metrics only live there) → *CloudWatch → Alarms → Create alarm → Select metric →
  Billing → Total Estimated Charge → USD* → threshold *greater than* e.g. **20** → notify a new SNS
  topic with your email → confirm the subscription email. (AWS Budgets with an email alert works too.)
- [ ] **EBS snapshot** taken after the final graph was built (step 6).
- [ ] **Secrets** only in `~/keystone/.env.prod` (mode 600); nothing in git: `git status` on the server is clean.
- [ ] **Know the restore commands:**
  `curl -X POST -H "x-admin-token: $ADMIN_TOKEN" https://$API_DOMAIN/admin/restore` replaces
  `apex` with `apex_backup` and merges the latest actions export back in (send
  `-H 'content-type: application/json' -d '{"reapplyActions":false}'` for a pure copy).
  If both graphs are ever lost, restart the API (it re-seeds from files) or run `pnpm seed --force` in the api container.

**When the results are announced:** take a last snapshot if you want to keep it, then *EC2 →
Instances → keystone → Instance state → Terminate*. Then *Elastic IPs → Release* (an Elastic IP
that is not attached to a running instance is still billed), delete leftover *Volumes* and
*Snapshots* you no longer need, and remove the Vercel project if you are done with it.
(Stopping instead of terminating keeps the disk and the Elastic IP, which are billed, but not
the instance hours.)

---

## Redeploying after a code change (laptop)

```bash
git push                                     # to the branch the server has checked out (main)
scripts/deploy.sh ubuntu@$EIP                # or: DEPLOY_SSH_KEY=~/.ssh/keystone.pem scripts/deploy.sh ubuntu@$EIP
```

It SSHes in, runs `git pull --ff-only` and `docker compose -f docker-compose.prod.yml up -d --build`,
then calls `https://API_DOMAIN/health` and fails loudly unless it says `up` or `seeding`. The graph
lives in the FalkorDB volume, so a redeploy does not re-seed. (Add `IdentityFile ~/.ssh/keystone.pem`
for the host to `~/.ssh/config` to skip `DEPLOY_SSH_KEY`.)

## Troubleshooting

| Symptom | Check |
|---|---|
| `curl: (35) SSL` / no certificate | Ports 80 and 443 open to 0.0.0.0/0? `API_DOMAIN` resolves to the Elastic IP? `docker compose -f docker-compose.prod.yml logs caddy` |
| `502 Bad Gateway` | The API is starting or crashed: `docker compose -f docker-compose.prod.yml logs --tail 100 api` (a bad `.env.prod` value is reported by name, never by value) |
| `"status":"degraded"` | The seed failed: `seed.error` / `seed.missing` in `/health`; see step 6 |
| `"status":"down"` | `docker compose -f docker-compose.prod.yml ps`: is falkordb or redis unhealthy? |
| Web app: network / CORS errors | `WEB_ORIGIN` must equal the Vercel URL exactly; `NEXT_PUBLIC_API_BASE_URL` must be `https://API_DOMAIN` (redeploy Vercel after changing it) |
| Approve says 401 | Paste `ADMIN_TOKEN` into the token field that appears |
| Memory | `/health` → `memory`; FalkorDB is capped at 4 GB (`mem_limit`), the graph is about 50 MB |
