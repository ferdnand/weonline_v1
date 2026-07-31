/**
 * Full-scale billing console (admin sub-tab).
 *
 * Talks to the server billing engine over REST (src/api/client.ts). Sub-sections:
 *   Overview      — revenue / MRR / outstanding / lifecycle KPIs + expiring soon
 *   Plans         — CRUD bandwidth/price/cycle products
 *   Subscribers   — CRUD customers + enroll on a plan (creates first invoice)
 *   Invoices      — pay via simulated M-Pesa STK or record cash/manual payment
 */

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DollarSign, TrendingUp, AlertCircle, Users, Wifi, Plus, Trash2, Edit2,
  Zap, RefreshCw, Smartphone, CheckCircle2, XCircle, Clock, Ban, PlayCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  api, fmtBytes, type BillingReport, type Invoice, type Payment, type Plan,
  type RouterSummary, type Subscriber, type Subscription, type SubscriptionStatus,
} from '../api/client';

type Section = 'overview' | 'plans' | 'subscribers' | 'invoices';

const KES = (n: number) => `KES ${Math.round(n).toLocaleString()}`;

const statusColor: Record<SubscriptionStatus, string> = {
  active: 'bg-green-100 text-green-700',
  grace: 'bg-amber-100 text-amber-700',
  suspended: 'bg-red-100 text-red-700',
  pending: 'bg-blue-100 text-blue-700',
  expired: 'bg-slate-200 text-slate-600',
  cancelled: 'bg-slate-200 text-slate-500',
};

