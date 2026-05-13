import React from 'react';
import { useStore } from '@/src/store/useStore';
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd';
import { Badge } from '@/src/components/ui/badge';
import { Clock, MessageCircle, User, Trash2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function KanbanBoard() {
  const { stages, tickets, contacts, messages, moveTicket, setActiveTicket, activeTicketId, deleteTicket } = useStore();

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    
    const { source, destination, draggableId } = result;
    
    if (source.droppableId !== destination.droppableId) {
      moveTicket(draggableId, destination.droppableId as any);
    }
  };

  const getTicketsForStage = (stageId: string) => {
    return Object.values(tickets)
      .filter(t => t.stage === stageId)
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  };

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden p-6">
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex h-full items-start gap-6">
          {stages.map((stage) => {
            const stageTickets = getTicketsForStage(stage.id);
            return (
              <div key={stage.id} className="flex h-full w-[350px] min-w-[350px] flex-col rounded-xl bg-zinc-900/50 border border-zinc-800">
                <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                  <h3 className="font-semibold text-zinc-100">{stage.title}</h3>
                  <Badge variant="secondary" className="bg-zinc-800 text-zinc-400">
                    {stageTickets.length}
                  </Badge>
                </div>
                
                <Droppable droppableId={stage.id}>
                  {(provided, snapshot) => (
                    <div
                      {...provided.droppableProps}
                      ref={provided.innerRef}
                      className={`flex-1 overflow-y-auto p-3 transition-colors ${snapshot.isDraggingOver ? 'bg-zinc-800/30' : ''}`}
                    >
                      {stageTickets.map((ticket, index) => {
                        const contact = contacts[ticket.contactId];
                        const ticketMessages = messages[ticket.id] || [];
                        const lastMsg = ticketMessages[ticketMessages.length - 1];

                        return (
                          // @ts-expect-error React 18+ types issue with hello-pangea/dnd
                          <Draggable key={ticket.id} draggableId={ticket.id} index={index}>
                            {(provided, snapshot) => {
                              // Busca a última mensagem do CONTATO para o preview, ignorando a da IA se houver
                              const contactMsgs = ticketMessages.filter(m => m.sender === 'contact');
                              const previewMsg = contactMsgs.length > 0 ? contactMsgs[contactMsgs.length - 1] : lastMsg;

                              return (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  onClick={() => setActiveTicket(ticket.id)}
                                  className={`group relative mb-4 flex flex-col gap-4 rounded-xl border p-4 shadow-xl transition-all cursor-pointer
                                    ${activeTicketId === ticket.id ? 'border-indigo-500 bg-zinc-900' : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'}
                                    ${snapshot.isDragging ? 'rotate-1 scale-105 shadow-2xl ring-2 ring-indigo-500 bg-zinc-900 z-50' : ''}`}
                                >
                                  {/* Badge de Não Lidas - Canto Superior Direito */}
                                  {ticket.unreadCount > 0 && (
                                    <div className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white shadow-lg border-2 border-zinc-950 z-10">
                                      {ticket.unreadCount}
                                    </div>
                                  )}

                                  {/* Botão Excluir - aparece no hover */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (confirm(`Excluir ticket de ${contact?.name || 'este contato'}?`)) {
                                        deleteTicket(ticket.id);
                                      }
                                    }}
                                    className="absolute top-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-red-500/20 text-zinc-600 hover:text-red-400 z-10"
                                    title="Excluir ticket"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                  
                                  {/* Cabeçalho do Card: Avatar, Nome, Tel e Prioridade */}
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                      {contact.avatar ? (
                                        <img src={contact.avatar} alt={contact.name} className="h-12 w-12 rounded-full border-2 border-zinc-800 object-cover" />
                                      ) : (
                                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 border-2 border-zinc-700">
                                          <User className="h-6 w-6 text-zinc-500" />
                                        </div>
                                      )}
                                      <div className="flex flex-col">
                                        <h4 className="text-[15px] font-bold text-zinc-100 tracking-tight">{contact.name}</h4>
                                        <span className="text-[13px] text-zinc-500 font-medium">
                                          {contact.number || 'Sem telefone'}
                                        </span>
                                      </div>
                                    </div>
                                    
                                    <div className="flex flex-col items-end">
                                       <Badge variant="outline" className={`rounded-full px-3 py-0.5 text-[10px] font-bold uppercase tracking-wider
                                          ${ticket.priority === 'alta' ? 'border-red-500 text-red-500 bg-red-500/5' : 
                                            ticket.priority === 'media' ? 'border-amber-500 text-amber-500 bg-amber-500/5' : 
                                            'border-indigo-500 text-indigo-500 bg-indigo-500/5'}
                                       `}>
                                          {ticket.priority === 'media' ? 'Media' : 
                                           ticket.priority === 'alta' ? 'Alta' : 'Baixa'}
                                       </Badge>
                                    </div>
                                  </div>
                                  
                                  {/* Preview da Mensagem (Focado no Eleitor) */}
                                  <div className="mt-1">
                                    <p className="line-clamp-2 text-[14px] text-zinc-400 leading-relaxed">
                                      {previewMsg ? previewMsg.text : 'Nenhuma interação registrada'}
                                    </p>
                                  </div>
                                  
                                  {/* Rodapé: Tempo e Rótulo */}
                                  <div className="flex items-center justify-between mt-1">
                                    <div className="flex items-center gap-2 text-zinc-500">
                                      <Clock className="h-4 w-4" />
                                      <span className="text-[12px]">
                                        {formatDistanceToNow(new Date(ticket.lastMessageAt), { addSuffix: false, locale: ptBR })}
                                      </span>
                                    </div>
                                    <div className="flex items-center">
                                       <span className="text-[12px] font-bold text-emerald-500/90 tracking-wide">Eleitor(a)</span>
                                    </div>
                                  </div>
                                </div>
                              );
                            }}
                          </Draggable>
                        );
                      })}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            );
          })}
        </div>
      </DragDropContext>
    </div>
  );
}
