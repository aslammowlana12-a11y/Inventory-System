import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Request failed");
  return data;
}

const CATEGORIES = ["Ingredient", "Topping", "Packaging", "Syrups", "Spreads", "Nuts"];

function Layout({ user, onLogout, children }) {
  const location = useLocation();
  const nav = [
    ["/", "Dashboard"],
    ["/add-item", "Add item"],
    ["/update-stock", "Update stock"],
    ["/history", "History"],
    ["/reports", "Reports"],
    ["/trends", "Trends"],
  ];
  return (
    <>
      <div className="app-bg" aria-hidden="true" />
      <div className="app">
        <header className="topbar">
          <Link to="/" className="brand">
            <span className="brand-mark" />
            <span className="brand-text">
              Pick A Treat <span>AI Inventory</span>
            </span>
          </Link>
          <nav className="topnav">
            {nav.map(([href, label]) => (
              <Link key={href} to={href} className={`nav-link${location.pathname === href ? " is-active" : ""}`}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="user-area">
            <span className="user-name">{user.username}</span>
            <button className="btn btn-ghost btn-sm" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>
        <main className="main">{children}</main>
      </div>
    </>
  );
}

function Login({ refreshSession }) {
  const [form, setForm] = useState({ username: "", password: "" });
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify(form) });
      await refreshSession();
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="auth-layout">
      <div className="auth-card card-elevated">
        <p className="eyebrow">Pick A Treat AI-Enhanced Inventory Management System</p>
        <h1 className="auth-title">Sign in</h1>
        {error && <p className="notice notice-error">{error}</p>}
        <form onSubmit={submit} className="form-stack">
          <label className="field">
            <span className="field-label">Username</span>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
          <button className="btn btn-primary btn-block">Sign in</button>
        </form>
        <p className="auth-footer">
          No accounts yet? <Link to="/register">Create the first admin</Link>
        </p>
      </div>
    </div>
  );
}

function Register() {
  const [form, setForm] = useState({ username: "", password: "", confirm: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const data = await api("/auth/register", { method: "POST", body: JSON.stringify(form) });
      setMessage(data.message);
      setForm({ username: "", password: "", confirm: "" });
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="auth-layout">
      <div className="auth-card card-elevated">
        <p className="eyebrow">Pick A Treat AI-Enhanced Inventory Management System</p>
        <h1 className="auth-title">Create admin</h1>
        {error && <p className="notice notice-error">{error}</p>}
        {message && (
          <>
            <p className="notice notice-success">{message}</p>
            <Link to="/login" className="btn btn-primary btn-block">
              Sign in
            </Link>
          </>
        )}
        {!message && (
          <form onSubmit={submit} className="form-stack">
            <label className="field">
              <span className="field-label">Username</span>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} required />
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </label>
            <label className="field">
              <span className="field-label">Confirm password</span>
              <input
                type="password"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                required
              />
            </label>
            <button className="btn btn-primary btn-block">Create account</button>
          </form>
        )}
      </div>
    </div>
  );
}

