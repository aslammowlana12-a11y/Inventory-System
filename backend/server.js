import express from "express";
import session from "express-session";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import cors from "cors";

const app = express();
const port = Number(process.env.PORT || 4000);

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "inventory_db",
  waitForConnections: true,
  connectionLimit: 10,
});

app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
    credentials: true,
  }),
);
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "inventory-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" },
  }),
);

const categories = ["Ingredient", "Topping", "Packaging", "Syrups", "Spreads", "Nuts"];

async function hasColumn(tableName, columnName) {
  const [rows] = await pool.query("SHOW COLUMNS FROM ?? LIKE ?", [tableName, columnName]);
  return rows.length > 0;
}

function ensureAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  return next();
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    res.status(503).json({ ok: false, message: "Database unavailable" });
  }
});

app.get("/api/auth/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/auth/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  if (!username || !password) {
    return res.status(400).json({ message: "Enter username and password." });
  }
  const [rows] = await pool.query("SELECT id, username, password_hash FROM users WHERE username = ?", [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ message: "Invalid username or password." });
  }
  req.session.user = { id: Number(user.id), username: user.username };
  return res.json({ user: req.session.user });
});

app.post("/api/auth/register", async (req, res) => {
  const [countRows] = await pool.query("SELECT COUNT(*) AS c FROM users");
  if (Number(countRows[0].c) > 0) {
    return res.status(403).json({ message: "Registration closed." });
  }
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const confirm = String(req.body.confirm || "");

  if (username.length < 3) {
    return res.status(400).json({ message: "Username must be at least 3 characters." });
  }
  if (password.length < 8) {
    return res.status(400).json({ message: "Password must be at least 8 characters." });
  }
  if (password !== confirm) {
    return res.status(400).json({ message: "Passwords do not match." });
  }

  const hash = await bcrypt.hash(password, 10);
  try {
    await pool.query("INSERT INTO users (username, password_hash) VALUES (?, ?)", [username, hash]);
    return res.json({ message: "Account created. You can sign in now." });
  } catch (error) {
    if (error && error.errno === 1062) {
      return res.status(409).json({ message: "That username is already taken." });
    }
    return res.status(500).json({ message: "Could not create account." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get("/api/meta", ensureAuth, async (_req, res) => {
  const hasDirectionCol = await hasColumn("usage_logs", "direction");
  const hasNoteCol = await hasColumn("usage_logs", "note");
  const hasReorderLevelCol = await hasColumn("items", "reorder_level");
  const [userRows] = await pool.query("SELECT COUNT(*) AS c FROM users");
  res.json({
    hasDirectionCol,
    hasNoteCol,
    hasReorderLevelCol,
    userCount: Number(userRows[0].c),
    categories,
  });
});

app.get("/api/items", ensureAuth, async (_req, res) => {
  const hasReorderLevelCol = await hasColumn("items", "reorder_level");
  const hasDirectionCol = await hasColumn("usage_logs", "direction");
  const usageSql = hasDirectionCol
    ? `SELECT item_id, SUM(quantity_used) AS total FROM usage_logs WHERE direction = 'OUT' AND used_at >= (NOW() - INTERVAL 30 DAY) GROUP BY item_id`
    : `SELECT item_id, SUM(quantity_used) AS total FROM usage_logs WHERE used_at >= (NOW() - INTERVAL 30 DAY) GROUP BY item_id`;

  const [usageRows] = await pool.query(usageSql);
  const usageByItem = new Map(usageRows.map((r) => [Number(r.item_id), Number(r.total || 0)]));
  const [rows] = await pool.query("SELECT * FROM items ORDER BY name ASC");

  const items = rows.map((row) => {
    const reorderLevel = hasReorderLevelCol ? Number(row.reorder_level || 5) : 5;
    const used30 = Number(usageByItem.get(Number(row.id)) || 0);
    const avgUsage = used30 / 30;
    const statusParts = [];
    if (Number(row.quantity) <= reorderLevel) statusParts.push("Low stock");
    if (new Date(row.expiry_date) < new Date(Date.now() + 3 * 24 * 3600 * 1000)) statusParts.push("Expiring soon");
    if (avgUsage > 0) {
      const daysLeft = Number(row.quantity) / avgUsage;
      const riskDate = new Date(Date.now() + daysLeft * 24 * 3600 * 1000);
      if (new Date(row.expiry_date) < riskDate) statusParts.push("May expire before use");
    }
    if (statusParts.length === 0) statusParts.push("OK");
    return {
      ...row,
      reorder_level: reorderLevel,
      used_30d: used30,
      avg_usage: avgUsage,
      status: statusParts.join(" · "),
    };
  });

  res.json({ items });
});

app.post("/api/items", ensureAuth, async (req, res) => {
  const hasReorderLevelCol = await hasColumn("items", "reorder_level");
  const name = String(req.body.name || "").trim();
  const category = String(req.body.category || "Ingredient");
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const reorderLevel = Math.max(0, Number(req.body.reorder_level ?? 5));
  const expiry = String(req.body.expiry || "");

  if (hasReorderLevelCol) {
    await pool.query(
      "INSERT INTO items (name, category, quantity, reorder_level, expiry_date) VALUES (?, ?, ?, ?, ?)",
      [name, category, quantity, reorderLevel, expiry],
    );
  } else {
    await pool.query("INSERT INTO items (name, category, quantity, expiry_date) VALUES (?, ?, ?, ?)", [
      name,
      category,
      quantity,
      expiry,
    ]);
  }
  res.json({ message: "Item added successfully." });
});

app.put("/api/items/:id", ensureAuth, async (req, res) => {
  const id = Number(req.params.id);
  const hasReorderLevelCol = await hasColumn("items", "reorder_level");
  const name = String(req.body.name || "").trim();
  const category = String(req.body.category || "Ingredient").trim();
  const quantity = Math.max(0, Number(req.body.quantity || 0));
  const reorderLevel = Math.max(0, Number(req.body.reorder_level ?? 5));
  const expiry = String(req.body.expiry || "");

  if (hasReorderLevelCol) {
    await pool.query("UPDATE items SET name=?, category=?, quantity=?, reorder_level=?, expiry_date=? WHERE id=?", [
      name,
      category,
      quantity,
      reorderLevel,
      expiry,
      id,
    ]);
  } else {
    await pool.query("UPDATE items SET name=?, category=?, quantity=?, expiry_date=? WHERE id=?", [
      name,
      category,
      quantity,
      expiry,
      id,
    ]);
  }
  res.json({ message: "Item updated." });
});

app.delete("/api/items/:id", ensureAuth, async (req, res) => {
  const id = Number(req.params.id);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM usage_logs WHERE item_id = ?", [id]);
    await conn.query("DELETE FROM items WHERE id = ?", [id]);
    await conn.commit();
    res.json({ ok: true });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ message: "Delete failed." });
  } finally {
    conn.release();
  }
});

app.get("/api/update-stock/items", ensureAuth, async (_req, res) => {
  const [items] = await pool.query("SELECT id, name, category, quantity FROM items ORDER BY name ASC");
  res.json({ items });
});

app.post("/api/update-stock", ensureAuth, async (req, res) => {
  const hasDirectionCol = await hasColumn("usage_logs", "direction");
  const hasNoteCol = await hasColumn("usage_logs", "note");

  const itemId = Number(req.body.item_id || 0);
  const direction = String(req.body.direction || "OUT").trim().toUpperCase() === "IN" ? "IN" : "OUT";
  const qty = Number(req.body.quantity || 0);
  let note = String(req.body.note || "").trim();
  if (note.length > 255) note = note.slice(0, 255);

  if (itemId <= 0 || qty <= 0) {
    return res.status(400).json({ message: "Please select an item and enter a valid quantity." });
  }

  const conn = await pool.getConnection();
  try {
    const [itemRows] = await conn.query("SELECT quantity FROM items WHERE id = ?", [itemId]);
    const item = itemRows[0];
    if (!item) return res.status(404).json({ message: "Item not found." });
    const available = Number(item.quantity);
    if (direction === "OUT" && available < qty) {
      return res.status(400).json({ message: `Not enough stock (available: ${available}).` });
    }

    await conn.beginTransaction();
    if (direction === "OUT") {
      await conn.query("UPDATE items SET quantity = quantity - ? WHERE id = ?", [qty, itemId]);
    } else {
      await conn.query("UPDATE items SET quantity = quantity + ? WHERE id = ?", [qty, itemId]);
    }

    if (hasDirectionCol && hasNoteCol) {
      await conn.query("INSERT INTO usage_logs (item_id, quantity_used, direction, note) VALUES (?, ?, ?, ?)", [
        itemId,
        qty,
        direction,
        note,
      ]);
    } else if (hasDirectionCol) {
      await conn.query("INSERT INTO usage_logs (item_id, quantity_used, direction) VALUES (?, ?, ?)", [
        itemId,
        qty,
        direction,
      ]);
    } else {
      await conn.query("INSERT INTO usage_logs (item_id, quantity_used) VALUES (?, ?)", [itemId, qty]);
    }

    await conn.commit();
    res.json({ message: direction === "OUT" ? "Stock usage recorded." : "Stock received recorded." });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ message: "Update failed." });
  } finally {
    conn.release();
  }
});

