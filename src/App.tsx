import React, { useEffect, useRef } from 'react';
import { Sidebar } from '@/src/features/Sidebar';
import { KanbanBoard } from '@/src/features/KanbanBoard';
import { ChatPanel } from '@/src/features/ChatPanel';
import { ChannelsPanel } from '@/src/features/ChannelsPanel';
import { DashboardPanel } from '@/src/features/DashboardPanel';
import { ContactsPanel } from '@/src/features/ContactsPanel';
import { AgendaPanel } from '@/src/features/AgendaPanel';
import { useStore } from '@/src/store/useStore';
import { Search } from 'lucide-react';
import io from 'socket.io-client';

export default function App() {
  const { viewMode } = useStore();
  // useRef para acessar receiveMessage sem adicionar como dependência do useEffect
  const receiveMessageRef = useRef(useStore.getState().receiveMessage);

  useEffect(() => {
    // Socket criado UMA vez — não recria em re-renders
    const socket = io(window.location.origin);

    socket.on('connect', () => {
      console.log('Conectado ao servidor via WebSocket', socket.id);
    });

    socket.on('new_message', (data: { contactId: string; contactName?: string; contactNumber?: string; provider: string; text: string; sender: string }) => {
      console.log('Recebido novo evento via WebSocket:', data);
      // Usa ref para não ter receiveMessage como dep do useEffect
      receiveMessageRef.current(data.contactId, data.text, data.sender as any, data.contactName, data.contactNumber);
    });

    return () => {
      socket.disconnect();
    };
  }, []); // <-- sem dependências: socket criado e destruído apenas no mount/unmount do App

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#09090b] text-foreground font-sans">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top Navbar */}
        <header className="flex h-16 items-center justify-between border-b border-zinc-800 bg-zinc-950/50 px-6 backdrop-blur-sm">
           <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
             {viewMode === 'kanban' && 'Atendimento'}
             {viewMode === 'channels' && 'Canais e IA'}
             {viewMode === 'dashboard' && 'Dashboard'}
             {viewMode === 'contacts' && 'Contatos'}
             {viewMode === 'agenda' && 'Agenda do Deputado'}
           </h1>
           <div className="flex items-center gap-4">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Buscar leads ou tags..."
                  className="h-9 w-[250px] rounded-md border border-zinc-800 bg-zinc-900 pl-9 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 transition-colors"
                />
              </div>
           </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 flex overflow-hidden">
          {/* Kanban e Chat: renderizados condicionalmente (sem estado de sessão crítico) */}
          {viewMode === 'kanban' && (
            <>
              <KanbanBoard />
              <ChatPanel />
            </>
          )}
          {viewMode === 'dashboard' && <DashboardPanel />}
          {viewMode === 'contacts' && <ContactsPanel />}
          {viewMode === 'agenda' && <AgendaPanel />}

          {/*
            ChannelsPanel: SEMPRE montado para preservar estado do QR Code / conexão WA.
            Visibilidade controlada por CSS — não desmonta ao navegar para outras abas.
          */}
          <div
            className="flex-1 flex overflow-hidden"
            style={{ display: viewMode === 'channels' ? 'flex' : 'none' }}
          >
            <ChannelsPanel />
          </div>
        </main>
      </div>
    </div>
  );
}
