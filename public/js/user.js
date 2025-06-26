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
const enterBtn     = document.getElementById('enterBtn');
const itemsTable   = document.querySelector('#itemsTable tbody');
const grandTotalEl = document.getElementById('grandTotal');

let masterItems = {};
const pad13 = c => c.padStart(13,'0');   // “1” → “0000000000001”

/* ---------- initial ---------- */
(async () => {
  await loadMaster();
  await loadLists();
})();

/* ---------- helpers ---------- */
async function loadMaster() {
  const res = await fetch('/api/items');
  masterItems = await res.json();
}
async function loadLists() {
  const res   = await fetch('/api/lists');
  const lists = await res.json();
  listSelect.innerHTML = Object.keys(lists)
    .map(n => `<option value="${n}">${n}</option>`)
    .join('');
  if (Object.keys(lists).length) {
    listSelect.value = Object.keys(lists)[0];
    renderList();
  }
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
    await loadLists();
    listSelect.value = name;
    newListName.value = '';
  } else {
    alert('Create failed');
  }
});
listSelect.addEventListener('change', renderList);

/* ---------- item selection ---------- */
selectBtn.addEventListener('click', async () => {
  const raw = itemCodeEl.value.trim();
  if (!raw) return alert('Enter item code');

  const code = normalizeUPC(raw);
  
  /* ————— Ask the back-end to decode the raw scan ————— */
  if (!masterItems[code]) {                       // nothing in master yet?
    const hit = await fetch(`/api/item/${raw}`).then(r => r.json());
    if (hit.code) masterItems[code] = hit;        // cache for next scan
  }
  
  prepareDetails(code);
  detailsWrap.style.display = 'block';
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

/* ---------- quantity updates ---------- */
document.querySelectorAll('button[data-delta]')
  .forEach(btn =>
    btn.addEventListener('click', () => {
      // just bump the qty field – don’t submit yet
      const delta = parseInt(btn.dataset.delta, 10);
      const curr  = parseInt(customQtyEl.value, 10) || 0;
      customQtyEl.value = curr + delta;
    })
  );
enterBtn.addEventListener('click', () =>
  updateQty(parseInt(customQtyEl.value,10))
);
customQtyEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); enterBtn.click(); }
});

async function updateQty(delta) {
  if (!delta) return;
  const raw = itemCodeEl.value.trim();
  if (!raw) return;
  const code = normalizeUPC(raw);

  const payload = {
    itemCode   : code,
    brand      : brandEl.value,
    description: descEl.value,
    price      : priceEl.value,
    delta
  };
  const res = await fetch(`/api/lists/${listSelect.value}/items`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload)
  });
  if (res.ok) { resetForm(); renderList(); }
  else        { alert('Server error');   }
}

// --- helper: normalise any scanner payload to 13-digit / no-check-digit ---
const normalizeUPC = raw => {
  let d = String(raw).replace(/\D/g, "");
  if (!d) return "";

  // UPC-A (12 digits) – strip the check-digit
  if (d.length === 12) d = d.slice(0, 11);

  // EAN-13 and everything else: **keep all 13 digits**
  return d.padStart(13, "0");
};

function resetForm() {
  itemCodeEl.value = '';
  customQtyEl.value = 1;
  detailsWrap.style.display = 'none';
  itemCodeEl.focus();
}

/* ---------- render list ---------- */
async function renderList() {
  if (!listSelect.value) return;
  const res = await fetch(`/api/lists/${listSelect.value}`);
  if (!res.ok) return;
  const list = await res.json();
  itemsTable.innerHTML = '';
  let grand = 0;
  Object.values(list.items).forEach(it => {
    const total = it.qty * it.price;
    grand += total;
    itemsTable.insertAdjacentHTML('beforeend', `
      <tr>
        <td data-label="Code">${it.code}</td>
        <td data-label="Brand">${it.brand}</td>
        <td data-label="Description">${it.description}</td>
        <td data-label="Price">${it.price.toFixed(2)}</td>
        <td data-label="Qty">${it.qty}</td>
        <td data-label="Total">${total.toFixed(2)}</td>
      </tr>`);
  });
  grandTotalEl.textContent = `Grand Total: $${grand.toFixed(2)}`;
}
