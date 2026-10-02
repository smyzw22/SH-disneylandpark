# Bounded Deployment Plan

## Recommendation

For a graduate-school portfolio, a one-month deployment is enough if it produces verifiable evidence: uptime/freshness checks, an observation coverage summary, a phone demo, and an archived release. Continuous paid hosting is not necessary.

## One-month schedule

### Week 0 — launch

- Deploy with Docker or the checked-in Ubuntu/systemd recipe.
- Keep SQLite outside the application checkout so upgrades do not erase observations.
- Configure HTTPS and the WeChat legal request domain before any formal Mini Program release.
- Store `THEMEPARKS_API_KEY` only as a server secret.
- Validate `/health`, `/api/realtime`, `/api/history`, `/api/predict`, and `/api/suggest`.

### Weeks 1–3 — observe

- Check daily freshness and collector errors.
- Record missing intervals and upstream API failures.
- Avoid changing the data schema mid-campaign unless migration is documented.

### Week 4 — evaluate and archive

- Export coverage counts and a non-sensitive aggregate summary.
- Evaluate simple baselines before retraining complex models.
- Record the final phone demo.
- Tag the Git release and document the observation window.
- Download the persistent database privately, then stop the paid service.

## Docker launch

```bash
export THEMEPARKS_API_KEY=...   # optional, server-side only
docker compose up -d --build
```

The container stores SQLite data in the named volume `shanghai_disney_data` and polls every 300 seconds by default.

Set `PUBLIC_PORT=80` in the deployment `.env` when a portfolio VM should expose the read-only API through an existing HTTP firewall rule. The service itself continues to listen on port 3000 inside the container.

The schema stores live observations in normalized five-minute buckets (`date`, `hour`, `minute`). Older hourly databases are migrated automatically with their existing rows assigned to minute `00`.

## Alibaba Cloud Ubuntu launch

The one-month portfolio campaign uses the native deployment because Docker Hub timed out from the selected Hangzhou instance. The checked-in recipe installs Node.js 22, creates a Python virtual environment, runs the API/collector under systemd, stores SQLite under `/var/lib/sh-disney`, and proxies port 80 through Nginx.

```bash
sudo APP_DIR=/opt/sh-disney sh deploy/alicloud/setup-native.sh
```

The service restarts automatically after a process failure or server reboot. Check it with:

```bash
systemctl status sh-disney
curl http://127.0.0.1/health
```

The public campaign endpoint is deliberately HTTP-only. Do not configure it as a WeChat production request domain; use a controlled HTTPS domain for a formal release.

## Shutdown checklist

- Save a private database backup.
- Export only aggregates that are safe and permitted to publish.
- Remove server credentials and DNS records no longer required.
- Stop/delete billable compute after confirming the backup.
- Update README status from “live experiment” to “archived prototype.”
