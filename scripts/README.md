# scripts/

Python data-prep scripts live here (from Stage 2 onward). Example: downloading
the OrgForge "Apex Athletics" dataset and splitting it into files the seed
command can load.

Rules that apply to everything in this folder (see AGENTS.md):

- Only rows with `category == "artifact"` may ever be written to files the
  graph is built from. `sim_event` rows are the benchmark answer key: keep them
  in a separate folder that nothing in the product reads.
- Output goes under `DATA_DIR` (default `./data`, git-ignored).
- No LLM calls here unless the result is cached to a file.
