PORT ?= 5173
HOST ?= 127.0.0.1
URL := http://$(HOST):$(PORT)/app/

.PHONY: run test gallery gallery-data
run:
	@printf 'GPX Rider is available at %s\n' '$(URL)'
	@python3 -m http.server $(PORT) --bind $(HOST)

test:
	@node --test tests/*.test.mjs

gallery:
	@python3 scripts/gallery.py

gallery-data:
	@python3 scripts/generate_gallery_json.py
