"""Refresh videos.json with every public upload on the Firerama YouTube channel.

Uses only the Python standard library and no API key: it reads the channel's
public uploads playlist page (following "load more" pages if there are over
100 videos), then looks up each new video's publish date on its watch page.
Dates already in videos.json are reused, so later runs only fetch new videos.

Usage:  python update_videos.py
"""

import html as htmllib
import json
import re
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

CHANNEL_ID = "UCrCAi-NsAUz7pDLx3-RHS8A"
HANDLE = "Firerama"
UPLOADS_PLAYLIST = "UU" + CHANNEL_ID[2:]
OUT = Path(__file__).with_name("videos.json")
AVATAR = Path(__file__).with_name("avatar.jpg")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "CONSENT=YES+1",
}


def fetch(url, data=None):
    headers = dict(HEADERS)
    if data is not None:
        data = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def initial_data(html):
    m = re.search(r"var ytInitialData = (\{.*?\});</script>", html, re.S)
    if not m:
        sys.exit("Couldn't find ytInitialData; YouTube may have changed its page layout.")
    return json.loads(m.group(1))


def find_all(obj, key):
    """Yield every value stored under `key` anywhere in a nested JSON object."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == key:
                yield v
            yield from find_all(v, key)
    elif isinstance(obj, list):
        for v in obj:
            yield from find_all(v, key)


def parse_lockups(data):
    videos = []
    for lockup in find_all(data, "lockupViewModel"):
        if lockup.get("contentType") != "LOCKUP_CONTENT_TYPE_VIDEO":
            continue
        meta = lockup.get("metadata", {}).get("lockupMetadataViewModel", {})
        badges = [b.get("text") for b in find_all(lockup.get("contentImage", {}), "thumbnailBadgeViewModel")]
        videos.append({
            "id": lockup["contentId"],
            "title": meta.get("title", {}).get("content", ""),
            "duration": next((b for b in badges if b and re.fullmatch(r"[\d:]+", b)), ""),
        })
    return videos


def parse_short_ids(data):
    return [ep["videoId"] for lockup in find_all(data, "shortsLockupViewModel")
            for ep in find_all(lockup, "reelWatchEndpoint") if "videoId" in ep]


def next_token(data):
    """The "load more" token at the end of a list (not the sort-chip tokens)."""
    for item in find_all(data, "continuationItemRenderer"):
        for command in find_all(item, "continuationCommand"):
            return command.get("token")
    return None


def browse_all(url, parse):
    """Parse a YouTube list page plus every "load more" page after it."""
    html = fetch(url)
    data = initial_data(html)
    items = parse(data)
    client_version = re.search(r'"INNERTUBE_CLIENT_VERSION":"([^"]+)"', html).group(1)
    token = next_token(data)
    while token:
        page = json.loads(fetch(
            "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false",
            {"context": {"client": {"clientName": "WEB", "clientVersion": client_version, "hl": "en"}},
             "continuation": token},
        ))
        items += parse(page)
        token = next_token(page)
    return items


def playlist_videos():
    return browse_all(f"https://www.youtube.com/playlist?list={UPLOADS_PLAYLIST}", parse_lockups)


def channel_tab_ids(tab):
    """IDs listed on one tab of the channel page: "shorts" or "streams"."""
    parse = parse_short_ids if tab == "shorts" else (lambda d: [v["id"] for v in parse_lockups(d)])
    return set(browse_all(f"https://www.youtube.com/@{HANDLE}/{tab}", parse))


def publish_date(video_id):
    html = fetch(f"https://www.youtube.com/watch?v={video_id}")
    m = re.search(r'"publishDate":"([^"]+)"', html) or re.search(r'itemprop="datePublished" content="([^"]+)"', html)
    if not m:
        return None
    return datetime.fromisoformat(m.group(1)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def channel_info():
    page = fetch(f"https://www.youtube.com/@{HANDLE}")

    def meta(prop):
        m = re.search(rf'<meta property="og:{prop}" content="([^"]*)"', page)
        return m.group(1) if m else ""

    # Save the avatar locally: YouTube's image host refuses hotlinked requests.
    avatar = re.sub(r"=s\d+-", "=s240-", meta("image"))
    if avatar:
        req = urllib.request.Request(avatar, headers={"User-Agent": HEADERS["User-Agent"]})
        with urllib.request.urlopen(req, timeout=30) as resp:
            AVATAR.write_bytes(resp.read())
    return {
        "id": CHANNEL_ID,
        "handle": HANDLE,
        "title": htmllib.unescape(meta("title")) or HANDLE,
        "description": htmllib.unescape(meta("description")),
        "avatar": AVATAR.name if avatar else "",
    }


def main():
    old = {}
    if OUT.exists():
        old = {v["id"]: v for v in json.loads(OUT.read_text(encoding="utf-8")).get("videos", [])}

    videos = playlist_videos()
    if not videos:
        sys.exit("Found no videos; not overwriting videos.json.")

    missing = [v["id"] for v in videos if not old.get(v["id"], {}).get("published")]
    print(f"Found {len(videos)} videos; looking up dates for {len(missing)} new ones...")
    with ThreadPoolExecutor(max_workers=8) as pool:
        dates = dict(zip(missing, pool.map(publish_date, missing)))

    shorts, streams = channel_tab_ids("shorts"), channel_tab_ids("streams")
    for v in videos:
        v["published"] = dates.get(v["id"]) or old.get(v["id"], {}).get("published")
        v["type"] = "short" if v["id"] in shorts else "stream" if v["id"] in streams else "video"
    videos.sort(key=lambda v: v["published"] or "", reverse=True)

    counts = {t: sum(v["type"] == t for v in videos) for t in ("video", "short", "stream")}
    print("Videos: {video}, shorts: {short}, streams: {stream}".format(**counts))
    OUT.write_text(json.dumps({
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "channel": channel_info(),
        "videos": videos,
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(videos)} videos to {OUT.name}.")


if __name__ == "__main__":
    main()
