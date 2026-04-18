import React, { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api } from './lib/api.js';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Devices from './pages/Devices.jsx';
import Tasks from './pages/Tasks.jsx';
import Chat from './pages/Chat.jsx';
import Settings from './pages/Settings.jsx';
import Docs from './pages/Docs.jsx';

const ToastContext = createContext();
export const useToast = () => useContext(ToastContext);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('noc_token');
    if (!token) { setAuthed(false); return; }
    api.verify().then(() => setAuthed(true)).catch(() => {
      localStorage.removeItem('noc_token');
      setAuthed(false);
    });
  }, []);

  if (authed === null) {
    return <div className="loading-screen"><div className="spinner" /> Carregando...</div>;
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          {!authed ? (
            <>
              <Route path="/login" element={<Login onLogin={() => setAuthed(true)} />} />
              <Route path="*" element={<Navigate to="/login" replace />} />
            </>
          ) : (
            <Route element={<Layout onLogout={() => { localStorage.removeItem('noc_token'); setAuthed(false); }} />}>
              <Route index element={<Dashboard />} />
              <Route path="devices" element={<Devices />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="chat" element={<Chat />} />
              <Route path="settings" element={<Settings />} />
              <Route path="docs" element={<Docs />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          )}
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
