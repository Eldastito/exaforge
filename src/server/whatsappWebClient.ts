import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg as any;
import qrcode from 'qrcode';
import { existsSync } from 'fs';
import { generateRagResponse } from './geminiRAG.js';
import { handleAgendaMessage } from './agendaAgent.js';
import { initAgendaScheduler, stopAgendaScheduler } from './agendaScheduler.js';

// Número do admin da agenda (apenas dígitos)
const AGENDA_ADMIN_RAW = (process.env.AGENDA_ADMIN_NUMBER || '5521972425118').replace(/\D/g, '');

/**
 * Verifica se a mensagem vem do admin da agenda (Daniel Soranz).
 * Usa múltiplos fallbacks para contornar LIDs do WhatsApp (ex: 265...@lid).
 * Loga o identificador real encontrado para facilitar diagnóstico.
 */
async function isFromAgendaAdmin(msg: any): Promise<boolean> {
  // Coleta todos os candidatos disponíveis sem chamada extra
  const quickCandidates: string[] = [
    msg.from || '',
    msg.author || '',
    msg._data?.from || '',
    msg._data?.author || '',
    msg._data?.id?.participant || '',
  ];

  for (const c of quickCandidates) {
    if (!c) continue;
    const digits = c.replace(/[^\d]/g, '');
    if (digits.length >= 8 && AGENDA_ADMIN_RAW.endsWith(digits.slice(-9))) {
      console.log(`[Agenda] ✅ Admin identificado (quick) via: ${c}`);
      return true;
    }
  }

  // Fallback: resolve o contato real (necessário quando msg.from é um LID)
  try {
    const contact = await msg.getContact();
    const deepCandidates: string[] = [
      contact.id?._serialized || '',
      contact.number || '',
      contact.id?.user || '',
      String(contact.id?.server === 'c.us' ? contact.id?._serialized : ''),
    ];

    for (const c of deepCandidates) {
      if (!c) continue;
      const digits = c.replace(/[^\d]/g, '');
      if (digits.length >= 8 && AGENDA_ADMIN_RAW.endsWith(digits.slice(-9))) {
        console.log(`[Agenda] ✅ Admin identificado (contact) via: ${c}`);
        return true;
      }
    }

    // Log de diagnóstico: mostra o que realmente chegou para facilitar depuração
    console.log(
      `[Agenda] 🔍 Diagnóstico – msg.from=${msg.from} | contact.number=${contact.number} | contact.id=${contact.id?._serialized} | admin esperado=...${AGENDA_ADMIN_RAW.slice(-9)}`
    );
  } catch (e) {
    console.warn('[Agenda] ⚠️  Não foi possível resolver contato para checagem de admin:', e);
  }

  return false;
}

export let client: Client | null = null;
let ioInstance: any = null;
let currentQrUrl: string | null = null;
let clientStatus: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
let initTimeout: ReturnType<typeof setTimeout> | null = null;

/** Tenta encontrar o Chrome instalado no sistema */
function findChromePath(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean) as string[];

  return candidates.find(p => existsSync(p));
}

export function getWhatsAppWebStatus() {
  return { status: clientStatus, qrUrl: currentQrUrl };
}

function emitStatus(status: string, extra?: object) {
  if (ioInstance) {
    ioInstance.emit('wa_web_status', { status, ...extra });
  }
}

function resetState() {
  clientStatus = 'disconnected';
  currentQrUrl = null;
  client = null;
  if (initTimeout) {
    clearTimeout(initTimeout);
    initTimeout = null;
  }
}

async function destroyClient() {
  const c = client;
  resetState(); // reseta primeiro para não permitir chamadas reentrantes
  if (c) {
    try { await c.destroy(); } catch { /* ignore */ }
  }
}

