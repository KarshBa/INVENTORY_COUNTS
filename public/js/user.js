// public/js/user.js  –  CLEAN & WORKING

/* ---------- DOM refs ---------- */
const listSelect   = document.getElementById('listSelect');
const newListName  = document.getElementById('newListName');
const createListBtn= document.getElementById('createListBtn');
const itemCodeEl   = document.getElementById('itemCode');
const selectBtn    = document.getElementById('selectBtn');
const detailsWrap  = document.getElementById('detailsWrap');
const brandEl      = document.getElementById('brand');
const descEl       = document.getElementById('desc');
const priceEl      = document.getElementById('price');
const customQtyEl  = document.getElementById('customQty');
const enterBtn        = document.getElementById('enterBtn');
const qtyDefaultToggle= document.getElementById('qtyDefaultToggle');
const itemsTable      = document.querySelector('#itemsTable tbody');
const grandTotalEl    = document.getElementById('grandTotal');

let masterItems = {};
const pad13 = c => c.padStart(13,'0');   // “1” → “0000000000001”
let currentCode = null;

const QTY_DEFAULT_SESSION_KEY = 'inventoryCounts:noDefaultQty';

const getNoDefaultQty = () =>
  sessionStorage.getItem(QTY_DEFAULT_SESSION_KEY) === '1';

const setNoDefaultQty = enabled =>
  sessionStorage.setItem(QTY_DEFAULT_SESSION_KEY, enabled ? '1' : '0');

const getDefaultQtyValue = () =>
  getNoDefaultQty() ? '' : '1';

const getQtyNumber = () => {
  const raw = String(customQtyEl.value ?? '').trim();
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
};

const getSelectedListKey = () => listSelect.value;

const formatQty = qty => Number.isInteger(qty) ? String(qty) : String(qty);
/* ---------- initial ---------- */
(async () => {
  await loadMaster();
  await loadLists();
})();

if (qtyDefaultToggle) {
  qtyDefaultToggle.checked = getNoDefaultQty();
  qtyDefaultToggle.addEventListener('change', () => {
    setNoDefaultQty(qtyDefaultToggle.checked);
    if (!detailsWrap || detailsWrap.style.display === 'none') {
      customQtyEl.value = getDefaultQtyValue();
    }
  });
}

customQtyEl.value = getDefaultQtyValue();

/* ---------- helpers ---------- */
async function loadMaster() {
  const res = await fetch('/api/items');
  masterItems = await res.json();
}

async function loadLists(selectedKey) {
  const res   = await fetch('/api/lists');
  const lists = await res.json();

  const entries = Object.entries(lists);

  if (!entries.length) {
    listSelect.innerHTML = `<option value="" disabled selected hidden>Create a List</option>`;
    return;
  }

  listSelect.innerHTML = entries
    .map(([safeName, list]) => `<option value="${safeName}">${list.displayName || safeName}</option>`)
    .join('');

  const fallbackKey = entries[0][0];
  listSelect.value = selectedKey && lists[selectedKey] ? selectedKey : fallbackKey;
  renderList();
}

/* ---------- list create ---------- */
createListBtn.addEventListener('click', async () => {
  const name = newListName.value.trim();
  if (!name) return alert('Enter list name');

  const res = await fetch('/api/lists', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ name })
  });

  if (res.ok) {
    const created = await res.json();
    await loadLists(created.safeName);
    newListName.value = '';
  } else {
    const err = await res.json().catch(() => null);
    alert(err?.error || 'Create failed');
  }
});
listSelect.addEventListener('change', renderList);

/* ---------- item selection ---------- */
selectBtn.addEventListener('click', async () => {
  const raw = itemCodeEl.value.trim();
  if (!raw) return alert('Enter item code');

  // always start with the freshly-scanned code
  let code = normalizeUPC(raw);

  /* ——— ask the back-end only if we don’t already know this code ——— */
  if (!masterItems[code]) {
    const hit = await fetch(`/api/item/${raw}`).then(r => r.json());
    if (hit.code) {
      masterItems[hit.code] = hit;   // cache for later scans
      code = hit.code;               // switch to canonical catalogue key
    }
  }

  currentCode = code;
  prepareDetails(code);
  detailsWrap.style.display = 'block';
  applyDefaultQtyForSelection();
  customQtyEl.focus();
});

itemCodeEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); selectBtn.click(); }
});

function prepareDetails(code) {
  const m = masterItems[code];
  const lock = !!m;
  [brandEl, descEl, priceEl].forEach(el => el.readOnly = lock);
  if (m) { brandEl.value = m.brand||''; descEl.value = m.description||''; priceEl.value = m.price??''; }
  else   { brandEl.value = descEl.value = priceEl.value = ''; }
}

function applyDefaultQtyForSelection() {
  customQtyEl.value = getDefaultQtyValue();
}

/* ---------- quantity updates ---------- */
document.querySelectorAll('button[data-delta]')
  .forEach(btn =>
    btn.addEventListener('click', () => {
      const delta = parseFloat(btn.dataset.delta);
      const curr  = getQtyNumber();
      customQtyEl.value = String(curr + delta);
    })
  );

enterBtn.addEventListener('click', () =>
  updateQty(getQtyNumber())
);

customQtyEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); enterBtn.click(); }
});

async function updateQty(delta) {
  if (!delta) return;

  const raw = itemCodeEl.value.trim().replace(/\D/g, "");
  if (!raw) return;

  const payload = {
    itemCode   : raw,
    brand      : brandEl.value,
    description: descEl.value,
    price      : priceEl.value,
    delta
  };

  const res = await fetch(`/api/lists/${encodeURIComponent(getSelectedListKey())}/items`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload)
  });

  if (res.ok) {
    resetForm();
    renderList();
  } else {
    alert('Server error');
  }
}

// --- helper: normalise any scanner payload to 13-digit / no-check-digit ---
const normalizeUPC = raw => {
  let d = String(raw).replace(/\D/g, "");
  if (!d) return "";

  // Variable-weight scale label with stripped check digit (11 digits)
  if (d.length === 11 && d[0] === "2") {
    // canonical catalogue code: 00 + first-7 + 0000
    return ("00" + d.slice(0, 7) + "0000").padStart(13, "0");
  }

  // UPC-A (12 digits) – strip the check digit
  if (d.length === 12) d = d.slice(0, 11);

  // EAN-13 and everything else: **keep all 13 digits**
  return d.padStart(13, "0");
};

function resetForm() {
  currentCode = null;
  itemCodeEl.value = '';
  customQtyEl.value = getDefaultQtyValue();
  detailsWrap.style.display = 'none';
  itemCodeEl.focus();
}

/* ---------- render list ---------- */
async function renderList() {
  if (!listSelect.value) return;

  const res = await fetch(`/api/lists/${encodeURIComponent(getSelectedListKey())}`);
  if (!res.ok) return;

  const list = await res.json();
  itemsTable.innerHTML = '';

  let grand = 0;
  Object.values(list.items).forEach(it => {
    const price = Number(it.price) || 0;
    const qty   = Number(it.qty) || 0;
    const total = qty * price;
    grand += total;

    itemsTable.insertAdjacentHTML('beforeend', `
      <tr>
        <td data-label="Code">${it.code}</td>
        <td data-label="Brand">${it.brand}</td>
        <td data-label="Description">${it.description}</td>
        <td data-label="Price">${price.toFixed(2)}</td>
        <td data-label="Qty">${formatQty(qty)}</td>
        <td data-label="Total">${total.toFixed(2)}</td>
      </tr>`);
  });

  grandTotalEl.textContent = `Grand Total: $${grand.toFixed(2)}`;
}
