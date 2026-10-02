# Model Card

## Model A — daily crowd index

- Algorithm: XGBoost regression.
- Intended output: relative crowd index and date ranking.
- Features: month, week, weekday, holiday/school-vacation flags, temperature, precipitation, and wind.
- Synthetic experiment metrics: MAE 4.30, RMSE 5.31.

## Model B — hourly attraction wait

- Algorithm: LSTM regression.
- Intended output: attraction-level wait estimate by hour/time slot.
- Features: temporal, calendar, weather, attraction identity, and lag/sequence context.
- Synthetic experiment metrics: MAE 3.73 minutes, RMSE 4.64 minutes.

## Evaluation boundary

The included dataset is synthetic and aligned to the production schema. Metrics therefore verify implementation behavior on that dataset; they do not establish accuracy on future Shanghai Disneyland operations.

The Mini Program also contains a deterministic historical-profile/heuristic fallback for offline demonstrations. Its output is labeled as an estimate and is not included in the metrics above. When the backend and exported artifacts are available, server-connected forecast requests use the trained model pipeline.

## Appropriate use

- demonstrating feature engineering and two-target modeling;
- generating UI estimates for a clearly labeled prototype;
- comparing model outputs with baselines during a bounded real-data study.

## Inappropriate use

- promising a wait time or operational outcome;
- presenting the estimates as official Disney information;
- making claims about real-world accuracy without time-based validation on real observations.

## Validation plan with one month of real data

1. Freeze a dated collection window and report missingness.
2. Use rolling-origin or chronological splits, never random leakage across adjacent hours.
3. Compare against weekday/hour seasonal median baselines.
4. Report MAE, RMSE, median absolute error, and error by attraction/time slot.
5. Include confidence intervals or empirical prediction bands.
6. Document closure/maintenance rows separately from numeric waits.
