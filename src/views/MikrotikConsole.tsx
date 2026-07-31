/**
 * MikroTik RouterOS console (admin sub-tab).
 *
 * A live window into each router — simulator OR a real device (RouterOS 7 over the
 * REST API): system resource, active PPPoE/hotspot sessions, the /ppp secret +
 * hotspot user tables, and simple queues. Staff can add/edit/test/delete routers,
 * power them, disconnect a session, and enable/disable a user — all through the
 * same server the billing engine provisions against.
 */

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  Activity, Cpu, Thermometer, Power, PowerOff, Wifi, Server, Gauge,
  RefreshCw, LogOut, ShieldCheck, ShieldAlert, HardDrive, Plus, Edit2, Trash2,
  AlertCircle, CheckCircle2, Radio, FlaskConical,
} from 'lucide-react';
import {
  api, fmtBytes, fmtRate, fmtUptime, type ActiveSession, type HotspotUser,
  type PppSecret, type RouterInput, type RouterSummary, type SimpleQueue,
  type SystemResource, type TestResult,
} from '../api/client';

type Tab = 'active' | 'secrets' | 'hotspot' | 'queues';

const inp = 'w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500';

export default function MikrotikConsole({ canControl }: { canControl: boolean }) {
  const [routers, setRouters] = useState<RouterSummary[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [resource, setResource] = useState<SystemResource | null>(null);
  const [active, setActive] = useState<ActiveSession[]>([]);
  const [secrets, setSecrets] = useState<PppSecret[]>([]);
  const [hotspot, setHotspot] = useState<HotspotUser[]>([]);
  const [queues, setQueues] = useState<SimpleQueue[]>([]);
  const [tab, setTab] = useState<Tab>('active');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<RouterSummary | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const loadRouters = useCallback(async () => {
    try {
      const rtr = await api.listRouters();
      setRouters(rtr);
      setSelected((cur) => cur || rtr[0]?.id || '');
    } catch (e) { setError((e as Error).message); }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const [res, act, sec, hs, q] = await Promise.all([
        api.routerResource(id).catch(() => null),
        api.routerActive(id).catch(() => []),
        api.routerSecrets(id).catch(() => []),
        api.routerHotspotUsers(id).catch(() => []),
        api.routerQueues(id).catch(() => []),
      ]);
      setResource(res); setActive(act); setSecrets(sec); setHotspot(hs); setQueues(q); setError('');
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { loadRouters(); }, [loadRouters]);

  useEffect(() => {
    if (!selected) return;
    loadDetail(selected);
    const t = setInterval(() => { loadDetail(selected); loadRouters(); }, 3000);
    return () => clearInterval(t);
  }, [selected, loadDetail, loadRouters]);

  const current = routers.find((r) => r.id === selected);

  const togglePower = async () => {
    if (!current) return;
    try { await api.setRouterPower(current.id, !current.online); loadRouters(); loadDetail(current.id); }
    catch (e) { setError((e as Error).message); }
  };

  const disconnect = async (sessionId: string) => {
    if (!current) return;
    try { await api.disconnectSession(current.id, sessionId); loadDetail(current.id); }
    catch (e) { setError((e as Error).message); }
  };

  const toggleUser = async (username: string, enabled: boolean) => {
    if (!current) return;
    try { await api.setUserEnabled(current.id, username, enabled); loadDetail(current.id); }
    catch (e) { setError((e as Error).message); }
  };

  const saveRouter = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const driver = (f.get('driver') as 'simulator' | 'live') || 'simulator';
    const body: RouterInput = {
      id: editing?.id,
      name: String(f.get('name')),
      location: String(f.get('location')) || undefined,
      model: String(f.get('model')) || undefined,
      identity: String(f.get('identity')) || undefined,
      ipAddress: String(f.get('ipAddress')),
      driver,
      tls: f.get('tls') === 'on',
      insecureTls: f.get('insecureTls') === 'on',
      apiPort: f.get('apiPort') ? Number(f.get('apiPort')) : undefined,
      username: String(f.get('username')) || undefined,
      password: String(f.get('password')) || undefined,
    };
    try {
      const saved = await api.createRouter(body);
      setShowForm(false); setEditing(null); setTestResult(null);
      notify(`Router "${saved.name}" saved`);
      await loadRouters();
      setSelected(saved.id);
    } catch (err) { setError((err as Error).message); }
  };

  const removeRouter = async (r: RouterSummary) => {
    if (!window.confirm(`Delete router "${r.name}"? This removes it from WeOnline (it does NOT change the physical device).`)) return;
    try {
      await api.deleteRouter(r.id);
      notify('Router removed');
      setSelected('');
      await loadRouters();
    } catch (err) { setError((err as Error).message); }
  };

  const testConnection = async () => {
    if (!current) return;
    setTesting(true); setTestResult(null);
    try {
      const result = await api.testRouter(current.id);
      setTestResult(result);
      if (result.ok) notify('Connection OK'); else setError(result.error || 'Connection failed');
    } catch (err) { setError((err as Error).message); }
    finally { setTesting(false); }
  };

  return (
    <div className="space-y-6">
      {/* Router picker */}
      <div className="flex items-center gap-3 flex-wrap">
        {routers.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelected(r.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all border ${
              selected === r.id ? 'bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-200' : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
            }`}
          >
            {r.driver === 'live' ? <Radio className="w-4 h-4" /> : <Server className="w-4 h-4" />}
            {r.name}
            <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${r.driver === 'live' ? (selected === r.id ? 'bg-white/20 text-white' : 'bg-emerald-100 text-emerald-700') : (selected === r.id ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500')}`}>{r.driver === 'live' ? 'live' : 'sim'}</span>
            <span className={`w-2 h-2 rounded-full ${r.online ? 'bg-green-400' : 'bg-red-400'}`} />
          </button>
        ))}
        {canControl && (
          <button onClick={() => { setEditing(null); setTestResult(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50">
            <Plus className="w-4 h-4" /> Add Router
          </button>
        )}
        <button onClick={() => { loadRouters(); loadDetail(selected); }} className="ml-auto flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-blue-600">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-4 bg-red-50 text-red-700 rounded-2xl text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span className="break-all">{error}</span>
        </div>
      )}
      {toast && (
        <div className="flex items-center gap-2 p-4 bg-green-50 text-green-700 rounded-2xl text-sm">
          <CheckCircle2 className="w-4 h-4" /> {toast}
        </div>
      )}
      {current?.driver === 'live' && current.lastError && (
        <div className="flex items-start gap-2 p-4 bg-amber-50 text-amber-800 rounded-2xl text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="break-all"><b>Live device error:</b> {current.lastError}</span>
        </div>
      )}

      {current && (
        <>
          {/* Identity + power */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-3xl p-6 shadow-lg">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <div className="bg-white/10 p-3 rounded-2xl">{current.driver === 'live' ? <Radio className="w-6 h-6" /> : <Server className="w-6 h-6" />}</div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-xl font-black">{current.identity}</h3>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${current.driver === 'live' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-500/30 text-slate-300'}`}>{current.driver === 'live' ? 'live device' : 'simulator'}</span>
                    </div>
                    <p className="text-sm text-slate-400">{current.model} · {current.location}</p>
                  </div>
                </div>
                <p className="text-xs font-mono text-slate-400 mt-3">
                  {current.driver === 'live' ? `${current.tls ? 'https' : 'http'}://` : ''}{current.ipAddress}:{current.apiPort ?? 8728}{current.driver === 'live' ? '/rest' : ''} · RouterOS {resource?.version || '—'}
                  {current.driver === 'live' && current.lastPolledAt ? ` · polled ${new Date(current.lastPolledAt).toLocaleTimeString()}` : ''}
                </p>
              </div>
              <div className="flex flex-col items-end gap-3">
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-xl text-xs font-black uppercase tracking-widest ${current.online ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                  {current.online ? <Wifi className="w-3 h-3" /> : <PowerOff className="w-3 h-3" />} {current.online ? 'online' : 'offline'}
                </span>
                {canControl && (
                  <div className="flex items-center gap-2">
                    {current.driver === 'live' && (
                      <button onClick={testConnection} disabled={testing} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 disabled:opacity-50">
                        <FlaskConical className="w-4 h-4" /> {testing ? 'Testing…' : 'Test'}
                      </button>
                    )}
                    <button onClick={() => { setEditing(current); setTestResult(null); setShowForm(true); }} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-white/10 text-slate-200 hover:bg-white/20">
                      <Edit2 className="w-4 h-4" /> Edit
                    </button>
                    <button onClick={() => removeRouter(current)} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-red-500/20 text-red-300 hover:bg-red-500/30">
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button onClick={togglePower} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold ${current.online ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30' : 'bg-green-500/20 text-green-300 hover:bg-green-500/30'}`}>
                      {current.online ? <><PowerOff className="w-4 h-4" /> Power Off</> : <><Power className="w-4 h-4" /> Power On</>}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {resource && current.online && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 mt-6">
                <Metric icon={<Cpu className="w-4 h-4" />} label="CPU" value={`${resource.cpuLoad}%`} bar={resource.cpuLoad} />
                <Metric icon={<Gauge className="w-4 h-4" />} label="Memory" value={`${resource.memoryUsedPct}%`} bar={resource.memoryUsedPct} sub={`${resource.freeMemoryMb}MB free`} />
                <Metric icon={<Thermometer className="w-4 h-4" />} label="Temp" value={`${resource.temperature}°C`} bar={(resource.temperature / 80) * 100} />
                <Metric icon={<Activity className="w-4 h-4" />} label="Sessions" value={String(active.length)} />
                <Metric icon={<HardDrive className="w-4 h-4" />} label="Voltage" value={`${resource.voltage}V`} />
                <Metric icon={<RefreshCw className="w-4 h-4" />} label="Uptime" value={fmtUptime(resource.uptimeSec)} small />
              </div>
            )}
          </div>

          {/* Tables */}
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="flex border-b border-slate-100">
              {([['active', 'Active', active.length], ['secrets', 'PPP Secrets', secrets.length], ['hotspot', 'Hotspot Users', hotspot.length], ['queues', 'Simple Queues', queues.length]] as const).map(([id, label, count]) => (
                <button key={id} onClick={() => setTab(id)} className={`px-5 py-3 text-xs font-bold border-b-2 transition-all ${tab === id ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
                  {label} <span className="ml-1 px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500">{count}</span>
                </button>
              ))}
            </div>

            <div className="overflow-x-auto">
              {tab === 'active' && (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <tr><th className="text-left px-5 py-3">User</th><th className="text-left px-5 py-3">Address</th><th className="text-left px-5 py-3">Uptime</th><th className="text-right px-5 py-3">↓ Rate</th><th className="text-right px-5 py-3">↑ Rate</th><th className="text-right px-5 py-3">Total</th><th className="text-right px-5 py-3"></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {active.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3"><span className="font-bold text-slate-800">{s.name}</span> <span className={`ml-1 text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${s.service === 'pppoe' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}`}>{s.service}</span><br /><span className="text-[10px] font-mono text-slate-300">{s.macAddress}</span></td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-600">{s.address}</td>
                        <td className="px-5 py-3 text-xs text-slate-500">{fmtUptime(s.uptimeSec)}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-green-600">{fmtRate(s.rateRxKbps)}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-blue-600">{fmtRate(s.rateTxKbps)}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-slate-600">{fmtBytes(s.bytesIn + s.bytesOut)}</td>
                        <td className="px-5 py-3 text-right">{canControl && <button onClick={() => disconnect(s.id)} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg" title="Disconnect"><LogOut className="w-4 h-4" /></button>}</td>
                      </tr>
                    ))}
                    {active.length === 0 && <tr><td colSpan={7} className="px-5 py-8 text-center text-sm text-slate-400">No active sessions. Enabled users connect within a few seconds.</td></tr>}
                  </tbody>
                </table>
              )}

              {tab === 'secrets' && (
                <UserTable rows={secrets.map((s) => ({ name: s.name, profile: s.profile, rate: s.rateLimit, disabled: s.disabled, extra: s.comment }))} canControl={canControl} onToggle={toggleUser} />
              )}

              {tab === 'hotspot' && (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <tr><th className="text-left px-5 py-3">User</th><th className="text-left px-5 py-3">Profile</th><th className="text-left px-5 py-3">Rate</th><th className="text-right px-5 py-3">Used / Cap</th><th className="text-left px-5 py-3">State</th><th className="text-right px-5 py-3"></th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {hotspot.map((u) => {
                      const used = u.bytesIn + u.bytesOut;
                      const pct = u.limitBytesTotal ? Math.min(100, (used / u.limitBytesTotal) * 100) : 0;
                      return (
                        <tr key={u.name} className="hover:bg-slate-50/50">
                          <td className="px-5 py-3 font-bold text-slate-800">{u.name}</td>
                          <td className="px-5 py-3 text-slate-600">{u.profile}</td>
                          <td className="px-5 py-3 font-mono text-xs text-slate-500">{u.rateLimit}</td>
                          <td className="px-5 py-3 text-right">
                            <span className="font-mono text-xs text-slate-600">{fmtBytes(used)} / {u.limitBytesTotal ? fmtBytes(u.limitBytesTotal) : '∞'}</span>
                            {u.limitBytesTotal > 0 && <div className="mt-1 h-1.5 w-24 bg-slate-100 rounded-full ml-auto overflow-hidden"><div className={`h-full rounded-full ${pct > 90 ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} /></div>}
                          </td>
                          <td className="px-5 py-3">{u.disabled ? <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600"><ShieldAlert className="w-3 h-3" /> disabled</span> : <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600"><ShieldCheck className="w-3 h-3" /> enabled</span>}</td>
                          <td className="px-5 py-3 text-right">{canControl && <button onClick={() => toggleUser(u.name, u.disabled)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200">{u.disabled ? 'Enable' : 'Disable'}</button>}</td>
                        </tr>
                      );
                    })}
                    {hotspot.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">No hotspot users on this router.</td></tr>}
                  </tbody>
                </table>
              )}

              {tab === 'queues' && (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    <tr><th className="text-left px-5 py-3">Queue</th><th className="text-left px-5 py-3">Target</th><th className="text-left px-5 py-3">Max Limit</th><th className="text-right px-5 py-3">↓ Bytes</th><th className="text-right px-5 py-3">↑ Bytes</th><th className="text-left px-5 py-3">State</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {queues.map((q) => (
                      <tr key={q.id} className="hover:bg-slate-50/50">
                        <td className="px-5 py-3 font-mono text-xs font-bold text-slate-700">{q.name}</td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-500">{q.target}</td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-600">{q.maxLimit}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-green-600">{fmtBytes(q.bytesIn)}</td>
                        <td className="px-5 py-3 text-right font-mono text-xs text-blue-600">{fmtBytes(q.bytesOut)}</td>
                        <td className="px-5 py-3">{q.disabled ? <span className="text-xs text-red-500">disabled</span> : <span className="text-xs text-green-600">active</span>}</td>
                      </tr>
                    ))}
                    {queues.length === 0 && <tr><td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">No simple queues.</td></tr>}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {testResult?.ok && testResult.resource && (
        <div className="p-4 bg-emerald-50 text-emerald-800 rounded-2xl text-sm flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            <b>Connection OK.</b> {String(testResult.resource['board-name'] || testResult.resource.boardName || 'RouterOS')} ·
            v{String(testResult.resource.version || '?')} · uptime {String(testResult.resource.uptime || '?')}
          </span>
        </div>
      )}

      {showForm && (
        <RouterForm
          editing={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSubmit={saveRouter}
        />
      )}
    </div>
  );
}

function RouterForm({ editing, onClose, onSubmit }: {
  editing: RouterSummary | null;
  onClose: () => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  const [driver, setDriver] = useState<'simulator' | 'live'>(editing?.driver || 'live');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-xl font-black text-slate-900">{editing ? `Edit ${editing.name}` : 'Add Router'}</h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl">✕</button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Driver">
            <select name="driver" value={driver} onChange={(e) => setDriver(e.target.value as 'simulator' | 'live')} className={inp}>
              <option value="live">Live — real RouterOS device (REST)</option>
              <option value="simulator">Simulator — in-memory demo</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name"><input name="name" required defaultValue={editing?.name} placeholder="L009 Office" className={inp} /></Field>
            <Field label="Location"><input name="location" defaultValue={editing?.location} placeholder="Server room" className={inp} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Model"><input name="model" defaultValue={editing?.model || 'MikroTik L009UiGS-RM'} className={inp} /></Field>
            <Field label="Identity"><input name="identity" defaultValue={editing?.identity} placeholder="RouterOS identity" className={inp} /></Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="IP address"><input name="ipAddress" required defaultValue={editing?.ipAddress || '192.168.88.1'} className={inp} /></Field>
            <Field label={driver === 'live' ? 'REST port (443 tls / 80)' : 'API port'}>
              <input name="apiPort" type="number" defaultValue={editing?.apiPort ?? (driver === 'live' ? 443 : 8728)} className={inp} />
            </Field>
          </div>
          {driver === 'live' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Username"><input name="username" defaultValue={editing?.username || 'admin'} className={inp} /></Field>
                <Field label={editing ? 'Password (blank = keep)' : 'Password'}><input name="password" type="password" className={inp} /></Field>
              </div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" name="tls" defaultChecked={editing?.tls ?? true} className="w-5 h-5 rounded" /> Use HTTPS (www-ssl)
              </label>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                <input type="checkbox" name="insecureTls" defaultChecked={editing?.insecureTls ?? false} className="w-5 h-5 rounded" /> Accept self-signed certificate (LAN only — disables cert verification)
              </label>
              <p className="text-xs text-slate-400">
                Enable REST on the router first (<span className="font-mono">/ip service enable www-ssl</span>) and use a dedicated API user.
                After saving, hit <b>Test</b> to verify before enrolling subscribers.
              </p>
            </>
          )}
          <button type="submit" className="w-full py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700">Save Router</button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Metric({ icon, label, value, bar, sub, small }: { icon: React.ReactNode; label: string; value: string; bar?: number; sub?: string; small?: boolean }) {
  return (
    <div className="bg-white/5 rounded-2xl p-3">
      <div className="flex items-center gap-2 text-slate-400 mb-1">{icon}<span className="text-[9px] font-black uppercase tracking-widest">{label}</span></div>
      <p className={`font-black ${small ? 'text-sm' : 'text-lg'}`}>{value}</p>
      {typeof bar === 'number' && <div className="mt-2 h-1 bg-white/10 rounded-full overflow-hidden"><div className={`h-full rounded-full ${bar > 85 ? 'bg-red-400' : bar > 60 ? 'bg-amber-400' : 'bg-green-400'}`} style={{ width: `${Math.min(100, bar)}%` }} /></div>}
      {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function UserTable({ rows, canControl, onToggle }: {
  rows: { name: string; profile: string; rate: string; disabled: boolean; extra?: string }[];
  canControl: boolean; onToggle: (name: string, enabled: boolean) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
        <tr><th className="text-left px-5 py-3">Name</th><th className="text-left px-5 py-3">Profile</th><th className="text-left px-5 py-3">Rate Limit</th><th className="text-left px-5 py-3">State</th><th className="text-right px-5 py-3"></th></tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {rows.map((r) => (
          <tr key={r.name} className="hover:bg-slate-50/50">
            <td className="px-5 py-3"><span className="font-bold text-slate-800">{r.name}</span>{r.extra && <><br /><span className="text-[10px] text-slate-400">{r.extra}</span></>}</td>
            <td className="px-5 py-3 text-slate-600">{r.profile}</td>
            <td className="px-5 py-3 font-mono text-xs text-slate-500">{r.rate}</td>
            <td className="px-5 py-3">{r.disabled ? <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600"><ShieldAlert className="w-3 h-3" /> disabled</span> : <span className="inline-flex items-center gap-1 text-xs font-bold text-green-600"><ShieldCheck className="w-3 h-3" /> enabled</span>}</td>
            <td className="px-5 py-3 text-right">{canControl && <button onClick={() => onToggle(r.name, r.disabled)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200">{r.disabled ? 'Enable' : 'Disable'}</button>}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-400">No entries.</td></tr>}
      </tbody>
    </table>
  );
}
