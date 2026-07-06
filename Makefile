PORT ?= 5173
HOST ?= 127.0.0.1
URL := http://$(HOST):$(PORT)/app/

# `make` with no target regenerates derived in-app gallery data and runs the
# tests — the same generation the deploy GitHub Action performs before publishing.
.DEFAULT_GOAL := all
.PHONY: all run test gallery-data rider-dot-model

all: gallery-data test

run:
	@printf 'GPX Rider is available at %s\n' '$(URL)'
	@python3 scripts/dev_server.py $(PORT) $(HOST)

test:
	@node --test tests/*.test.mjs

gallery-data:
	@python3 scripts/generate_gallery_json.py

# Not part of `all` — app/assets/rider-dot.glb is a deterministic, checked-in
# asset that only needs regenerating after editing the generator script
# itself (e.g. to retune the rider dot's color or dimensions).
rider-dot-model:
	@python3 scripts/generate_rider_dot_model.py
