import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Contact = {
  id: string;
  name: string;
  number: string;
  avatar?: string;
};

export type Message = {
  id: string;
  contactId: string;
  text: string;
  sender: 'human' | 'bot' | 'contact';
  timestamp: string;
  read?: boolean;
};

export type Stage = 'novo_lead' | 'em_atendimento' | 'proposta' | 'fechado';

export type Ticket = {
  id: string;
  contactId: string;
  stage: Stage;
  priority: 'baixa' | 'media' | 'alta';
  lastMessageAt: string;
  unreadCount: number;
};

export type ViewMode = 'kanban' | 'channels' | 'dashboard';

export type ChannelInfo = {
  id: string;
  provider: 'whatsapp' | 'instagram';
  name: string;
  identifier: string; // phone number ou @handle
  status: 'connected' | 'disconnected' | 'configured';
  isActiveAI: boolean;
  // Credenciais reais (persistidas no localStorage)
  token?: string;
  phoneNumberId?: string; // WA Business
  wabaId?: string;        // WA Business
  pageId?: string;        // Instagram
};

export type RagDocument = {
  id: string;
  name: string;
  size: string;
  status: 'processing' | 'ready' | 'error';
  channelId: string | 'global';
  uploadDate: string;
};

type AppState = {
  viewMode: ViewMode;
  contacts: Record<string, Contact>;
  tickets: Record<string, Ticket>;
  messages: Record<string, Message[]>;
  stages: { id: Stage; title: string }[];
  activeTicketId: string | null;
  channels: ChannelInfo[];
  ragDocuments: RagDocument[];
  
  setViewMode: (mode: ViewMode) => void;
  setActiveTicket: (id: string | null) => void;
  moveTicket: (ticketId: string, destStage: Stage) => void;
  sendMessage: (ticketId: string, text: string, sender?: 'human' | 'bot') => void;
  receiveMessage: (contactId: string, text: string, sender?: 'contact' | 'bot' | 'human', contactName?: string) => void;
  connectInstagram: () => void;
  configureChannel: (channelId: string, data: Partial<ChannelInfo>) => void;
  addRagDocument: (doc: Omit<RagDocument, 'id' | 'status' | 'uploadDate'>) => void;
};

const initialContacts: Record<string, Contact> = {
  c1: { id: 'c1', name: 'João Silva', number: '+55 11 99999-1111', avatar: 'https://i.pravatar.cc/150?u=c1' },
  c2: { id: 'c2', name: 'Maria Souza', number: '+55 11 99999-2222', avatar: 'https://i.pravatar.cc/150?u=c2' },
  c3: { id: 'c3', name: 'Empresa XYZ', number: '+55 11 99999-3333', avatar: 'https://i.pravatar.cc/150?u=c3' },
};

const initialTickets: Record<string, Ticket> = {
  t1: { id: 't1', contactId: 'c1', stage: 'novo_lead', priority: 'media', lastMessageAt: new Date().toISOString(), unreadCount: 1 },
  t2: { id: 't2', contactId: 'c2', stage: 'em_atendimento', priority: 'alta', lastMessageAt: new Date(Date.now() - 3600000).toISOString(), unreadCount: 0 },
  t3: { id: 't3', contactId: 'c3', stage: 'proposta', priority: 'baixa', lastMessageAt: new Date(Date.now() - 86400000).toISOString(), unreadCount: 0 },
};

const initialMessages: Record<string, Message[]> = {
  t1: [
    { id: 'm1', contactId: 'c1', text: 'Olá, gostaria de saber mais sobre o sistema omni.', sender: 'contact', timestamp: new Date().toISOString() }
  ],
  t2: [
    { id: 'm2', contactId: 'c2', text: 'Boa tarde, qual o valor da licença?', sender: 'contact', timestamp: new Date(Date.now() - 7200000).toISOString() },
    { id: 'm3', contactId: 'c2', text: 'Olá Maria! Nosso plano inicial custa R$ 199/mês.', sender: 'bot', timestamp: new Date(Date.now() - 7000000).toISOString() },
    { id: 'm4', contactId: 'c2', text: 'Perfeito, me manda o link por favor.', sender: 'contact', timestamp: new Date(Date.now() - 3600000).toISOString() },
  ],
  t3: [
    { id: 'm5', contactId: 'c3', text: 'Vocês fazem integração com ERP?', sender: 'contact', timestamp: new Date(Date.now() - 86400000).toISOString() }
  ]
};

// Channels iniciam como 'disconnected' — sem dados hardcoded/fake
const initialChannels: ChannelInfo[] = [
  { id: 'ch_wa_business', provider: 'whatsapp', name: 'WhatsApp Business', identifier: '', status: 'disconnected', isActiveAI: true },
  { id: 'ch_instagram', provider: 'instagram', name: 'Instagram Direct', identifier: '', status: 'disconnected', isActiveAI: true },
];

