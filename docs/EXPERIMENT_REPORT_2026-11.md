# Bounded Live-Data Collection Experiment Report

**Project:** Shanghai Disneyland Crowd Intelligence Mini Program  
**Campaign window:** 2026-10-03–2026-11-02 (Asia/Shanghai)  
**Report date:** 2026-11-02  
**Status:** End-of-campaign service check completed; archival completeness is partial.

## Objective

Demonstrate a bounded end-to-end deployment of the portfolio prototype: collect timestamped attraction observations from ThemeParks.wiki, persist them in SQLite, expose read-only health/current-data endpoints, and retain provenance and freshness signals. This is an engineering and data-pipeline demonstration, not a validation study of crowd-prediction accuracy.

## Deployment and collection configuration

The campaign used the Hangzhou Alibaba Cloud instance described in the repository's `docs/LIVE_CAMPAIGN.md`: 2 vCPU, 2 GiB RAM, Node.js API with a Python collector, SQLite persistence, systemd supervision, and Nginx. The health endpoint reported automatic collection enabled at a 300-second interval.

## Verified endpoint observations

| Check date (UTC) | Snapshot count | Latest DB write (UTC) | Automatic | Interval | Realtime freshness |
| --- | ---: | --- | --- | ---: | --- |
| 2026-10-03 | 239 | 2026-10-03 04:27:16 | true | 300 s | fresh |
| 2026-10-21 | 5,309 | 2026-10-21 13:50:55 | true | 300 s | fresh |
| 2026-10-24 | 6,112 | 2026-10-24 09:04:02 | true | 300 s | 3 min |
| 2026-10-25 | 6,397 | 2026-10-25 08:57:41 | true | 300 s | 5 min |
| 2026-10-28 | 7,257 | 2026-10-28 09:01:59 | true | 300 s | 2 min |
| 2026-11-02 | 8,722 | 2026-11-02 11:47:14 | true | 300 s | 5 min |

At the final check on 2026-11-02, `/health` returned `ok=true`, `observed_days=37`, `first_date=2026-09-27`, and `last_date=2026-11-02`. `/api/realtime` returned `ok=true`, `stale=false`, `freshness_minutes=5`, and `data_source=sqlite_snapshot`. The snapshot count increased by 1,465 from the last verified check on 2026-10-28.

The endpoint identifies ThemeParks.wiki as the upstream source. Counts and timestamps above are direct API readings recorded during checks; they do not establish that every planned interval was captured.

## Interpretation

The evidence supports that the deployed collection service was alive and automatically writing observations at the final check, and that cumulative stored snapshots increased substantially across the campaign. The API's provenance and freshness signals also demonstrate a practical separation between current observations and forecasts.

This is not proof of uninterrupted operation for the full month. Monitoring was not successful on every day. In particular, endpoint checks were unavailable on 2026-10-22–23, 2026-10-26–27, and 2026-10-29 through 2026-11-01. Consequently, uptime, missed 5-minute intervals, outage duration, and completeness rate cannot be calculated from the available check log. A rising cumulative count between checks does not by itself prove continuous collection.

## Scope and limitations

- The reported 8,722 is the API's `observation_snapshots` count at the final check, not an independently audited count from a downloaded database.
- The 37 observed calendar days include dates before the campaign start, as reported by the service; this report does not attribute those backfilled observations to the campaign period.
- The live source provides third-party park-operation observations. It is not official Disney data and may be delayed, incomplete, or subject to upstream coverage and terms.
- This campaign does not validate forecast quality. The repository's ML training data and metrics are synthetic/schema-aligned; they must not be presented as model performance on these live observations.
- This report does not assert a private database backup, cloud shutdown, or complete archival until those actions are separately verified.

## Archival follow-up

1. Export and privately preserve the SQLite database if available, without publishing credentials or personal data.
2. Generate a coverage report from the database itself (counts by date, observed interval distribution, duplicate policy, and collection errors).
3. Reconcile deployment uptime/restart logs and the monitoring gaps above.
4. Decide whether to stop the paid instance, then verify shutdown and final billing status.
5. Keep the public repository limited to code, aggregate statistics, and appropriately licensed/redacted evidence.

## Reproducibility and provenance

The deployment recipe, schema, model/data limitations, and campaign context are documented in the repository's README, Architecture, Data Card, Model Card, and Live Campaign record. Final endpoint values were read from `http://47.99.129.17/health` and `http://47.99.129.17/api/realtime` on 2026-11-02. No raw database or credentials are included here.
