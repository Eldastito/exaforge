import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, Trash2, Edit3, Check, Clock, AlertCircle, ChevronLeft, ChevronRight, X, Save } from 'lucide-react';

type Priority = 'alta' | 'media' | 'baixa';
type Status = 'pendente' | 'confirmado' | 'aguardando_ok' | 'concluido' | 'cancelado';

interface AgendaEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  with: string;
  location?: string;
  priority: Priority;
  status: Status;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

const PRIORITY_STYLES: Record<Priority, { label: string; dot: string; badge: string }> = {
  alta:  { label: 'Alta',  dot: 'bg-red-500',    badge: 'bg-red-500/15 text-red-400 border-red-500/30' },
  media: { label: 'Média', dot: 'bg-amber-500',  badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  baixa: { label: 'Baixa', dot: 'bg-emerald-500',badge: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

const STATUS_STYLES: Record<Status, { label: string; color: string }> = {
  pendente:      { label: 'Pendente',       color: 'text-zinc-400' },
  confirmado:    { label: 'Confirmado ✅',  color: 'text-emerald-400' },
  aguardando_ok: { label: 'Aguardando OK ⏳', color: 'text-amber-400' },
  concluido:     { label: 'Concluído',      color: 'text-indigo-400' },
  cancelado:     { label: 'Cancelado ❌',   color: 'text-red-400' },
};

const EMPTY_FORM = {
  title: '', date: '', time: '', with: '',
  location: '', priority: 'media' as Priority, status: 'pendente' as Status, notes: '',
};

export function AgendaPanel() {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AgendaEvent | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(false);

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch('/api/agenda');
      if (res.ok) setEvents(await res.json());
    } catch { /* sem conexão ainda */ }
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  // Atualiza via WebSocket quando agenda muda
  useEffect(() => {
    const io = (window as any).__socket;
    if (!io) return;
    const handler = () => fetchEvents();
    io.on('agenda_updated', handler);
    return () => io.off('agenda_updated', handler);
  }, [fetchEvents]);

  // Eventos do dia selecionado
  const dayEvents = events
    .filter(e => e.date === selectedDate && e.status !== 'cancelado')
    .sort((a, b) => a.time.localeCompare(b.time));

  // Datas com eventos (para marcar no calendário)
  const datesWithEvents = new Set(events.filter(e => e.status !== 'cancelado').map(e => e.date));

  // ── Calendário ─────────────────────────────────────────────────────────────
  function getDaysInMonth(d: Date) {
    const year = d.getFullYear(), month = d.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const total = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = Array(firstDay).fill(null);
    for (let i = 1; i <= total; i++) days.push(i);
    return days;
  }

  function toDateStr(day: number) {
    const y = currentMonth.getFullYear();
    const m = String(currentMonth.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-${String(day).padStart(2, '0')}`;
  }

  const monthLabel = currentMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  // ── CRUD ───────────────────────────────────────────────────────────────────
  function openCreate() {
    setEditingEvent(null);
    setForm({ ...EMPTY_FORM, date: selectedDate });
    setShowModal(true);
  }

  function openEdit(ev: AgendaEvent) {
    setEditingEvent(ev);
    setForm({ title: ev.title, date: ev.date, time: ev.time, with: ev.with,
              location: ev.location || '', priority: ev.priority, status: ev.status, notes: ev.notes || '' });
    setShowModal(true);
  }

  async function handleSave() {
    if (!form.title || !form.date || !form.time) return;
    setLoading(true);
    try {
      const url = editingEvent ? `/api/agenda/${editingEvent.id}` : '/api/agenda';
      const method = editingEvent ? 'PATCH' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (res.ok) { await fetchEvents(); setShowModal(false); }
    } finally { setLoading(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remover este compromisso?')) return;
    await fetch(`/api/agenda/${id}`, { method: 'DELETE' });
    fetchEvents();
  }

  async function handleStatus(id: string, status: Status) {
    await fetch(`/api/agenda/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    fetchEvents();
  }

  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="flex-1 flex h-full bg-zinc-950 overflow-hidden">

      {/* ── Coluna esquerda: calendário + mini-stats ── */}
      <div className="w-80 flex-shrink-0 border-r border-zinc-800 flex flex-col bg-zinc-900/40">

        {/* Calendário */}
        <div className="p-5 border-b border-zinc-800">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() - 1))}
              className="p-1 hover:bg-zinc-800 rounded transition-colors">
              <ChevronLeft className="w-4 h-4 text-zinc-400" />
            </button>
            <span className="text-sm font-semibold text-zinc-200 capitalize">{monthLabel}</span>
            <button onClick={() => setCurrentMonth(m => new Date(m.getFullYear(), m.getMonth() + 1))}
              className="p-1 hover:bg-zinc-800 rounded transition-colors">
              <ChevronRight className="w-4 h-4 text-zinc-400" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {['D','S','T','Q','Q','S','S'].map((d, i) => (
              <div key={i} className="text-center text-[10px] font-medium text-zinc-600 py-1">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {getDaysInMonth(currentMonth).map((day, i) => {
              if (!day) return <div key={i} />;
              const ds = toDateStr(day);
              const isToday = ds === today;
              const isSelected = ds === selectedDate;
              const hasEv = datesWithEvents.has(ds);
              return (
                <button key={i} onClick={() => setSelectedDate(ds)}
                  className={`relative h-8 w-full rounded text-xs font-medium transition-all
                    ${isSelected ? 'bg-indigo-600 text-white' : isToday ? 'bg-indigo-600/20 text-indigo-400' : 'text-zinc-400 hover:bg-zinc-800'}`}>
                  {day}
                  {hasEv && !isSelected && (
                    <span className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-indigo-500" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Mini stats */}
        <div className="p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-zinc-600">Resumo</p>
          {[
            { label: 'Total de eventos', value: events.filter(e => e.status !== 'cancelado').length },
            { label: 'Alta prioridade', value: events.filter(e => e.priority === 'alta' && e.status !== 'cancelado').length },
            { label: 'Hoje', value: events.filter(e => e.date === today && e.status !== 'cancelado').length },
            { label: 'Aguardando OK', value: events.filter(e => e.status === 'aguardando_ok').length },
          ].map(s => (
            <div key={s.label} className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">{s.label}</span>
              <span className="text-sm font-bold text-zinc-200">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Coluna direita: lista de eventos ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/30">
          <div>
            <h2 className="text-lg font-bold text-zinc-100">
              {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </h2>
            <p className="text-xs text-zinc-500 mt-0.5">{dayEvents.length} compromisso(s)</p>
          </div>
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors shadow-lg shadow-indigo-600/20">
            <Plus className="w-4 h-4" /> Novo Compromisso
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {dayEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Calendar className="w-12 h-12 text-zinc-700 mb-3" />
              <p className="text-zinc-500 text-sm">Nenhum compromisso para este dia.</p>
              <button onClick={openCreate} className="mt-3 text-indigo-400 text-sm hover:text-indigo-300 transition-colors">
                + Adicionar compromisso
              </button>
            </div>
          ) : dayEvents.map(ev => (
            <div key={ev.id}
              className={`group bg-zinc-900/60 border rounded-xl p-4 transition-all hover:border-zinc-600
                ${ev.priority === 'alta' ? 'border-red-500/30 hover:border-red-500/50' :
                  ev.priority === 'media' ? 'border-amber-500/20 hover:border-amber-500/40' :
                  'border-zinc-800'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${PRIORITY_STYLES[ev.priority].dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-zinc-100 text-sm">{ev.title}</span>
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${PRIORITY_STYLES[ev.priority].badge}`}>
                        {PRIORITY_STYLES[ev.priority].label}
                      </span>
                    </div>
                    <div className="mt-1.5 space-y-0.5">
                      <p className="text-xs text-zinc-400 flex items-center gap-1.5">
                        <Clock className="w-3 h-3" />{ev.time}
                      </p>
                      <p className="text-xs text-zinc-400">👤 {ev.with}</p>
                      {ev.location && <p className="text-xs text-zinc-500">📍 {ev.location}</p>}
                      {ev.notes && <p className="text-xs text-zinc-600 italic mt-1">{ev.notes}</p>}
                    </div>
                    <p className={`text-[10px] mt-2 font-medium ${STATUS_STYLES[ev.status].color}`}>
                      {STATUS_STYLES[ev.status].label}
                    </p>
                  </div>
                </div>

                {/* Ações */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  {ev.status !== 'concluido' && (
                    <button onClick={() => handleStatus(ev.id, 'concluido')} title="Concluir"
                      className="p-1.5 hover:bg-emerald-500/20 text-zinc-500 hover:text-emerald-400 rounded-lg transition-colors">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => openEdit(ev)} title="Editar"
                    className="p-1.5 hover:bg-indigo-500/20 text-zinc-500 hover:text-indigo-400 rounded-lg transition-colors">
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(ev.id)} title="Remover"
                    className="p-1.5 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 rounded-lg transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Modal de criação/edição ── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold text-zinc-100">{editingEvent ? 'Editar Compromisso' : 'Novo Compromisso'}</h3>
              <button onClick={() => setShowModal(false)} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <FormField label="Título *">
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Ex: Reunião com Secretaria de Saúde"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Data *">
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors" />
                </FormField>
                <FormField label="Horário *">
                  <input type="time" value={form.time} onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors" />
                </FormField>
              </div>
              <FormField label="Com quem">
                <input value={form.with} onChange={e => setForm(f => ({ ...f, with: e.target.value }))}
                  placeholder="Nome ou organização"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors" />
              </FormField>
              <FormField label="Local">
                <input value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                  placeholder="Local do compromisso"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors" />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Prioridade">
                  <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors">
                    <option value="alta">🔴 Alta</option>
                    <option value="media">🟡 Média</option>
                    <option value="baixa">🟢 Baixa</option>
                  </select>
                </FormField>
                <FormField label="Status">
                  <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as Status }))}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors">
                    <option value="pendente">Pendente</option>
                    <option value="confirmado">Confirmado</option>
                    <option value="concluido">Concluído</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                </FormField>
              </div>
              <FormField label="Observações">
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2} placeholder="Anotações adicionais..."
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500 transition-colors resize-none" />
              </FormField>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 rounded-lg border border-zinc-700 text-zinc-400 text-sm hover:bg-zinc-800 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={loading || !form.title || !form.date || !form.time}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors">
                <Save className="w-4 h-4" />
                {loading ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
