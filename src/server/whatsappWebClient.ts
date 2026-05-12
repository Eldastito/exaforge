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
    if (msg.from === 'status@broadcast' || !msg.body) return;
    const senderId = msg.from;
    if (ioInstance) {
      ioInstance.emit('new_message', {
        contactId: senderId, provider: 'whatsapp',
        text: msg.body, sender: 'contact',
        timestamp: new Date().toISOString()
      });
    }
    try {
      const iaResponse = await generateRagResponse(msg.body, 'wa_web');
      if (ioInstance) {
        ioInstance.emit('new_message', {
          contactId: senderId, provider: 'whatsapp',
          text: iaResponse, sender: 'bot',
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
