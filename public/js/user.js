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

  // If not in master, pull any previous user‐entered data from this list
  const r  = await fetch(`/api/lists/${listSelect.value}`);
  const ls = await r.json();
  if (!masterItems[code] && ls.items[code])
    masterItems[code] = ls.items[code];

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
  .forEach(btn => btn.addEventListener('click', () =>
    updateQty(parseInt(btn.dataset.delta,10))
  ));
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

/**
 * normalizeUPC(raw)
 * 1) keep digits only
 * 2) strip leading zeros, remember how many
 * 3) if we now have 13 digits, test “without last digit”
 *    against masterItems; if that exists, drop check digit
 * 4) pad back to 13 with any leading zeros we lost
 */
function normalizeUPC(raw) {
  const digits = String(raw).replace(/\\D/g,"");          // keep digits
  if (!digits) return "";

  let core = digits;
  // If scanner included check digit (13) but master is 12
  if (core.length === 13 && !masterItems[core] && masterItems[core.slice(0,12)]) {
    core = core.slice(0,12);                              // drop check digit
  }
  // Pad to 13 with leading zeros
  return core.padStart(13,"0");
}

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