app.get("/api/history", ensureAuth, async (_req, res) => {
  const hasDirectionCol = await hasColumn("usage_logs", "direction");
  const hasNoteCol = await hasColumn("usage_logs", "note");
  let historySql;
  if (hasDirectionCol && hasNoteCol) {
    historySql = `SELECT l.used_at, l.direction, l.quantity_used, l.note, i.name, i.category FROM usage_logs l JOIN items i ON i.id = l.item_id ORDER BY l.used_at DESC LIMIT 200`;
  } else if (hasDirectionCol) {
    historySql = `SELECT l.used_at, l.direction, l.quantity_used, '' AS note, i.name, i.category FROM usage_logs l JOIN items i ON i.id = l.item_id ORDER BY l.used_at DESC LIMIT 200`;
  } else {
    historySql = `SELECT l.used_at, 'OUT' AS direction, l.quantity_used, '' AS note, i.name, i.category FROM usage_logs l JOIN items i ON i.id = l.item_id ORDER BY l.used_at DESC LIMIT 200`;
  }
  const [rows] = await pool.query(historySql);
  res.json({ history: rows });
});

app.get("/api/reports", ensureAuth, async (_req, res) => {
  const hasDirectionCol = await hasColumn("usage_logs", "direction");
  const hasReorderLevelCol = await hasColumn("items", "reorder_level");
  const lowCondition = hasReorderLevelCol ? "quantity <= reorder_level" : "quantity < 5";
  const reorderSelect = hasReorderLevelCol ? "reorder_level" : "5 AS reorder_level";
  const [lowStock] = await pool.query(
    `SELECT id, name, category, quantity, ${reorderSelect}, expiry_date FROM items WHERE ${lowCondition} ORDER BY quantity ASC, name ASC`,
  );
  const [expiringSoon] = await pool.query(
    "SELECT id, name, category, quantity, expiry_date FROM items WHERE expiry_date <= (CURDATE() + INTERVAL 3 DAY) ORDER BY expiry_date ASC, name ASC",
  );
  const topSql = hasDirectionCol
    ? `SELECT i.id, i.name, i.category, SUM(l.quantity_used) AS used_30d FROM usage_logs l JOIN items i ON i.id = l.item_id WHERE l.direction = 'OUT' AND l.used_at >= (NOW() - INTERVAL 30 DAY) GROUP BY i.id, i.name, i.category ORDER BY used_30d DESC LIMIT 10`
    : `SELECT i.id, i.name, i.category, SUM(l.quantity_used) AS used_30d FROM usage_logs l JOIN items i ON i.id = l.item_id WHERE l.used_at >= (NOW() - INTERVAL 30 DAY) GROUP BY i.id, i.name, i.category ORDER BY used_30d DESC LIMIT 10`;
  const [topUsed] = await pool.query(topSql);
  const usageSql = hasDirectionCol
    ? `SELECT item_id, SUM(quantity_used) AS used_30d FROM usage_logs WHERE direction = 'OUT' AND used_at >= (NOW() - INTERVAL 30 DAY) GROUP BY item_id`
    : `SELECT item_id, SUM(quantity_used) AS used_30d FROM usage_logs WHERE used_at >= (NOW() - INTERVAL 30 DAY) GROUP BY item_id`;
  const [usageRows] = await pool.query(usageSql);
  const usageMap = new Map(usageRows.map((r) => [Number(r.item_id), Number(r.used_30d)]));
  const [items] = await pool.query("SELECT id, name, category, quantity, expiry_date FROM items ORDER BY name ASC");
  const aiInsights = [];
  for (const item of items) {
    const used30 = Number(usageMap.get(Number(item.id)) || 0);
    const avgPerDay = used30 / 30;
    const daysToStockout = avgPerDay > 0 ? Math.floor(Number(item.quantity) / avgPerDay) : null;
    const insightTags = [];
    if (used30 > 0 && used30 <= 2) insightTags.push("Slow-moving");
    if (daysToStockout !== null && daysToStockout <= 7) insightTags.push("Stockout risk (<= 7 days)");
    if (daysToStockout !== null) {
      const riskDate = new Date(Date.now() + daysToStockout * 24 * 3600 * 1000);
      if (new Date(item.expiry_date) < riskDate) insightTags.push("Expiry risk before consumption");
    }
    if (insightTags.length > 0) {
      aiInsights.push({
        name: item.name,
        category: item.category,
        used_30d: used30,
        days_to_stockout: daysToStockout,
        insights: insightTags.join(" · "),
      });
    }
  }
  res.json({ lowStock, expiringSoon, topUsed, aiInsights });
});

