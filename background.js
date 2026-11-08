const DRIFT_BADGE_COLOR = '#d97706';
const LOCK_ALL_MENU_ID = 'lock-all-pinned-tabs';
const RESET_ALL_MENU_ID = 'reset-all-pinned-tabs';
const RESTORE_POLL_MS = 500;
const RESTORE_TIMEOUT_MS = 15_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const urlOf = (tab) => tab.url || tab.pendingUrl || '';
const isOn = (tab, url) => Boolean(tab) && (tab.url === url || tab.pendingUrl === url);
const tabExists = (tabId) => chrome.tabs.get(tabId).then(() => true, () => false);
const windowExists = (windowId) => chrome.windows.get(windowId).then(() => true, () => false);
const openSlots = (slots) => slots.flatMap((slot, index) => (slot.closed ? [] : [index]));

// Chrome's "Reopen closed tab" brings a pinned tab back already pinned; such a tab takes back the closed
// slot it left instead of adding a second one.
const createdPinnedTabIds = new Set();

async function pinnedTabs() {
  const tabs = await chrome.tabs.query({ pinned: true, windowType: 'normal' });
  return tabs.sort((a, b) => a.windowId - b.windowId || a.index - b.index);
}

async function openWindowCount() {
  return (await chrome.windows.getAll({ windowTypes: ['normal'] })).length;
}

// slots[i] belongs to the i-th pinned position; a closed slot lost its tab and reopens on the next reset.
// pinnedTabIds mirrors the live tab strip, one id per open slot: Chrome reports an unpin or close by tab id
// alone, so this is how the extension knows which slot it vacated.
// An empty session (browser start, extension reload) defaults to resetPending.
async function loadState() {
  const { closedSlots, lockedUrls } = await chrome.storage.local.get({ closedSlots: [], lockedUrls: [] });
  const { pinnedTabIds = [], resetPending = true } = await chrome.storage.session.get([
    'pinnedTabIds',
    'resetPending',
  ]);
  const slots = lockedUrls.map((url, index) => ({ closed: closedSlots.includes(index), url }));
  return { pinnedTabIds, resetPending, slots };
}

async function saveState({ pinnedTabIds, resetPending, slots }) {
  await chrome.storage.local.set({
    closedSlots: slots.flatMap((slot, index) => (slot.closed ? [index] : [])),
    lockedUrls: slots.map((slot) => slot.url),
  });
  await chrome.storage.session.set({ pinnedTabIds, resetPending });
}

function describe(drifted, closed) {
  const lines = [];
  if (drifted.length === 1) lines.push(`Pinned tab ${drifted[0]} is off its locked URL`);
  if (drifted.length > 1) lines.push(`Pinned tabs ${drifted.join(', ')} are off their locked URLs`);
  if (closed.length === 1) lines.push(`Pinned tab ${closed[0]} is closed and reopens on reset`);
  if (closed.length > 1) lines.push(`Pinned tabs ${closed.join(', ')} are closed and reopen on reset`);
  return lines.join('\n') || 'Every pinned tab is on its locked URL';
}

