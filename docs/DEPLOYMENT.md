# Bounded Deployment Plan

## Recommendation

For a graduate-school portfolio, a one-month deployment is enough if it produces verifiable evidence: uptime/freshness checks, an observation coverage summary, a phone demo, and an archived release. Continuous paid hosting is not necessary.

## One-month schedule

### Week 0 — launch

- Deploy the Docker image to a small Linux VM/container service.
- Attach a persistent volume for `/app/data`.
- Configure HTTPS and the WeChat legal request domain.
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

## Shutdown checklist

- Save a private database backup.
- Export only aggregates that are safe and permitted to publish.
- Remove server credentials and DNS records no longer required.
- Stop/delete billable compute after confirming the backup.
- Update README status from “live experiment” to “archived prototype.”
