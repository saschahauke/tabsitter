const EXPORT_FILENAME = 'pinned-tab-lock.json';

const list = document.getElementById('locked-urls');
const importFile = document.getElementById('import-file');
const status = document.getElementById('status');

const loadLocks = () => chrome.storage.local.get({ closedSlots: [], lockedUrls: [] });

async function render() {
  const { closedSlots, lockedUrls } = await loadLocks();
  const label = (url, index) => (closedSlots.includes(index) ? `${url} (closed, reopens on reset)` : url);
  list.replaceChildren(...lockedUrls.map((url, index) => Object.assign(document.createElement('li'), { textContent: label(url, index) })));
  document.getElementById('no-locks').hidden = lockedUrls.length > 0;
}

function parseExport(text) {
  const lockedUrls = JSON.parse(text)?.lockedUrls;
  if (!Array.isArray(lockedUrls) || !lockedUrls.every((url) => typeof url === 'string' && url)) {
    throw new Error('expected {"lockedUrls": ["https://…", …]}');
  }
  return lockedUrls;
}

document.getElementById('export').addEventListener('click', async () => {
  const { lockedUrls } = await loadLocks();
  const json = `${JSON.stringify({ lockedUrls }, null, 2)}\n`;
  const link = Object.assign(document.createElement('a'), {
    download: EXPORT_FILENAME,
    href: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
  });
  link.click();
  status.textContent = `Exported ${lockedUrls.length} locked URLs.`;
});

document.getElementById('import').addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const [file] = importFile.files;
  importFile.value = '';
  if (!file) return;
  try {
    const lockedUrls = parseExport(await file.text());
    const question = `Open the ${lockedUrls.length} URLs in ${file.name} as new pinned tabs? Your current pinned tabs stay as they are.`;
    if (!confirm(question)) return;
    await chrome.runtime.sendMessage({ type: 'import', lockedUrls });
    status.textContent = `Added ${lockedUrls.length} pinned tabs from ${file.name}.`;
  } catch (error) {
    status.textContent = `Import failed: ${error.message}`;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.lockedUrls || changes.closedSlots)) render();
});

render();
