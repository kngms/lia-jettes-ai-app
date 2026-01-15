import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Link, useLocation, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, signInWithGoogle, logoutUser } from './src/services/firebase';

import WritingAssistant from './components/WritingAssistant';
import ChatSearch from './components/ChatSearch';
import ImageStudio from './components/ImageStudio';
import { ExcelAssistant } from './components/ExcelAssistant';
import KnowledgeBase from './components/KnowledgeBase';
import AudioLab from './components/AudioLab';
import RelationshipPlanner from './components/RelationshipPlanner';
import Settings from './components/Settings';
import LandingPage from './components/LandingPage';
import { PenTool, MessageSquare, Image, Mic2, Heart, Settings as SettingsIcon, Table, LogOut, Book } from 'lucide-react';

const Navigation = ({ isDyslexic, user, onLogout }: { isDyslexic: boolean; user: User; onLogout: () => void }) => {
  const location = useLocation();
  const navItems = [
    { path: '/', label: 'Assistant', icon: <PenTool size={20} /> },
    { path: '/planner', label: 'Connect', icon: <Heart size={20} /> },
    { path: '/chat', label: 'Research', icon: <MessageSquare size={20} /> },
    { path: '/excel', label: 'Excel Helper', icon: <Table size={20} /> },
    { path: '/images', label: 'Studio', icon: <Image size={20} /> },
    { path: '/audio', label: 'Voice Lab', icon: <Mic2 size={20} /> },
    { path: '/knowledge', label: 'Library', icon: <Book size={20} /> },
    { path: '/settings', label: 'Settings', icon: <SettingsIcon size={20} /> },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex justify-around md:relative md:border-t-0 md:border-r md:w-64 md:flex-col md:justify-start md:gap-4 md:py-8 z-50">
      <div className="hidden md:block mb-8 px-4">
        <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
          Lia- Jette's AI
        </h1>
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Personal Workspace</p>
      </div>

      <div className="flex flex-row md:flex-col gap-1 md:gap-4 w-full overflow-x-auto md:overflow-x-visible pb-2 md:pb-0 scrollbar-hide">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center md:flex-row md:gap-3 p-2 md:px-4 md:py-3 rounded-xl transition-all flex-shrink-0 md:flex-shrink ${
                isActive 
                  ? 'text-indigo-600 md:bg-indigo-50 font-medium' 
                  : 'text-slate-500 hover:text-indigo-500 hover:bg-slate-50'
              }`}
            >
              {item.icon}
              <span className={`text-[10px] md:text-sm mt-1 md:mt-0 ${isDyslexic ? 'font-bold tracking-wide' : ''}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
      
      <div className="hidden md:block mt-auto px-4">
        <div className="mb-4 p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center gap-3">
            {user.photoURL ? (
                <img src={user.photoURL} alt="User" className="w-8 h-8 rounded-full" />
            ) : (
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">
                    {user.displayName?.[0] || 'U'}
                </div>
            )}
            <div className="overflow-hidden">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Active User</p>
                <p className="text-xs font-bold text-slate-700 truncate">{user.displayName}</p>
            </div>
        </div>
        <button 
          onClick={onLogout}
          className="flex items-center gap-3 p-3 rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all w-full text-left"
        >
          <LogOut size={18} />
          <span className="text-sm font-medium">Sign Out</span>
        </button>
      </div>
    </nav>
  );
};

const App: React.FC = () => {
  const [isDyslexic, setIsDyslexic] = useState(() => localStorage.getItem('dyslexicMode') === 'true');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    localStorage.setItem('dyslexicMode', String(isDyslexic));
    if (isDyslexic) {
      document.body.classList.add('dyslexic-mode');
    } else {
      document.body.classList.remove('dyslexic-mode');
    }
  }, [isDyslexic]);

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error) {
      alert("Login failed");
    }
  };

  const handleLogout = async () => {
    await logoutUser();
  };

  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  if (!user) {
    return <LandingPage onLogin={handleLogin} />; 
  }

  return (
    <HashRouter>
      <div className="flex flex-col md:flex-row min-h-screen">
        <Navigation isDyslexic={isDyslexic} user={user} onLogout={handleLogout} />
        
        <main className="flex-1 pb-20 md:pb-0 h-screen overflow-y-auto bg-slate-50/50">
          <div className="max-w-5xl mx-auto p-4 md:p-8">
            <Routes>
              <Route path="/" element={<WritingAssistant />} />
              <Route path="/planner" element={<RelationshipPlanner />} />
              <Route path="/knowledge" element={<KnowledgeBase />} />
              <Route path="/excel" element={<ExcelAssistant />} />
              <Route path="/audio" element={<AudioLab />} />
              <Route path="/chat" element={<ChatSearch />} />
              <Route path="/images" element={<ImageStudio />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </HashRouter>
  );
};

export default App;
