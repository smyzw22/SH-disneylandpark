# Archive Checklist

Use this checklist at the end of a real-data collection campaign.

## Record

- Git commit and release tag.
- Deployment start/end timestamps and timezone.
- Collector interval and history entitlement.
- First/last observed dates.
- Hourly park snapshot count and ride snapshot count.
- Missing intervals, API outages, and schema changes.
- Model artifact hashes and evaluation split definition.

## Preserve privately

- Runtime SQLite database.
- Raw service logs needed for diagnosis.
- Cloud invoices and deployment configuration.
- API keys only in the secret manager; revoke when no longer needed.

## Publish safely

- Source code and dependency lockfiles.
- Aggregate coverage statistics.
- Data/Model Cards and limitations.
- Screenshots with personal information removed.
- Demo video with account identifiers and QR codes blurred.

## Useful commands

```bash
git rev-parse HEAD
shasum -a 256 models/artifacts/*
sqlite3 shanghai_disneyland.db \
  'SELECT COUNT(DISTINCT date), COUNT(*), MIN(date), MAX(date) FROM daily_total;'
sqlite3 shanghai_disneyland.db \
  'SELECT COUNT(*) FROM ride_queue;'
```
