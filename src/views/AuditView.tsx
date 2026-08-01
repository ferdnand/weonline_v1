/**
 * Audit Log (admin sub-tab).
 *
 * Read-only view over GET /api/audit — the persisted "who did what" trail. Shows
 * newest-first events with filtering by actor, action prefix, and outcome, plus
 * "load more" pagination. System-driven billing events appear with actor "system".
 */

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertCircle, ShieldAlert, Filter } from 'lucide-react';
import { api, type AuditEntry } from '../api/client';

const inp = 'px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500 text-sm';
const PAGE = 100;

// Colour the dotted action namespace so scanning the log is easier.
function actionTone(action: string): string {
  if (action.startsWith('auth')) return 'bg-blue-50 text-blue-700';
  if (action.startsWith('billing.payment')) return 'bg-green-50 text-green-700';
  if (action.startsWith('billing')) return 'bg-orange-50 text-orange-700';
  if (action.startsWith('mikrotik')) return 'bg-purple-50 text-purple-700';
  return 'bg-slate-100 text-slate-600';
}

export default function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [outcome, setOutcome] = useState<'' | 'success' | 'failure'>('');

  const load = useCallback(
    async (offset: number, append: boolean) => {
      setLoading(true);
      try {
        const page = await api.listAudit({
          actor: actor || undefined,
          action: action || undefined,
          outcome: outcome || undefined,
          limit: PAGE,
          offset,
        });
        setTotal(page.total);
        setEntries((prev) => (append ? [...prev, ...page.entries] : page.entries));
        setError('');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [actor, action, outcome],
  );

  // Reload from the top whenever a filter changes.
  useEffect(() => { void load(0, false); }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-black text-slate-900">Audit Log</h3>
          <p className="text-sm text-slate-500">Every account, billing, and router action — newest first.</p>
        </div>
        <button
          onClick={() => load(0, false)}
          className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition-all"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 p-4 bg-white border border-slate-200 rounded-2xl">
        <Filter className="w-4 h-4 text-slate-400" />
        <input className={inp} placeholder="Actor email…" value={actor} onChange={(e) => setActor(e.target.value)} />
        <input className={inp} placeholder="Action prefix, e.g. billing.payment" value={action} onChange={(e) => setAction(e.target.value)} />
        <select className={inp} value={outcome} onChange={(e) => setOutcome(e.target.value as '' | 'success' | 'failure')}>
          <option value="">Any outcome</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
        </select>
        <span className="ml-auto text-xs text-slate-400">{total} event{total === 1 ? '' : 's'}</span>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 text-red-700 rounded-xl text-sm font-bold">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 uppercase text-xs border-b border-slate-100">
              <th className="px-5 py-3">When</th>
              <th className="px-5 py-3">Actor</th>
              <th className="px-5 py-3">Action</th>
              <th className="px-5 py-3">Target</th>
              <th className="px-5 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-slate-50 last:border-0 align-top">
                <td className="px-5 py-3 whitespace-nowrap text-slate-500">{new Date(e.ts).toLocaleString()}</td>
                <td className="px-5 py-3">
                  <div className="font-bold text-slate-800">{e.actorEmail || 'anonymous'}</div>
                  {e.ip && <div className="text-xs text-slate-400">{e.ip}</div>}
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block px-2 py-1 rounded-lg text-xs font-bold ${actionTone(e.action)}`}>{e.action}</span>
                    {e.outcome === 'failure' && <ShieldAlert className="w-4 h-4 text-red-500" aria-label="failure" />}
                  </div>
                </td>
                <td className="px-5 py-3 text-slate-500 font-mono text-xs">{e.target || '—'}</td>
                <td className="px-5 py-3 text-slate-500 text-xs">
                  {e.details ? <code className="break-all">{JSON.stringify(e.details)}</code> : '—'}
                </td>
              </tr>
            ))}
            {entries.length === 0 && !loading && (
              <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No audit events match.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {entries.length < total && (
        <div className="flex justify-center">
          <button
            onClick={() => load(entries.length, true)}
            disabled={loading}
            className="px-5 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 disabled:opacity-60"
          >
            {loading ? 'Loading…' : `Load more (${total - entries.length} remaining)`}
          </button>
        </div>
      )}
    </div>
  );
}
