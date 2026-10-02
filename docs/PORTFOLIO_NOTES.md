# Portfolio / Application Notes

## One-sentence description

I designed and implemented an end-to-end WeChat Mini Program that separates real park observations from ML estimates, combining a resilient collector, SQLite/Express API, XGBoost/LSTM experiments, and user-centered trip logging.

## Technical highlights

- End-to-end ownership across data collection, backend API, ML pipeline, and mobile product design.
- Explicit provenance and stale-data handling rather than silently presenting cached values as live.
- Independent crowd and wait-time targets to avoid a misleading product assumption.
- Local-first storage for check-ins, photos, and spending.
- Bounded deployment plan that balances evidence, cost, and responsible data use.

## Strong interview discussion points

1. Why polling every five minutes still uses hourly upserts.
2. Why “low crowd” and “short queue” are separate rankings.
3. How offline states preserve usefulness without falsifying freshness.
4. Why synthetic-data metrics are not a real-world accuracy claim.
5. What data would be required for chronological validation and drift monitoring.
6. Why a time-boxed deployment is more appropriate than indefinite hosting for this prototype.

## Suggested application attachment

- GitHub repository URL.
- 60–90 second unlisted demo video.
- Two-page PDF summary adapted from README, Architecture, Data Card, and Model Card.
- Optional appendix with model plots and one-month observation coverage.
