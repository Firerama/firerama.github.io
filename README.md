# firerama.github.io

The Firerama channel site, served by GitHub Pages at https://firerama.github.io.

It's plain static HTML/CSS/JS: `index.html` loads `app.js`, which reads the video list from `videos.json` and renders a card for each video under Videos, Shorts and Streams tabs (linkable as `#videos`, `#shorts`, `#streams`). Clicking a card plays the video in an embedded player (ctrl/cmd-click opens it on YouTube).

## Refreshing the video list

`videos.json` is a snapshot, so new uploads only show up after you refresh it:

```
python update_videos.py
```

It needs only Python 3 (no packages, no API key). It reads the channel's public uploads playlist, looks up publish dates for any videos it hasn't seen before, and rewrites `videos.json` and `avatar.jpg`. Then publish the change (below).

## Adding a game

The Games tab lists the entries in `games.json`. Each game is a static web build (HTML/JS/assets, no server code) in its own folder under `games/`:

1. Put the build in `games/<name>/`, with its start page at `games/<name>/index.html`. Use relative paths for its files.
2. Optionally add a 16:9 cover image, e.g. `games/<name>/thumb.png`.
3. Add an entry to `games.json`, newest first:

```json
{
  "games": [
    {
      "title": "My Game",
      "description": "One line about it.",
      "path": "games/my-game/",
      "thumbnail": "games/my-game/thumb.png",
      "published": "2026-11-01"
    }
  ]
}
```

Only `title` and `path` are required; without a `thumbnail` the card shows the title on a plain background. The game will be playable at `https://firerama.github.io/games/<name>/`.

### Ender Quest

`games/ender-quest/` is a browser port of Ender Quest 0.3.2, a 2020 C++ console game whose source was lost. Its rules were recovered from the original `.exe`; the levels, dialogue and ASCII art in `text/` are the game's own data files. `scripts.js` holds two boss scripts (King Othim's fight and the final fight) captured by running the original program's code in an emulator. Saves are kept in the browser (`localStorage`). Add `?debug` to the URL to expose the current board as `window.eqBoard` for testing.

The empty `.nojekyll` file stops GitHub Pages from hiding folders that start with `_`, which some game engines' web exports use.

## Previewing locally

```
python -m http.server 8000
```

then open http://localhost:8000. (Opening `index.html` straight from disk won't load `videos.json`.)

## Publishing

Commit and push to `main`; GitHub Pages redeploys within a minute or two:

```
git add -A
git commit -m "Update video list"
git push
```