const initialRagDocuments: RagDocument[] = [
  { id: 'doc1', name: 'tabela_precos_2024.pdf', size: '1.2 MB', status: 'ready', channelId: 'global', uploadDate: new Date().toISOString() },
];

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
  viewMode: 'kanban',
  contacts: initialContacts,
  tickets: initialTickets,
  messages: initialMessages,
  channels: initialChannels,
  ragDocuments: initialRagDocuments,
  stages: [
    { id: 'novo_lead', title: 'Novo Lead' },
    { id: 'em_atendimento', title: 'Em Atendimento' },
    { id: 'proposta', title: 'Proposta Enviada' },
    { id: 'fechado', title: 'Fechado' },
  ],
  activeTicketId: null,

  setViewMode: (mode) => set({ viewMode: mode }),
  setActiveTicket: (id) => set({ activeTicketId: id }),

  connectInstagram: () => {},  // Mantido por compatibilidade — use configureChannel

  configureChannel: (channelId, data) => set((state) => ({
    channels: state.channels.map(ch =>
      ch.id === channelId ? { ...ch, ...data } : ch
    )
  })),

  addRagDocument: (doc) => set((state) => {
    const newDoc: RagDocument = {
      ...doc,
      id: `doc_${Date.now()}`,
      status: 'processing',
      uploadDate: new Date().toISOString()
    };
    
    // Simulate processing time
    setTimeout(() => {
      set((s) => ({
        ragDocuments: s.ragDocuments.map(d => 
          d.id === newDoc.id ? { ...d, status: 'ready' } : d
        )
      }));
    }, 3000);

    return { ragDocuments: [...state.ragDocuments, newDoc] };
  }),

  moveTicket: (ticketId, destStage) => set((state) => ({
    tickets: {
      ...state.tickets,
      [ticketId]: { ...state.tickets[ticketId], stage: destStage }
    }
  })),

  sendMessage: (ticketId, text, sender = 'human') => set((state) => {
    const ticket = state.tickets[ticketId];
    if (!ticket) return state;

    const newMessage: Message = {
      id: Date.now().toString(),
      contactId: ticket.contactId,
      text,
      sender,
      timestamp: new Date().toISOString()
    };

    return {
      messages: {
        ...state.messages,
        [ticketId]: [...(state.messages[ticketId] || []), newMessage]
      },
      tickets: {
        ...state.tickets,
        [ticketId]: { ...ticket, lastMessageAt: newMessage.timestamp, unreadCount: 0 }
      }
    };
  }),

  receiveMessage: (contactId, text, sender = 'contact', contactName) => set((state) => {
    // Check if contact exists, if not create it
    let newContacts = { ...state.contacts };
    if (!newContacts[contactId]) {
      newContacts[contactId] = {
        id: contactId,
        name: contactName || `Contato ${contactId.slice(0, 4)}`,
        number: contactId,
      };
    } else if (contactName && newContacts[contactId].name.startsWith('Contato ')) {
      // Atualiza o nome se antes era o padrão genérico
      newContacts[contactId].name = contactName;
    }

    // Find open ticket for contact
    let ticketId = Object.keys(state.tickets).find(id => state.tickets[id].contactId === contactId);
    let newTickets = { ...state.tickets };
    
    // Create new ticket if none exists
    if (!ticketId) {
      ticketId = `t_${Date.now()}`;
      newTickets[ticketId] = {
        id: ticketId,
        contactId,
        stage: 'novo_lead',
        priority: 'media',
        lastMessageAt: new Date().toISOString(),
        unreadCount: sender === 'contact' ? 1 : 0
      };
    } else {
      newTickets[ticketId].lastMessageAt = new Date().toISOString();
      if (state.activeTicketId !== ticketId && sender === 'contact') {
        newTickets[ticketId].unreadCount += 1;
      }
    }

    const newMessage: Message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      contactId,
      text,
      sender: sender as 'contact' | 'bot' | 'human',
      timestamp: new Date().toISOString()
    };

    return {
      contacts: newContacts,
      tickets: newTickets,
      messages: {
        ...state.messages,
        [ticketId]: [...(state.messages[ticketId] || []), newMessage]
      }
    };
  }),
}),
    {
      name: 'exaforge-ui-state',
      // Persiste apenas viewMode e activeTicketId (dados de negócio ficam em memória/server)
      partialize: (state) => ({
        viewMode: state.viewMode,
        activeTicketId: state.activeTicketId,
        // Persiste channels para salvar credenciais configuradas (token, etc.)
        channels: state.channels,
      }),
    }
  )
);
