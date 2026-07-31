/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { useState, useEffect, useMemo } from 'react';
import { 
  Wifi, 
  Clock, 
  Calendar, 
  Zap, 
  CheckCircle2, 
  ChevronRight, 
  Menu, 
  X, 
  User, 
  Smartphone, 
  CreditCard,
  ArrowRight,
  Search,
  LayoutDashboard,
  Users,
  Router as RouterIcon,
  History,
  LogOut,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Power,
  PowerOff,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  DollarSign,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { authService, dataStore } from './data';
import type {
  AuthUser,
  Package,
  Subscription,
  Payment,
  Client,
  Router,
  Transaction,
  UserProfile,
} from './data';
import { format, addDays } from 'date-fns';

// Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleDataError(error: unknown, operationType: OperationType, path: string | null) {
  console.error(`Data Error [${operationType}] at ${path}:`, error);
  throw error;
}

const packages: Record<string, Package[]> = {
  connect: [
    {
      id: 'C1',
      name: 'Tester',
      speed: 'Up to 5Mbps',
      price: 10,
      duration: '90min',
      features: ['Unlimited Data', 'Best for quick browsing'],
    },
    {
      id: 'C2',
      name: 'KARIBU',
      speed: 'Up to 5Mbps',
      price: 20,
      duration: '3 Hours',
      features: ['Unlimited Data', 'Introduction to Possibilities'],
    },
    {
      id: 'C3',
      name: 'Tausi',
      speed: 'Up to 5Mbps',
      price: 30,
      duration: '5 Hours',
      features: ['Unlimited Data', 'Sit Back and Enjoy'],
    },
    {
      id: 'd1',
      name: 'Daily Lite',
      speed: 'Up to 5Mbps',
      price: 60,
      duration: '24 Hours',
      features: ['Unlimited Data', 'The Daily Dose'],
    },
    {
      id: 'd2',
      name: 'Ndovu',
      speed: 'Up to 5Mbps',
      price: 120,
      duration: '3 Days',
      features: ['Unlimited Data', 'Push your Limits'],
      popular: true,
    },
    {
      id: 'w1',
      name: 'Weekly Starter',
      speed: 'Up to 5Mbps',
      price: 200,
      duration: '7 Days',
      features: ['Unlimited Data', 'Consistent connection'],
    },
    {
      id: 'w2',
      name: 'Weekly Premium',
      speed: 'Up to 10Mbps',
      price: 350,
      duration: '7 Days',
      features: ['Unlimited Data', 'High speed streaming'],
      popular: true,
    },
  ],
  monthly: [
    {
      id: 'm1',
      name: 'Monthly Basic',
      speed: 'Up to 5Mbps',
      price: 600,
      duration: '30 Days',
      features: ['Unlimited Data', '1 Device', 'Affordable monthly plan'],
    },
    {
      id: 'm2',
      name: 'Monthly Home',
      speed: 'Up to 10Mbps',
      price: 900,
      duration: '30 Days',
      features: ['Unlimited Data', 'Up to 2 Devices', 'Perfect for families'],
      popular: true,
    },
  ],
};

