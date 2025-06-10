// server.js – updated header mapping for unconventional CSV column names

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const LISTS_FILE = path.join(DATA_DIR, "lists_data.json");
const ITEM_CSV_PATH = path.join(__dirname, "item_list.csv");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LISTS_FILE)) fs.writeFileSync(LISTS_FILE, "{}", "utf8");

/* --------------------------------------------------
   Helper: normalise header names so we don’t depend on
   exact capitalisation / quoting from the export.
-------------------------------------------------- */
const clean = (s = "") => s.replace(/\"/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const wanted = {
  code: ["main code", "item code", "code"],
  brand: ["main item-brand", "brand"],
  description: ["main item-description", "description"],
  price: [
    "price-regular-price",
    "price active price",
    "price",
    "unit price",
  ],
};

function pick(row, aliases) {
  for (const alias of aliases) {
    const key = Object.keys(row).find((k) => clean(k) === alias);
    if (key) return row[key];
  }
  return undefined;
}

/* --------------------------------------------------
   Load the master item mapping once at startup
-------------------------------------------------- */
let masterItems = new Map();
try {
  const csvRaw = fs.readFileSync(ITEM_CSV_PATH, "utf8");
  const records = parse(csvRaw, { columns: true, skip_empty_lines: true });
  records.forEach((row) => {
    const itemCode = String(pick(row, wanted.code) || "").padStart(13, "0").trim();
    if (!itemCode) return; // skip empty rows
    masterItems.set(itemCode, {
      code: itemCode,
      brand: pick(row, wanted.brand) || "",
      description: pick(row, wanted.description) || "",
      price: parseFloat(pick(row, wanted.price) || 0),
    });
  });
  console.log(`Loaded ${masterItems.size} master items.`);
} catch (err) {
  console.error("Failed to load item_list.csv", err);
}

/* -------------------------------------------------- */
const loadLists = () => JSON.parse(fs.readFileSync(LISTS_FILE, "utf8"));
const saveLists = (obj) => fs.writeFileSync(LISTS_FILE, JSON.stringify(obj, null, 2));

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Return the master map to the front‑end
app.get("/api/items", (_, res) => {
  res.json(Object.fromEntries(masterItems));
});

// ----- list CRUD endpoints -----
app.get("/api/lists", (_, res) => res.json(loadLists()));

app.post("/api/lists", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing list name" });
  const lists = loadLists();
  if (lists[name]) return res.status(409).json({ error: "List exists" });
  lists[name] = { items: {}, created: Date.now() };
  saveLists(lists);
  res.status(201).json({ message: "List created" });
});

app.get("/api/lists/:name", (req, res) => {
  const list = loadLists()[req.params.name];
  if (!list) return res.status(404).json({ error: "Not found" });
  res.json(list);
});

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
  if (master) {
    entry.brand = master.brand;
    entry.description = master.description;
    entry.price = master.price;
  } else {
// keep previous values unless the user sent non-blank data
  if (brand && brand.trim())        entry.brand       = brand.trim();
  if (description && description.trim())
                                    entry.description = description.trim();
  if (price !== undefined && price !== '')
                                    entry.price       = parseFloat(price);
  }
  entry.qty += parseFloat(delta) || 0;
  if (entry.qty === 0) delete list.items[itemCode];
  else list.items[itemCode] = entry;
  saveLists(lists);
  res.json({ message: "Item updated", item: entry });
});

app.delete("/api/lists/:name", (req, res) => {
  const lists = loadLists();
  delete lists[req.params.name];
  saveLists(lists);
  res.json({ message: "Deleted" });
});

app.delete("/api/lists", (_, res) => { saveLists({}); res.json({ message: "All cleared" }); });

// ----- CSV export -----
app.get("/api/export/:name", (req, res) => {
  const list = loadLists()[req.params.name];
  if (!list) return res.status(404).json({ error: "List not found" });
  const rows = [["Item Code","Brand","Description","Price","Qty","Total"]];
  let grand = 0;
  Object.values(list.items).forEach(it => { const t = it.qty * it.price; grand += t; rows.push([it.code,it.brand,it.description,it.price,it.qty,t]); });
  rows.push(["","","","","Grand Total",grand]);
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition",`attachment; filename=${req.params.name}.csv`);
  res.send(rows.map(r=>r.join(",")).join("\n"));
});

app.get("/api/exportall", (_, res) => {
  const lists = loadLists();
  const rows = [["List","Item Code","Brand","Description","Price","Qty","Total"]];
  Object.entries(lists).forEach(([name,list])=>{
    Object.values(list.items).forEach(it=>rows.push([name,it.code,it.brand,it.description,it.price,it.qty,it.qty*it.price]));
  });
  res.setHeader("Content-Type","text/csv");
  res.setHeader("Content-Disposition","attachment; filename=all_lists.csv");
  res.send(rows.map(r=>r.join(",")).join("\n"));
});

/* -------------------------------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Inventory Counts App listening on port ${PORT}`));
