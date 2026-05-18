import React, { useState, useEffect, useCallback } from "react";

const ASSET_COLORS = ["#F7931A","#10B981","#F59E0B","#EF4444","#8B5CF6","#F97316","#06B6D4","#EC4899"];

const initialTransactions = [];

const initialAssets = [
  { id: 1, symbol: "BTC", name: "Bitcoin", type: "Crypto" },
];

const mockCurrentPrices = { 1: 80683 }; // fallback

function fmt(n) {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n) {
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtBTC(n) {
  return n.toFixed(6) + " BTC";
}
function pct(n) {
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

const PNL = ({ val, cls }) => (
  <span className={val >= 0 ? "pos" : "neg"}>{cls}{val >= 0 ? "+" : ""}{fmt(val)}</span>
);

export default function App() {
  const [transactions, setTransactions] = useState(() => {
    try {
      const saved = localStorage.getItem("btc_transactions");
      if (saved) return JSON.parse(saved);
      // First time only — save initialTransactions to localStorage
      localStorage.setItem("btc_transactions", JSON.stringify(initialTransactions));
      return initialTransactions;
    } catch { return initialTransactions; }
  });
  const [assets] = useState(initialAssets);
  const [prices, setPrices] = useState(mockCurrentPrices);
  const [priceStatus, setPriceStatus] = useState("loading"); // "loading" | "live" | "error"
  const [lastUpdated, setLastUpdated] = useState(null);
  const [view, setView] = useState("dashboard");
  const [confirmDelete, setConfirmDelete] = useState(null); // id to delete

  // Fetch real-time BTC price from CoinGecko
  const fetchPrice = useCallback(async () => {
    setPriceStatus("loading");
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const btcPrice = data?.bitcoin?.usd;
      if (!btcPrice) throw new Error("No price");
      setPrices({ 1: btcPrice });
      setPriceStatus("live");
      setLastUpdated(new Date());
    } catch (e) {
      console.warn("CoinGecko failed, trying Binance...", e);
      try {
        const res2 = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        const data2 = await res2.json();
        const btcPrice2 = parseFloat(data2?.price);
        if (!btcPrice2) throw new Error("No price");
        setPrices({ 1: btcPrice2 });
        setPriceStatus("live");
        setLastUpdated(new Date());
      } catch {
        setPriceStatus("error");
      }
    }
  }, []);

  useEffect(() => {
    fetchPrice();
    const interval = setInterval(fetchPrice, 60000); // refresh every 60s
    return () => clearInterval(interval);
  }, [fetchPrice]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    assetId: "1", type: "Buy", investAmount: "3000",
    price: "", fee: "0", date: new Date().toISOString().split("T")[0], note: ""
  });

  // Compute holdings
  const holdings = assets.map(asset => {
    const txns = transactions.filter(t => t.assetId === asset.id);
    let totalUnits = 0, totalCost = 0;
    txns.forEach(t => {
      if (t.type === "Buy") { totalUnits += t.amount; totalCost += t.amount * t.price + t.fee; }
      else { totalUnits -= t.amount; }
    });
    const currentPrice = prices[asset.id] || 0;
    const currentValue = totalUnits * currentPrice;
    const avgCost = totalUnits > 0 ? totalCost / totalUnits : 0;
    const pnl = currentValue - totalCost;
    const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    return { ...asset, totalUnits, totalCost, currentValue, avgCost, pnl, pnlPct, currentPrice };
  }).filter(h => h.totalUnits > 0);

  const totalValue = holdings.reduce((s, h) => s + h.currentValue, 0);
  const totalCost = holdings.reduce((s, h) => s + h.totalCost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const totalInvested = transactions.filter(t => t.type === "Buy").reduce((s, t) => s + t.amount * t.price + t.fee, 0);

  // Save to localStorage whenever transactions change
  useEffect(() => {
    try { localStorage.setItem("btc_transactions", JSON.stringify(transactions)); }
    catch { console.warn("localStorage unavailable"); }
  }, [transactions]);

  const addTx = () => {
    const investAmt = parseFloat(form.investAmount) || 0;
    const price = parseFloat(form.price) || 0;
    const fee = parseFloat(form.fee) || 0;
    const units = price > 0 ? (investAmt - fee) / price : 0;
    const t = { id: Date.now(), assetId: parseInt(form.assetId), type: form.type, amount: units, price, fee, date: form.date, note: form.note };
    setTransactions([...transactions, t]);
    setShowForm(false);
    setForm({ assetId: "1", type: "Buy", investAmount: "3000", price: "", fee: "0", date: new Date().toISOString().split("T")[0], note: "" });
  };

  const delTx = id => { setConfirmDelete(null); setTransactions(transactions.filter(t => t.id !== id)); };

  // Running avg cost calc
  const txsSorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  let running = { units: 0, cost: 0 };
  const txRows = txsSorted.map(t => {
    const asset = assets.find(a => a.id === t.assetId);
    if (t.type === "Buy") { running.units += t.amount; running.cost += t.amount * t.price + t.fee; }
    else { running.units -= t.amount; }
    const avgAfter = running.units > 0 ? running.cost / running.units : 0;
    return { ...t, asset, avgAfter, investAmt: t.amount * t.price + t.fee };
  });

  // Sparkline
  const sparkData = txRows.map(r => r.price);

  const Spark = () => {
    if (sparkData.length < 2) return null;
    const min = Math.min(...sparkData), max = Math.max(...sparkData), range = max - min || 1;
    const pts = sparkData.map((v, i) => `${(i / (sparkData.length - 1)) * 260},${40 - ((v - min) / range) * 36}`).join(" ");
    const last = sparkData[sparkData.length - 1];
    const isUp = last >= sparkData[0];
    return (
      <svg viewBox="0 0 260 44" style={{ width: "100%", height: 44 }}>
        <polyline points={pts} fill="none" stroke={isUp ? "#10B981" : "#EF4444"} strokeWidth="2" strokeLinecap="round" />
        {sparkData.map((v, i) => {
          const x = (i / (sparkData.length - 1)) * 260;
          const y = 40 - ((v - min) / range) * 36;
          return <circle key={i} cx={x} cy={y} r="3" fill="#F7931A" />;
        })}
      </svg>
    );
  };

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", background: "#0F0F14", minHeight: "100vh", color: "#E8E6E0" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .card { background: #1A1A24; border-radius: 14px; border: 1px solid #2A2A3A; padding: 1.25rem; }
        .metric { background: #141420; border-radius: 10px; padding: .9rem 1rem; border: 1px solid #22223A; }
        .pos { color: #10B981; font-weight: 600; }
        .neg { color: #EF4444; font-weight: 600; }
        .nav-btn { background: none; border: none; cursor: pointer; padding: 8px 16px; border-radius: 8px; font-size: 13px; font-family: inherit; color: #888; transition: all .15s; }
        .nav-btn.active { background: #F7931A; color: #fff; font-weight: 600; }
        .nav-btn:hover:not(.active) { background: #2A2A3A; color: #ddd; }
        .btn-primary { background: #F7931A; color: #fff; border: none; border-radius: 8px; padding: 9px 18px; font-size: 13px; cursor: pointer; font-family: inherit; font-weight: 600; }
        .btn-primary:hover { opacity: .85; }
        .btn-primary:disabled { opacity: .4; cursor: not-allowed; }
        .btn-sec { background: #2A2A3A; color: #ccc; border: 1px solid #3A3A4A; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; font-family: inherit; }
        .btn-del { background: #3A1A1A; color: #EF4444; border: none; border-radius: 6px; padding: 4px 10px; font-size: 12px; cursor: pointer; font-family: inherit; }
        input, select, textarea { border: 1px solid #3A3A4A; border-radius: 8px; padding: 9px 12px; font-size: 13px; font-family: inherit; background: #141420; color: #E8E6E0; width: 100%; outline: none; }
        input:focus, select:focus { border-color: #F7931A; }
        .lbl { font-size: 11px; color: #666; margin-bottom: 4px; font-weight: 500; text-transform: uppercase; letter-spacing: .05em; }
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); z-index: 100; display: flex; align-items: center; justify-content: center; }
        .modal { background: #1A1A24; border-radius: 16px; padding: 1.5rem; width: 440px; max-width: 95vw; border: 1px solid #2A2A3A; }
        .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
        .tx-row { display: flex; align-items: center; gap: 10px; padding: 11px 0; border-bottom: 1px solid #1E1E2E; }
        .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
        .tag-buy { background: #0D2E1F; color: #10B981; }
        .tag-sell { background: #2E0D0D; color: #EF4444; }
        .btc-icon { width: 38px; height: 38px; border-radius: 50%; background: #F7931A22; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#13131C", borderBottom: "1px solid #2A2A3A", padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 22 }}>₿</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "#F7931A" }}>BTC DCA Tracker</span>
        </div>
        <nav style={{ display: "flex", gap: 4 }}>
          {[["dashboard","Dashboard"],["transactions","Transactions"]].map(([v, l]) => (
            <button key={v} className={`nav-btn${view === v ? " active" : ""}`} onClick={() => setView(v)}>{l}</button>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "#141420", border: "1px solid #2A2A3A", borderRadius: 8, padding: "5px 12px", fontSize: 12 }}>
            {priceStatus === "loading" && <span style={{ color: "#F7931A", animation: "pulse 1s infinite" }}>⟳</span>}
            {priceStatus === "live" && <span style={{ color: "#10B981", fontSize: 8 }}>●</span>}
            {priceStatus === "error" && <span style={{ color: "#EF4444", fontSize: 8 }}>●</span>}
            <span style={{ color: priceStatus === "live" ? "#F7931A" : "#888", fontWeight: 600 }}>
              {priceStatus === "loading" ? "Loading..." : priceStatus === "error" ? "Offline" : `${Math.round(prices[1]).toLocaleString()}`}
            </span>
            {priceStatus === "live" && lastUpdated && (
              <span style={{ color: "#555", fontSize: 10 }}>
                {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <button onClick={fetchPrice} style={{ background: "none", border: "none", cursor: "pointer", color: "#555", fontSize: 12, padding: 0 }} title="Refresh">⟳</button>
          </div>
          <button className="btn-primary" onClick={() => setShowForm(true)}>+ Add Buy</button>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "24px 20px" }}>

        {/* DASHBOARD */}
        {view === "dashboard" && holdings.length > 0 && (() => {
          const h = holdings[0];
          const dca = totalInvested / 10; // avg per buy
          return (
            <>
              {/* Top metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                <div className="card" style={{ gridColumn: "span 2", background: "linear-gradient(135deg,#1A1A24,#1F1A2E)" }}>
                  <div className="lbl">Current Portfolio Value</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#F7931A", marginBottom: 4 }}>{fmtInt(h.currentValue)}</div>
                  <div style={{ fontSize: 13 }} className={h.pnl >= 0 ? "pos" : "neg"}>
                    {h.pnl >= 0 ? "▲" : "▼"} {fmt(Math.abs(h.pnl))} ({pct(h.pnlPct)})
                  </div>
                </div>
                <div className="metric">
                  <div className="lbl">Total Invested</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtInt(totalCost)}</div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{transactions.length} purchases</div>
                </div>
                <div className="metric">
                  <div className="lbl">BTC Holdings</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#F7931A" }}>{fmtBTC(h.totalUnits)}</div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>@ ${Math.round(h.currentPrice).toLocaleString()} now</div>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
                <div className="metric">
                  <div className="lbl">Avg Buy Price (DCA)</div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{fmtInt(h.avgCost)}</div>
                </div>
                <div className="metric">
                  <div className="lbl">Current BTC Price</div>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{fmtInt(h.currentPrice)}</div>
                  <div style={{ fontSize: 11, marginTop: 2 }} className={h.currentPrice >= h.avgCost ? "pos" : "neg"}>
                    {pct(((h.currentPrice - h.avgCost) / h.avgCost) * 100)} vs avg
                  </div>
                </div>
                <div className="metric">
                  <div className="lbl">Unrealized P&L</div>
                  <div style={{ fontSize: 17 }} className={h.pnl >= 0 ? "pos" : "neg"}>
                    {h.pnl >= 0 ? "+" : ""}{fmtInt(h.pnl)}
                  </div>
                  <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>({pct(h.pnlPct)})</div>
                </div>
              </div>

              {/* Sparkline */}
              <div className="card" style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div className="lbl">BTC Buy Price History</div>
                  <div style={{ fontSize: 12, color: "#666" }}>Each dot = 1 buy @ $3,000 USDT</div>
                </div>
                <Spark />
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 11, color: "#555" }}>
                  <span>Nov 2025</span><span>Dec 2025</span><span>Jan 2026</span><span>Feb 2026</span><span>Mar 2026</span><span>Apr 2026</span>
                </div>
              </div>

              {/* DCA Table */}
              <div className="card">
                <div className="lbl" style={{ marginBottom: 12 }}>DCA Buy History — 10 purchases × $3,000 USDT</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
                      <th style={{ textAlign: "left", padding: "6px 0", fontWeight: 500 }}>#</th>
                      <th style={{ textAlign: "left", padding: "6px 8px", fontWeight: 500 }}>Date</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>Invest (USDT)</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>BTC Price</th>
                      <th style={{ textAlign: "right", padding: "6px 8px", fontWeight: 500 }}>BTC Received</th>
                      <th style={{ textAlign: "right", padding: "6px 0", fontWeight: 500 }}>Avg Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {txRows.map((r, i) => (
                      <tr key={r.id} style={{ borderTop: "1px solid #1E1E2E" }}>
                        <td style={{ padding: "9px 0", color: "#555", fontSize: 12 }}>{i + 1}</td>
                        <td style={{ padding: "9px 8px", fontWeight: 500 }}>{r.date}</td>
                        <td style={{ padding: "9px 8px", textAlign: "right" }}>{fmtInt(r.investAmt)}</td>
                        <td style={{ padding: "9px 8px", textAlign: "right", color: "#F7931A" }}>{fmtInt(r.price)}</td>
                        <td style={{ padding: "9px 8px", textAlign: "right", color: "#10B981", fontSize: 12 }}>{r.amount.toFixed(6)}</td>
                        <td style={{ padding: "9px 0", textAlign: "right", color: "#aaa" }}>{fmtInt(r.avgAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ borderTop: "2px solid #F7931A44" }}>
                      <td colSpan={2} style={{ padding: "10px 0", fontWeight: 700, color: "#F7931A" }}>Total</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700 }}>{fmtInt(totalCost)}</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700, color: "#F7931A" }}>{fmtInt(h.avgCost)} avg</td>
                      <td style={{ padding: "10px 8px", textAlign: "right", fontWeight: 700, color: "#10B981" }}>{fmtBTC(h.totalUnits)}</td>
                      <td style={{ padding: "10px 0", textAlign: "right" }}>
                        <span className={h.pnl >= 0 ? "pos" : "neg"}>{pct(h.pnlPct)}</span>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          );
        })()}

        {/* TRANSACTIONS */}
        {view === "transactions" && (
          <div className="card">
            <div className="lbl" style={{ marginBottom: 14 }}>All Transactions ({transactions.length})</div>
            {[...transactions].reverse().map(t => {
              const asset = assets.find(a => a.id === t.assetId);
              const invest = t.amount * t.price + t.fee;
              return (
                <div key={t.id} className="tx-row">
                  <div className="btc-icon">₿</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{asset?.symbol} <span className={`tag tag-${t.type.toLowerCase()}`}>{t.type}</span></div>
                    <div style={{ fontSize: 12, color: "#666", marginTop: 2 }}>{t.date} · {t.amount.toFixed(6)} BTC @ ${Math.round(t.price).toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 600 }}>{fmtInt(invest)}</div>
                    {t.fee > 0 && <div style={{ fontSize: 11, color: "#666" }}>fee {fmt(t.fee)}</div>}
                  </div>
                  <button className="btn-del" onClick={() => setConfirmDelete(t.id)}>✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* CONFIRM DELETE MODAL */}
      {confirmDelete && (
        <div className="overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" style={{ maxWidth: 340, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>ยืนยันการลบ?</h2>
            <p style={{ fontSize: 13, color: "#888", marginBottom: 20 }}>รายการนี้จะถูกลบถาวร ไม่สามารถกู้คืนได้</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button className="btn-sec" onClick={() => setConfirmDelete(null)}>ยกเลิก</button>
              <button className="btn-primary" style={{ background: "#EF4444" }} onClick={() => delTx(confirmDelete)}>ลบเลย</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD MODAL */}
      {showForm && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Add BTC Purchase</h2>
              <button className="btn-sec" style={{ padding: "5px 10px" }} onClick={() => setShowForm(false)}>✕</button>
            </div>
            <div className="row2">
              <div>
                <div className="lbl">Invest Amount (USDT)</div>
                <input type="number" placeholder="3000" value={form.investAmount} onChange={e => setForm({ ...form, investAmount: e.target.value })} />
              </div>
              <div>
                <div className="lbl">BTC Price (USD)</div>
                <input type="number" placeholder="e.g. 80000" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
              </div>
            </div>
            <div className="row2">
              <div>
                <div className="lbl">Fee (USD)</div>
                <input type="number" placeholder="0" value={form.fee} onChange={e => setForm({ ...form, fee: e.target.value })} />
              </div>
              <div>
                <div className="lbl">Date</div>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
              </div>
            </div>
            {form.investAmount && form.price && (
              <div style={{ background: "#0D2E1F", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 13, color: "#10B981" }}>
                BTC received: {((parseFloat(form.investAmount) - (parseFloat(form.fee)||0)) / parseFloat(form.price)).toFixed(6)} BTC
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn-sec" onClick={() => setShowForm(false)}>Cancel</button>
              <button className="btn-primary" disabled={!form.investAmount || !form.price} onClick={addTx}>Save Purchase</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}