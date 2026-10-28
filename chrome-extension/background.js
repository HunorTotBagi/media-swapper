const SPOTIFY_URL = 'https://open.spotify.com/*';
const YOUTUBE_URL = 'https://www.youtube.com/*';
const VSCODE_BRIDGE_URL = 'ws://127.0.0.1:47823';

let pending = Promise.resolve();
function queue(task) {
  pending = pending.then(task).catch((err) => console.error('Media Swapper:', err));
}

chrome.action.onClicked.addListener(() => queue(swap));
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'youtube-play') queue(onYouTubePlay);
});

let bridge;
function connectBridge() {
  if (bridge?.readyState === WebSocket.CONNECTING || bridge?.readyState === WebSocket.OPEN) return;
  bridge = new WebSocket(VSCODE_BRIDGE_URL);
  bridge.onmessage = (event) => {
    if (event.data === 'vscode-focused') queue(onVSCodeFocused);
  };
}

connectBridge();
setInterval(() => {
  if (bridge?.readyState === WebSocket.OPEN) bridge.send('keepalive');
}, 20_000);
chrome.alarms.create('connect-bridge', { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'connect-bridge') connectBridge();
});

async function swap() {
  const spotifyTab = await findSpotifyTab();
  const youtubeTabs = await findYouTubeTabs();

  if (spotifyTab && (await isSpotifyPlaying(spotifyTab))) {
    await pauseSpotify(spotifyTab);
    await resumeYouTube(youtubeTabs);
  } else {
    await pauseYouTube(youtubeTabs);
    await playSpotify(spotifyTab);
  }
}

async function onVSCodeFocused() {
  await pauseYouTube(await findYouTubeTabs());
  await playSpotify(await findSpotifyTab());
}

async function onYouTubePlay() {
  const spotifyTab = await findSpotifyTab();
  if (spotifyTab) await pauseSpotify(spotifyTab);
}

async function findSpotifyTab() {
  return pickTab(await chrome.tabs.query({ url: SPOTIFY_URL }));
}

async function isSpotifyPlaying(tab) {
  const hooked = await runInTab(tab, () => window.__mediaSwapper?.isPlaying() ?? null, [], 'MAIN');
  return hooked ?? tab.audible;
}

async function pauseSpotify(tab) {
  if (!(await isSpotifyPlaying(tab))) return;
  await runInTab(tab, clickSpotifyPlayPause);
  await keepLoaded(tab);
}

async function playSpotify(tab) {
  if (tab && (await isSpotifyPlaying(tab))) return;
  const clicked = tab && (await runInTab(tab, clickSpotifyPlayPause));
  if (!clicked) flashBadge();
}

function findYouTubeTabs() {
  return chrome.tabs.query({ url: YOUTUBE_URL });
}

async function pauseYouTube(tabs) {
  let pausedAny = false;
  for (const tab of tabs) {
    if (await runInTab(tab, pauseVideos)) {
      pausedAny = true;
      await chrome.storage.session.set({ youtubeTabId: tab.id });
      await keepLoaded(tab);
    }
  }
  return pausedAny;
}

async function resumeYouTube(tabs) {
  const { youtubeTabId } = await chrome.storage.session.get('youtubeTabId');
  const tab =
    tabs.find((t) => t.id === youtubeTabId) ??
    pickTab(tabs.filter((t) => /youtube\.com\/(watch|shorts)/.test(t.url))) ??
    pickTab(tabs);
  if (!tab || !(await runInTab(tab, resumeVideo))) flashBadge();
}

function pickTab(tabs) {
  return tabs.toSorted(
    (a, b) => (b.audible ? 1 : 0) - (a.audible ? 1 : 0) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0),
  )[0];
}

async function runInTab(tab, func, args = [], world = 'ISOLATED') {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args, world });
    return injection?.result;
  } catch (err) {
    console.warn(`Couldn't run in tab ${tab.id} (${tab.url}):`, err.message);
    return undefined;
  }
}

function keepLoaded(tab) {
  return chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => {});
}

function flashBadge() {
  chrome.action.setBadgeText({ text: '?' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
}

function pauseVideos() {
  const playing = [...document.querySelectorAll('video')].filter((v) => !v.paused);
  playing.forEach((v) => v.pause());
  if (playing.length) window.__mediaSwapperPaused = playing;
  return playing.length > 0;
}

async function resumeVideo() {
  const remembered = (window.__mediaSwapperPaused ?? []).filter((v) => v.isConnected);
  const video =
    remembered[0] ?? document.querySelector('video.html5-main-video') ?? document.querySelector('video');
  if (!video) return false;
  window.__mediaSwapperResuming = true;
  try {
    await video.play();
    return true;
  } catch {
    return false;
  } finally {
    window.__mediaSwapperResuming = false;
  }
}

function clickSpotifyPlayPause() {
  const button = document.querySelector('[data-testid="control-button-playpause"]');
  button?.click();
  return Boolean(button);
}
