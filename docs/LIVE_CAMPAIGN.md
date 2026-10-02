# Live Observation Campaign

## Scope

- Window: 2026-10-03 to 2026-11-02 (Asia/Shanghai).
- Region: Alibaba Cloud, China East 1 (Hangzhou).
- Instance class: 2 vCPU, 2 GiB RAM, 40 GiB system disk.
- Collector cadence: every 300 seconds.
- Storage cadence: one timestamped observation per 5-minute bucket.
- Runtime: Node.js 22 + Python virtual environment under systemd, fronted by Nginx.
- Runtime storage: private SQLite database at `/var/lib/sh-disney/shanghai_disneyland.db`.

## Public status

The deployment is a bounded portfolio experiment, not a permanent production service. The public API exposes read-only health, current observations, historical aggregates, and estimates. Runtime databases, cloud account identifiers, credentials, and raw logs are not published.

- Read-only experiment endpoint: <http://47.99.129.17/health>
- Deployed commit at launch: `7426624`
- Launch verification: Node.js `v22.23.3`; `/health`, `/api/realtime`, `/api/history`, `/api/predict`, and `/api/suggest` returned successfully.
- Automatic-collection proof: `observation_snapshots` increased from 90 to 91 and `last_database_write_at` advanced after one 300-second cycle.
- Initial anonymous backfill: seven observed calendar days. A longer upstream history window requires an API key and is not claimed here.

The endpoint is HTTP-only during this bounded data campaign. It is suitable for health checks and desktop demonstration, but it is **not** a WeChat production legal domain. A formal Mini Program release still requires a controlled domain, HTTPS certificate, ICP-related compliance as applicable, and platform review.

## Evidence to retain

At the end of the campaign, record:

- first and last successful observation timestamps;
- observation and ride-row counts;
- missing 5-minute intervals and upstream failures;
- container uptime and restart events;
- the Git commit deployed;
- a private SQLite backup and a public aggregate coverage summary.

After the backup and summary are verified, stop the paid instance and update this document from `live` to `archived`.
