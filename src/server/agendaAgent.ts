import OpenAI from 'openai';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AgendaPriority = 'alta' | 'media' | 'baixa';
export type AgendaStatus = 'pendente' | 'confirmado' | 'aguardando_ok' | 'concluido' | 'cancelado';

export interface AgendaEvent {
  id: string;
  title: string;           // Descrição/título do compromisso
  date: string;            // ISO date string: "2026-05-15"
  time: string;            // "HH:MM"
  with: string;            // Com quem é o compromisso
  location?: string;       // Local (opcional)
  priority: AgendaPriority;
  status: AgendaStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  confirmationSentAt?: string;  // Quando enviou o resumo do dia pedindo OK
  reminderSentAt?: string;      // Quando enviou o lembrete de 1h antes
}

// ─── Persistência ────────────────────────────────────────────────────────────

const AGENDA_PATH = path.join(process.cwd(), 'agenda.json');

export function loadAgenda(): AgendaEvent[] {
  if (!existsSync(AGENDA_PATH)) return [];
  try {
    const data = readFileSync(AGENDA_PATH, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export function saveAgenda(events: AgendaEvent[]): void {
  try {
    writeFileSync(AGENDA_PATH, JSON.stringify(events, null, 2), 'utf-8');
  } catch (e) {
    console.error('[AgendaAgent] Erro ao salvar agenda:', e);
  }
}

export function addEvent(event: Omit<AgendaEvent, 'id' | 'createdAt' | 'updatedAt'>): AgendaEvent {
  const events = loadAgenda();
  const newEvent: AgendaEvent = {
    ...event,
    id: uuidv4(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  events.push(newEvent);
  saveAgenda(events);
  return newEvent;
}

export function updateEvent(id: string, patch: Partial<AgendaEvent>): AgendaEvent | null {
  const events = loadAgenda();
  const idx = events.findIndex(e => e.id === id);
  if (idx === -1) return null;
  events[idx] = { ...events[idx], ...patch, updatedAt: new Date().toISOString() };
  saveAgenda(events);
  return events[idx];
}

export function deleteEvent(id: string): boolean {
  const events = loadAgenda();
  const filtered = events.filter(e => e.id !== id);
  if (filtered.length === events.length) return false;
  saveAgenda(filtered);
  return true;
}

export function getEventsByDate(dateStr: string): AgendaEvent[] {
  return loadAgenda().filter(e => e.date === dateStr && e.status !== 'cancelado');
}

// ─── IA: Extração de compromisso a partir de texto ───────────────────────────

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('[AgendaAgent] OPENAI_API_KEY não configurada.');
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

/**
 * Usa a IA para extrair um compromisso de um texto livre (áudio transcrito ou mensagem).
 * Retorna null se não conseguir identificar um compromisso claro.
 */
export async function extractEventFromText(text: string): Promise<Omit<AgendaEvent, 'id' | 'createdAt' | 'updatedAt'> | null> {
  const client = getOpenAI();
  const today = new Date().toISOString().split('T')[0];

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: `Você é um assistente de agenda pessoal do Deputado Daniel Soranz.
Sua única função é extrair compromissos de mensagens e retornar um JSON estruturado.

Data de hoje: ${today}

REGRAS:
- Se a mensagem contiver um compromisso (reunião, consulta, almoço, visita, evento, etc.), extraia os dados.
- Interprete expressões relativas como "amanhã", "semana que vem", "próxima segunda" baseando-se na data de hoje.
- Se NÃO for um compromisso (pergunta, saudação, etc.), retorne: {"isEvent": false}
- Se for um compromisso, retorne:
{
  "isEvent": true,
  "title": "descrição curta do compromisso",
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "with": "nome da pessoa ou organização",
  "location": "local ou vazio",
  "priority": "alta|media|baixa",
  "notes": "observações extras ou vazio"
}

Prioridade:
- "alta": reuniões com parlamentares, imprensa, eventos públicos, emergências
- "media": reuniões de equipe, compromissos de rotina
- "baixa": almoços informais, ligações de retorno

Responda APENAS com o JSON. Sem texto adicional.`
      },
      { role: 'user', content: text }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
    max_tokens: 300,
  });

  const raw = response.choices[0]?.message?.content?.trim();
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.isEvent) return null;

    return {
      title: parsed.title || 'Compromisso',
      date: parsed.date || today,
      time: parsed.time || '09:00',
      with: parsed.with || 'A definir',
      location: parsed.location || '',
      priority: (['alta', 'media', 'baixa'].includes(parsed.priority) ? parsed.priority : 'media') as AgendaPriority,
      status: 'pendente',
      notes: parsed.notes || '',
    };
  } catch {
    return null;
  }
}

