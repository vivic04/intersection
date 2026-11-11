#!/bin/sh
# Rebuild audio/index.json: the clip keys recorded for each narrator ("f" = Heart, "m" = Michael).
cd "$(dirname "$0")/.." || exit 1
python3 - <<'PY'
import json, os
keys = lambda d: sorted(f[:-4] for f in os.listdir(d) if f.endswith(".mp3"))
json.dump({"f": keys("audio"), "m": keys("audio/m")}, open("audio/index.json", "w"), separators=(",", ":"))
PY
