// inventory-counts-app server.js

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, "data");
const LISTS_FILE = path.join(DATA_DIR, "lists_data.json");
const ITEM_CSV_PATH = path.join(__dirname, "item_list.csv");

// Ensure data directory & file
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LISTS_FILE)) fs.writeFileSync(LISTS_FILE, "{}", "utf8");

// Parse master item list once at startup.
let masterItems = new Map();
try {
  const csvRaw = fs.readFileSync(ITEM_CSV_PATH, "utf8");
  const records = parse(csvRaw, {
    columns: true,
    skip_empty_lines: true,
  });
  records.forEach((row) => {
    const code = row["Item Code"]?.trim();
    if (code) {
      masterItems.set(code, {
        code,
        brand: row["Brand"],
        description: row["Description"],
        price: parseFloat(row["Price"] || 0),
      });
    }
  });
  console.log(`Loaded ${masterItems.size} master items.`);
} catch (err) {
  console.error("Failed to load item_list.csv", err);
}

const loadLists = () => JSON.parse(fs.readFileSync(LISTS_FILE, "utf8"));
const saveLists = (obj) => fs.writeFileSync(LISTS_FILE, JSON.stringify(obj, null, 2));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- API ROUTES ---------------- */

// Get master items (brand/description/price) for client-side autocomplete
app.get("/api/items", (_, res) => {
  res.json(Object.fromEntries(masterItems));
});

// List all inventory lists (names only + meta)
app.get("/api/lists", (_, res) => {
  const lists = loadLists();
  res.json(lists);
});

// Create new list
app.post("/api/lists", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing list name" });
  const lists = loadLists();
  if (lists[name]) return res.status(409).json({ error: "List already exists" });
  lists[name] = { items: {}, created: Date.now() };
  saveLists(lists);
  res.status(201).json({ message: "List created", name });
});

// Get single list
app.get("/api/lists/:name", (req, res) => {
  const lists = loadLists();
  const list = lists[req.params.name];
  if (!list) return res.status(404).json({ error: "List not found" });
  res.json(list);
});

// Add / update an item quantity in a list
app.post("/api/lists/:name/items", (req, res) => {
  const { itemCode, brand, description, price, delta } = req.body;
  if (!itemCode) return res.status(400).json({ error: "Missing itemCode" });
  const lists = loadLists();
  const list = lists[req.params.name];
  if (!list) return res.status(404).json({ error: "List not found" });

  const master = masterItems.get(itemCode);
  let entry = list.items[itemCode] || {
    code: itemCode,
    brand: master?.brand || brand || "",
    description: master?.description || description || "",
    price: master ? master.price : parseFloat(price || 0),
    qty: 0,
  };

  // Lock brand/desc/price if master data exists
  if (master) {
    entry.brand = master.brand;
    entry.description = master.description;
    entry.price = master.price;
  } else {
    entry.brand = brand ?? entry.brand;
    entry.description = description ?? entry.description;
    entry.price = price !== undefined ? parseFloat(price) : entry.price;
  }

  entry.qty = (entry.qty || 0) + (parseFloat(delta) || 0);
  if (entry.qty === 0) {
    delete list.items[itemCode];
  } else {
    list.items[itemCode] = entry;
  }
  saveLists(lists);
  res.json({ message: "Item updated", item: entry });
});

// Delete a list
app.delete("/api/lists/:name", (req, res) => {
  const lists = loadLists();
  if (!lists[req.params.name]) return res.status(404).json({ error: "Not found" });
  delete lists[req.params.name];
  saveLists(lists);
  res.json({ message: "List deleted" });
});

// Delete ALL lists
app.delete("/api/lists", (_, res) => {
  saveLists({});
  res.json({ message: "All lists deleted" });
});

// Export list as CSV with totals
app.get("/api/export/:name", (req, res) => {
  const lists = loadLists();
  const list = lists[req.params.name];
  if (!list) return res.status(404).json({ error: "List not found" });

  const rows = [
    ["Item Code", "Brand", "Description", "Price", "Quantity", "Total"],
  ];
  let grand = 0;
  Object.values(list.items).forEach((it) => {
    const total = it.qty * it.price;
    grand += total;
    rows.push([it.code, it.brand, it.description, it.price, it.qty, total]);
  });
  rows.push(["", "", "", "", "Grand Total", grand]);
  const csvStr = rows.map((r) => r.join(",")).join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.name}.csv"`);
  res.send(csvStr);
});

// Export all lists as CSV joined
app.get("/api/exportall", (_, res) => {
  const lists = loadLists();
  const rows = [
    ["List", "Item Code", "Brand", "Description", "Price", "Quantity", "Total"],
  ];
  Object.entries(lists).forEach(([listName, list]) => {
    Object.values(list.items).forEach((it) => {
      rows.push([
        listName,
        it.code,
        it.brand,
        it.description,
        it.price,
        it.qty,
        it.qty * it.price,
      ]);
    });
  });
  const csvStr = rows.map((r) => r.join(",")).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=all_lists.csv");
  res.send(csvStr);
});

/* ------------------- START ------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Inventory Counts App listening on port ${PORT}`));
