import { Users, Search, Phone, MoreVertical, MessageCircle, Clock } from 'lucide-react';
import { useStore } from '@/src/store/useStore';
import { formatDistanceToNow, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function ContactsPanel() {
  const { contacts } = useStore();
  const contactList = Object.values(contacts).sort((a, b) => {
    return new Date(b.lastInteractionAt || 0).getTime() - new Date(a.lastInteractionAt || 0).getTime();
  });

  return (
    <div className="flex flex-col h-full bg-slate-950">
      <div className="flex items-center justify-between p-6 border-b border-slate-800 bg-slate-900/20">
        <div>
          <h2 className="text-2xl font-bold text-slate-100">Contatos</h2>
          <p className="text-slate-400 text-sm mt-1">Gerencie sua base de eleitores e contatos.</p>
        </div>
        <div className="flex gap-3">
           <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input 
                type="text" 
                placeholder="Buscar contatos..." 
                className="pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 transition-colors w-64"
              />
           </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-slate-900/30 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/50 text-slate-400 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-4">Nome / Eleitor</th>
                <th className="px-6 py-4">Telefone</th>
                <th className="px-6 py-4">Status / Tags</th>
                <th className="px-6 py-4">Última Interação</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {contactList.length > 0 ? contactList.map(contact => (
                <tr key={contact.id} className="hover:bg-slate-800/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold">
                        {contact.name.charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{contact.name}</p>
                        <p className="text-[10px] text-slate-500 uppercase tracking-tight">WhatsApp Web</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-sm text-slate-300">
                      <Phone className="w-3.5 h-3.5 text-slate-500" />
                      {contact.number}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase">
                      Eleitor Ativo
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-400">
                    <div className="flex flex-col">
                       <span>{contact.lastInteractionAt ? format(new Date(contact.lastInteractionAt), "dd/MM 'às' HH:mm") : '--'}</span>
                       {contact.lastInteractionAt && (
                         <span className="text-[10px] text-slate-500">
                           {formatDistanceToNow(new Date(contact.lastInteractionAt), { addSuffix: true, locale: ptBR })}
                         </span>
                       )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                       <button className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-indigo-400">
                         <MessageCircle className="w-4 h-4" />
                       </button>
                       <button className="p-2 hover:bg-slate-700 rounded-lg text-slate-400">
                         <MoreVertical className="w-4 h-4" />
                       </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Users className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-400">Nenhum contato encontrado na sua base.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