/**
 * Processa uma mensagem do Daniel Soranz via WhatsApp.
 * Identifica se é agendamento, confirmação de OK, cancelamento, etc.
 * Retorna a resposta que a IA deve enviar de volta.
 */
export async function handleAgendaMessage(text: string): Promise<string> {
  const lowerText = text.toLowerCase();

  // Detecta confirmação de OK
  const isConfirmation = /\b(ok|sim|confirmo|confirmado|tudo bem|beleza|certo|pode ser|perfeito)\b/.test(lowerText);
  // Detecta cancelamento
  const isCancellation = /\b(cancel|cancela|desmarca|não vou|nao vou|remov)\b/.test(lowerText);

  if (isConfirmation && !isCancellation) {
    // Verifica se tem eventos aguardando OK hoje
    const today = new Date().toISOString().split('T')[0];
    const events = getEventsByDate(today).filter(e => e.status === 'aguardando_ok');
    if (events.length > 0) {
      events.forEach(e => updateEvent(e.id, { status: 'confirmado' }));
      return `✅ Agenda do dia confirmada! Você tem ${events.length} compromisso(s) confirmado(s). Boa sorte nas reuniões, Deputado!`;
    }
    return `✅ OK recebido! Sua agenda está atualizada.`;
  }

  // Tenta extrair compromisso da mensagem
  try {
    const extracted = await extractEventFromText(text);
    if (extracted) {
      const newEvent = addEvent(extracted);
      const dateFormatted = new Date(newEvent.date + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
      const priorityEmoji = { alta: '🔴', media: '🟡', baixa: '🟢' }[newEvent.priority];

      return `📅 *Compromisso registrado na sua agenda!*\n\n` +
        `${priorityEmoji} *${newEvent.title}*\n` +
        `📆 ${dateFormatted} às ${newEvent.time}\n` +
        `👤 Com: ${newEvent.with}\n` +
        (newEvent.location ? `📍 Local: ${newEvent.location}\n` : '') +
        `\nDigite *OK* para confirmar ou me diga se precisa ajustar algo.`;
    }
  } catch (e) {
    console.error('[AgendaAgent] Erro ao extrair compromisso:', e);
  }

  // Fallback: mensagem não identificada como compromisso
  const today = new Date().toISOString().split('T')[0];
  const todayEvents = getEventsByDate(today);

  if (todayEvents.length > 0) {
    const lista = todayEvents.map(e => `• ${e.time} - ${e.title} (${e.with})`).join('\n');
    return `📋 Não entendi como um compromisso. Sua agenda de hoje:\n\n${lista}\n\nPara agendar, me diga: *dia, horário, com quem e o tipo de compromisso*.`;
  }

  return `🤖 Olá Deputado! Para agendar um compromisso, me diga:\n• *Quando* (data e horário)\n• *Com quem* é a reunião\n• *Onde* será realizada\n\nEx: "Amanhã às 14h reunião com a secretaria de saúde no gabinete"`;
}

/**
 * Gera o resumo diário dos compromissos para envio automático.
 */
export function generateDailySummary(dateStr: string): string {
  const events = getEventsByDate(dateStr);
  const dateFormatted = new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  if (events.length === 0) {
    return `🌅 *Bom dia, Deputado!*\n\nSua agenda para ${dateFormatted} está livre. Aproveite o dia!\n\n_Responda *OK* para confirmar que recebeu._`;
  }

  const sorted = [...events].sort((a, b) => a.time.localeCompare(b.time));
  const priorityEmoji = (p: AgendaPriority) => ({ alta: '🔴', media: '🟡', baixa: '🟢' }[p]);

  const lista = sorted.map((e, i) =>
    `${i + 1}. ${priorityEmoji(e.priority)} *${e.time}* — ${e.title}\n   👤 ${e.with}${e.location ? `\n   📍 ${e.location}` : ''}`
  ).join('\n\n');

  return `🌅 *Bom dia, Deputado Daniel!*\n\n📅 *Sua agenda para ${dateFormatted}:*\n\n${lista}\n\n_Revise e responda *OK* para confirmar todos os compromissos._`;
}

/**
 * Gera a mensagem de lembrete de 1 hora antes.
 */
export function generateReminderMessage(event: AgendaEvent): string {
  const priorityEmoji = { alta: '🔴', media: '🟡', baixa: '🟢' }[event.priority];
  return `⏰ *Lembrete — 1 hora para o próximo compromisso!*\n\n` +
    `${priorityEmoji} *${event.title}*\n` +
    `🕐 Horário: *${event.time}*\n` +
    `👤 Com: *${event.with}*\n` +
    (event.location ? `📍 Local: *${event.location}*\n` : '') +
    `\nResponda *OK* quando estiver a caminho.`;
}