function Dashboard() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api("/items").then((d) => setItems(d.items));
  }, []);
  const summary = useMemo(() => {
    let low = 0;
    let exp = 0;
    let risk = 0;
    let qty = 0;
    let used = 0;
    for (const item of items) {
      qty += Number(item.quantity);
      used += Number(item.used_30d || 0);
      if (item.status.includes("Low")) low += 1;
      if (item.status.includes("Expiring")) exp += 1;
      if (item.status.includes("before use")) risk += 1;
    }
    return { low, exp, risk, qty, used };
  }, [items]);

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Inventory</h1>
        <p className="page-sub">Live stock, alerts, and usage-based predictions.</p>
      </div>
      <div className="table-wrap card-elevated">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Name</th><th>Category</th><th>Quantity</th><th>Reorder</th><th>Usage freq (30d)</th><th>Expiry</th><th>Status</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="td-strong">{item.name}</td>
                <td><span className="tag">{item.category}</span></td>
                <td>{item.quantity}</td>
                <td>{item.reorder_level}</td>
                <td>{Number(item.avg_usage || 0).toFixed(2)}/day</td>
                <td>{item.expiry_date?.slice(0, 10)}</td>
                <td><span className={`badge ${item.status === "OK" ? "badge-ok" : "badge-warn"}`}>{item.status}</span></td>
                <td className="actions-cell"><Link className="btn btn-ghost btn-sm" to={`/edit-item/${item.id}`}>Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="dashboard-bottom">
        <div className="summary-grid">
          <div className="card-elevated summary-card"><p className="summary-label">Items</p><p className="summary-value">{items.length}</p></div>
          <div className="card-elevated summary-card"><p className="summary-label">Total quantity</p><p className="summary-value">{summary.qty}</p></div>
          <div className="card-elevated summary-card"><p className="summary-label">Used (30 days)</p><p className="summary-value">{summary.used}</p></div>
          <div className="card-elevated summary-card"><p className="summary-label">Critical alerts</p><p className="summary-value">{summary.low + summary.exp + summary.risk}</p></div>
        </div>
      </section>
    </>
  );
}

function ItemForm({ editMode = false }) {
  const navigate = useNavigate();
  const id = useLocation().pathname.split("/").at(-1);
  const [form, setForm] = useState({ name: "", category: "Ingredient", quantity: 0, reorder_level: 5, expiry: "" });
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (editMode) {
      api("/items").then((d) => {
        const item = d.items.find((x) => String(x.id) === id);
        if (item) {
          setForm({
            name: item.name,
            category: item.category,
            quantity: Number(item.quantity),
            reorder_level: Number(item.reorder_level || 5),
            expiry: String(item.expiry_date).slice(0, 10),
          });
        }
      });
    }
  }, [editMode, id]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editMode) {
        await api(`/items/${id}`, { method: "PUT", body: JSON.stringify(form) });
        setMessage("Item updated.");
      } else {
        await api("/items", { method: "POST", body: JSON.stringify(form) });
        setMessage("Item added successfully.");
        setForm({ name: "", category: "Ingredient", quantity: 0, reorder_level: 5, expiry: "" });
      }
    } catch (err) {
      setMessage(err.message);
    }
  };

  const remove = async () => {
    if (!editMode || !window.confirm("Delete this item?")) return;
    await api(`/items/${id}`, { method: "DELETE" });
    navigate("/");
  };

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">{editMode ? "Edit item" : "Add item"}</h1>
        <p className="page-sub">{editMode ? "Update item details and reorder threshold." : "New stock entry with category and expiry."}</p>
      </div>
      {message && <p className={`notice ${message.includes("updated") || message.includes("added") ? "notice-success" : "notice-error"}`}>{message}</p>}
      <form onSubmit={submit} className="card card-elevated form-stack narrow">
        <label className="field"><span className="field-label">Name</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
        <label className="field"><span className="field-label">Category</span><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label className="field"><span className="field-label">Quantity</span><input type="number" min="0" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} required /></label>
        <label className="field"><span className="field-label">Reorder level</span><input type="number" min="0" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: Number(e.target.value) })} required /></label>
        <label className="field"><span className="field-label">Expiry date</span><input type="date" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} required /></label>
        <button className="btn btn-primary">{editMode ? "Save changes" : "Add item"}</button>
        {editMode && <button type="button" className="btn btn-ghost btn-danger" onClick={remove}>Delete item</button>}
      </form>
    </>
  );
}

