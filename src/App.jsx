import { useState, useEffect, useRef } from "react";
import { createChart } from "lightweight-charts";
import './index.css';

let API_BASE = "http://127.0.0.1:8000/api";
try { API_BASE = localStorage.getItem("API_BASE") || API_BASE; } catch(e) {}

const fetchWithAuth = async (url, options = {}) => {
  let pwd = '';
  try { pwd = localStorage.getItem('EXECUTION_PASSWORD') || ''; } catch(e) {}
  if (!options.headers) options.headers = {};
  options.headers['Authorization'] = `Bearer ${pwd}`;
  options.headers['Content-Type'] = 'application/json';

  let res = await fetch(url, options);
  if (res.status === 401) {
    pwd = window.prompt('Execution requires authorization. Enter password:');
    if (!pwd) return null;
    try { localStorage.setItem('EXECUTION_PASSWORD', pwd); } catch(e) {}
    options.headers['Authorization'] = `Bearer ${pwd}`;
    res = await fetch(url, options);
  }
  return res;
};

const fmt = (n, d = 2) => n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

function ChartComponent({ data, selectedTrade }) {
  const chartContainerRef = useRef();
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const linesRef = useRef([]);

  useEffect(() => {
    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid', color: '#161a25' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: 'rgba(197, 203, 206, 0.8)' },
      timeScale: { borderColor: 'rgba(197, 203, 206, 0.8)' },
    });
    chartRef.current = chart;

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#4bffb5',
      downColor: '#ff4976',
      borderDownColor: '#ff4976',
      borderUpColor: '#4bffb5',
      wickDownColor: '#ff4976',
      wickUpColor: '#4bffb5',
    });
    seriesRef.current = candleSeries;

    const handleResize = () => {
      chart.applyOptions({ width: chartContainerRef.current.clientWidth });
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current || !seriesRef.current || !selectedTrade) return;
    
    // Clear old lines
    linesRef.current.forEach(l => seriesRef.current.removePriceLine(l));
    linesRef.current = [];

    // Simulate some OHLC data relative to the selected trade's price
    const cData = [];
    let time = Math.floor(Date.now() / 1000) - 60 * 86400; // 60 days back
    let basePrice = selectedTrade.entry * 0.9;
    for (let i = 0; i < 60; i++) {
      time += 86400;
      const open = basePrice + (Math.random() - 0.5) * (selectedTrade.entry * 0.02);
      const close = open + (Math.random() - 0.5) * (selectedTrade.entry * 0.04);
      const high = Math.max(open, close) + Math.random() * (selectedTrade.entry * 0.02);
      const low = Math.min(open, close) - Math.random() * (selectedTrade.entry * 0.02);
      cData.push({ time, open, high, low, close });
      basePrice = close;
    }
    // Force last candle to be near entry price
    cData[cData.length - 1].close = selectedTrade.entry;
    seriesRef.current.setData(cData);

    const l1 = seriesRef.current.createPriceLine({ price: selectedTrade.target, color: '#39d353', lineWidth: 2, lineStyle: 0, title: 'Target (T)' });
    const l2 = seriesRef.current.createPriceLine({ price: selectedTrade.entry, color: '#58a6ff', lineWidth: 2, lineStyle: 0, title: 'Current Price' });
    const l3 = seriesRef.current.createPriceLine({ price: selectedTrade.stop, color: '#ff6b6b', lineWidth: 2, lineStyle: 0, title: 'Stop Loss (SL)' });
    
    linesRef.current = [l1, l2, l3];
    chartRef.current.timeScale().fitContent();
    
  }, [selectedTrade]);

  return <div ref={chartContainerRef} style={{ width: '100%', height: '100%', minHeight: 300 }} />;
}

