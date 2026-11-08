const EXPORT_FILENAME = 'tabsitter.json';

const list = document.getElementById('homes');
const importFile = document.getElementById('import-file');
const status = document.getElementById('status');

const loadHomes = () => chrome.storage.local.get({ closedSlots: [], homeUrls: [] });

async function render() {
  const { closedSlots, homeUrls } = await loadHomes();
  const label = (url, index) => (closedSlots.includes(index) ? `${url} (closed until the tabs are sent home)` : url);
  list.replaceChildren(...homeUrls.map((url, index) => Object.assign(document.createElement('li'), { textContent: label(url, index) })));
  document.getElementById('no-homes').hidden = homeUrls.length > 0;
}

// Pinned Tab Lock exported the homes as lockedUrls.
function parseExport(text) {
  const parsed = JSON.parse(text);
  const homeUrls = parsed?.homeUrls ?? parsed?.lockedUrls;
  if (!Array.isArray(homeUrls) || !homeUrls.every((url) => typeof url === 'string' && url)) {
    throw new Error('expected {"homeUrls": ["https://…", …]}');
  }
  return homeUrls;
}

document.getElementById('export').addEventListener('click', async () => {
  const { homeUrls } = await loadHomes();
  const json = `${JSON.stringify({ homeUrls }, null, 2)}\n`;
  const link = Object.assign(document.createElement('a'), {
    download: EXPORT_FILENAME,
    href: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
  });
  link.click();
  status.textContent = `Exported ${homeUrls.length} homes.`;
});

document.getElementById('import').addEventListener('click', () => importFile.click());

importFile.addEventListener('change', async () => {
  const [file] = importFile.files;
  importFile.value = '';
  if (!file) return;
  try {
    const homeUrls = parseExport(await file.text());
    const question = `Open the ${homeUrls.length} URLs in ${file.name} as new pinned tabs? Your current pinned tabs stay as they are.`;
    if (!confirm(question)) return;
    await chrome.runtime.sendMessage({ homeUrls, type: 'import' });
    status.textContent = `Added ${homeUrls.length} pinned tabs from ${file.name}.`;
  } catch (error) {
    status.textContent = `Import failed: ${error.message}`;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.homeUrls || changes.closedSlots)) render();
});

render();
