/**
 * Staff management (admin sub-tab).
 *
 * Admin-only surface over /api/auth/users: list staff, create accounts, change
 * roles, reset passwords, and remove accounts. The server enforces admin-only
 * access and the "can't remove the last admin / yourself" guards; this UI mirrors
 * them for a clean experience and surfaces server errors otherwise.
 */

import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, KeyRound, ShieldCheck, User as UserIcon, CheckCircle2, AlertCircle } from 'lucide-react';
import { api, type StaffRole, type StaffUser } from '../api/client';

const inp = 'w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500';

export default function StaffView({ currentUid }: { currentUid: string }) {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);

  const notify = (m: string) => { setToast(m); setTimeout(() => setToast(''), 4000); };

  const load = useCallback(async () => {
    try {
      const { users } = await api.listStaff();
      setStaff(users.sort((a, b) => a.email.localeCompare(b.email)));
      setError('');
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const addStaff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const { user } = await api.createStaff({
        email: String(f.get('email')),
        password: String(f.get('password')),
        displayName: String(f.get('displayName')) || undefined,
        role: (String(f.get('role')) as StaffRole) || 'technician',
      });
      notify(`Account created for ${user.email}`);
      setShowForm(false);
      await load();
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  };

  const toggleRole = async (u: StaffUser) => {
    const next: StaffRole = u.role === 'admin' ? 'technician' : 'admin';
    if (!window.confirm(`Change ${u.email} from ${u.role} to ${next}?`)) return;
    try {
      await api.setStaffRole(u.uid, next);
      notify(`${u.email} is now ${next}`);
      await load();
    } catch (err) { setError((err as Error).message); }
  };

  const resetPassword = async (u: StaffUser) => {
    const pw = window.prompt(`New password for ${u.email} (min 8 chars):`);
    if (pw == null) return;
    try {
      await api.resetStaffPassword(u.uid, pw);
      notify(`Password reset for ${u.email}`);
    } catch (err) { setError((err as Error).message); }
  };

  const removeStaff = async (u: StaffUser) => {
    if (!window.confirm(`Delete the account ${u.email}? This cannot be undone.`)) return;
    try {
      await api.deleteStaff(u.uid);
      notify(`Deleted ${u.email}`);
      await load();
    } catch (err) { setError((err as Error).message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-black text-slate-900">Staff</h3>
          <p className="text-sm text-slate-500">Manage portal accounts and their roles.</p>
        </div>
        <button
          onClick={() => { setShowForm((s) => !s); setError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-600/20"
        >
          <Plus className="w-5 h-5" /> Add staff
        </button>
      </div>

      {toast && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 text-green-700 rounded-xl text-sm font-bold">
          <CheckCircle2 className="w-5 h-5" /> {toast}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 text-red-700 rounded-xl text-sm font-bold">
          <AlertCircle className="w-5 h-5" /> {error}
        </div>
      )}

      {showForm && (
        <form onSubmit={addStaff} className="grid gap-4 sm:grid-cols-2 p-5 bg-white border border-slate-200 rounded-2xl">
          <label className="text-xs font-bold text-slate-500 uppercase">Email
            <input name="email" type="email" required className={inp} placeholder="tech@weonline.net" />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase">Display name
            <input name="displayName" className={inp} placeholder="(optional)" />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase">Password (min 8)
            <input name="password" type="password" required minLength={8} className={inp} />
          </label>
          <label className="text-xs font-bold text-slate-500 uppercase">Role
            <select name="role" defaultValue="technician" className={inp}>
              <option value="technician">technician</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <div className="sm:col-span-2 flex gap-3">
            <button type="submit" disabled={busy} className="px-5 py-2 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 disabled:opacity-60">
              {busy ? 'Creating…' : 'Create account'}
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200">Cancel</button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto bg-white border border-slate-200 rounded-2xl">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-400 uppercase text-xs border-b border-slate-100">
              <th className="px-5 py-3">Account</th>
              <th className="px-5 py-3">Role</th>
              <th className="px-5 py-3">Created</th>
              <th className="px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => {
              const isSelf = u.uid === currentUid;
              return (
                <tr key={u.uid} className="border-b border-slate-50 last:border-0">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 font-bold text-slate-800">
                      <UserIcon className="w-4 h-4 text-slate-400" />
                      {u.displayName || u.email}
                      {isSelf && <span className="text-[10px] font-bold text-orange-600 uppercase">you</span>}
                    </div>
                    <div className="text-xs text-slate-400 ml-6">{u.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold ${u.role === 'admin' ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>
                      {u.role === 'admin' && <ShieldCheck className="w-3 h-3" />} {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => toggleRole(u)} disabled={isSelf} title={isSelf ? "You can't change your own role" : 'Toggle role'}
                        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed">
                        Make {u.role === 'admin' ? 'technician' : 'admin'}
                      </button>
                      <button onClick={() => resetPassword(u)} title="Reset password"
                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"><KeyRound className="w-4 h-4" /></button>
                      <button onClick={() => removeStaff(u)} disabled={isSelf} title={isSelf ? "You can't delete your own account" : 'Delete account'}
                        className="p-2 rounded-lg text-red-500 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {staff.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-8 text-center text-slate-400">No staff accounts yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
