import OpenAI from 'openai';
import { v4 as uuidv4 } from "uuid";

// Instância lazy — evita crash no import quando OPENAI_API_KEY não está disponível
let _openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("[geminiRAG] OPENAI_API_KEY não configurada. Configure a variável de ambiente antes de usar o RAG.");
    }
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

interface DocumentChunk {
  id: string;
  text: string;
  embedding: number[];
  metadata: {
    fileName: string;
    channelId: string | 'global';
  };
}

// Banco de dados vetorial em memória (produção: use pgvector ou Pinecone)
const vectorStore: DocumentChunk[] = [];

/**
 * Divide o texto em chunks por parágrafo
 */
function splitIntoChunks(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  return paragraphs.filter(p => p.trim().length > 0);
}

/**
 * Processa e indexa um documento no banco vetorial usando OpenAI Embeddings
 */
export async function processDocument(fileBuffer: Buffer, fileName: string, channelId: string = 'global') {
  const client = getOpenAI();

  // 1. Extração de texto (TXT/CSV; para PDF seria necessário um parser como pdf-parse)
  const text = fileBuffer.toString('utf-8');

  // 2. Chunks
  const chunks = splitIntoChunks(text);
  if (chunks.length === 0) {
    throw new Error("Documento vazio ou sem conteúdo legível.");
  }

  // 3. Vetorização via OpenAI Embeddings (batch)
  const embeddingResponse = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: chunks,
  });

  // 4. Salvar no banco vetorial em memória
  for (let i = 0; i < chunks.length; i++) {
    vectorStore.push({
      id: uuidv4(),
      text: chunks[i],
      embedding: embeddingResponse.data[i].embedding,
      metadata: { fileName, channelId }
    });
  }

  return { success: true, chunksProcessed: chunks.length };
}

/**
 * Calcula similaridade por Cosseno entre dois vetores
 */
function cosineSimilarity(A: number[], B: number[]): number {
  let dot = 0, mA = 0, mB = 0;
  for (let i = 0; i < A.length; i++) {
    dot += A[i] * B[i];
    mA += A[i] * A[i];
    mB += B[i] * B[i];
  }
  const denom = Math.sqrt(mA) * Math.sqrt(mB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Busca os N chunks mais relevantes para a query
 */
export async function searchContext(query: string, channelId: string, topK: number = 3): Promise<string[]> {
  const client = getOpenAI();

  if (vectorStore.length === 0) return [];

  const queryEmbeddingRes = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });

  const queryVec = queryEmbeddingRes.data[0].embedding;

  // Filtrar por canal e calcular similaridade
  const relevantDocs = vectorStore
    .filter(doc => doc.metadata.channelId === 'global' || doc.metadata.channelId === channelId)
    .map(doc => ({ text: doc.text, score: cosineSimilarity(queryVec, doc.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  return relevantDocs.map(d => d.text);
}

/**
 * RAG completo: busca contexto + geração de resposta via OpenAI
 */
export async function generateRagResponse(userMessage: string, channelId: string): Promise<string> {
  const client = getOpenAI();

  const contextChunks = await searchContext(userMessage, channelId);
  const contextText = contextChunks.length > 0
    ? contextChunks.join('\n\n---\n\n')
    : "Nenhum documento adicional encontrado na base de conhecimento.";

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Você é um assistente de IA humanizado representando nossa empresa via WhatsApp/Instagram.
Use o CONTEXTO abaixo para responder à pergunta do cliente.
Se a resposta não estiver no contexto, diga educadamente que vai transferir para um atendente humano.
Seja conciso, educado e formate a resposta para chat.

CONTEXTO:
${contextText}`
      },
      { role: "user", content: userMessage }
    ],
    max_tokens: 300,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content?.trim() || "Desculpe, ocorreu um erro ao gerar a resposta.";
}
