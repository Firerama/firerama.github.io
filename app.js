// Renders the grid from videos.json (refreshed by update_videos.py) and games.json (edited by hand).
const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const search = document.getElementById("search");
const tabs = [...document.querySelectorAll(".tab")];
const player = document.getElementById("player");
const playerIframe = document.getElementById("player-iframe");
const playerLink = document.getElementById("player-link");

const dateFormat = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });
let videos = [];
let games = [];

function watchUrl(video) {
  return video.type === "short"
    ? `https://www.youtube.com/shorts/${video.id}`
    : `https://www.youtube.com/watch?v=${video.id}`;
}

// The tab named in the URL hash (#videos, #shorts, #streams), defaulting to Videos.
function currentType() {
  const tab = tabs.find((t) => t.hash === location.hash);
  return (tab || tabs[0]).dataset.type;
}

function card(video) {
  const isGame = video.type === "game";
  const li = document.createElement("li");
  const a = document.createElement("a");
  a.className = "card";
  if (isGame) {
    a.href = video.path;
  } else {
    a.href = watchUrl(video);
    a.target = "_blank";
    a.rel = "noopener";
    a.dataset.id = video.id;
  }

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const src = isGame ? video.thumbnail : `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`;
  if (src) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.width = 480;
    img.height = 270;
    thumb.append(img);
  } else {
    thumb.classList.add("thumb-placeholder");
    thumb.textContent = video.title;
  }
  if (video.duration) {
    const d = document.createElement("span");
    d.className = "duration";
    d.textContent = video.duration;
    thumb.append(d);
  }

  const body = document.createElement("div");
  body.className = "card-body";
  const title = document.createElement("h3");
  title.className = "card-title";
  title.textContent = video.title;
  body.append(title);
  if (video.description) {
    const p = document.createElement("p");
    p.className = "card-desc";
    p.textContent = video.description;
    body.append(p);
  }
  if (video.published) {
    const date = document.createElement("time");
    date.className = "card-date";
    date.dateTime = video.published;
    date.textContent = dateFormat.format(new Date(video.published));
    const p = document.createElement("p");
    p.className = "card-date";
    p.append(date);
    body.append(p);
  }

  a.append(thumb, body);
  li.append(a);
  return li;
}

function render() {
  const type = currentType();
  const q = search.value.trim().toLowerCase();
  for (const tab of tabs) {
    const ofType = tab.dataset.type === "game" ? games : videos.filter((v) => v.type === tab.dataset.type);
    const matching = q
      ? ofType.filter((v) => `${v.title} ${v.description || ""}`.toLowerCase().includes(q))
      : ofType;
    tab.querySelector(".count").textContent = q ? `${matching.length}/${ofType.length}` : ofType.length;
    if (tab.dataset.type === type) {
      tab.setAttribute("aria-current", "page");
      grid.replaceChildren(...matching.map(card));
    } else {
      tab.removeAttribute("aria-current");
    }
  }
  grid.classList.toggle("shorts", type === "short");
  statusEl.hidden = grid.children.length > 0;
  statusEl.textContent = q
    ? "Nothing here matches your search."
    : type === "game" ? "Games are coming soon. Check back later!" : "Nothing here yet.";
}

function openPlayer(video) {
  playerIframe.src = `https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`;
  playerIframe.title = video.title;
  playerLink.href = watchUrl(video);
  player.classList.toggle("short", video.type === "short");
  player.showModal();
}

function closePlayer() {
  player.close();
}

// Open videos in an embedded player; ctrl/cmd/shift/middle-click still opens YouTube.
// Game cards are plain links to the game's page.
grid.addEventListener("click", (e) => {
  const a = e.target.closest(".card");
  if (!a || !a.dataset.id || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0 || typeof player.showModal !== "function") return;
  e.preventDefault();
  openPlayer(videos.find((v) => v.id === a.dataset.id));
});
document.getElementById("player-close").addEventListener("click", closePlayer);
player.addEventListener("click", (e) => { if (e.target === player) closePlayer(); });
player.addEventListener("close", () => { playerIframe.src = "about:blank"; });
search.addEventListener("input", render);
window.addEventListener("hashchange", render);

// A missing or broken games.json just leaves the Games tab empty.
fetch("games.json", { cache: "no-cache" })
  .then((r) => (r.ok ? r.json() : { games: [] }))
  .catch(() => ({ games: [] }))
  .then((data) => {
    games = (data.games || []).map((g) => ({ ...g, type: "game" }));
    if (videos.length) render();
  });

fetch("videos.json", { cache: "no-cache" })
  .then((r) => {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  })
  .then((data) => {
    videos = data.videos;
    const { channel } = data;
    if (channel.avatar) {
      const avatar = document.getElementById("avatar");
      avatar.src = channel.avatar;
      avatar.alt = channel.title;
      avatar.hidden = false;
    }
    if (data.updated) {
      document.getElementById("updated").textContent = `List updated ${dateFormat.format(new Date(data.updated))}`;
    }
    render();
  })
  .catch(() => {
    statusEl.innerHTML = 'Couldn\'t load the video list. <a href="https://www.youtube.com/@Firerama/videos">See all videos on YouTube</a>.';
  });
