# Live Observation Campaign

## Scope

- Window: 2026-10-02 to 2026-11-02 (Asia/Shanghai).
- Region: Alibaba Cloud, China East 1 (Hangzhou).
- Instance class: 2 vCPU, 2 GiB RAM, 40 GiB system disk.
- Collector cadence: every 300 seconds.
- Storage cadence: one timestamped observation per 5-minute bucket.
- Runtime storage: private SQLite database in a persistent Docker volume.

## Public status

The deployment is a bounded portfolio experiment, not a permanent production service. The public API exposes read-only health, current observations, historical aggregates, and estimates. Runtime databases, cloud account identifiers, credentials, and raw logs are not published.

## Evidence to retain

At the end of the campaign, record:

- first and last successful observation timestamps;
- observation and ride-row counts;
- missing 5-minute intervals and upstream failures;
- container uptime and restart events;
- the Git commit deployed;
- a private SQLite backup and a public aggregate coverage summary.

After the backup and summary are verified, stop the paid instance and update this document from `live` to `archived`.