export default function BillingView({ canDelete }: { canDelete: boolean }) {
  const [section, setSection] = useState<Section>('overview');
  const [report, setReport] = useState<BillingReport | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscribers, setSubscribers] = useState<Subscriber[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [routers, setRouters] = useState<RouterSummary[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [rep, pl, subs, subscr, inv, pay, rtr] = await Promise.all([
        api.report(), api.listPlans(), api.listSubscribers(),
        api.listSubscriptions(), api.listInvoices(), api.listPayments(), api.listRouters(),
      ]);
      setReport(rep); setPlans(pl); setSubscribers(subs); setSubscriptions(subscr);
      setInvoices(inv); setPayments(pay); setRouters(rtr); setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000); // live-ish
    return () => clearInterval(t);
  }, [refresh]);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 3500); };

  return (
    <div className="space-y-6">
      {/* Sub-nav */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex p-1 bg-slate-100 rounded-2xl">
          {(['overview', 'plans', 'subscribers', 'invoices'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSection(s)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all capitalize ${
                section === s ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button onClick={refresh} className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-orange-600">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 text-red-700 rounded-2xl text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}
      {toast && (
        <div className="flex items-center gap-2 p-4 bg-green-50 text-green-700 rounded-2xl text-sm">
          <CheckCircle2 className="w-4 h-4" /> {toast}
        </div>
      )}

      {section === 'overview' && <Overview report={report} subscriptions={subscriptions} subscribers={subscribers} plans={plans} />}
      {section === 'plans' && <Plans plans={plans} canDelete={canDelete} onChange={refresh} notify={notify} setError={setError} />}
      {section === 'subscribers' && (
        <Subscribers
          subscribers={subscribers} subscriptions={subscriptions} plans={plans} routers={routers}
          canDelete={canDelete} onChange={refresh} notify={notify} setError={setError}
        />
      )}
      {section === 'invoices' && (
        <Invoices invoices={invoices} subscribers={subscribers} plans={plans} payments={payments} onChange={refresh} notify={notify} setError={setError} />
      )}
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: string }) {
  return (
    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
      <div className={`inline-flex p-3 rounded-2xl mb-4 ${tone}`}>{icon}</div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-2xl font-black text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function Overview({ report, subscriptions, subscribers, plans }: {
  report: BillingReport | null; subscriptions: Subscription[]; subscribers: Subscriber[]; plans: Plan[];
}) {
  if (!report) return <div className="text-slate-400 text-sm">Loading…</div>;
  const now = Date.now();
  const soon = subscriptions
    .filter((s) => (s.status === 'active' || s.status === 'grace') && new Date(s.currentPeriodEnd).getTime() <= now + 3 * 86400000)
    .sort((a, b) => new Date(a.currentPeriodEnd).getTime() - new Date(b.currentPeriodEnd).getTime());
  const nameOf = (id: string) => subscribers.find((x) => x.id === id)?.name ?? '—';
  const planOf = (id: string) => plans.find((x) => x.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Stat icon={<DollarSign className="w-6 h-6 text-green-600" />} tone="bg-green-50" label="Revenue (This Month)" value={KES(report.revenueThisMonth)} />
        <Stat icon={<TrendingUp className="w-6 h-6 text-blue-600" />} tone="bg-blue-50" label="MRR" value={KES(report.mrr)} />
        <Stat icon={<AlertCircle className="w-6 h-6 text-amber-600" />} tone="bg-amber-50" label="Outstanding" value={KES(report.outstanding)} />
        <Stat icon={<Users className="w-6 h-6 text-orange-600" />} tone="bg-orange-50" label="Active Subscriptions" value={String(report.activeSubscriptions)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Lifecycle breakdown */}
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-4">Subscription Lifecycle</h3>
          <div className="space-y-3">
            {(['active', 'grace', 'suspended', 'pending', 'expired', 'cancelled'] as SubscriptionStatus[]).map((st) => {
              const count = report.statusCounts[st] || 0;
              const total = subscriptions.length || 1;
              return (
                <div key={st} className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest w-24 text-center ${statusColor[st]}`}>{st}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500 rounded-full" style={{ width: `${(count / total) * 100}%` }} />
                  </div>
                  <span className="text-sm font-bold text-slate-700 w-8 text-right">{count}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <div><p className="text-2xl font-black text-slate-900">{report.totalSubscribers}</p><p className="text-[10px] font-bold text-slate-400 uppercase">Subscribers</p></div>
            <div><p className="text-2xl font-black text-slate-900">{report.dataUsedGb}</p><p className="text-[10px] font-bold text-slate-400 uppercase">GB Used</p></div>
            <div><p className="text-2xl font-black text-slate-900">{report.unpaidInvoices}</p><p className="text-[10px] font-bold text-slate-400 uppercase">Unpaid Inv.</p></div>
          </div>
        </div>

        {/* Expiring soon */}
        <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-500" /> Expiring within 3 days ({report.expiringSoon})
          </h3>
          {soon.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing expiring soon 🎉</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {soon.map((s) => (
                <div key={s.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{nameOf(s.subscriberId)}</p>
                    <p className="text-xs text-slate-400">{planOf(s.planId)}</p>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${statusColor[s.status]}`}>{s.status}</span>
                    <p className="text-xs text-slate-500 mt-1">{format(new Date(s.currentPeriodEnd), 'dd MMM HH:mm')}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Plans ─────────────────────────────────────────────────────────────────────

function Plans({ plans, canDelete, onChange, notify, setError }: {
  plans: Plan[]; canDelete: boolean; onChange: () => void; notify: (m: string) => void; setError: (m: string) => void;
}) {
  const [editing, setEditing] = useState<Plan | null>(null);
  const [open, setOpen] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: Partial<Plan> = {
      name: String(f.get('name')),
      type: (f.get('type') as 'hotspot' | 'pppoe') || 'hotspot',
      speedLabel: String(f.get('speedLabel')),
      downloadKbps: Number(f.get('downloadKbps')),
      uploadKbps: Number(f.get('uploadKbps')),
      price: Number(f.get('price')),
      durationDays: Number(f.get('durationDays')),
      dataCapMb: Number(f.get('dataCapMb')),
      active: f.get('active') === 'on',
    };
    try {
      if (editing) await api.updatePlan(editing.id, body);
      else await api.createPlan(body);
      setOpen(false); setEditing(null); notify('Plan saved'); onChange();
    } catch (e) { setError((e as Error).message); }
  };

  const del = async (p: Plan) => {
    if (!window.confirm(`Delete plan "${p.name}"?`)) return;
    try { await api.deletePlan(p.id); notify('Plan deleted'); onChange(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-black text-slate-900">Plans ({plans.length})</h3>
        <button onClick={() => { setEditing(null); setOpen(true); }} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700">
          <Plus className="w-4 h-4" /> New Plan
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans.map((p) => (
          <div key={p.id} className="bg-white p-5 rounded-3xl border border-slate-100 shadow-sm">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h4 className="font-black text-slate-900">{p.name}</h4>
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-lg ${p.type === 'pppoe' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{p.type}</span>
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setEditing(p); setOpen(true); }} className="p-2 text-slate-400 hover:text-blue-600"><Edit2 className="w-4 h-4" /></button>
                {canDelete && <button onClick={() => del(p)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="text-xs font-bold text-slate-400">KES</span>
              <span className="text-3xl font-black text-slate-900">{p.price}</span>
              <span className="text-xs text-slate-400">/ {p.durationDays}d</span>
            </div>
            <div className="space-y-1 text-xs text-slate-500">
              <p className="flex items-center gap-2"><Zap className="w-3 h-3 text-orange-500" /> {p.speedLabel} ({Math.round(p.downloadKbps / 1000)}M/{Math.round(p.uploadKbps / 1000)}M)</p>
              <p className="flex items-center gap-2"><Wifi className="w-3 h-3 text-blue-500" /> Cap: {p.dataCapMb ? fmtBytes(p.dataCapMb * 1024 * 1024) : 'Unlimited'}</p>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <Modal title={editing ? 'Edit Plan' : 'New Plan'} onClose={() => { setOpen(false); setEditing(null); }}>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Name"><input name="name" required defaultValue={editing?.name} className={inp} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Type">
                <select name="type" defaultValue={editing?.type || 'hotspot'} className={inp}>
                  <option value="hotspot">Hotspot</option><option value="pppoe">PPPoE</option>
                </select>
              </Field>
              <Field label="Speed label"><input name="speedLabel" defaultValue={editing?.speedLabel || 'Up to 5Mbps'} className={inp} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Download (kbps)"><input name="downloadKbps" type="number" defaultValue={editing?.downloadKbps ?? 5000} className={inp} /></Field>
              <Field label="Upload (kbps)"><input name="uploadKbps" type="number" defaultValue={editing?.uploadKbps ?? 5000} className={inp} /></Field>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Price (KES)"><input name="price" type="number" required defaultValue={editing?.price ?? 0} className={inp} /></Field>
              <Field label="Cycle (days)"><input name="durationDays" type="number" defaultValue={editing?.durationDays ?? 30} className={inp} /></Field>
              <Field label="Data cap (MB, 0=∞)"><input name="dataCapMb" type="number" defaultValue={editing?.dataCapMb ?? 0} className={inp} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} className="w-5 h-5 rounded" /> Active (offered to customers)
            </label>
            <button type="submit" className="w-full py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700">Save Plan</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Subscribers ───────────────────────────────────────────────────────────────

function Subscribers({ subscribers, subscriptions, plans, routers, canDelete, onChange, notify, setError }: {
  subscribers: Subscriber[]; subscriptions: Subscription[]; plans: Plan[]; routers: RouterSummary[];
  canDelete: boolean; onChange: () => void; notify: (m: string) => void; setError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [enroll, setEnroll] = useState<Subscriber | null>(null);

  const subFor = (id: string) => subscriptions.find((s) => s.subscriberId === id && ['pending', 'active', 'grace', 'suspended'].includes(s.status));
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? '—';

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api.createSubscriber({
        name: String(f.get('name')), phone: String(f.get('phone')), email: String(f.get('email')) || undefined,
        type: (f.get('type') as 'hotspot' | 'pppoe'), routerId: String(f.get('routerId')),
        username: String(f.get('username')), password: String(f.get('password')) || undefined,
        macAddress: String(f.get('macAddress')) || undefined,
      });
      setOpen(false); notify('Subscriber created'); onChange();
    } catch (e) { setError((e as Error).message); }
  };

  const doEnroll = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!enroll) return;
    const f = new FormData(e.currentTarget);
    try {
      await api.createSubscription(enroll.id, String(f.get('planId')), f.get('autoRenew') === 'on');
      setEnroll(null); notify('Enrolled — first invoice issued (pending payment)'); onChange();
    } catch (e) { setError((e as Error).message); }
  };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); notify(msg); onChange(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-black text-slate-900">Subscribers ({subscribers.length})</h3>
        <button onClick={() => setOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700">
          <Plus className="w-4 h-4" /> New Subscriber
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <tr>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">Login</th>
                <th className="text-left px-5 py-3">Plan</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {subscribers.map((s) => {
                const sub = subFor(s.id);
                return (
                  <tr key={s.id} className="hover:bg-slate-50/50">
                    <td className="px-5 py-3">
                      <p className="font-bold text-slate-800">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.phone}</p>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">{s.username}<br /><span className="text-slate-300">{s.type}</span></td>
                    <td className="px-5 py-3 text-slate-600">{sub ? planName(sub.planId) : <span className="text-slate-300">no plan</span>}</td>
                    <td className="px-5 py-3">
                      {sub ? <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${statusColor[sub.status]}`}>{sub.status}</span> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {!sub && <button onClick={() => setEnroll(s)} className="px-3 py-1.5 bg-orange-50 text-orange-600 rounded-lg text-xs font-bold hover:bg-orange-100">Enroll</button>}
                        {sub && (sub.status === 'suspended' || sub.status === 'grace' || sub.status === 'pending') && (
                          <button onClick={() => act(() => api.activateSubscription(sub.id), 'Activated')} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg" title="Activate"><PlayCircle className="w-4 h-4" /></button>
                        )}
                        {sub && (sub.status === 'active' || sub.status === 'grace') && (
                          <button onClick={() => act(() => api.suspendSubscription(sub.id), 'Suspended')} className="p-1.5 text-amber-600 hover:bg-amber-50 rounded-lg" title="Suspend"><Ban className="w-4 h-4" /></button>
                        )}
                        {sub && (
                          <button onClick={() => window.confirm('Cancel subscription?') && act(() => api.cancelSubscription(sub.id), 'Cancelled')} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg" title="Cancel"><XCircle className="w-4 h-4" /></button>
                        )}
                        {canDelete && !sub && (
                          <button onClick={() => window.confirm('Delete subscriber?') && act(() => api.deleteSubscriber(s.id), 'Deleted')} className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {open && (
        <Modal title="New Subscriber" onClose={() => setOpen(false)}>
          <form onSubmit={create} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Name"><input name="name" required className={inp} /></Field>
              <Field label="Phone (2547…)"><input name="phone" required placeholder="254712345678" className={inp} /></Field>
            </div>
            <Field label="Email (optional)"><input name="email" type="email" className={inp} /></Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Service">
                <select name="type" className={inp}><option value="pppoe">PPPoE</option><option value="hotspot">Hotspot</option></select>
              </Field>
              <Field label="Router">
                <select name="routerId" className={inp}>{routers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Login username"><input name="username" required placeholder="john.doe" className={inp} /></Field>
              <Field label="Password (blank=auto)"><input name="password" className={inp} /></Field>
            </div>
            <Field label="MAC (hotspot, optional)"><input name="macAddress" placeholder="AA:BB:CC:DD:EE:FF" className={inp} /></Field>
            <button type="submit" className="w-full py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700">Create</button>
          </form>
        </Modal>
      )}

      {enroll && (
        <Modal title={`Enroll ${enroll.name}`} onClose={() => setEnroll(null)}>
          <form onSubmit={doEnroll} className="space-y-4">
            <Field label="Plan">
              <select name="planId" className={inp}>
                {plans.filter((p) => p.type === enroll.type && p.active).map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — KES {p.price}/{p.durationDays}d</option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
              <input type="checkbox" name="autoRenew" defaultChecked className="w-5 h-5 rounded" /> Auto-renew each cycle
            </label>
            <p className="text-xs text-slate-400">A first invoice is issued immediately. The user goes live once it's paid (M-Pesa or manual).</p>
            <button type="submit" className="w-full py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700">Enroll & Invoice</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Invoices ──────────────────────────────────────────────────────────────────

function Invoices({ invoices, subscribers, plans, payments, onChange, notify, setError }: {
  invoices: Invoice[]; subscribers: Subscriber[]; plans: Plan[]; payments: Payment[];
  onChange: () => void; notify: (m: string) => void; setError: (m: string) => void;
}) {
  const [paying, setPaying] = useState<Invoice | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => subscribers.find((x) => x.id === id)?.name ?? '—';
  const phoneOf = (id: string) => subscribers.find((x) => x.id === id)?.phone ?? '';

  const invColor: Record<string, string> = {
    paid: 'bg-green-100 text-green-700', unpaid: 'bg-blue-100 text-blue-700',
    overdue: 'bg-red-100 text-red-700', void: 'bg-slate-200 text-slate-500',
  };

  const sorted = useMemo(
    () => [...invoices].sort((a, b) => new Date(b.issuedDate).getTime() - new Date(a.issuedDate).getTime()),
    [invoices],
  );

  const payMpesa = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!paying) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api.payMpesa(paying.id, String(f.get('phone')));
      notify('STK push sent — awaiting confirmation (settles in a few seconds)');
      setPaying(null);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const payManual = async (inv: Invoice) => {
    if (!window.confirm(`Record a cash/manual payment of KES ${inv.amount} for ${inv.number}?`)) return;
    try { await api.payManual(inv.id, 'cash'); notify('Payment recorded — user activated'); onChange(); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-50"><h3 className="text-lg font-black text-slate-900">Invoices ({invoices.length})</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <tr>
                <th className="text-left px-5 py-3">Invoice</th>
                <th className="text-left px-5 py-3">Customer</th>
                <th className="text-left px-5 py-3">Period</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Due</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Pay</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sorted.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/50">
                  <td className="px-5 py-3 font-mono text-xs font-bold text-slate-700">{inv.number}</td>
                  <td className="px-5 py-3 text-slate-700">{nameOf(inv.subscriberId)}</td>
                  <td className="px-5 py-3 text-xs text-slate-400">{format(new Date(inv.periodStart), 'dd MMM')} – {format(new Date(inv.periodEnd), 'dd MMM')}</td>
                  <td className="px-5 py-3 text-right font-bold text-slate-800">KES {inv.amount}</td>
                  <td className="px-5 py-3 text-xs text-slate-400">{format(new Date(inv.dueDate), 'dd MMM')}</td>
                  <td className="px-5 py-3"><span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${invColor[inv.status]}`}>{inv.status}</span></td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {(inv.status === 'unpaid' || inv.status === 'overdue') && (
                        <>
                          <button onClick={() => setPaying(inv)} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700"><Smartphone className="w-3 h-3" /> M-Pesa</button>
                          <button onClick={() => payManual(inv)} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-200">Cash</button>
                        </>
                      )}
                      {inv.status === 'paid' && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent payments */}
      <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
        <div className="px-5 py-4 border-b border-slate-50"><h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Recent Payments</h3></div>
        <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
          {payments.slice().reverse().slice(0, 12).map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-3">
                {p.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : p.status === 'failed' ? <XCircle className="w-4 h-4 text-red-500" /> : <Clock className="w-4 h-4 text-amber-500 animate-pulse" />}
                <div>
                  <p className="text-sm font-bold text-slate-800">{nameOf(p.subscriberId)} · <span className="uppercase text-xs text-slate-400">{p.method}</span></p>
                  <p className="text-xs text-slate-400 font-mono">{p.mpesaReceipt || p.failureReason || p.checkoutRequestId || '—'}</p>
                </div>
              </div>
              <span className="font-bold text-slate-700">KES {p.amount}</span>
            </div>
          ))}
          {payments.length === 0 && <div className="px-5 py-6 text-sm text-slate-400">No payments yet.</div>}
        </div>
      </div>

      {paying && (
        <Modal title={`Pay ${paying.number} — KES ${paying.amount}`} onClose={() => setPaying(null)}>
          <form onSubmit={payMpesa} className="space-y-4">
            <p className="text-sm text-slate-500">Simulated M-Pesa STK push. ~92% succeed; the rest fail like a real cancel/timeout. Settlement is automatic.</p>
            <Field label="Phone (2547…)"><input name="phone" required defaultValue={phoneOf(paying.subscriberId)} className={inp} /></Field>
            <button type="submit" disabled={busy} className="w-full py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
              <Smartphone className="w-4 h-4" /> {busy ? 'Sending…' : 'Send STK Push'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

const inp = 'w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-5">
          <h3 className="text-xl font-black text-slate-900">{title}</h3>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
