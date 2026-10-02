# Data Card

## Purpose

The project uses data for two different purposes: displaying observed park conditions and demonstrating a forecasting pipeline. These sources must not be conflated.

## Sources

### Real observations

- ThemeParks.wiki live/history endpoints: attraction status and wait observations.
- Open-Meteo: weather context.
- Runtime storage: SQLite tables `daily_total` and `ride_queue`.

The local working database used during development contained 8 observed dates, 94 hourly park snapshots, and 6,793 ride-level snapshots as of 2026-10-02. The database is excluded from Git because its retention and redistribution terms should be reviewed independently of the source code.

### Checked-in research dataset

`data/raw/dataset_manifest.txt` explicitly identifies the CSV dataset as `synthetic_aligned_to_scraper_schema`. It covers the same columns expected by the training pipeline and is suitable for reproducibility and interface testing, not for claims about real visitor behavior.

## Labels used in the product

- **Observed / live:** successfully retrieved from a real endpoint and carrying the source timestamp.
- **Historical observation:** reconstructed or aggregated from real history endpoints.
- **Prediction / estimate:** model output.
- **Bundled snapshot:** a timestamped offline copy of a prior observation.
- **Mock/synthetic:** generated data for development or ML pipeline demonstration.

The offline forecast and route screens may use a deterministic historical-profile/heuristic fallback when the API or model artifacts are unavailable. This fallback is reproducible UI demo data, not an observed queue record. Server-connected predictions use the exported XGBoost/LSTM pipeline.

## Known limitations

- Anonymous history access is bounded and may not recover older missing dates.
- Collection gaps remain gaps; the collector does not fabricate observed rows.
- API fields, attraction catalogs, and operating rules may change.
- Weather and calendar features omit many operational and behavioral factors.
- Redistribution permissions for third-party observations must be reviewed before publishing bulk snapshots.

## Responsible release policy

- Do not commit API keys, private user data, or runtime databases.
- Keep visible source attribution in the UI.
- Use conservative polling intervals and obey provider limits.
- Describe synthetic training data wherever metrics are shown.
