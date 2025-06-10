<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Inventory Counts – User</title>
  <link rel="stylesheet" href="styles.css" />
  <style>
    /* Desktop: use default table layout from styles.css */
    @media (min-width: 601px) {
      .table-responsive { overflow: visible; }
      #itemsTable { width: 100%; table-layout: auto; }
    }
    /* Mobile: horizontal scroll, preserve headers, no block layout */
    @media (max-width: 600px) {
      .table-responsive { overflow-x: auto; }
      #itemsTable {
        width: max-content;
        min-width: 100%;
        border-collapse: collapse;
      }
      #itemsTable th, #itemsTable td {
        white-space: nowrap;
        padding: 0.5rem;
      }
    }
  </style>
</head>
<body>
<header><h1>Inventory Counts</h1></header>
<main>
  <div class="input-group flex">
    <select id="listSelect"></select>
    <input type="text" id="newListName" placeholder="New list name" />
    <button id="createListBtn">Create</button>
  </div>
  <hr />
  <form id="itemForm" autocomplete="off">
    <div class="input-group flex" style="align-items:flex-end;">
      <div style="flex:1;">
        <label for="itemCode">Item Code</label>
        <input type="text" id="itemCode" inputmode="numeric" pattern="[0-9]*" required />
      </div>
      <button type="button" id="selectBtn" class="secondary">Select</button>
    </div>
    <div id="detailsWrap" style="display:none;">
      <div class="flex">
        <div style="flex:1;min-width:120px;"><label for="brand">Brand</label><input type="text" id="brand" /></div>
        <div style="flex:2;"><label for="desc">Description</label><input type="text" id="desc" /></div>
      </div>
      <div class="input-group" style="max-width:200px;"><label for="price">Price</label><input type="number" step="0.01" id="price" /></div>
      <div class="flex" style="margin-top:.5rem;align-items:flex-end;">
        <button type="button" data-delta="-5">-5</button>
        <button type="button" data-delta="-1">-1</button>
        <input type="number" id="customQty" value="1" style="width:90px;" />
        <button type="button" id="enterBtn" class="secondary">Enter</button>
        <button type="button" data-delta="1">+1</button>
        <button type="button" data-delta="5">+5</button>
      </div>
    </div>
  </form>

  <div class="table-responsive">
    <table id="itemsTable">
      <thead>
        <tr><th>Code</th><th>Brand</th><th>Description</th><th>Price</th><th>Qty</th><th>Total</th></tr>
      </thead>
      <tbody></tbody>
    </table>
  </div>
  <h3 id="grandTotal"></h3>
</main>
<script src="js/user.js"></script>
<script>
  // Override renderList to trim to last 3 on mobile
  const _origRender = renderList;
  renderList = async function() {
    await _origRender();
    if (window.innerWidth <= 600) {
      const tb = document.querySelector('#itemsTable tbody');
      const rows = Array.from(tb.children);
      if (rows.length > 3) {
        tb.innerHTML = '';
        rows.slice(-3).forEach(r => tb.appendChild(r));
      }
    }
  };

  // Focus on itemCode input on startup
  window.addEventListener('load', () => {
    const codeField = document.getElementById('itemCode');
    if (codeField) codeField.focus();
  });
</script>
</body>
</html>