async function updateIndicator({ resetPending, slots }) {
  if (resetPending) return;
  const tabs = await pinnedTabs();
  const drifted = openSlots(slots).flatMap((index, position) => (isOn(tabs[position], slots[index].url) ? [] : [index + 1]));
  const closed = slots.flatMap((slot, index) => (slot.closed ? [index + 1] : []));
  const count = drifted.length + closed.length;
  await chrome.action.setBadgeBackgroundColor({ color: DRIFT_BADGE_COLOR });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setTitle({ title: describe(drifted, closed) });
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

function placementAt(tabs, position) {
  const before = tabs[position - 1];
  if (before) return { index: before.index + 1, windowId: before.windowId };
  return tabs.length ? { index: 0, windowId: tabs[0].windowId } : { index: 0 };
}

// Ascending, so the slot before a closed one already has its tab to open next to.
async function reopenClosed(state) {
  for (const [index, slot] of state.slots.entries()) {
    if (!slot.closed) continue;
    const position = openSlots(state.slots).filter((open) => open < index).length;
    const placement = placementAt(await pinnedTabs(), position);
    const tab = await chrome.tabs
      .create({ active: false, pinned: true, url: slot.url, ...placement })
      .catch((error) => console.warn(`Cannot open ${slot.url}`, error));
    if (tab) slot.closed = false;
  }
  state.pinnedTabIds = (await pinnedTabs()).map((tab) => tab.id);
}

async function reset(state) {
  if (!state.resetPending || (await openWindowCount()) === 0) return;
  await waitForPinnedTabs(openSlots(state.slots).length);
  const tabs = await pinnedTabs();
  const open = openSlots(state.slots);
  // A tab Chrome did not bring back counts as closed, so it reopens instead of going missing.
  for (const index of open.slice(tabs.length)) state.slots[index].closed = true;
  for (const [position, tab] of tabs.entries()) {
    if (position < open.length) await navigate(tab, state.slots[open[position]].url);
    else state.slots.push({ closed: false, url: urlOf(tab) });
  }
  await reopenClosed(state);
  state.resetPending = false;
}

// Moves leave the slots alone, which is what keeps the order fixed. A vacated slot whose tab still exists was
// unpinned and goes; one whose tab is gone was closed and stays.
async function sync(state, lockFor = urlOf) {
  if (state.resetPending || (await openWindowCount()) === 0) return;
  const tabs = await pinnedTabs();
  const liveIds = tabs.map((tab) => tab.id);
  const open = openSlots(state.slots);
  const vacated = state.pinnedTabIds.flatMap((id, position) => (liveIds.includes(id) ? [] : [{ id, index: open[position] }]));
  for (const { id, index } of vacated.toReversed()) {
    if (await tabExists(id)) state.slots.splice(index, 1);
    else state.slots[index].closed = true;
  }
  const known = new Set(state.pinnedTabIds);
  let index = 0;
  for (const tab of tabs) {
    const gapStart = index;
    while (state.slots[index]?.closed) index += 1;
    if (known.has(tab.id)) {
      index += 1;
      continue;
    }
    const gap = state.slots.slice(gapStart, index);
    let reclaimed = gap.findIndex((slot) => isOn(tab, slot.url));
    if (reclaimed < 0 && gap.length && createdPinnedTabIds.has(tab.id)) reclaimed = 0;
    if (reclaimed >= 0) {
      state.slots[gapStart + reclaimed].closed = false;
      index = gapStart + reclaimed + 1;
    } else {
      state.slots.splice(index, 0, { closed: false, url: lockFor(tab) });
      index += 1;
    }
  }
  state.pinnedTabIds = liveIds;
  createdPinnedTabIds.clear();
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
  for (const tabId of imported.keys()) createdPinnedTabIds.delete(tabId);
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
  if (!tab.pinned) return;
  createdPinnedTabIds.add(tab.id);
  enqueue(sync);
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

// Locking drops the slots of closed tabs; resetting reopens them.
chrome.contextMenus.onClicked.addListener(({ menuItemId }) =>
  enqueue(async (state) => {
    const tabs = await pinnedTabs();
    if (menuItemId === LOCK_ALL_MENU_ID) {
      state.slots = tabs.map((tab) => ({ closed: false, url: urlOf(tab) }));
      state.pinnedTabIds = tabs.map((tab) => tab.id);
      state.resetPending = false;
    }
    if (menuItemId === RESET_ALL_MENU_ID) {
      const open = openSlots(state.slots);
      for (const [position, tab] of tabs.entries()) await navigate(tab, state.slots[open[position]]?.url);
      await reopenClosed(state);
    }
  }),
);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'import') return false;
  enqueue((state) => importLocks(state, message.lockedUrls)).then(() => sendResponse({}));
  return true;
});
