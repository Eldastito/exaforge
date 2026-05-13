import {
  loadAgenda,
  updateEvent,
  generateDailySummary,
  generateReminderMessage,
  type AgendaEvent
} from './agendaAgent.js';

let schedulerClient: any = null;
let cronJobs: any[] = [];

/**
 * Define o cliente WhatsApp a ser usado pelo scheduler para enviar mensagens.
 */
export function setSchedulerClient(client: any) {
  schedulerClient = client;
}

/**
 * Número do WhatsApp do Daniel Soranz (formato: 5521972425118@c.us)
 */
function getAdminJid(): string {
  const num = (process.env.AGENDA_ADMIN_NUMBER || '5521972425118').replace(/\D/g, '');
  return `${num}@c.us`;
}

async function sendToAdmin(text: string) {
  if (!schedulerClient) {
    console.warn('[AgendaScheduler] Cliente WA não disponível ainda.');
    return;
  }
  try {
    await schedulerClient.sendMessage(getAdminJid(), text);
    console.log('[AgendaScheduler] Mensagem enviada ao admin:', text.substring(0, 80) + '...');
  } catch (e) {
    console.error('[AgendaScheduler] Erro ao enviar mensagem:', e);
  }
}

/**
 * Verifica se existe evento para iniciar em ~1 hora e envia lembrete.
 * Executado a cada minuto.
 */
async function checkUpcomingReminders() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const events = loadAgenda().filter(e =>
    e.date === today &&
    e.status !== 'cancelado' &&
    !e.reminderSentAt
  );

  for (const event of events) {
    const [hh, mm] = event.time.split(':').map(Number);
    const eventTime = new Date(now);
    eventTime.setHours(hh, mm, 0, 0);

    const diffMs = eventTime.getTime() - now.getTime();
    const diffMinutes = diffMs / 60000;

    // Envia lembrete entre 55 e 65 minutos antes
    if (diffMinutes >= 55 && diffMinutes <= 65) {
      const message = generateReminderMessage(event);
      await sendToAdmin(message);
      updateEvent(event.id, {
        reminderSentAt: now.toISOString(),
        status: 'aguardando_ok'
      });
      console.log(`[AgendaScheduler] Lembrete enviado para evento: ${event.title}`);
    }
  }
}

/**
 * Envia o resumo diário às 7h da manhã.
 */
async function sendDailySummary() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`[AgendaScheduler] Enviando resumo diário para ${today}`);

  const summary = generateDailySummary(today);
  await sendToAdmin(summary);

  // Marca todos os eventos do dia como "aguardando_ok"
  const events = loadAgenda().filter(e => e.date === today && e.status === 'pendente');
  events.forEach(e => updateEvent(e.id, {
    status: 'aguardando_ok',
    confirmationSentAt: new Date().toISOString()
  }));
}

/**
 * Inicializa os cron jobs do scheduler da agenda.
 * Deve ser chamado APÓS o cliente WhatsApp estar pronto.
 */
export async function initAgendaScheduler(client: any) {
  setSchedulerClient(client);

  try {
    // Importação dinâmica do node-cron para não crashar se não instalado
    const cron = await import('node-cron');

    // Resumo diário: todo dia às 07:00
    const dailyJob = cron.schedule('0 7 * * *', sendDailySummary, {
      timezone: 'America/Sao_Paulo'
    });
    cronJobs.push(dailyJob);
    console.log('[AgendaScheduler] ✅ Cron job diário (07:00) registrado.');

    // Verificador de lembretes: a cada minuto
    const reminderJob = cron.schedule('* * * * *', checkUpcomingReminders, {
      timezone: 'America/Sao_Paulo'
    });
    cronJobs.push(reminderJob);
    console.log('[AgendaScheduler] ✅ Cron job de lembretes (cada 1min) registrado.');

  } catch (e: any) {
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.message?.includes('node-cron')) {
      console.warn('[AgendaScheduler] ⚠️  node-cron não instalado. Execute: npm install node-cron @types/node-cron');
      console.warn('[AgendaScheduler] O scheduler de lembretes automáticos ficará desabilitado até a instalação.');
    } else {
      console.error('[AgendaScheduler] Erro ao inicializar scheduler:', e);
    }
  }
}

export function stopAgendaScheduler() {
  cronJobs.forEach(job => {
    try { job.stop(); } catch {}
  });
  cronJobs = [];
  schedulerClient = null;
  console.log('[AgendaScheduler] Scheduler parado.');
}

// Exporta para testes/uso manual
export { sendDailySummary, checkUpcomingReminders };
