import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '@/src/store/useStore';
import { Smartphone, Instagram, AlertCircle, CheckCircle2, RefreshCw, UploadCloud, BrainCircuit, FileText, Loader2, Check, X, QrCode, Settings } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { Badge } from '@/src/components/ui/badge';
import { format } from 'date-fns';
import io from 'socket.io-client';
import { ChannelConfigModal } from '@/src/components/ChannelConfigModal';

export type ViewMode = 'kanban' | 'channels' | 'dashboard' | 'contacts';

export function ChannelsPanel() {
  const { channels, connectInstagram, ragDocuments, addRagDocument, configureChannel } = useStore();
  const [isConnecting, setIsConnecting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [configModalChannel, setConfigModalChannel] = useState<string | null>(null);
  
  // WA Web State
  const [waWebStatus, setWaWebStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [waWebQr, setWaWebQr] = useState<string | null>(null);
  const [waWebError, setWaWebError] = useState<string | null>(null);
  const socketRef = useRef<any>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io();
    }
    const socket = socketRef.current;

    const handleWaStatus = (data: { status: any; message?: string }) => {
      if (data.status === 'error') {
        setWaWebStatus('error');
        setWaWebError(data.message || 'Erro desconhecido');
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
      } else {
        setWaWebStatus(data.status);
        setWaWebError(null);
        if (data.status !== 'connecting' && connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
      }
      if (data.status !== 'connecting') setWaWebQr(null);
    };
    const handleWaQr = (data: { qrUrl: string }) => {
      setWaWebQr(data.qrUrl);
      setWaWebStatus('connecting');
      // QR recebido — cancela timeout de segurança do frontend
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
    };

    socket.on('wa_web_status', handleWaStatus);
    socket.on('wa_web_qr', handleWaQr);

    // Busca status inicial — trata 500 (ex: puppeteer não disponível) graciosamente
    fetch('/api/wa-web/status')
      .then(r => r.ok ? r.json() : { status: 'disconnected', qrUrl: null })
      .then(data => {
        setWaWebStatus(data.status || 'disconnected');
        setWaWebQr(data.qrUrl || null);
      })
      .catch(() => setWaWebStatus('disconnected'));

    return () => {
      socket.off('wa_web_status', handleWaStatus);
      socket.off('wa_web_qr', handleWaQr);
    };
  }, []);

  const handleConnectWaWeb = async () => {
    setWaWebStatus('connecting');
    setWaWebError(null);
    setWaWebQr(null);

    // Timeout de segurança no frontend: 65s (servidor tem 60s)
    connectTimeoutRef.current = setTimeout(() => {
      if (waWebStatus !== 'connected') {
        setWaWebStatus('error');
        setWaWebError('Tempo esgotado. O Chrome/Puppeteer pode não estar disponível neste ambiente.');
      }
    }, 65_000);

    try {
      const response = await fetch('/api/wa-web/connect', { method: 'POST' });
      // Verifica HTTP status ANTES de aguardar evento WebSocket
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const msg = data.error || `Erro ${response.status} ao iniciar WhatsApp Web.`;
        console.error('[WA Web Connect]', msg);
        setWaWebStatus('error');
        setWaWebError(msg);
        if (connectTimeoutRef.current) {
          clearTimeout(connectTimeoutRef.current);
          connectTimeoutRef.current = null;
        }
      }
      // Se response.ok, aguarda evento WebSocket 'wa_web_qr' ou 'wa_web_status'
    } catch (e) {
      console.error(e);
      setWaWebStatus('error');
      setWaWebError('Erro de rede ao conectar.');
      if (connectTimeoutRef.current) {
        clearTimeout(connectTimeoutRef.current);
        connectTimeoutRef.current = null;
      }
    }
  };

  const handleDisconnectWaWeb = async () => {
     try {
       await fetch('/api/wa-web/disconnect', { method: 'POST' });
       setWaWebStatus('disconnected');
     } catch(e) {
       console.error(e);
     }
  };

  const whatsapp = channels.find(c => c.provider === 'whatsapp');
  const instagram = channels.find(c => c.provider === 'instagram');

  const handleConnectInstagram = () => {
    setIsConnecting(true);
    connectInstagram();
    // Reset loading state after store simulate is done (1.5s)
    setTimeout(() => setIsConnecting(false), 1600);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // First add UI optimistic
      addRagDocument({
        name: file.name,
        size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        channelId: 'global'
      });

      // Then do real upload
      const formData = new FormData();
      formData.append('document', file);
      formData.append('channelId', 'global');

      try {
        const response = await fetch('/api/rag/upload', {
          method: 'POST',
          body: formData,
        });
        const data = await response.json();
        console.log('RAG Upload response:', data);
      } catch (error) {
        console.error('RAG Upload failed:', error);
      }
    }
  };

  const handleSimulateWebhook = async () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "1029384756102",
          changes: [
            {
              value: {
                messages: [
                  {
                    from: "5511999999999",
                    text: {
                      body: "Olá, gostaria de saber os preços por favor."
                    }
                  }
                ]
              }
            }
          ]
        }
      ]
    };

    try {
      await fetch('/api/webhooks/meta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      console.log('Webhook simulado finalizado.');
    } catch (error) {
      console.error('Erro ao simular webhook', error);
    }
  };

  return (
    <>
    <div className="flex-1 overflow-y-auto custom-scroll p-6 bg-background text-foreground">
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Cabecalho */}
        <div className="flex justify-between items-center mb-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-white mb-2">Canais e Automação</h2>
            <p className="text-sm text-slate-400">Conecte suas contas do Meta e gerencie o comportamento da IA (RAG) para cada canal.</p>
          </div>
          <Button onClick={handleSimulateWebhook} variant="outline" className="border-indigo-500/50 text-indigo-400 hover:bg-indigo-500/10">
            Simular Mensagem WhatsApp
          </Button>
        </div>

        {/* Status de Conexoes */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Card WhatsApp Web */}
          <div className="flex flex-col rounded-xl border border-indigo-800/50 bg-slate-900/50 p-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5">
              <QrCode className="w-32 h-32 text-indigo-400" />
            </div>
            
            <div className="flex items-center justify-between mb-6 relative z-10">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
                  <Smartphone className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">WA Web (Pessoal)</h3>
                  <p className="text-xs text-slate-400">Via QR Code (Sem Custos via Meta)</p>
                </div>
              </div>
              {waWebStatus === 'connected' ? (
                <Badge variant="outline" className="border-indigo-500/30 text-indigo-400 bg-indigo-500/10">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Conectado
                </Badge>
              ) : waWebStatus === 'connecting' ? (
               <Badge variant="outline" className="border-amber-500/30 text-amber-400 bg-amber-500/10">
                 <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                 Conectando
               </Badge>
              ) : waWebStatus === 'error' ? (
               <Badge variant="outline" className="border-red-500/30 text-red-400 bg-red-500/10">
                 <AlertCircle className="w-3 h-3 mr-1" />
                 Erro
               </Badge>
              ) : (
                <Badge variant="outline" className="border-slate-700 text-slate-400 bg-slate-800/50">
                  Desconectado
                </Badge>
              )}
            </div>

            <div className="space-y-4 relative z-10 flex-1 flex flex-col justify-center items-center py-4">
               {waWebStatus === 'connected' ? (
                 <div className="text-center w-full">
                    <CheckCircle2 className="w-12 h-12 text-indigo-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-slate-200">Dispositivo Vinculado</p>
                    <p className="text-xs text-slate-400 mt-1">O bot ira responder tudo que chegar e for texto.</p>
                 </div>
               ) : waWebStatus === 'error' ? (
                 <div className="text-center w-full flex flex-col items-center">
                   <AlertCircle className="w-10 h-10 text-red-400 mx-auto mb-3" />
                   <p className="text-sm font-medium text-red-300 mb-1">Falha na conexão</p>
                   <p className="text-xs text-slate-400 text-center px-2">{waWebError || 'Erro desconhecido'}</p>
                 </div>
               ) : waWebStatus === 'connecting' ? (
                 <div className="text-center w-full flex flex-col items-center">
                    {waWebQr ? (
                      <div className="bg-white p-3 rounded-xl shadow-lg shadow-black/30">
                        <img
                          src={waWebQr}
                          alt="QR Code WhatsApp"
                          className="w-56 h-56 transition-opacity duration-300"
                          style={{ imageRendering: 'pixelated' }}
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-32">
                         <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-2" />
                         <p className="text-xs text-slate-400">Iniciando Chrome/Puppeteer...</p>
                         <p className="text-xs text-slate-500 mt-1">Isso pode levar até 30 segundos</p>
                      </div>
                    )}
                 </div>
               ) : (
                 <div className="text-center w-full">
                    <QrCode className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-sm text-slate-400 text-center">Conecte sua conta do WhatsApp pessoal lendo o QR Code.</p>
                 </div>
               )}
            </div>

            <div className="mt-6 pt-6 border-t border-slate-800 flex gap-3 relative z-10">
              {waWebStatus === 'connected' || waWebStatus === 'error' ? (
                <Button 
                  variant="outline" 
                  className="w-full bg-slate-950 border-red-500/20 text-red-400 hover:text-white hover:bg-red-500" 
                  onClick={handleDisconnectWaWeb}
                >
                  {waWebStatus === 'error' ? 'Limpar Sessão / Tentar Reset' : 'Desconectar Dispositivo'}
                </Button>
              ) : waWebStatus === 'connecting' && !waWebQr ? (
                 <Button className="w-full bg-slate-800 text-slate-300 pointer-events-none border-0" disabled>
                   Aguarde... (pode levar ~30s)
                 </Button>
              ) : (
                <Button className="w-full bg-indigo-600 hover:bg-indigo-700 text-white border-0 transition-colors" onClick={handleConnectWaWeb} disabled={waWebStatus === 'connecting'}>
                  {waWebStatus === 'error' ? 'Tentar Conectar' : 'Gerar QR Code'}
                </Button>
              )}
            </div>
          </div>
          
          {/* Card WhatsApp Business API */}
          {(() => {
            const waBusiness = channels.find(c => c.id === 'ch_wa_business')!;
            const isConnected = waBusiness?.status === 'connected';
            return (
              <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Smartphone className="w-24 h-24 text-emerald-500" />
                </div>
                <div className="flex items-center justify-between mb-6 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <Smartphone className="w-6 h-6 text-emerald-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-100">WhatsApp Business</h3>
                      <p className="text-xs text-slate-400">Cloud API (Oficial)</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={isConnected ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-slate-700 text-slate-400 bg-slate-800/50'}>
                    {isConnected ? <><CheckCircle2 className="w-3 h-3 mr-1" />Conectado</> : 'Não configurado'}
                  </Badge>
                </div>
                {isConnected ? (
                  <div className="space-y-4 relative z-10 flex-1">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Número</span>
                      <span className="font-medium text-slate-200">{waBusiness.identifier}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">WABA ID</span>
                      <span className="font-mono text-xs text-slate-500">{waBusiness.wabaId}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Modo IA</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked={waBusiness.isActiveAI} />
                        <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 relative z-10 flex-1 flex flex-col justify-center items-center py-4">
                    <Settings className="w-8 h-8 text-slate-600 mb-2" />
                    <p className="text-sm text-slate-400 text-center">Configure as credenciais da API oficial do Meta para ativar este canal.</p>
                  </div>
                )}
                <div className="mt-6 pt-6 border-t border-slate-800 flex gap-3 relative z-10">
                  <Button
                    variant={isConnected ? 'outline' : 'default'}
                    className={isConnected
                      ? 'w-full bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                      : 'w-full bg-emerald-600 hover:bg-emerald-700 text-white border-0'}
                    onClick={() => setConfigModalChannel('ch_wa_business')}
                  >
                    {isConnected
                      ? <><RefreshCw className="w-4 h-4 mr-2" /> Reconfigurar</>  
                      : <><Settings className="w-4 h-4 mr-2" /> Configurar</>}
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* Card Instagram */}
          {(() => {
            const igChannel = channels.find(c => c.id === 'ch_instagram')!;
            const isConnected = igChannel?.status === 'connected';
            return (
              <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900/50 p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                  <Instagram className="w-24 h-24 text-pink-500" />
                </div>
                <div className="flex items-center justify-between mb-6 relative z-10">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-pink-500/10 border border-pink-500/20">
                      <Instagram className="w-6 h-6 text-pink-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-100">Instagram Direct</h3>
                      <p className="text-xs text-slate-400">Graph API</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={isConnected ? 'border-pink-500/30 text-pink-400 bg-pink-500/10' : 'border-slate-700 text-slate-400 bg-slate-800/50'}>
                    {isConnected ? <><CheckCircle2 className="w-3 h-3 mr-1" />Conectado</> : 'Não configurado'}
                  </Badge>
                </div>
                {isConnected ? (
                  <div className="space-y-4 relative z-10 flex-1">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Conta</span>
                      <span className="font-medium text-slate-200">{igChannel.identifier}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Page ID</span>
                      <span className="font-mono text-xs text-slate-500">{igChannel.pageId}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-400">Modo IA</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer" defaultChecked={igChannel.isActiveAI} />
                        <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 relative z-10 flex-1 flex flex-col justify-center items-center py-4">
                    <Settings className="w-8 h-8 text-slate-600 mb-2" />
                    <p className="text-sm text-slate-400 text-center">Configure as credenciais da Graph API do Meta para ativar o Instagram Direct.</p>
                  </div>
                )}
                <div className="mt-6 pt-6 border-t border-slate-800 flex gap-3 relative z-10">
                  <Button
                    variant={isConnected ? 'outline' : 'default'}
                    className={isConnected
                      ? 'w-full bg-slate-950 border-slate-800 text-slate-300 hover:text-white'
                      : 'w-full bg-pink-600 hover:bg-pink-700 text-white border-0'}
                    onClick={() => setConfigModalChannel('ch_instagram')}
                  >
                    {isConnected
                      ? <><RefreshCw className="w-4 h-4 mr-2" /> Reconfigurar</>
                      : <><Settings className="w-4 h-4 mr-2" /> Configurar</>}
                  </Button>
                </div>
              </div>
            );
          })()}

        </div>{/* fecha grid grid-cols-3 */}

        {/* Secao base de conhecimento RAG */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
             <BrainCircuit className="w-5 h-5 text-indigo-400" />
             <h3 className="text-lg font-semibold text-slate-100">Base de Conhecimento RAG</h3>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-0 overflow-hidden">
            <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
              <div>
                 <h4 className="text-sm font-medium text-slate-200">Gerenciamento de Documentos</h4>
                 <p className="text-xs text-slate-500 mt-1">Faça upload de FAQs, catálogos e regras de negócio para treinar a IA do seu atendimento.</p>
              </div>
               <div className="flex items-center gap-3 text-sm">
                 <span className="text-slate-400">Canal:</span>
                 <select className="bg-slate-900 border border-slate-700 text-slate-200 text-sm rounded-lg focus:ring-primary focus:border-primary block p-2">
                    <option>Global (Todos os Canais)</option>
                    <option>Somente WhatsApp</option>
                    <option>Somente Instagram</option>
                 </select>
               </div>
            </div>
            
            <div className="p-6">
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".pdf,.txt,.csv"
                onChange={handleFileUpload}
              />
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-xl bg-slate-950/30 hover:bg-slate-800/30 transition-colors cursor-pointer py-10 mb-6"
              >
                 <UploadCloud className="w-10 h-10 text-slate-500 mb-4" />
                 <p className="text-sm text-slate-300 font-medium">Arraste seus PDFs ou TXTs para cá</p>
                 <p className="text-xs text-slate-500 mt-1">Arquivos processados são vetorizados automaticamente em tempo real.</p>
                 <Button variant="outline" className="mt-6 border-slate-700 text-slate-300 bg-slate-900 hover:text-white" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                   Selecionar Arquivos
                 </Button>
              </div>

              {/* Lista de Documentos Processados */}
              {ragDocuments.length > 0 && (
                <div className="space-y-3">
                  <h5 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Documentos Indexados</h5>
                  {ragDocuments.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-800 bg-slate-950/50">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded bg-slate-800 border border-slate-700">
                          <FileText className="w-4 h-4 text-slate-400" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-200">{doc.name}</p>
                          <p className="text-xs text-slate-500">{doc.size} • Enviado em {format(new Date(doc.uploadDate), "dd/MM/yyyy HH:mm")}</p>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="border-slate-700 text-slate-400">
                          {doc.channelId === 'global' ? 'Global' : 'Específico'}
                        </Badge>
                        
                        {doc.status === 'processing' ? (
                          <div className="flex items-center text-xs text-indigo-400">
                            <Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processando...
                          </div>
                        ) : doc.status === 'ready' ? (
                          <div className="flex items-center text-xs text-emerald-400">
                            <Check className="w-3 h-3 mr-1" /> Vetorizado
                          </div>
                        ) : (
                          <div className="flex items-center text-xs text-red-400">
                            <X className="w-3 h-3 mr-1" /> Erro
                          </div>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-red-400 hover:bg-red-400/10">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>

    {configModalChannel && channels.find(c => c.id === configModalChannel) && (
      <ChannelConfigModal
        channel={channels.find(c => c.id === configModalChannel)!}
        onSave={(data) => configureChannel(configModalChannel, data)}
        onClose={() => setConfigModalChannel(null)}
      />
    )}
    </>
  );
}
