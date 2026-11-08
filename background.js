const DRIFT_BADGE_COLOR = '#d97706';
const LOCK_ALL_MENU_ID = 'lock-all-pinned-tabs';
const RESET_ALL_MENU_ID = 'reset-all-pinned-tabs';
const RESTORE_POLL_MS = 500;
const RESTORE_TIMEOUT_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const urlOf = (tab) => tab.url || tab.pendingUrl || '';
const isOn = (tab, url) => Boolean(tab) && (tab.url === url || tab.pendingUrl === url);
const windowExists = (windowId) => chrome.windows.get(windowId).then(() => true, () => false);

async function pinnedTabs() {
  const tabs = await chrome.tabs.query({ pinned: true, windowType: 'normal' });
  return tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index);
}

async function openWindowCount() {
  return (await chrome.windows.getAll({ windowTypes: ['normal'] })).length;
}

// lockedUrls[i] belongs to the i-th pinned tab. pinnedTabIds only mirrors the live tab strip: Chrome
// reports an unpin or close by tab id alone, so this is how the extension knows which slot it vacated.
// An empty session (browser start, extension reload) defaults to resetPending.
async function loadState() {
  const { lockedUrls = [] } = await chrome.storage.local.get('lockedUrls');
  const { pinnedTabIds = [], resetPending = true } = await chrome.storage.session.get([
    'pinnedTabIds',
    'resetPending',
  ]);
  return { lockedUrls, pinnedTabIds, resetPending };
}

async function saveState({ lockedUrls, pinnedTabIds, resetPending }) {
  await chrome.storage.local.set({ lockedUrls });
  await chrome.storage.session.set({ pinnedTabIds, resetPending });
}

async function updateIndicator({ lockedUrls, resetPending }) {
  if (resetPending) return;
  const tabs = await pinnedTabs();
  const positions = Array.from({ length: Math.max(tabs.length, lockedUrls.length) }, (_, slot) => slot);
  const drifted = positions.filter((slot) => !isOn(tabs[slot], lockedUrls[slot])).map((slot) => slot + 1);
  let title = 'Every pinned tab is on its locked URL';
  if (drifted.length === 1) title = `Pinned tab ${drifted[0]} is off its locked URL`;
  if (drifted.length > 1) title = `Pinned tabs ${drifted.join(', ')} are off their locked URLs`;
  await chrome.action.setBadgeBackgroundColor({ color: DRIFT_BADGE_COLOR });
  await chrome.action.setBadgeText({ text: drifted.length ? String(drifted.length) : '' });
  await chrome.action.setTitle({ title });
}

let queue = Promise.resolve();
// Without a task it only refreshes the indicator, which is all a pinned tab's navigation changes.
function enqueue(task = async () => {}) {
  return (queue = queue
    .then(async () => {
      const state = await loadState();
      await task(state);
      await saveState(state);
      await updateIndicator(state);
    })
    .catch(console.error));
}

async function navigate(tab, url) {
  if (!url || urlOf(tab) === url) return;
  await chrome.tabs.update(tab.id, { url }).catch((error) => console.warn(`Cannot open ${url}`, error));
}

async function waitForPinnedTabs(expected) {
  const deadline = Date.now() + RESTORE_TIMEOUT_MS;
  while ((await pinnedTabs()).length < expected && Date.now() < deadline) await sleep(RESTORE_POLL_MS);
}

async function reset(state) {
  if (!state.resetPending || (await openWindowCount()) === 0) return;
  await waitForPinnedTabs(state.lockedUrls.length);
  const tabs = await pinnedTabs();
  for (const [slot, tab] of tabs.entries()) {
    if (slot < state.lockedUrls.length) await navigate(tab, state.lockedUrls[slot]);
    else state.lockedUrls.push(urlOf(tab));
  }
  state.pinnedTabIds = tabs.map((tab) => tab.id);
  state.resetPending = false;
}

// Moves leave the slots alone, which is what keeps the order fixed.
async function sync(state, lockFor = urlOf) {
  if (state.resetPending || (await openWindowCount()) === 0) return;
  const tabs = await pinnedTabs();
  const liveIds = tabs.map((tab) => tab.id);
  const vacated = state.pinnedTabIds.flatMap((id, slot) => (liveIds.includes(id) ? [] : [slot]));
  for (const slot of vacated.toReversed()) state.lockedUrls.splice(slot, 1);
  tabs.forEach((tab, slot) => {
    if (!state.pinnedTabIds.includes(tab.id)) state.lockedUrls.splice(slot, 0, lockFor(tab));
  });
  state.pinnedTabIds = liveIds;
}

// One task end to end, so the tabs it opens are already mirrored when their onCreated events arrive.
// Each opened tab is locked to the file's URL rather than wherever a redirect has taken it by now.
async function importLocks(state, lockedUrls) {
  await sync(state);
  const imported = new Map();
  for (const url of lockedUrls) {
    const tab = await chrome.tabs.create({ active: false, pinned: true, url }).catch((error) => console.warn(`Cannot open ${url}`, error));
    if (tab) imported.set(tab.id, url);
  }
  await sync(state, (tab) => imported.get(tab.id) ?? urlOf(tab));
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: LOCK_ALL_MENU_ID, title: 'Lock all pinned tabs to their current URLs', contexts: ['action'] });
  chrome.contextMenus.create({ id: RESET_ALL_MENU_ID, title: 'Reset all pinned tabs to their locked URLs', contexts: ['action'] });
});

enqueue(reset);

chrome.windows.onCreated.addListener(() => enqueue(reset));

chrome.windows.onRemoved.addListener(() =>
  enqueue(async (state) => {
    if ((await openWindowCount()) > 0) return;
    state.resetPending = true;
    state.pinnedTabIds = [];
  }),
);

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.pinned) enqueue(sync);
});

// Chrome unpins every pinned tab while it closes their window; those unpins must not free slots.
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.pinned === true) enqueue(sync);
  else if (change.pinned === false) {
    enqueue(async (state) => {
      if (await windowExists(tab.windowId)) await sync(state);
    });
  } else if (change.url && tab.pinned) enqueue();
});

// Closing a whole window keeps its slots; only closing a single pinned tab gives one up.
chrome.tabs.onRemoved.addListener((tabId, { isWindowClosing }) => {
  if (isWindowClosing) return;
  enqueue(async (state) => {
    if (state.pinnedTabIds.includes(tabId)) await sync(state);
  });
});

for (const event of [chrome.tabs.onMoved, chrome.tabs.onAttached]) {
  event.addListener((tabId) =>
    enqueue(async (state) => {
      if (state.pinnedTabIds.includes(tabId)) await sync(state);
    }),
  );
}

// Prerendering swaps a new tab id in for the old one.
chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) =>
  enqueue(async (state) => {
    state.pinnedTabIds = state.pinnedTabIds.map((id) => (id === removedTabId ? addedTabId : id));
  }),
);

chrome.contextMenus.onClicked.addListener(({ menuItemId }) =>
  enqueue(async (state) => {
    const tabs = await pinnedTabs();
    if (menuItemId === LOCK_ALL_MENU_ID) {
      state.lockedUrls = tabs.map(urlOf);
      state.pinnedTabIds = tabs.map((tab) => tab.id);
      state.resetPending = false;
    }
    if (menuItemId === RESET_ALL_MENU_ID) {
      for (const [slot, tab] of tabs.entries()) await navigate(tab, state.lockedUrls[slot]);
    }
  }),
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'import') return false;
  enqueue((state) => importLocks(state, message.lockedUrls)).then(() => sendResponse({}));
  return true;
});