app.get("/api/trends", ensureAuth, async (_req, res) => {
  const hasDirectionCol = await hasColumn("usage_logs", "direction");
  const dailyWhere = hasDirectionCol ? "direction = 'OUT' AND " : "";
  const weeklyWhere = hasDirectionCol ? "l.direction = 'OUT' AND " : "";
  const categoryWhere = hasDirectionCol ? "l.direction = 'OUT' AND " : "";

  const [dailyUsage] = await pool.query(
    `SELECT DATE(used_at) AS day_key, SUM(quantity_used) AS total_used FROM usage_logs WHERE ${dailyWhere} used_at >= (CURDATE() - INTERVAL 30 DAY) GROUP BY DATE(used_at) ORDER BY day_key ASC`,
  );
  const [weeklyUsage] = await pool.query(
    `SELECT YEARWEEK(l.used_at, 1) AS week_key, SUM(l.quantity_used) AS total_used FROM usage_logs l WHERE ${weeklyWhere} l.used_at >= (CURDATE() - INTERVAL 8 WEEK) GROUP BY YEARWEEK(l.used_at, 1) ORDER BY week_key ASC`,
  );
  const [categoryUsage] = await pool.query(
    `SELECT i.category, SUM(l.quantity_used) AS total_used FROM usage_logs l JOIN items i ON i.id = l.item_id WHERE ${categoryWhere} l.used_at >= (CURDATE() - INTERVAL 30 DAY) GROUP BY i.category ORDER BY total_used DESC`,
  );
  res.json({ dailyUsage, weeklyUsage, categoryUsage });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Server error." });
});

app.listen(port, () => {
  console.log(`API running on http://localhost:${port}`);
});
