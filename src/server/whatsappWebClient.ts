import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg as any;
import qrcode from 'qrcode';
import { existsSync } from 'fs';
import { generateRagResponse } from './geminiRAG.js';

let client: Client | null = null;
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

function destroyClient() {
  if (client) {
    client.destroy().catch(() => {});
  }
  resetState();
}

export function initializeWhatsAppWeb(io: any) {
  if (client) {
    console.log('[WA Web] Client already exists.');
    return;
  }

  ioInstance = io;
  clientStatus = 'connecting';
  currentQrUrl = null;

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
      ioInstance.emit('new_message', {
        contactId: senderId, 
        contactName: contactName,
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
        iaResponse = await generateRagResponse(incomingText, 'wa_web', { name: contactName });
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

export function disconnectWhatsAppWeb() {
  if (client) {
    client.logout().catch(console.error);
    client.destroy().catch(console.error);
    if (ioInstance) ioInstance.emit('wa_web_status', { status: 'disconnected' });
    resetState();
  }
}