export default function App() {
  const [queue, setQueue] = useState([]);
  const [sells, setSells] = useState([]);
  const [rules, setRules] = useState([]);
  const [portfolio, setPortfolio] = useState({ stats: {}, holdings: [] });
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [selectedTrade, setSelectedTrade] = useState(null);
  
  const chatEndRef = useRef(null);

  const fetchState = () => {
    fetch(`${API_BASE}/queue`).then(r => r.json()).then(d => {
      if (d.data) {
        const buys = d.data.filter(t => t.status === 'PENDING' && t.transaction_type !== 'SELL').map(t => ({
          id: t.id, symbol: t.symbol, setup: t.setup_type, score: t.technical_score, confidence: t.confidence,
          entry: parseFloat(t.entry_zone) || 0, stop: t.stop_loss || 0, target: t.target || 0, rr: t.rr_ratio || 0,
          rationale: t.rationale || "No rationale provided", qty: Math.max(1, Math.floor(2000 / (parseFloat(t.entry_zone) - t.stop_loss))),
          type: 'BUY'
        }));
        
        const sellsQ = d.data.filter(t => t.status === 'PENDING' && t.transaction_type === 'SELL').map(t => ({
          id: t.id, symbol: t.symbol, setup: t.setup_type, score: t.technical_score, confidence: t.confidence,
          entry: parseFloat(t.entry_zone) || 0, stop: t.stop_loss || 0, target: t.target || 0, rr: t.rr_ratio || 0,
          rationale: t.rationale || "Risk flag breached.", qty: t.quantity,
          type: 'SELL'
        }));

        setQueue(buys);
        setSells(sellsQ);
        if (!selectedTrade && buys.length > 0) setSelectedTrade(buys[0]);
      }
    });

    fetch(`${API_BASE}/auto-approve/rules`).then(r => r.json()).then(d => {
      if (d.data) setRules(d.data);
    });

    fetch(`${API_BASE}/portfolio`).then(r => r.json()).then(d => {
      if (d.status === "success") setPortfolio(d);
    }).catch(e => console.error("Portfolio fetch failed", e));
  };

  useEffect(() => {
    fetchState();
  }, []);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatHistory(prev => [...prev, { role: "user", text: userMsg }]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      let res = await fetch(`${API_BASE}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: userMsg })
      });
      let data = await res.json();
      setChatHistory(prev => [...prev, { role: "bot", text: data.reply }]);
    } catch (e) {
      setChatHistory(prev => [...prev, { role: "bot", text: "Connection error." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleExecuteAll = () => {
    // We execute all BUY queue while checking if balance is sufficient
    // Actually, backend /api/approve can take an array, but we can filter it based on required funds locally first or let backend handle it
    const ids = queue.map(t => t.id);
    if(ids.length === 0) return;
    
    // We can just pass it to the backend and the backend will verify funds.
    fetchWithAuth(`${API_BASE}/approve`, { method: "POST", body: JSON.stringify({ trade_ids: ids, enforce_margin: true }) }).then(() => {
      fetchState();
    });
  };

  const executeTrade = (tradeId) => {
    fetchWithAuth(`${API_BASE}/approve`, { method: "POST", body: JSON.stringify({ trade_ids: [tradeId], enforce_margin: true }) }).then(() => {
      fetchState();
    });
  };

  // Keyboard shortcut for executing selected trade
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Enter' && selectedTrade && document.activeElement.tagName !== 'INPUT') {
        executeTrade(selectedTrade.id);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedTrade]);

  const pnlColor = portfolio.stats.pnl >= 0 ? '#39d353' : '#ff4976';
  const topSell = sells.length > 0 ? sells[0] : null;

  return (
    <div className="layout-container">
      {/* HEADER */}
      <header className="top-header">
        <div className="header-left">
          <div className="logo-box">TS</div>
          <div className="greeting">Good morning Parth!</div>
        </div>
        <div className="header-mid">
          Invested - {fmt(portfolio.stats.invested || 0, 0)} &nbsp;&nbsp; Current - {fmt(portfolio.stats.current || 0, 0)}
        </div>
        <div className="header-right">
          <span style={{ color: pnlColor }}>P/L - {fmt(portfolio.stats.pnl || 0, 0)}</span>
          <span style={{ marginLeft: 20 }}>Balance-{fmt(portfolio.stats.balance || 0, 0)}</span>
        </div>
      </header>

      {/* MAIN GRID */}
      <main className="main-grid">
        
        {/* LEFT PANEL */}
        <section className="left-panel">
          <div className="panel-header">
            <h3>Top picks today</h3>
            <button className="white-btn" onClick={() => fetchWithAuth(`${API_BASE}/scan`, {method: 'POST'}).then(()=>fetchState())}>Scan Now</button>
          </div>
          
          <div className="picks-table">
            {queue.map(t => (
              <div key={t.id} className={`pick-row ${selectedTrade?.id === t.id ? 'selected' : ''}`} onClick={() => setSelectedTrade(t)}>
                <div className="pick-symbol">{t.symbol}</div>
                <div className="pick-val bg-blue">{fmt(t.entry, 0)}</div>
                <div className="pick-val bg-green">{fmt(t.target, 0)}</div>
                <div className="pick-val bg-red">{fmt(t.stop, 0)}</div>
                <div className="pick-val bg-yellow">{(Math.random() * 10 + 2).toFixed(0)}D</div>
              </div>
            ))}
            {queue.length === 0 && <div style={{ color: '#888', padding: '10px' }}>No pending buy setups</div>}
          </div>

          <div style={{ textAlign: 'right', marginTop: 10, marginBottom: 20 }}>
            <button className="execute-all-btn" onClick={handleExecuteAll}>EXECUTE ALL</button>
          </div>

          <div className="sell-box">
            {topSell ? (
              <>
                <div className="sell-text">SELL {topSell.symbol}</div>
                <button className="white-btn" onClick={() => executeTrade(topSell.id)}>Sell Now</button>
              </>
            ) : (
              <div className="sell-text" style={{ color: '#888' }}>NO SELL WARNINGS</div>
            )}
          </div>

          <div className="analysis-terminal">
            <div className="term-header">
              <span>Analysis</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <span className="dot" style={{ background: '#ff5f56' }}></span>
                <span className="dot" style={{ background: '#ffbd2e' }}></span>
                <span className="dot" style={{ background: '#27c93f' }}></span>
              </div>
            </div>
            <div className="term-body">
              <h4 style={{ color: '#fff', marginBottom: 12 }}>{selectedTrade ? `${selectedTrade.symbol} Analysis Terminal` : "No trade selected"}</h4>
              {selectedTrade ? (
                <div className="term-content">
                  {typeof selectedTrade.rationale === 'string' 
                    ? selectedTrade.rationale.split('\n').map((line, i) => <div key={i} style={{ marginBottom: 4 }}>{line}</div>)
                    : <div style={{ marginBottom: 4 }}>{selectedTrade.rationale?.why_lucrative || "No rationale provided"}</div>}
                  <div style={{ marginTop: 12 }}>Verdict: BUY</div>
                  <div>QTY: {selectedTrade.qty} Shares</div>
                  <div>Amt = {fmt(selectedTrade.qty * selectedTrade.entry)}</div>
                  <div>Confidence: {selectedTrade.confidence}%</div>
                  <div className="blink" style={{ marginTop: 16 }}>PRESS ENTER TO EXECUTE</div>
                </div>
              ) : (
                <div style={{ color: '#888' }}>Select a pick to view analysis</div>
              )}
            </div>
          </div>
        </section>

        {/* MIDDLE PANEL */}
        <section className="middle-panel">
          <div className="chart-wrapper">
             <div className="chart-header">
               <span style={{ fontSize: 12, fontWeight: 700 }}>{selectedTrade?.symbol || 'INDEX'} NSE (1D)</span>
             </div>
             <ChartComponent selectedTrade={selectedTrade} />
          </div>

          <div className="rules-section">
            <div className="panel-header">
              <h3>Auto Execution Rules</h3>
              <button className="white-btn">New Rule Set</button>
            </div>
            <div className="rules-list">
              {rules.map((r, i) => (
                <div key={r.rule_id || i} className="rule-row" style={{ borderColor: r.active ? '#39d353' : '#fff' }}>
                  <div>{r.setup_type === '*' ? 'Rule Set ' + (i+1) : r.setup_type}</div>
                  {r.active && <div style={{ color: '#39d353', fontWeight: 'bold' }}>ACTIVE</div>}
                </div>
              ))}
              {rules.length === 0 && (
                <>
                  <div className="rule-row" style={{ borderColor: '#39d353' }}>
                    <div>Strict Breakout Rules (Score &gt; 80)</div>
                    <div style={{ color: '#39d353', fontWeight: 'bold' }}>ACTIVE</div>
                  </div>
                  <div className="rule-row">
                    <div>Momentum Runners (Score &gt; 75)</div>
                  </div>
                </>
              )}
            </div>
          </div>
          
          <div className="legend-box">
             <div className="legend-item bg-blue">CP</div>
             <div className="legend-item bg-green">TP</div>
             <div className="legend-item bg-red">SL</div>
             <div className="legend-item bg-yellow">HD</div>
          </div>
        </section>

        {/* RIGHT PANEL */}
        <section className="right-panel">
          <div className="holdings-section">
            <div className="holdings-tabs">
              <span className="active-tab">All</span>
              <span>Equity</span>
              <span>Mutual funds</span>
            </div>
            <div className="holdings-header">
              <h3>Holdings</h3>
              <div className="search-bar">🔍 Search</div>
            </div>
            <table className="holdings-table">
              <thead>
                <tr>
                  <th>Instrument</th>
                  <th>Qty.</th>
                  <th>LTP</th>
                  <th>P&L</th>
                  <th>Net chg</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h, i) => (
                  <tr key={i}>
                    <td>{h.instrument}</td>
                    <td>{h.qty}</td>
                    <td>{fmt(h.ltp)}</td>
                    <td style={{ color: h.pnl >= 0 ? '#39d353' : '#ff4976' }}>{fmt(h.pnl)}</td>
                    <td style={{ color: h.net_chg >= 0 ? '#39d353' : '#ff4976' }}>{fmtPct(h.net_chg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="chat-section">
            <div className="explore-text">Explore what's possible</div>
            <div className="chat-actions">
              <button onClick={() => setChatInput("Deep search ONGC fundamentals")}>🔍 Deep Search</button>
              <button onClick={() => setChatInput("Analyze my Watchlist")}>📈 Analyze my Watchlist</button>
            </div>
            
            <div className="chat-history">
               {chatHistory.map((msg, i) => (
                 <div key={i} className={`chat-msg ${msg.role}`}>{msg.text}</div>
               ))}
               {isChatLoading && <div className="chat-msg bot">Thinking...</div>}
               <div ref={chatEndRef} />
            </div>

            <div className="chat-input-box">
              <input 
                type="text" 
                placeholder="Ask anything" 
                value={chatInput} 
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendChat()}
              />
              <button onClick={sendChat} className="send-btn">↑</button>
            </div>
          </div>
        </section>

      </main>
    </div>
  );
}
