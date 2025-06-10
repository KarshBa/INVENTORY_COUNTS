
// user.js – all front‑end logic for Inventory Counts
const listSelect = document.getElementById('listSelect');
const newListName = document.getElementById('newListName');
const createListBtn = document.getElementById('createListBtn');
const itemCodeEl = document.getElementById('itemCode');
const selectBtn = document.getElementById('selectBtn');
const detailsWrap = document.getElementById('detailsWrap');
const brandEl = document.getElementById('brand');
const descEl = document.getElementById('desc');
const priceEl = document.getElementById('price');
const customQtyEl = document.getElementById('customQty');
const enterBtn = document.getElementById('enterBtn');
const itemsTableBody = document.querySelector('#itemsTable tbody');
const grandTotalEl = document.getElementById('grandTotal');

let masterItems = {};

// ---------- initial ----------
(async () => {
  await loadMaster();
  await loadLists();
})();

// ---------- fetch helpers ----------
async function loadMaster() {
  const res = await fetch('/api/items');
  masterItems = await res.json();
}
async function loadLists() {
  const res = await fetch('/api/lists');
  const lists = await res.json();
  listSelect.innerHTML = Object.keys(lists)
    .map(n => `<option value="${n}">${n}</option>`)
    .join('');
  if (Object.keys(lists).length) {
    listSelect.value = Object.keys(lists)[0];
    renderList();
  }
}

// ---------- list create ----------
createListBtn.addEventListener('click', async () => {
  const name = newListName.value.trim();
  if (!name) return alert('Enter list name');
  const res = await fetch('/api/lists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
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

// ---------- item selection ----------
selectBtn.addEventListener('click', () => {
  const code = itemCodeEl.value.trim();
  if (!code) return alert('Enter item code');
  prepareDetails(code);
  detailsWrap.style.display = 'block';
  customQtyEl.focus();
});
itemCodeEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    selectBtn.click();
  }
});

function prepareDetails(code) {
  const master = masterItems[code];
  const locked = !!master;
  [brandEl, descEl, priceEl].forEach(el => (el.readOnly = locked));
  if (master) {
    brandEl.value = master.brand || '';
    descEl.value = master.description || '';
    priceEl.value = master.price ?? '';
  } else {
    brandEl.value = '';
    descEl.value = '';
    priceEl.value = '';
  }
}

// ---------- quantity updates ----------
document
  .querySelectorAll('button[data-delta]')
  .forEach(btn =>
    btn.addEventListener('click', () =>
      updateQty(parseInt(btn.dataset.delta, 10)),
    ),
  );
enterBtn.addEventListener('click', () =>
  updateQty(parseInt(customQtyEl.value, 10)),
);
customQtyEl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    enterBtn.click();
  }
});

async function updateQty(delta) {
  if (!delta) return;
  const code = itemCodeEl.value.trim();
  if (!code) return;
  const payload = {
    itemCode: code,
    brand: brandEl.value,
    description: descEl.value,
    price: priceEl.value,
    delta,
  };
  const res = await fetch(`/api/lists/${listSelect.value}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) {
    resetForm();
    renderList();
  } else {
    alert('Server error');
  }
}

function resetForm() {
  itemCodeEl.value = '';
  detailsWrap.style.display = 'none';
  customQtyEl.value = 1;
  itemCodeEl.focus();
}

// ---------- render list ----------
async function renderList() {
  if (!listSelect.value) return;
  const res = await fetch(`/api/lists/${listSelect.value}`);
  if (!res.ok) return;
  const list = await res.json();
  itemsTableBody.innerHTML = '';
  let grand = 0;
  Object.values(list.items).forEach(it => {
    const total = it.qty * it.price;
    grand += total;
    itemsTableBody.insertAdjacentHTML(
      'beforeend',
      `<tr>
        <td data-label="Code">${it.code}</td>
        <td data-label="Brand">${it.brand}</td>
        <td data-label="Description">${it.description}</td>
        <td data-label="Price">${it.price.toFixed(2)}</td>
        <td data-label="Qty">${it.qty}</td>
        <td data-label="Total">${total.toFixed(2)}</td>
      </tr>`,
    );
  });
  grandTotalEl.textContent = `Grand Total: $${grand.toFixed(2)}`;
}
