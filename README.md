# Pinned Tab Lock

Locks each pinned-tab position to a URL. You can browse and rearrange freely; whenever the pinned tabs
come back, the first one is sent to the first locked URL, the second to the second, and so on.

They come back, and get reset, when Chrome starts, when you reopen Chrome after closing its last window
while it kept running in the background, and when the extension is reloaded. A locked tab that is missing
then, because you closed it or Chrome did not bring it back, reopens in its old position.

## Install

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → pick this folder

Installing locks the tabs that are already pinned to their current URLs.

## Use

- **Pinning a tab** adds a slot with the URL it is on at that moment. **Unpinning** a tab removes its slot.
- **Closing a pinned tab** keeps its slot: the tab reopens on the next reset, and **Reopen closed tab**
  (Ctrl+Shift+T) takes the slot back straight away. Closing the whole window keeps all slots.
- **Moving pinned tabs** changes nothing: slots belong to positions, so a reset restores the order.
- **Right-click the icon:**
  - **Lock all pinned tabs to their current URLs** sets up every slot in one go and drops the slots of
    closed tabs.
  - **Reset all pinned tabs to their locked URLs** sends them back and reopens closed ones now, without
    a restart.
  - **Options** lists the locked URLs and has **Export** and **Import**.
- **The orange badge** counts the pinned positions that are off their locked URL or closed; hover the
  icon to see which. No badge means every pinned tab is where its slot says.

## Back up and restore

Removing the extension or losing the Chrome profile deletes the locks; without them the extension
just locks whatever the pinned tabs show. **Export** saves `pinned-tab-lock.json`. **Import** only adds:
each URL in the file opens as a new pinned tab at the end, locked to that URL. Existing pinned tabs and
their locks stay as they are, even if that means a URL is pinned twice.

Pinned tabs in several windows are numbered window by window.