export async function initializeWhatsAppWeb(io: any) {
  if (client) {
    console.log('[WA Web] Client already exists.');
    return;
  }

  ioInstance = io;
  clientStatus = 'connecting';
  currentQrUrl = null;

  // Limpeza agressiva de lockfiles para evitar erro EBUSY em restarts
  const sessionDir = './.wwebjs_auth/session';
  const lockFiles = [
    `${sessionDir}/lockfile`,
    `${sessionDir}/SingletonLock`,
    `${sessionDir}/SingletonCookie`,
  ];
  for (const lf of lockFiles) {
    if (existsSync(lf)) {
      try {
        const { unlinkSync } = await import('fs');
        unlinkSync(lf);
        console.log(`[WA Web] Lockfile removido: ${lf}`);
      } catch {
        // No Windows, o arquivo está bloqueado por um processo Chrome zumbi
        // Mata o processo e aguarda antes de prosseguir
        console.warn(`[WA Web] Lockfile preso: ${lf} — tentando matar Chrome zumbi...`);
        try {
          const { execSync } = await import('child_process');
          if (process.platform === 'win32') {
            execSync('taskkill /F /IM chrome.exe /T 2>nul || exit 0', { stdio: 'pipe' });
          } else {
            execSync('pkill -f chrome || true', { stdio: 'pipe' });
          }
          console.log('[WA Web] Processo Chrome finalizado. Aguardando 2s...');
          await new Promise(r => setTimeout(r, 2000));
          // Tenta novamente após matar
          try { const { unlinkSync } = await import('fs'); unlinkSync(lf); } catch { /* ok */ }
        } catch (killErr) {
          console.warn('[WA Web] Não foi possível matar o Chrome:', killErr);
        }
      }
    }
  }

  const chromePath = findChromePath();
  if (chromePath) {
    console.log(`[WA Web] Usando Chrome: ${chromePath}`);
  } else {
    console.warn('[WA Web] Chrome do sistema não encontrado. Usando Puppeteer bundled.');
  }

  const puppeteerConfig: any = {
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    headless: true,
  };

  if (chromePath) {
    puppeteerConfig.executablePath = chromePath;
  }

  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: puppeteerConfig,
  });

  // Timeout de segurança: 60s
  initTimeout = setTimeout(() => {
    if (clientStatus === 'connecting') {
      console.error('[WA Web] Timeout: QR Code não gerado em 60s.');
      emitStatus('error', { message: 'Timeout: Chrome/Puppeteer não respondeu em 60s. Verifique se o Chrome está instalado.' });
      destroyClient();
    }
  }, 60_000);

  client.on('qr', async (qrText) => {
    console.log('[WA Web] QR Code recebido');
    if (initTimeout) { clearTimeout(initTimeout); initTimeout = null; }
    try {
      currentQrUrl = await qrcode.toDataURL(qrText);
      if (ioInstance) ioInstance.emit('wa_web_qr', { qrUrl: currentQrUrl });
    } catch (e) {
      console.error('[WA Web] Erro ao gerar QR Code', e);
    }
  });

  client.on('ready', () => {
    console.log('[WA Web] Pronto!');
    clientStatus = 'connected';
    currentQrUrl = null;
    if (initTimeout) { clearTimeout(initTimeout); initTimeout = null; }
    emitStatus('connected');
    // Inicializa o scheduler de agenda agora que o client está pronto
    initAgendaScheduler(client).catch(e => console.error('[WA Web] Erro ao iniciar scheduler:', e));
  });

  client.on('authenticated', () => {
    console.log('[WA Web] Autenticado!');
  });

  client.on('auth_failure', (msg) => {
    console.error('[WA Web] Falha na autenticação', msg);
    emitStatus('error', { message: 'Falha na autenticação. Escaneie o QR novamente.' });
    destroyClient();
  });

  client.on('disconnected', (reason) => {
    console.log('[WA Web] Desconectado', reason);
    emitStatus('disconnected');
    stopAgendaScheduler();
    resetState();
  });

  client.on('error' as any, (err: Error) => {
    console.error('[WA Web] Erro crítico:', err?.message || err);
    emitStatus('error', { message: `Erro Chrome: ${err?.message || 'Erro desconhecido'}` });
    destroyClient();
  });

  client.on('message', async (msg) => {
    if (msg.from === 'status@broadcast') return;
    const senderId = msg.from;

    // ── ROTEADOR DE AGENDA ─────────────────────────────────────────────────
    // Se a mensagem vem do Daniel Soranz, vai para o agendaAgent.
    // Todo o restante do fluxo (eleitorado) permanece 100% inalterado.
    if (await isFromAgendaAdmin(msg)) {
      let incomingText = msg.body || '';
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media?.mimetype.startsWith('audio/')) {
            const { transcribeAudio } = await import('./geminiRAG.js');
            const transcription = await transcribeAudio(Buffer.from(media.data, 'base64'));
            incomingText = transcription;
            console.log(`[Agenda] Áudio do Daniel transcrito: ${transcription}`);
          }
        } catch (mediaError) {
          console.error('[Agenda] Erro ao transcrever áudio do Daniel:', mediaError);
        }
      }
      if (!incomingText) return;
      try {
        const agendaResponse = await handleAgendaMessage(incomingText);
        await client?.sendMessage(msg.from, agendaResponse);
        if (ioInstance) ioInstance.emit('agenda_updated', { timestamp: new Date().toISOString() });
        console.log(`[Agenda] Respondido ao Daniel: ${agendaResponse.substring(0, 80)}...`);
      } catch (e) {
        console.error('[Agenda] Erro ao processar mensagem da agenda:', e);
        await client?.sendMessage(msg.from, '❌ Erro ao processar. Tente novamente.');
      }
      return; // NÃO continua para o fluxo da IA de campanha
    }
    // ── FIM DO ROTEADOR ────────────────────────────────────────────────────

    // Tenta obter info do contato para personalizar a IA
    let contactName = "Eleitor(a)";
    try {
      const contact = await msg.getContact();
      contactName = contact.pushname || contact.name || "Eleitor(a)";
    } catch (e) {
      console.warn('[WA Web] Erro ao obter contato:', e);
    }

    let incomingText = msg.body || "";

    // FLUXO DE MÍDIA (ÁUDIO / IMAGEM)
    if (msg.hasMedia) {
      try {
        const media = await msg.downloadMedia();
        if (media) {
          if (media.mimetype.startsWith('audio/')) {
            console.log(`[WA Web] Áudio recebido de ${contactName}. Transcrevendo...`);
            const audioBuffer = Buffer.from(media.data, 'base64');
            const transcription = await (await import('./geminiRAG.js')).transcribeAudio(audioBuffer);
            incomingText = `[Áudio Transcrito]: ${transcription}`;
            console.log(`[WA Web] Transcrição: ${transcription}`);
          } else if (media.mimetype.startsWith('image/')) {
            incomingText = "[Enviou uma imagem]";
            // Opcional: Usar GPT-4o Vision aqui no futuro
          } else {
            incomingText = "[Enviou um arquivo]";
          }
        }
      } catch (mediaError) {
        console.error('[WA Web] Erro ao processar mídia:', mediaError);
      }
    }

    if (!incomingText && !msg.hasMedia) return;

    if (ioInstance) {
      let contactName = "Eleitor(a)";
      let cleanNumber = senderId.split('@')[0];

      try {
        const contact = await msg.getContact();
        contactName = msg._data?.notifyName || contact.pushname || contact.name || senderId.split('@')[0];
        
        // ESTRATÉGIA DE EXTRAÇÃO AGRESSIVA (Anti-LID)
        // O WhatsApp está trocando números por LIDs (265...). Vamos buscar o JID real (@c.us)
        // que quase sempre contém o número de telefone real.
        const possibleJids = [
          msg.from,
          msg.author,
          msg._data?.id?.participant,
          msg._data?.from,
          msg._data?.author,
          contact.id?._serialized
        ].filter(id => id && id.includes('@c.us') && !id.includes('lid'));

        // Se encontrou algum ID que não seja LID, esse é o nosso número!
        let rawNumber = "";
        if (possibleJids.length > 0) {
          rawNumber = possibleJids[0].split('@')[0];
        } else {
          rawNumber = contact.number || contact.id.user;
        }
        
        // Formatador de Telefone (Ex: 5521999947477 -> +55 21 99994-7477)
        if (rawNumber && rawNumber.length >= 10 && rawNumber.startsWith('55')) {
          const ddi = rawNumber.substring(0, 2);
          const ddd = rawNumber.substring(2, 4);
          const lastPart = rawNumber.substring(rawNumber.length - 4);
          const middlePart = rawNumber.substring(4, rawNumber.length - 4);
          cleanNumber = `+${ddi} ${ddd} ${middlePart}-${lastPart}`;
        } else {
          // Se for um número estrangeiro ou ID curto, apenas garante o +
          cleanNumber = rawNumber.startsWith('+') ? rawNumber : `+${rawNumber}`;
        }
      } catch (e) {
        console.warn('[WA Web] Erro ao obter detalhes do contato:', e);
      }

      console.log(`[WA Web] Mensagem de ${contactName} (${cleanNumber})`);
      
      ioInstance.emit('new_message', {
        contactId: senderId, 
        contactName: contactName,
        contactNumber: cleanNumber,
        provider: 'whatsapp',
        text: incomingText, 
        sender: 'contact',
        timestamp: new Date().toISOString()
      });
    }

    try {
      // Se for apenas uma imagem sem texto, damos uma resposta padrão simpática
      let iaResponse: string;
      if (incomingText === "[Enviou uma imagem]") {
        iaResponse = `Recebi sua imagem, ${contactName}! Obrigado por compartilhar. Como posso te ajudar em relação às propostas do Daniel Soranz hoje?`;
      } else if (incomingText === "[Enviou um arquivo]") {
        iaResponse = `Recebi seu arquivo, ${contactName}. Vou encaminhar para nossa equipe analisar. Em que mais posso te ajudar?`;
      } else {
        // Captura o histórico recente do chat para dar contexto à IA
        let historyText = "";
        try {
          const chat = await msg.getChat();
          const recentMessages = await chat.fetchMessages({ limit: 6 });
          historyText = recentMessages
            .map(m => `${m.fromMe ? 'Assessor' : 'Eleitor'}: ${m.body}`)
            .join('\n');
        } catch (hError) {
          console.warn('[WA Web] Erro ao buscar histórico:', hError);
        }

        iaResponse = await generateRagResponse(incomingText, 'wa_web', { name: contactName }, historyText);
      }
      
      if (ioInstance) {
        ioInstance.emit('new_message', {
          contactId: senderId, 
          provider: 'whatsapp',
          text: iaResponse, 
          sender: 'bot',
          timestamp: new Date().toISOString()
        });
      }
      await client?.sendMessage(msg.from, iaResponse);
    } catch (error) {
      console.error('[WA Web] Erro ao responder via IA', error);
    }
  });

  // initialize() é async — captura erros da promise
  client.initialize().catch((error) => {
    const msg = error?.message || 'Erro desconhecido';
    console.error('[WA Web] Erro no initialize():', msg);
    emitStatus('error', { message: `Falha ao iniciar Chrome: ${msg}` });
    destroyClient();
  });
}

export async function disconnectWhatsAppWeb() {
  if (client) {
    // Não chamamos logout() pois pode lançar TargetCloseError se o browser já fechou.
    // destroy() é suficiente para encerrar o processo Puppeteer/Chrome.
    if (ioInstance) ioInstance.emit('wa_web_status', { status: 'disconnected' });
    await destroyClient();
  }
}
