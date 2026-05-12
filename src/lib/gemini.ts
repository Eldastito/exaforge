import OpenAI from 'openai';
import { Message, Contact } from "@/src/store/useStore";

// Inicialização lazy — evita erro ao importar sem a key configurada
let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.warn("OPENAI_API_KEY não configurada. Respostas de IA serão simuladas.");
      return null;
    }
    // dangerouslyAllowBrowser necessário para uso no cliente Vite
    _openai = new OpenAI({ apiKey, dangerouslyAllowBrowser: true });
  }
  return _openai;
}

export async function suggestResponse(contact: Contact, history: Message[]): Promise<string> {
  const client = getOpenAI();

  if (!client) {
    return `Olá ${contact.name}, como posso te ajudar hoje?`;
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `Você é um assistente especialista em atendimento ao cliente via WhatsApp.
Gere uma sugestão de resposta educada, curta e humanizada para o atendente usar.
Nome do Cliente: ${contact.name}.
Responda APENAS com o texto da mensagem, sem aspas ou comentários extras.`
    },
    ...history.slice(-6).map(m => ({
      role: (m.sender === 'contact' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.text
    }))
  ];

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 200,
      temperature: 0.7,
    });
    return response.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    console.error("OpenAI suggestResponse error:", err);
    return "Desculpe, ocorreu um erro ao gerar a sugestão.";
  }
}

export async function summarizeConversation(history: Message[]): Promise<string> {
  const client = getOpenAI();
  if (!client) return "Sem chave API para resumir conversa.";
  if (history.length === 0) return "A conversa está vazia.";

  const conversationText = history.map(m => `${m.sender}: ${m.text}`).join('\n');

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Faça um resumo conciso em tópicos desta conversa de atendimento. Destaque o problema principal e as ações já tomadas."
        },
        { role: "user", content: conversationText }
      ],
      max_tokens: 300,
      temperature: 0.5,
    });
    return response.choices[0]?.message?.content?.trim() || "Resumo indisponível.";
  } catch (err) {
    console.error("OpenAI summarize error:", err);
    return "Falha ao gerar resumo.";
  }
}

export async function analyzeIntent(message: string): Promise<string> {
  const client = getOpenAI();
  if (!client) return "Suporte";

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "Classifique a intenção da mensagem em uma categoria: Vendas, Suporte, Dúvida, Reclamação, Outros. Responda APENAS com a categoria."
        },
        { role: "user", content: message }
      ],
      max_tokens: 10,
      temperature: 0,
    });
    return response.choices[0]?.message?.content?.trim() || "Outros";
  } catch (err) {
    return "Outros";
  }
}
