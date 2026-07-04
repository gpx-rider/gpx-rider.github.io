PORT ?= 5173
HOST ?= 127.0.0.1
URL := http://$(HOST):$(PORT)/app/

# `make` with no target regenerates everything derived from source (the
# in-app gallery data and the README gallery section) and runs the tests —
# the same generation the deploy GitHub Action performs before publishing.
.DEFAULT_GOAL := all
.PHONY: all run test gallery gallery-data

all: gallery-data gallery test

run:
	@printf 'GPX Rider is available at %s\n' '$(URL)'
	@python3 -m http.server $(PORT) --bind $(HOST)

test:
	@node --test tests/*.test.mjs

gallery:
	@python3 scripts/gallery.py

gallery-data:
	@python3 scripts/generate_gallery_json.py
