# KRADFILE setup

This app can use **KRADFILE** (EDRDG) to find kanji that share components, which powers the
AI Tutor "related kanji" suggestions.

## How to add it
1. Download the `kradfile` dataset from EDRDG:
   https://www.edrdg.org/krad/kradinf.html
2. Save the file as:
   `anki-swipe/server/data/kradfile`

## Optional: custom path
Set an environment variable if you want a different location:

```bash
export KRADFILE_PATH="/full/path/to/kradfile"
```

If the file is not found, the app will fall back to the next-kanji suggestion.
