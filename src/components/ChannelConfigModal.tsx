import React, { useState } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { Button } from '@/src/components/ui/button';
import { ChannelInfo } from '@/src/store/useStore';

interface ChannelConfigModalProps {
  channel: ChannelInfo;
  onSave: (data: Partial<ChannelInfo>) => void;
  onClose: () => void;
}

export function ChannelConfigModal({ channel, onSave, onClose }: ChannelConfigModalProps) {
  const isWA = channel.provider === 'whatsapp';

  const [form, setForm] = useState({
    token: channel.token || '',
    phoneNumberId: channel.phoneNumberId || '',
    wabaId: channel.wabaId || '',
    pageId: channel.pageId || '',
    identifier: channel.identifier || '',
  });

  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
    setVerifyError(null);
  };

  const handleSave = async () => {
    if (!form.token) {
      setVerifyError('O token de acesso é obrigatório.');
      return;
    }
    if (isWA && (!form.phoneNumberId || !form.wabaId)) {
      setVerifyError('Phone Number ID e WABA ID são obrigatórios para WhatsApp Business.');
      return;
    }

    setIsVerifying(true);
    setVerifyError(null);

    try {
      // Verificação real contra a Graph API da Meta
      const endpoint = isWA
        ? `https://graph.facebook.com/v19.0/${form.phoneNumberId}?access_token=${form.token}`
        : `https://graph.facebook.com/v19.0/me?access_token=${form.token}`;

      const res = await fetch(endpoint);
      const data = await res.json();

      if (data.error) {
        setVerifyError(`Token inválido: ${data.error.message}`);
        setIsVerifying(false);
        return;
      }

      // Token válido — salva no store
      const update: Partial<ChannelInfo> = {
        status: 'connected',
        token: form.token,
        identifier: isWA
          ? (data.display_phone_number || form.identifier || form.phoneNumberId)
          : (form.identifier || data.name || ''),
      };
      if (isWA) {
        update.phoneNumberId = form.phoneNumberId;
        update.wabaId = form.wabaId;
      } else {
        update.pageId = form.pageId || data.id;
      }

      onSave(update);
      onClose();
    } catch (err) {
      setVerifyError('Erro de rede ao verificar o token. Verifique sua conexão.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6 m-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-slate-100">
              Configurar {isWA ? 'WhatsApp Business' : 'Instagram Direct'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {isWA
                ? 'Credenciais do WhatsApp Business Cloud API (Meta)'
                : 'Credenciais do Instagram Graph API (Meta)'}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-200 transition-colors p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Guia rápido */}
        <div className="mb-5 p-3 rounded-lg bg-indigo-950/50 border border-indigo-800/40">
          <p className="text-xs text-indigo-300 font-medium mb-1">📋 Como obter as credenciais:</p>
          <a
            href={isWA
              ? 'https://developers.facebook.com/apps/'
              : 'https://developers.facebook.com/docs/instagram-api/get-started'}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-indigo-400 hover:text-indigo-200 flex items-center gap-1 transition-colors"
          >
            Meta for Developers <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Formulário */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Token de Acesso Permanente *
            </label>
            <input
              name="token"
              type="password"
              value={form.token}
              onChange={handleChange}
              placeholder="EAAxxxxx..."
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
            />
          </div>

          {isWA ? (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Phone Number ID *
                </label>
                <input
                  name="phoneNumberId"
                  value={form.phoneNumberId}
                  onChange={handleChange}
                  placeholder="123456789012345"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
                <p className="text-xs text-slate-500 mt-1">Encontrado em: Meta App → WhatsApp → API Setup</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  WABA ID (WhatsApp Business Account ID) *
                </label>
                <input
                  name="wabaId"
                  value={form.wabaId}
                  onChange={handleChange}
                  placeholder="102938475..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  @handle do Instagram *
                </label>
                <input
                  name="identifier"
                  value={form.identifier}
                  onChange={handleChange}
                  placeholder="@sua_empresa"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Page ID da Página do Facebook (associada)
                </label>
                <input
                  name="pageId"
                  value={form.pageId}
                  onChange={handleChange}
                  placeholder="ID da página"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-colors"
                />
              </div>
            </>
          )}
        </div>

        {/* Erro de verificação */}
        {verifyError && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/50 border border-red-800/40">
            <p className="text-xs text-red-300">{verifyError}</p>
          </div>
        )}

        {/* Botões */}
        <div className="flex gap-3 mt-6">
          <Button variant="outline" className="flex-1 border-slate-700 text-slate-300" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white border-0"
            onClick={handleSave}
            disabled={isVerifying}
          >
            {isVerifying ? 'Verificando...' : 'Conectar e Salvar'}
          </Button>
        </div>
      </div>
    </div>
  );
}