function UpdateStock() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState({ item_id: "", direction: "OUT", quantity: 1, note: "" });
  const [message, setMessage] = useState("");
  useEffect(() => {
    api("/update-stock/items").then((d) => setItems(d.items));
  }, []);
  const submit = async (e) => {
    e.preventDefault();
    try {
      const data = await api("/update-stock", { method: "POST", body: JSON.stringify(form) });
      setMessage(data.message);
    } catch (err) {
      setMessage(err.message);
    }
  };
  return (
    <>
      <div className="page-head"><h1 className="page-title">Update stock</h1><p className="page-sub">Record stock received or used. Each change is logged for reporting and predictions.</p></div>
      {message && <p className={`notice ${message.includes("recorded") ? "notice-success" : "notice-error"}`}>{message}</p>}
      <form onSubmit={submit} className="card card-elevated form-stack narrow">
        <label className="field"><span className="field-label">Item</span><select value={form.item_id} onChange={(e) => setForm({ ...form, item_id: e.target.value })} required><option value="">Select an item</option>{items.map((it) => <option key={it.id} value={it.id}>{`${it.name} · ${it.category} · Available: ${it.quantity}`}</option>)}</select></label>
        <label className="field"><span className="field-label">Movement</span><select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}><option value="OUT">Used (stock out)</option><option value="IN">Received (stock in)</option></select></label>
        <label className="field"><span className="field-label">Quantity</span><input type="number" min="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} required /></label>
        <label className="field"><span className="field-label">Note (optional)</span><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength="255" /></label>
        <button className="btn btn-primary">Update</button>
      </form>
    </>
  );
}

function History() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api("/history").then((d) => setRows(d.history));
  }, []);
  return (
    <>
      <div className="page-head"><h1 className="page-title">Stock update history</h1><p className="page-sub">Audit trail of stock in/out actions used for alerts, trends, and prediction logic.</p></div>
      <div className="table-wrap card-elevated"><table className="inventory-table"><thead><tr><th>Date/Time</th><th>Item</th><th>Category</th><th>Type</th><th>Quantity</th><th>Note</th></tr></thead><tbody>{rows.map((row, idx) => <tr key={idx}><td>{row.used_at}</td><td className="td-strong">{row.name}</td><td><span className="tag">{row.category}</span></td><td><span className={`badge ${String(row.direction).toUpperCase() === "OUT" ? "badge-warn" : "badge-ok"}`}>{String(row.direction).toUpperCase() === "OUT" ? "Used (OUT)" : "Received (IN)"}</span></td><td>{row.quantity_used}</td><td>{row.note || ""}</td></tr>)}</tbody></table></div>
    </>
  );
}

function Reports() {
  const [data, setData] = useState({ lowStock: [], expiringSoon: [], topUsed: [], aiInsights: [] });
  useEffect(() => {
    api("/reports").then(setData);
  }, []);
  return (
    <>
      <div className="page-head"><h1 className="page-title">Reports</h1><p className="page-sub">Quick insights: low stock, expiring items, and top usage (last 30 days).</p></div>
      <div className="grid">
        <section className="card-elevated panel"><h2 className="panel-title">Low stock</h2><ul className="panel-list">{data.lowStock.map((r) => <li key={r.id}><span className="li-strong">{r.name}</span><span className="li-meta">{r.category} · Qty: {r.quantity} · Reorder: {r.reorder_level}</span></li>)}</ul></section>
        <section className="card-elevated panel"><h2 className="panel-title">Expiring soon (≤ 3 days)</h2><ul className="panel-list">{data.expiringSoon.map((r) => <li key={r.id}><span className="li-strong">{r.name}</span><span className="li-meta">{r.category} · Exp: {String(r.expiry_date).slice(0, 10)}</span></li>)}</ul></section>
        <section className="card-elevated panel panel-wide"><h2 className="panel-title">Top used items (last 30 days)</h2><div className="table-wrap"><table className="inventory-table"><thead><tr><th>Name</th><th>Category</th><th>Used (30 days)</th></tr></thead><tbody>{data.topUsed.map((r, i) => <tr key={i}><td className="td-strong">{r.name}</td><td><span className="tag">{r.category}</span></td><td>{r.used_30d}</td></tr>)}</tbody></table></div></section>
        <section className="card-elevated panel panel-wide"><h2 className="panel-title">AI insights (last 30 days)</h2><div className="table-wrap"><table className="inventory-table"><thead><tr><th>Name</th><th>Category</th><th>Used (30 days)</th><th>Days to stockout</th><th>Insight</th></tr></thead><tbody>{data.aiInsights.map((r, i) => <tr key={i}><td className="td-strong">{r.name}</td><td><span className="tag">{r.category}</span></td><td>{r.used_30d}</td><td>{r.days_to_stockout ?? "N/A"}</td><td><span className="badge badge-warn">{r.insights}</span></td></tr>)}</tbody></table></div></section>
      </div>
    </>
  );
}

