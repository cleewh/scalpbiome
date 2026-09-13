"""ScalpBiome backend package.

A self-contained scalp microbiome analyzer:
  - taxa:        domain model (canonical taxa + reference/built-in profiles)
  - data_gen:    synthetic healthy/dysbiotic profile generator
  - metrics:     diversity metrics (Shannon, richness, Cuti:Staph ratio)
  - model:       scikit-learn classifier trained at startup + per-sample drivers
  - healthomics: AWS HealthOmics / S3 input stub (where real data plugs in)
  - main:        FastAPI application
"""

__version__ = "1.0.0"
