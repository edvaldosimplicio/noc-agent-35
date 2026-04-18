import { useState, useEffect } from 'react';
import { ListTodo, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../lib/api.js';
import { StatusBadge, PriorityBadge } from '../components/StatusBadge.jsx';

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', source: '', priority: '' });
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    setLoading(true);
    const p = {};
    if (filter.status) p.status = filter.status;
    if (filter.source) p.source = filter.source;
    if (filter.priority) p.priority = filter.priority;
    api.getTasks(p).then(r => setTasks(r.data)).catch(() => {}).finally(() => setLoading(false));
  }, [filter]);

  return (
    <div>
      <div className="page-header"><h2>Tasks</h2><p>Histórico de diagnósticos e ações</p></div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <select className="form-select" style={{ width: 150 }} value={filter.status} onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
            <option value="">Todos Status</option>
            <option value="pending">Pendente</option><option value="diagnosing">Diagnosticando</option>
            <option value="awaiting_approval">Aguardando</option><option value="completed">Concluído</option>
            <option value="failed">Falhou</option><option value="cancelled">Cancelado</option>
          </select>
          <select className="form-select" style={{ width: 130 }} value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}>
            <option value="">Todas Fontes</option><option value="whatsapp">WhatsApp</option>
            <option value="zabbix">Zabbix</option><option value="dashboard">Dashboard</option>
          </select>
        </div>
      </div>
      {loading ? <div className="loading-screen" style={{ minHeight: 200 }}><div className="spinner" /></div> :
      tasks.length === 0 ? <div className="card"><div className="empty-state"><ListTodo size={48} /><p>Nenhuma task encontrada.</p></div></div> :
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map(t => (
          <div key={t.id} className="card" style={{ cursor: 'pointer', padding: 0 }} onClick={() => setExpanded(expanded === t.id ? null : t.id)}>
            <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--primary)', fontWeight: 700, minWidth: 60 }}>#{t.taskNumber}</span>
              <StatusBadge status={t.status} /><PriorityBadge priority={t.priority} />
              <span className={`badge ${t.source === 'zabbix' ? 'badge-warning' : 'badge-success'}`}>{t.source}</span>
              <span style={{ color: 'var(--text-secondary)', flex: 1, fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.device?.name || t.originalMessage?.substring(0, 50)}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{new Date(t.createdAt).toLocaleString('pt-BR')}</span>
              {expanded === t.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            {expanded === t.id && (
              <div style={{ padding: '0 20px 20px', borderTop: '1px solid var(--border-primary)' }}>
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>MENSAGEM</div>
                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 12, borderRadius: 8 }}>{t.originalMessage}</pre>
                </div>
                {t.diagnosis && <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>DIAGNÓSTICO</div>
                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 12, borderRadius: 8 }}>{t.diagnosis}</pre>
                </div>}
                {t.executionResult && <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 600, marginBottom: 4 }}>RESULTADO</div>
                  <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: 'var(--bg-primary)', padding: 12, borderRadius: 8, color: 'var(--success)' }}>{t.executionResult}</pre>
                </div>}
              </div>
            )}
          </div>
        ))}
      </div>}
    </div>
  );
}
