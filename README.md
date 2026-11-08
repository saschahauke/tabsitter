# Tabsitter

Babysits your pinned tabs. Each pinned position has a home URL. You can browse and rearrange freely;
whenever the pinned tabs come back, the first one is sent to the first home, the second to the second,
and so on.

The tabs are sent home when Chrome starts, when you reopen Chrome after closing its last window while it
kept running in the background, and when the extension is reloaded. A pinned tab that is missing then,
because you closed it or Chrome did not bring it back, reopens in its old position.

## Install

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → pick this folder

Installing makes each pinned tab's current URL its home.

## Use

- **Pinning a tab** gives its position a home: the URL it is on at that moment. **Unpinning** a tab
  removes that home.
- **Closing a pinned tab** keeps its home: the tab reopens the next time the tabs are sent home, and
  **Reopen closed tab** (Ctrl+Shift+T) takes its place back straight away. Closing the whole window keeps
  all homes.
- **Moving pinned tabs** changes nothing: homes belong to positions, so sending the tabs home restores
  the order.
- **Right-click the icon:**
  - **Set homes to current URLs** makes each pinned tab's current URL its home in one go and drops the
    homes of closed tabs.
  - **Send every pinned tab home** does it now, reopening closed ones, without a restart.
  - **Options** lists the homes and has **Export** and **Import**.
- **The orange badge** counts the pinned positions that have wandered off their home or are closed;
  hover the icon to see which. No badge means every pinned tab is home.

## Back up and restore

Removing the extension or losing the Chrome profile deletes the homes; without them the extension just
makes whatever the pinned tabs show their homes. **Export** saves `tabsitter.json`. **Import** only adds:
each URL in the file opens as a new pinned tab at the end, with that URL as its home. Existing pinned
tabs and their homes stay as they are, even if that means a URL is pinned twice. Import also reads a
`pinned-tab-lock.json` saved before the rename.

Pinned tabs in several windows are numbered window by window.