export default function App() {
  const [view, setView] = useState<'plans' | 'subscriptions' | 'history' | 'admin'>('plans');
  const [adminView, setAdminView] = useState<'dashboard' | 'clients' | 'routers' | 'transactions'>('dashboard');
  const [activeTab, setActiveTab] = useState<'connect' | 'monthly'>('connect');
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);
  const [checkoutStep, setCheckoutStep] = useState<'idle' | 'phone' | 'processing' | 'connecting' | 'success'>('idle');
  const [phoneNumber, setPhoneNumber] = useState('');
  
  // Firebase State
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [routers, setRouters] = useState<Router[]>([]);
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  // Admin Form States
  const [isClientModalOpen, setIsClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isRouterModalOpen, setIsRouterModalOpen] = useState(false);
  const [editingRouter, setEditingRouter] = useState<Router | null>(null);

  // Login States
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([
    {
      id: 'sub_1',
      packageName: 'Daily Lite',
      speed: 'Up to 5Mbps',
      price: 60,
      activationDate: '2026-03-24T10:00:00Z',
      expiryDate: '2026-03-25T10:00:00Z',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      status: 'expired'
    }
  ]);
  const [payments, setPayments] = useState<Payment[]>([
    {
      id: 'pay_1',
      subscriptionId: 'sub_1',
      packageName: 'Daily Lite',
      amount: 60,
      date: '2026-03-24T10:00:00Z',
      phoneNumber: '712345678',
      transactionId: 'RCH12345678',
      status: 'completed'
    }
  ]);

  // Auth Effect
  useEffect(() => {
    const unsubscribe = authService.onAuthStateChanged(async (authUser) => {
      setUser(authUser);
      if (authUser) {
        const existing = await dataStore.get<UserProfile>('users', authUser.uid);
        if (existing) {
          setUserProfile(existing);
        } else {
          // Default admin for the first user if it matches the email
          const isAdmin = authUser.email === 'mongeta5@gmail.com';
          const profile: UserProfile = {
            uid: authUser.uid,
            email: authUser.email || '',
            role: isAdmin ? 'admin' : 'technician',
            name: authUser.displayName || 'User'
          };
          await dataStore.set('users', authUser.uid, profile);
          setUserProfile(profile);
        }
      } else {
        setUserProfile(null);
        if (view === 'admin') setView('plans');
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [view]);

  // Data Fetching Effect
  useEffect(() => {
    if (!userProfile) return;

    const unsubClients = dataStore.subscribe<Client>('clients', setClients);
    const unsubRouters = dataStore.subscribe<Router>('routers', setRouters);
    const unsubTransactions = dataStore.subscribe<Transaction>('transactions', setAllTransactions, {
      orderBy: { field: 'date', dir: 'desc' },
    });

    return () => {
      unsubClients();
      unsubRouters();
      unsubTransactions();
    };
  }, [userProfile]);

  // MikroTik Polling Effect
  useEffect(() => {
    if (routers.length === 0) return;

    const pollMikrotik = async () => {
      const mikrotikRouters = routers.filter(r => r.isMikrotik && r.status === 'online');
      for (const router of mikrotikRouters) {
        try {
          const response = await fetch(`/api/mikrotik/status?ip=${router.ipAddress}`);
          if (response.ok) {
            const data = await response.json();
            // Persist the simulated telemetry via the data layer
            await dataStore.update('routers', router.id, {
              cpu: data.cpu,
              memory: data.memory,
              temperature: data.temperature,
              uptime: data.uptime,
              clientsCount: data.clientsCount,
              model: data.model
            });
          }
        } catch (error) {
          console.error("Failed to poll MikroTik:", error);
        }
      }
    };

    const interval = setInterval(pollMikrotik, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [routers]);

  const handleLogin = () => {
    setIsLoginModalOpen(true);
    setLoginError('');
  };

  const handleGoogleLogin = async () => {
    try {
      await authService.signInWithGoogle();
      setIsLoginModalOpen(false);
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError('Login was cancelled. Please try again if you wish to sign in.');
      } else {
        console.error("Google login failed:", error);
        setLoginError(error.message || 'Google login failed. Please try again.');
      }
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      if (isSignUp) {
        await authService.signUpWithEmail(email, password);
      } else {
        await authService.signInWithEmail(email, password);
      }
      setIsLoginModalOpen(false);
      setEmail('');
      setPassword('');
      setIsSignUp(false);
    } catch (error: any) {
      console.error("Auth failed:", error);
      if (error.code === 'auth/operation-not-allowed') {
        setLoginError('Email/Password authentication is not enabled in your Firebase project. Please enable it in the Firebase Console under Authentication > Sign-in method.');
      } else {
        setLoginError(error.message || 'Authentication failed.');
      }
    }
  };

  const handleLogout = async () => {
    await authService.signOut();
    setView('plans');
  };

  const filteredPackages = packages[activeTab].filter(pkg => {
    const searchLower = searchTerm.toLowerCase();
    return (
      pkg.name.toLowerCase().includes(searchLower) || 
      pkg.speed.toLowerCase().includes(searchLower) ||
      pkg.price.toString().includes(searchLower) ||
      pkg.duration.toLowerCase().includes(searchLower) ||
      pkg.features.some(f => f.toLowerCase().includes(searchLower))
    );
  });

  const handleBuyNow = (pkg: Package) => {
    setSelectedPackage(pkg);
    setCheckoutStep('phone');
  };

  const initiatePayment = () => {
    if (!phoneNumber || phoneNumber.length < 9) return;
    setCheckoutStep('processing');
    
    // Simulate M-Pesa STK Push
    setTimeout(() => {
      setCheckoutStep('connecting');
      
      // Simulate WiFi Connection
      setTimeout(async () => {
        // Generate a random MAC address in the background
        const generateMac = () => {
          const hexDigits = "0123456789ABCDEF";
          let mac = "";
          for (let i = 0; i < 6; i++) {
            mac += hexDigits.charAt(Math.floor(Math.random() * 16));
            mac += hexDigits.charAt(Math.floor(Math.random() * 16));
            if (i !== 5) mac += ":";
          }
          return mac;
        };

        const mac = generateMac();
        const now = new Date();
        let expiry = new Date(now);
        
        if (selectedPackage?.duration.includes('min')) {
          const mins = parseInt(selectedPackage.duration);
          expiry.setMinutes(now.getMinutes() + mins);
        } else if (selectedPackage?.duration.includes('Hour')) {
          const hours = parseInt(selectedPackage.duration);
          expiry.setHours(now.getHours() + hours);
        } else if (selectedPackage?.duration.includes('Day')) {
          const days = parseInt(selectedPackage.duration);
          expiry.setDate(now.getDate() + days);
        }

        const subId = `sub_${Math.random().toString(36).substr(2, 9)}`;
        const payId = `pay_${Math.random().toString(36).substr(2, 9)}`;
        const transId = `MPESA${Math.random().toString(36).substr(2, 8).toUpperCase()}`;

        const newSub: Subscription = {
          id: subId,
          packageName: selectedPackage?.name || '',
          speed: selectedPackage?.speed || '',
          price: selectedPackage?.price || 0,
          activationDate: now.toISOString(),
          expiryDate: expiry.toISOString(),
          macAddress: mac,
          status: 'active'
        };

        const newPayment: Payment = {
          id: payId,
          subscriptionId: subId,
          packageName: selectedPackage?.name || '',
          amount: selectedPackage?.price || 0,
          date: now.toISOString(),
          phoneNumber: phoneNumber,
          transactionId: transId,
          status: 'completed'
        };

        // If it's a hotspot client, we could also record it in Firestore if we wanted to track all sales
        try {
          await dataStore.add('transactions', {
            clientId: 'guest',
            clientName: `Guest (${phoneNumber})`,
            amount: selectedPackage?.price || 0,
            date: now.toISOString(),
            planName: selectedPackage?.name || '',
            type: 'hotspot_sale'
          });
        } catch (e) {
          console.error("Error logging transaction:", e);
        }

        setSubscriptions([newSub, ...subscriptions]);
        setPayments([newPayment, ...payments]);
        setCheckoutStep('success');
      }, 2500);
    }, 3000);
  };

  const resetCheckout = () => {
    setSelectedPackage(null);
    setCheckoutStep('idle');
    setPhoneNumber('');
  };

  // Admin Actions
  const saveClient = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const clientData = {
      name: formData.get('name') as string,
      type: formData.get('type') as 'hotspot' | 'pppoe',
      planName: formData.get('planName') as string,
      price: Number(formData.get('price')),
      phoneNumber: formData.get('phoneNumber') as string,
      status: 'active',
      online: Math.random() > 0.5,
      startDate: new Date().toISOString(),
      expiryDate: addDays(new Date(), 30).toISOString(), // Default 30 days
      pppoeUsername: formData.get('pppoeUsername') as string,
      pppoePassword: formData.get('pppoePassword') as string,
      routerId: formData.get('routerId') as string,
    };

    try {
      if (editingClient) {
        await dataStore.update('clients', editingClient.id, clientData);
      } else {
        await dataStore.add('clients', clientData);
      }
      setIsClientModalOpen(false);
      setEditingClient(null);
    } catch (e) {
      handleDataError(e, editingClient ? OperationType.UPDATE : OperationType.CREATE, 'clients');
    }
  };

  const rechargeClient = async (client: Client, days: number) => {
    const newExpiry = addDays(new Date(client.expiryDate), days);
    try {
      await dataStore.update('clients', client.id, {
        expiryDate: newExpiry.toISOString(),
        status: 'active'
      });
      await dataStore.add('transactions', {
        clientId: client.id,
        clientName: client.name,
        amount: client.price,
        date: new Date().toISOString(),
        planName: client.planName,
        type: 'recharge'
      });
    } catch (e) {
      handleDataError(e, OperationType.UPDATE, `clients/${client.id}`);
    }
  };

  const disconnectClient = async (client: Client) => {
    try {
      await dataStore.update('clients', client.id, {
        status: 'expired',
        online: false
      });
    } catch (e) {
      handleDataError(e, OperationType.UPDATE, `clients/${client.id}`);
    }
  };

  const deleteClient = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this client?")) return;
    try {
      await dataStore.remove('clients', id);
    } catch (e) {
      handleDataError(e, OperationType.DELETE, `clients/${id}`);
    }
  };

  const saveRouter = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const routerData = {
      name: formData.get('name') as string,
      location: formData.get('location') as string,
      ipAddress: formData.get('ipAddress') as string,
      username: formData.get('username') as string || 'admin',
      apiPort: parseInt(formData.get('apiPort') as string) || 8728,
      isMikrotik: formData.get('isMikrotik') === 'on',
      model: formData.get('model') as string || 'MikroTik L009UiGS-RM',
      status: 'online',
      cpu: 0,
      memory: 0,
      uptime: '00:00:00',
      temperature: 0,
      clientsCount: 0
    };

    try {
      if (editingRouter) {
        await dataStore.update('routers', editingRouter.id, routerData);
      } else {
        await dataStore.add('routers', routerData);
      }
      setIsRouterModalOpen(false);
      setEditingRouter(null);
    } catch (e) {
      handleDataError(e, editingRouter ? OperationType.UPDATE : OperationType.CREATE, 'routers');
    }
  };

  const dashboardStats = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const dailyIncome = allTransactions
      .filter(t => t.date.startsWith(today))
      .reduce((sum, t) => sum + t.amount, 0);
    
    const onlineHotspot = clients.filter(c => c.type === 'hotspot' && c.online).length;
    const onlinePPPoE = clients.filter(c => c.type === 'pppoe' && c.online).length;

    // Aggregate MikroTik health
    const mikrotikRouters = routers.filter(r => r.isMikrotik && r.status === 'online');
    const avgCpu = mikrotikRouters.length > 0 
      ? Math.round(mikrotikRouters.reduce((acc, r) => acc + (r.cpu || 0), 0) / mikrotikRouters.length) 
      : 0;
    const avgTemp = mikrotikRouters.length > 0
      ? Math.round(mikrotikRouters.reduce((acc, r) => acc + (r.temperature || 0), 0) / mikrotikRouters.length)
      : 0;
    
    return { dailyIncome, onlineHotspot, onlinePPPoE, avgCpu, avgTemp };
  }, [allTransactions, clients, routers]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-orange-100 border-t-orange-600 rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading WeOnline...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900">
      {/* Admin Modals */}
      <AnimatePresence>
        {isLoginModalOpen && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
                <h3 className="text-xl font-bold">{isSignUp ? 'Create Admin Account' : 'Admin Login'}</h3>
                <button onClick={() => setIsLoginModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <button 
                  onClick={handleGoogleLogin}
                  className="w-full py-3 px-4 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold flex items-center justify-center gap-3 hover:bg-slate-50 transition-all"
                >
                  <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
                  Continue with Google
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-100"></div>
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-white px-2 text-slate-400 font-bold tracking-widest">Or with email</span>
                  </div>
                </div>

                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Email Address</label>
                    <input 
                      type="email" 
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required 
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500" 
                      placeholder="admin@weonline.net"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Password</label>
                    <input 
                      type="password" 
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required 
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500" 
                      placeholder="••••••••"
                    />
                  </div>

                  {loginError && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-xs font-medium">
                      <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                      {loginError}
                    </div>
                  )}

                  <button 
                    type="submit" 
                    className="w-full py-4 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-600/20"
                  >
                    {isSignUp ? 'Create Account' : 'Login to Dashboard'}
                  </button>
                </form>

                <div className="text-center">
                  <button 
                    onClick={() => setIsSignUp(!isSignUp)}
                    className="text-sm font-bold text-slate-500 hover:text-orange-600 transition-colors"
                  >
                    {isSignUp ? 'Already have an account? Login' : 'Need an account? Sign up'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isClientModalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="bg-slate-900 p-6 text-white flex justify-between items-center">
                <h3 className="text-xl font-bold">{editingClient ? 'Edit Client' : 'Add New Client'}</h3>
                <button onClick={() => setIsClientModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={saveClient} className="p-8 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Full Name</label>
                    <input name="name" defaultValue={editingClient?.name} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Phone Number</label>
                    <input name="phoneNumber" defaultValue={editingClient?.phoneNumber} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Client Type</label>
                    <select name="type" defaultValue={editingClient?.type || 'pppoe'} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500">
                      <option value="pppoe">PPPoE</option>
                      <option value="hotspot">Hotspot</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Plan Name</label>
                    <input name="planName" defaultValue={editingClient?.planName} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Monthly Price (KES)</label>
                    <input name="price" type="number" defaultValue={editingClient?.price} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Router</label>
                    <select name="routerId" defaultValue={editingClient?.routerId} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500">
                      <option value="">Select Router</option>
                      {routers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">PPPoE Username</label>
                    <input name="pppoeUsername" defaultValue={editingClient?.pppoeUsername} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">PPPoE Password</label>
                    <input name="pppoePassword" type="password" defaultValue={editingClient?.pppoePassword} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-orange-500" />
                  </div>
                </div>
                <button type="submit" className="w-full py-4 bg-orange-600 text-white rounded-2xl font-bold hover:bg-orange-700 transition-all">
                  {editingClient ? 'Update Client' : 'Add Client'}
                </button>
              </form>
            </motion.div>
          </div>
        )}

        {isRouterModalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="bg-blue-900 p-6 text-white flex justify-between items-center">
                <h3 className="text-xl font-bold">{editingRouter ? 'Edit Router' : 'Add Router'}</h3>
                <button onClick={() => setIsRouterModalOpen(false)} className="p-2 hover:bg-white/10 rounded-full">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={saveRouter} className="p-8 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Router Name</label>
                    <input name="name" defaultValue={editingRouter?.name} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Model</label>
                    <input name="model" defaultValue={editingRouter?.model || 'MikroTik L009UiGS-RM'} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">IP Address</label>
                    <input name="ipAddress" defaultValue={editingRouter?.ipAddress} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">API Port</label>
                    <input name="apiPort" type="number" defaultValue={editingRouter?.apiPort || 8728} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Username</label>
                    <input name="username" defaultValue={editingRouter?.username || 'admin'} className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-500 uppercase">Password</label>
                    <input name="password" type="password" className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" placeholder="••••••••" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Location</label>
                  <input name="location" defaultValue={editingRouter?.location} required className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex items-center gap-3 py-2">
                  <input type="checkbox" name="isMikrotik" id="isMikrotik" defaultChecked={editingRouter?.isMikrotik ?? true} className="w-5 h-5 text-blue-600 border-slate-300 rounded focus:ring-blue-500" />
                  <label htmlFor="isMikrotik" className="text-sm font-bold text-slate-700">Enable MikroTik RouterOS Simulation</label>
                </div>
                <button type="submit" className="w-full py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all">
                  {editingRouter ? 'Update Router' : 'Add Router'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <AnimatePresence>
        {selectedPackage && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
            >
              {/* Modal Header */}
              <div className="bg-orange-600 p-6 text-white flex justify-between items-center">
                <div>
                  <h3 className="text-xl font-bold">Checkout</h3>
                  <p className="text-orange-100 text-sm">{selectedPackage.name} - {selectedPackage.speed}</p>
                </div>
                {checkoutStep === 'phone' && (
                  <button onClick={resetCheckout} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                )}
              </div>

              <div className="p-8">
                {checkoutStep === 'phone' && (
                  <div className="space-y-6">
                    <div className="flex items-center gap-4 p-4 bg-orange-50 rounded-2xl border border-orange-100">
                      <div className="bg-white p-2 rounded-xl shadow-sm">
                        <CreditCard className="w-6 h-6 text-orange-600" />
                      </div>
                      <div>
                        <p className="text-xs text-orange-600 font-bold uppercase tracking-wider">Total Amount</p>
                        <p className="text-2xl font-black text-slate-900">KES {selectedPackage.price}</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-700 ml-1">M-Pesa Phone Number</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                          <span className="text-slate-400 font-bold text-sm">+254</span>
                        </div>
                        <input
                          type="tel"
                          placeholder="712345678"
                          value={phoneNumber}
                          onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, '').slice(0, 9))}
                          className="w-full pl-16 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all font-mono tracking-widest text-lg"
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 ml-1">Enter your Safaricom number to receive an STK push</p>
                    </div>

                    <button
                      onClick={initiatePayment}
                      disabled={phoneNumber.length < 9}
                      className={`
                        w-full py-4 rounded-2xl font-bold text-lg flex items-center justify-center gap-2 transition-all
                        ${phoneNumber.length >= 9
                          ? 'bg-green-600 text-white hover:bg-green-700 shadow-lg shadow-green-200' 
                          : 'bg-slate-100 text-slate-400 cursor-not-allowed'}
                      `}
                    >
                      Pay Now
                      <ArrowRight className="w-5 h-5" />
                    </button>
                  </div>
                )}

                {checkoutStep === 'processing' && (
                  <div className="py-12 text-center space-y-6">
                    <div className="relative w-20 h-20 mx-auto">
                      <div className="absolute inset-0 border-4 border-slate-100 rounded-full" />
                      <motion.div 
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        className="absolute inset-0 border-4 border-orange-600 rounded-full border-t-transparent"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Smartphone className="w-8 h-8 text-orange-600" />
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-slate-900">Waiting for M-Pesa...</h4>
                      <p className="text-slate-500 text-sm mt-2">Please check your phone and enter your PIN to complete the payment of KES {selectedPackage.price}</p>
                    </div>
                  </div>
                )}

                {checkoutStep === 'connecting' && (
                  <div className="py-12 text-center space-y-6">
                    <div className="relative w-20 h-20 mx-auto">
                      <motion.div 
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                        className="absolute inset-0 bg-orange-100 rounded-full"
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Wifi className="w-10 h-10 text-orange-600 animate-pulse" />
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xl font-bold text-slate-900">Connecting to WeOnline...</h4>
                      <p className="text-slate-500 text-sm mt-2">Setting up your secure high-speed connection. Please stay on this page.</p>
                    </div>
                  </div>
                )}

                {checkoutStep === 'success' && (
                  <div className="py-8 text-center space-y-6">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-12 h-12 text-green-600" />
                    </div>
                    <div>
                      <h4 className="text-2xl font-black text-slate-900">Success! You're Online</h4>
                      <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 inline-block">
                        <p className="text-sm text-slate-500">Connected for</p>
                        <p className="text-xl font-bold text-orange-600">{selectedPackage.duration}</p>
                      </div>
                      <p className="text-slate-500 text-sm mt-6">Enjoy your high-speed unlimited internet. Your session will expire automatically.</p>
                    </div>
                    <button
                      onClick={resetCheckout}
                      className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold text-lg hover:bg-slate-800 transition-all"
                    >
                      Go to Dashboard
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="bg-orange-500 p-1.5 rounded-lg">
                <Wifi className="text-white w-6 h-6" />
              </div>
              <span className="text-2xl font-black tracking-tighter text-orange-600">WEONLINE</span>
            </div>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-8">
              <button 
                onClick={() => setView('plans')}
                className={`text-sm font-semibold transition-all pb-1 ${view === 'plans' ? 'text-orange-600 border-b-2 border-orange-600' : 'text-slate-600 hover:text-orange-600'}`}
              >
                Internet Plans
              </button>
              <button 
                onClick={() => setView('subscriptions')}
                className={`text-sm font-semibold transition-all pb-1 ${view === 'subscriptions' ? 'text-orange-600 border-b-2 border-orange-600' : 'text-slate-600 hover:text-orange-600'}`}
              >
                Subscriptions
              </button>
              <button 
                onClick={() => setView('history')}
                className={`text-sm font-semibold transition-all pb-1 ${view === 'history' ? 'text-orange-600 border-b-2 border-orange-600' : 'text-slate-600 hover:text-orange-600'}`}
              >
                Payment History
              </button>
              {userProfile && (
                <button 
                  onClick={() => setView('admin')}
                  className={`text-sm font-semibold transition-all pb-1 ${view === 'admin' ? 'text-orange-600 border-b-2 border-orange-600' : 'text-slate-600 hover:text-orange-600'}`}
                >
                  Admin Portal
                </button>
              )}
            </div>

            <div className="hidden md:flex items-center gap-4">
              {user ? (
                <div className="flex items-center gap-4">
                  <div className="flex flex-col items-end">
                    <span className="text-xs font-bold text-slate-900">{userProfile?.name}</span>
                    <span className="text-[10px] text-slate-500 uppercase tracking-widest">{userProfile?.role}</span>
                  </div>
                  <button 
                    onClick={handleLogout}
                    className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                  >
                    <LogOut className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button 
                  onClick={handleLogin}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 rounded-full transition-all"
                >
                  <User className="w-4 h-4" />
                  Admin Login
                </button>
              )}
            </div>

            {/* Mobile Menu Button */}
            <div className="md:hidden">
              <button 
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="p-2 text-slate-600 hover:text-orange-600"
              >
                {isMenuOpen ? <X /> : <Menu />}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Nav */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="md:hidden bg-white border-b border-slate-200 overflow-hidden"
            >
              <div className="px-4 pt-2 pb-6 space-y-1">
                <button 
                  onClick={() => { setView('plans'); setIsMenuOpen(false); }}
                  className={`block w-full text-left px-3 py-4 text-base font-semibold rounded-xl ${view === 'plans' ? 'text-orange-600 bg-orange-50' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Internet Plans
                </button>
                <button 
                  onClick={() => { setView('subscriptions'); setIsMenuOpen(false); }}
                  className={`block w-full text-left px-3 py-4 text-base font-semibold rounded-xl ${view === 'subscriptions' ? 'text-orange-600 bg-orange-50' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Subscriptions
                </button>
                <button 
                  onClick={() => { setView('history'); setIsMenuOpen(false); }}
                  className={`block w-full text-left px-3 py-4 text-base font-semibold rounded-xl ${view === 'history' ? 'text-orange-600 bg-orange-50' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  Payment History
                </button>
                <a href="#" className="block px-3 py-4 text-base font-medium text-slate-600 hover:bg-slate-50 rounded-xl">Add Device</a>
                <div className="pt-4 border-t border-slate-100">
                  <button className="w-full flex items-center justify-center gap-2 px-4 py-3 text-base font-bold text-white bg-orange-600 rounded-xl">
                    <User className="w-5 h-5" />
                    Login to Account
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* Receipt Modal */}
      <AnimatePresence>
        {selectedPayment && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8">
                <div className="flex justify-between items-start mb-8">
                  <div className="flex items-center gap-2">
                    <div className="bg-orange-500 p-1.5 rounded-lg">
                      <Wifi className="text-white w-5 h-5" />
                    </div>
                    <span className="text-xl font-black tracking-tighter text-orange-600 uppercase">WeOnline</span>
                  </div>
                  <button onClick={() => setSelectedPayment(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                    <X className="w-5 h-5 text-slate-400" />
                  </button>
                </div>

                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900">Payment Receipt</h3>
                  <p className="text-slate-500 text-sm">Transaction Successful</p>
                </div>

                <div className="space-y-4 border-t border-b border-slate-100 py-6 mb-6">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Package</span>
                    <span className="font-bold text-slate-900">{selectedPayment.packageName}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Amount Paid</span>
                    <span className="font-bold text-slate-900">KES {selectedPayment.amount}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Date</span>
                    <span className="font-bold text-slate-900">{new Date(selectedPayment.date).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Phone Number</span>
                    <span className="font-bold text-slate-900">+254 {selectedPayment.phoneNumber}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Transaction ID</span>
                    <span className="font-mono font-bold text-orange-600">{selectedPayment.transactionId}</span>
                  </div>
                </div>

                <div className="bg-slate-50 p-4 rounded-2xl mb-8">
                  <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mb-1 text-center">Important Note</p>
                  <p className="text-[11px] text-slate-500 text-center leading-relaxed">
                    This is an electronic receipt. Your internet access has been activated automatically for the device used during purchase.
                  </p>
                </div>

                <button
                  onClick={() => window.print()}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold text-lg hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
                >
                  <Smartphone className="w-5 h-5" />
                  Download Receipt
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <AnimatePresence mode="wait">
        {view === 'plans' ? (
          <motion.div
            key="plans-view"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
          >
            {/* Hero Section */}
            <header className="relative overflow-hidden bg-white pt-16 pb-24 lg:pt-24 lg:pb-32">
              <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/4 w-[600px] h-[600px] bg-orange-100 rounded-full blur-3xl opacity-50" />
              <div className="absolute bottom-0 left-0 translate-y-1/2 -translate-x-1/4 w-[400px] h-[400px] bg-blue-100 rounded-full blur-3xl opacity-50" />
              
              <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-100 text-orange-700 text-xs font-bold uppercase tracking-wider mb-6">
                    <Zap className="w-3 h-3" />
                    Fast & Reliable
                  </span>
                  <h1 className="text-4xl md:text-6xl font-black text-slate-900 tracking-tight mb-6">
                    Choose Your <span className="text-orange-600">Internet Package</span>
                  </h1>
                  <p className="max-w-2xl mx-auto text-lg text-slate-600 mb-10">
                    Experience truly unlimited wireless internet with no data caps. 
                    Connect your home or business with WeOnline today.
                  </p>
                </motion.div>

                {/* Search Bar */}
                <div className="max-w-md mx-auto mb-10 relative">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    <Search className="w-5 h-5 text-slate-400" />
                  </div>
                  <input
                    type="text"
                    placeholder="Search packages (e.g. 10Mbps)..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition-all shadow-sm"
                  />
                </div>

                {/* Tab Selection */}
                <div className="flex justify-center mb-12">
                  <div className="inline-flex p-1.5 bg-slate-100 rounded-2xl shadow-inner">
                    {(['connect', 'monthly'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`
                          px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200
                          ${activeTab === tab 
                            ? 'bg-white text-orange-600 shadow-sm' 
                            : 'text-slate-500 hover:text-slate-700'}
                        `}
                      >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </header>

            {/* Packages Grid */}
            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-16 pb-24">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <AnimatePresence mode="wait">
                  {filteredPackages.map((pkg, index) => (
                    <motion.div
                      key={pkg.id}
                      initial={{ opacity: 0, scale: 0.95, y: 20 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.95, y: 20 }}
                      transition={{ duration: 0.3, delay: index * 0.1 }}
                      className={`
                        relative bg-white rounded-3xl p-8 shadow-xl shadow-slate-200/50 border-2 transition-all hover:shadow-2xl hover:-translate-y-1
                        ${pkg.popular ? 'border-orange-500' : 'border-transparent'}
                      `}
                    >
                      {pkg.popular && (
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-orange-500 text-white text-[10px] font-black uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg">
                          Most Popular
                        </div>
                      )}

                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h3 className="text-xl font-bold text-slate-900 mb-1">{pkg.name}</h3>
                          <div className="flex items-center gap-1.5 text-slate-500 text-sm">
                            <Zap className="w-4 h-4 text-orange-500" />
                            {pkg.speed}
                          </div>
                        </div>
                        <div className="bg-slate-50 p-3 rounded-2xl">
                          {(pkg.duration.includes('Hour') || pkg.duration.includes('min')) && <Clock className="w-6 h-6 text-slate-400" />}
                          {pkg.duration.includes('Day') && <Calendar className="w-6 h-6 text-slate-400" />}
                        </div>
                      </div>

                      <div className="mb-8">
                        <div className="flex items-baseline gap-1">
                          <span className="text-sm font-bold text-slate-400">KES</span>
                          <span className="text-5xl font-black text-slate-900">{pkg.price}</span>
                          <span className="text-sm font-medium text-slate-400">/ {pkg.duration}</span>
                        </div>
                      </div>

                      <ul className="space-y-4 mb-10">
                        {pkg.features.map((feature, i) => (
                          <li key={i} className="flex items-start gap-3 text-sm text-slate-600">
                            <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                            {feature}
                          </li>
                        ))}
                      </ul>

                      <button 
                        onClick={() => handleBuyNow(pkg)}
                        className={`
                        w-full py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 transition-all
                        ${pkg.popular 
                          ? 'bg-orange-600 text-white hover:bg-orange-700 shadow-lg shadow-orange-200' 
                          : 'bg-slate-100 text-slate-900 hover:bg-slate-200'}
                      `}>
                        Buy Now
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Quick Actions */}
              <section className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4 hover:border-orange-200 transition-colors cursor-pointer group">
                  <div className="bg-blue-50 p-4 rounded-2xl group-hover:bg-blue-100 transition-colors">
                    <Smartphone className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900">Add New Device</h4>
                    <p className="text-xs text-slate-500">Connect more gadgets to your plan</p>
                  </div>
                  <ChevronRight className="ml-auto w-5 h-5 text-slate-300 group-hover:text-orange-500 transition-colors" />
                </div>

                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4 hover:border-orange-200 transition-colors cursor-pointer group">
                  <div className="bg-purple-50 p-4 rounded-2xl group-hover:bg-purple-100 transition-colors">
                    <Zap className="w-6 h-6 text-purple-600" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900">Change Device</h4>
                    <p className="text-xs text-slate-500">Switch your active internet device</p>
                  </div>
                  <ChevronRight className="ml-auto w-5 h-5 text-slate-300 group-hover:text-orange-500 transition-colors" />
                </div>

                <div 
                  onClick={() => { setView('history'); setIsMenuOpen(false); }}
                  className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm flex items-center gap-4 hover:border-orange-200 transition-colors cursor-pointer group"
                >
                  <div className="bg-green-50 p-4 rounded-2xl group-hover:bg-green-100 transition-colors">
                    <CreditCard className="w-6 h-6 text-green-600" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900">Payment History</h4>
                    <p className="text-xs text-slate-500">View and download your receipts</p>
                  </div>
                  <ChevronRight className="ml-auto w-5 h-5 text-slate-300 group-hover:text-orange-500 transition-colors" />
                </div>
              </section>
            </main>
          </motion.div>
        ) : view === 'admin' ? (
          <motion.div
            key="admin-view"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
          >
            {/* Admin Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div>
                <h2 className="text-3xl font-black text-slate-900 tracking-tight">Admin Portal</h2>
                <p className="text-slate-500">Manage your network, clients, and billing.</p>
              </div>
              <div className="flex p-1 bg-slate-100 rounded-2xl">
                {(['dashboard', 'clients', 'routers', 'transactions'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAdminView(tab)}
                    className={`
                      px-4 py-2 rounded-xl text-xs font-bold transition-all
                      ${adminView === tab ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}
                    `}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Admin Content */}
            {adminView === 'dashboard' && (
              <div className="space-y-8">
                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="bg-green-100 p-3 rounded-2xl">
                        <DollarSign className="w-6 h-6 text-green-600" />
                      </div>
                      <span className="text-sm font-bold text-slate-500">Daily Income</span>
                    </div>
                    <p className="text-3xl font-black text-slate-900">KES {dashboardStats.dailyIncome}</p>
                    <div className="mt-2 flex items-center gap-1 text-xs text-green-600 font-bold">
                      <TrendingUp className="w-3 h-3" />
                      +12% from yesterday
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="bg-orange-100 p-3 rounded-2xl">
                        <Wifi className="w-6 h-6 text-orange-600" />
                      </div>
                      <span className="text-sm font-bold text-slate-500">Hotspot Users</span>
                    </div>
                    <p className="text-3xl font-black text-slate-900">{dashboardStats.onlineHotspot}</p>
                    <div className="mt-2 flex items-center gap-1 text-xs text-slate-400 font-bold">
                      <Activity className="w-3 h-3" />
                      Active sessions
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="bg-blue-100 p-3 rounded-2xl">
                        <Activity className="w-6 h-6 text-blue-600" />
                      </div>
                      <span className="text-sm font-bold text-slate-500">Router CPU</span>
                    </div>
                    <p className="text-3xl font-black text-slate-900">{dashboardStats.avgCpu}%</p>
                    <div className="mt-2 flex items-center gap-1 text-xs text-slate-400 font-bold">
                      <TrendingUp className="w-3 h-3" />
                      Avg system load
                    </div>
                  </div>
                  <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                    <div className="flex items-center gap-4 mb-4">
                      <div className="bg-red-100 p-3 rounded-2xl">
                        <Zap className="w-6 h-6 text-red-600" />
                      </div>
                      <span className="text-sm font-bold text-slate-500">Router Temp</span>
                    </div>
                    <p className="text-3xl font-black text-slate-900">{dashboardStats.avgTemp}°C</p>
                    <div className="mt-2 flex items-center gap-1 text-xs text-slate-400 font-bold">
                      <Activity className="w-3 h-3" />
                      Network health
                    </div>
                  </div>
                </div>

                {/* Recent Activity */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                      <History className="w-5 h-5 text-orange-600" />
                      Recent Transactions
                    </h3>
                    <div className="space-y-4">
                      {allTransactions.slice(0, 5).map(t => (
                        <div key={t.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className="bg-white p-2 rounded-xl shadow-sm">
                              <CreditCard className="w-4 h-4 text-slate-400" />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">{t.clientName}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-widest">{t.planName}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-slate-900">KES {t.amount}</p>
                            <p className="text-[10px] text-slate-400">{format(new Date(t.date), 'HH:mm')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
                    <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-2">
                      <RouterIcon className="w-5 h-5 text-blue-600" />
                      Router Status
                    </h3>
                    <div className="space-y-4">
                      {routers.map(r => (
                        <div key={r.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-xl shadow-sm ${r.status === 'online' ? 'bg-green-100' : 'bg-red-100'}`}>
                              <RouterIcon className={`w-4 h-4 ${r.status === 'online' ? 'text-green-600' : 'text-red-600'}`} />
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">{r.name}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-widest">{r.location}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${r.status === 'online' ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{r.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {adminView === 'clients' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <div className="relative max-w-xs w-full">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search clients..." 
                      className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-orange-500 outline-none"
                    />
                  </div>
                  <button 
                    onClick={() => { setEditingClient(null); setIsClientModalOpen(true); }}
                    className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Add Client
                  </button>
                </div>

                <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100">
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Client</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Type</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Plan</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Status</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Expiry</th>
                          <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {clients.map(client => (
                          <tr key={client.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className={`w-2 h-2 rounded-full ${client.online ? 'bg-green-500' : 'bg-slate-300'}`} />
                                <div>
                                  <p className="text-sm font-bold text-slate-900">{client.name}</p>
                                  <p className="text-[10px] text-slate-500">{client.phoneNumber}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${client.type === 'pppoe' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                                {client.type}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm font-medium text-slate-700">{client.planName}</p>
                              <p className="text-[10px] text-slate-400">KES {client.price}</p>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${client.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {client.status}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <p className="text-sm text-slate-600">{format(new Date(client.expiryDate), 'MMM dd, yyyy')}</p>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button 
                                  onClick={() => rechargeClient(client, 30)}
                                  className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                  title="Recharge 30 Days"
                                >
                                  <RefreshCw className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => disconnectClient(client)}
                                  className="p-2 text-orange-600 hover:bg-orange-50 rounded-lg transition-colors"
                                  title="Disconnect"
                                >
                                  <PowerOff className="w-4 h-4" />
                                </button>
                                <button 
                                  onClick={() => { setEditingClient(client); setIsClientModalOpen(true); }}
                                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                {userProfile?.role === 'admin' && (
                                  <button 
                                    onClick={() => deleteClient(client.id)}
                                    className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {adminView === 'routers' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold text-slate-900">Network Routers</h3>
                  <button 
                    onClick={() => { setEditingRouter(null); setIsRouterModalOpen(true); }}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Add Router
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {routers.map(router => (
                    <div key={router.id} className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-all">
                      <div className="flex justify-between items-start mb-4">
                        <div className={`p-3 rounded-2xl ${router.status === 'online' ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                          <RouterIcon className="w-6 h-6" />
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => { setEditingRouter(router); setIsRouterModalOpen(true); }}
                            className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {userProfile?.role === 'admin' && (
                            <button 
                              onClick={async () => {
                                if (window.confirm("Delete router?")) await dataStore.remove('routers', router.id);
                              }}
                              className="p-2 text-slate-400 hover:text-red-600 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="mb-4">
                        <h4 className="text-lg font-bold text-slate-900">{router.name}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs font-medium text-slate-500">{router.model || 'MikroTik Router'}</span>
                          <span className="w-1 h-1 bg-slate-300 rounded-full"></span>
                          <span className="text-xs text-slate-400">{router.location}</span>
                        </div>
                      </div>

                      {router.isMikrotik && router.status === 'online' && (
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div className="p-3 bg-slate-50 rounded-2xl">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">CPU Usage</p>
                            <div className="flex items-center gap-2">
                              <Activity className="w-3 h-3 text-blue-500" />
                              <span className="text-sm font-bold text-slate-700">{router.cpu || Math.floor(Math.random() * 15) + 5}%</span>
                            </div>
                          </div>
                          <div className="p-3 bg-slate-50 rounded-2xl">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Memory</p>
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-3 h-3 text-purple-500" />
                              <span className="text-sm font-bold text-slate-700">{router.memory || Math.floor(Math.random() * 20) + 40}%</span>
                            </div>
                          </div>
                          <div className="p-3 bg-slate-50 rounded-2xl">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Temp</p>
                            <div className="flex items-center gap-2">
                              <Zap className="w-3 h-3 text-orange-500" />
                              <span className="text-sm font-bold text-slate-700">{router.temperature || Math.floor(Math.random() * 10) + 35}°C</span>
                            </div>
                          </div>
                          <div className="p-3 bg-slate-50 rounded-2xl">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Users</p>
                            <div className="flex items-center gap-2">
                              <Users className="w-3 h-3 text-green-500" />
                              <span className="text-sm font-bold text-slate-700">{router.clientsCount || clients.filter(c => c.routerId === router.id).length}</span>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                        <div className="flex flex-col">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">IP Address</span>
                          <span className="text-xs font-mono text-slate-600">{router.ipAddress}</span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</span>
                          <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-widest ${router.status === 'online' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {router.status}
                          </span>
                        </div>
                      </div>
                      
                      {router.uptime && (
                        <div className="mt-3 text-[10px] text-slate-400 text-center">
                          Uptime: <span className="font-mono text-slate-500">{router.uptime}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {adminView === 'transactions' && (
              <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Date</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Client</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Plan</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Amount</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Type</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {allTransactions.map(t => (
                        <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {format(new Date(t.date), 'MMM dd, HH:mm')}
                          </td>
                          <td className="px-6 py-4 text-sm font-bold text-slate-900">
                            {t.clientName}
                          </td>
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {t.planName}
                          </td>
                          <td className="px-6 py-4 text-sm font-black text-slate-900">
                            KES {t.amount}
                          </td>
                          <td className="px-6 py-4">
                            <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-widest">
                              {t.type}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.div>
        ) : view === 'subscriptions' ? (
          <motion.div
            key="subscriptions-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16"
          >
            <div className="mb-12">
              <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">My Subscriptions</h2>
              <p className="text-slate-500">Manage your active and past internet packages.</p>
            </div>

            <div className="space-y-6">
              {subscriptions.length === 0 ? (
                <div className="bg-white p-12 rounded-3xl border border-slate-100 text-center">
                  <div className="bg-slate-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <CreditCard className="w-8 h-8 text-slate-300" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-900">No subscriptions found</h3>
                  <p className="text-slate-500 mt-2 mb-6">You haven't purchased any internet packages yet.</p>
                  <button 
                    onClick={() => setView('plans')}
                    className="px-6 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all"
                  >
                    Browse Plans
                  </button>
                </div>
              ) : (
                subscriptions.map((sub) => {
                  const isActive = sub.status === 'active';
                  const expiryDate = new Date(sub.expiryDate);
                  const now = new Date();
                  const remainingMs = expiryDate.getTime() - now.getTime();
                  const remainingMins = Math.max(0, Math.floor(remainingMs / (1000 * 60)));
                  const remainingHours = Math.max(0, Math.floor(remainingMins / 60));
                  const remainingDays = Math.max(0, Math.floor(remainingHours / 24));
                  
                  let validityText = '';
                  if (isActive) {
                    if (remainingDays > 0) {
                      validityText = `${remainingDays} days remaining`;
                    } else if (remainingHours > 0) {
                      validityText = `${remainingHours} hours remaining`;
                    } else {
                      validityText = `${remainingMins} minutes remaining`;
                    }
                  } else {
                    validityText = 'Expired';
                  }

                  return (
                    <div 
                      key={sub.id}
                      className={`bg-white p-6 md:p-8 rounded-3xl border transition-all hover:shadow-lg ${isActive ? 'border-orange-200 shadow-sm' : 'border-slate-100 opacity-75'}`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-start gap-4">
                          <div className={`p-4 rounded-2xl ${isActive ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                            <Wifi className="w-6 h-6" />
                          </div>
                          <div>
                            <div className="flex items-center gap-3 mb-1">
                              <h3 className="text-xl font-bold text-slate-900">{sub.packageName}</h3>
                              <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${isActive ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-600'}`}>
                                {sub.status}
                              </span>
                            </div>
                            <p className="text-sm text-slate-500 font-medium">{sub.speed} • KES {sub.price}</p>
                            <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-400">
                              <div className="flex items-center gap-1.5">
                                <Clock className="w-3.5 h-3.5" />
                                Activated: {new Date(sub.activationDate).toLocaleDateString()}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Calendar className="w-3.5 h-3.5" />
                                Expires: {new Date(sub.expiryDate).toLocaleDateString()}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <div className={`text-right ${isActive ? 'text-orange-600' : 'text-slate-400'}`}>
                            <p className="text-xs font-bold uppercase tracking-wider mb-1">Validity</p>
                            <p className="text-xl font-black">{validityText}</p>
                          </div>
                          {isActive && (
                            <button className="mt-2 text-sm font-bold text-slate-900 underline underline-offset-4 hover:text-orange-600 transition-colors">
                              Extend Plan
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="history-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16"
          >
            <div className="mb-12">
              <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Payment History</h2>
              <p className="text-slate-500">View your past transactions and download receipts.</p>
            </div>

            <div className="bg-white rounded-3xl border border-slate-100 overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Date</th>
                      <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Package</th>
                      <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Transaction ID</th>
                      <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400">Amount</th>
                      <th className="px-6 py-4 text-xs font-black uppercase tracking-widest text-slate-400 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {payments.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-slate-500">
                          No payment history found.
                        </td>
                      </tr>
                    ) : (
                      payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 text-sm text-slate-600">
                            {new Date(payment.date).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4">
                            <p className="text-sm font-bold text-slate-900">{payment.packageName}</p>
                            <p className="text-[10px] text-slate-400">+254 {payment.phoneNumber}</p>
                          </td>
                          <td className="px-6 py-4 font-mono text-xs text-orange-600 font-bold">
                            {payment.transactionId}
                          </td>
                          <td className="px-6 py-4 text-sm font-black text-slate-900">
                            KES {payment.amount}
                          </td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => setSelectedPayment(payment)}
                              className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-orange-100 hover:text-orange-600 transition-all"
                            >
                              View Receipt
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="bg-slate-900 text-slate-400 py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center gap-2 mb-6">
                <div className="bg-orange-500 p-1.5 rounded-lg">
                  <Wifi className="text-white w-5 h-5" />
                </div>
                <span className="text-xl font-black tracking-tighter text-white">WEONLINE</span>
              </div>
              <p className="max-w-sm text-sm leading-relaxed">
                WeOnline is committed to providing high-speed, unlimited wireless internet 
                to communities across Kenya. We believe connectivity is a fundamental right.
              </p>
            </div>
            <div>
              <h5 className="text-white font-bold mb-6">Quick Links</h5>
              <ul className="space-y-4 text-sm">
                <li><a href="#" className="hover:text-orange-500 transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-orange-500 transition-colors">Coverage Map</a></li>
                <li><a href="#" className="hover:text-orange-500 transition-colors">Support Center</a></li>
                <li><a href="#" className="hover:text-orange-500 transition-colors">Terms of Service</a></li>
              </ul>
            </div>
            <div>
              <h5 className="text-white font-bold mb-6">Contact Us</h5>
              <ul className="space-y-4 text-sm">
                <li>Email: support@weonline.net</li>
                <li>Phone: +254 737 317 457</li>
                <li>Location: Nairobi, Kenya</li>
              </ul>
            </div>
          </div>
          <div className="pt-8 border-t border-slate-800 text-center text-xs">
            <p>&copy; {new Date().getFullYear()} WeOnline. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