function Trends() {
  const [data, setData] = useState({ dailyUsage: [], weeklyUsage: [], categoryUsage: [] });
  useEffect(() => {
    api("/trends").then(setData);
  }, []);
  const dailyMax = Math.max(1, ...data.dailyUsage.map((d) => Number(d.total_used)));
  const weeklyMax = Math.max(1, ...data.weeklyUsage.map((d) => Number(d.total_used)));
  return (
    <>
      <div className="page-head"><h1 className="page-title">Usage trends</h1><p className="page-sub">Daily and weekly stock-out activity to support AI-based demand analysis.</p></div>
      <div className="grid">
        <section className="card-elevated panel panel-wide"><h2 className="panel-title">Daily usage (last 30 days)</h2><ul className="trend-list">{data.dailyUsage.map((r, i) => <li className="trend-row" key={i}><span className="trend-label">{r.day_key}</span><span className="trend-bar"><span style={{ width: `${Math.round((Number(r.total_used) / dailyMax) * 100)}%` }} /></span><span className="trend-value">{r.total_used}</span></li>)}</ul></section>
        <section className="card-elevated panel"><h2 className="panel-title">Weekly usage (last 8 weeks)</h2><ul className="trend-list">{data.weeklyUsage.map((r, i) => <li className="trend-row" key={i}><span className="trend-label">Week {r.week_key}</span><span className="trend-bar"><span style={{ width: `${Math.round((Number(r.total_used) / weeklyMax) * 100)}%` }} /></span><span className="trend-value">{r.total_used}</span></li>)}</ul></section>
        <section className="card-elevated panel"><h2 className="panel-title">Usage by category (30 days)</h2><ul className="panel-list">{data.categoryUsage.map((r, i) => <li key={i}><span className="li-strong">{r.category}</span><span className="li-meta">Total used: {r.total_used}</span></li>)}</ul></section>
      </div>
    </>
  );
}

function Protected({ user, onLogout, children }) {
  if (!user) return <Navigate to="/login" replace />;
  return <Layout user={user} onLogout={onLogout}>{children}</Layout>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const refreshSession = async () => {
    const data = await api("/auth/me");
    setUser(data.user);
  };
  useEffect(() => {
    refreshSession().catch(() => setUser(null));
  }, []);
  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setUser(null);
  };
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login refreshSession={refreshSession} />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/" element={<Protected user={user} onLogout={logout}><Dashboard /></Protected>} />
      <Route path="/add-item" element={<Protected user={user} onLogout={logout}><ItemForm /></Protected>} />
      <Route path="/edit-item/:id" element={<Protected user={user} onLogout={logout}><ItemForm editMode /></Protected>} />
      <Route path="/update-stock" element={<Protected user={user} onLogout={logout}><UpdateStock /></Protected>} />
      <Route path="/history" element={<Protected user={user} onLogout={logout}><History /></Protected>} />
      <Route path="/reports" element={<Protected user={user} onLogout={logout}><Reports /></Protected>} />
      <Route path="/trends" element={<Protected user={user} onLogout={logout}><Trends /></Protected>} />
    </Routes>
  );
}
