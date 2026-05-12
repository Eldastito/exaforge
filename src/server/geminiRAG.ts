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
 * Divide o texto em chunks por parágrafo e garante que nenhum chunk seja excessivamente grande.
 */
function splitIntoChunks(text: string, maxChunkLength: number = 4000): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const chunks: string[] = [];
  
  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    
    if (trimmed.length > maxChunkLength) {
      // Se um parágrafo for gigante, quebra ele em partes menores
      for (let i = 0; i < trimmed.length; i += maxChunkLength) {
        chunks.push(trimmed.substring(i, i + maxChunkLength));
      }
    } else {
      chunks.push(trimmed);
    }
  }
  return chunks;
}

/**
 * Processa e indexa um documento no banco vetorial usando OpenAI Embeddings
 */
export async function processDocument(fileBuffer: Buffer, fileName: string, channelId: string = 'global') {
  const client = getOpenAI();

  // 1. Extração de texto
  const text = fileBuffer.toString('utf-8');

  // 2. Chunks (agora com proteção de tamanho)
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
export async function generateRagResponse(userMessage: string, channelId: string, leadInfo?: { name?: string }): Promise<string> {
  const client = getOpenAI();

  const contextChunks = await searchContext(userMessage, channelId);
  const contextText = contextChunks.length > 0
    ? contextChunks.join('\n\n---\n\n')
    : "Nenhum dado específico encontrado na base. Responda cordialmente com base nos conhecimentos gerais da campanha.";

  const leadName = leadInfo?.name || "Eleitor(a)";

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Você é um assessor de campanha política humanizado e inteligente. 
Seu objetivo é conversar com o eleitor(a) de forma cordial, empática e prestativa.

Estamos conversando com: ${leadName}. Use o nome dele(a) ocasionalmente para ser mais próximo.

Use o CONTEXTO abaixo (extraído da nossa base de conhecimento) para fundamentar suas respostas.
Se a informação solicitada não estiver no contexto, seja honesto e diga que não tem essa informação agora, mas que pode anotar o contato para um assessor humano retornar.

Diretrizes:
1. Responda como um humano, não use linguagem robótica.
2. Seja conciso mas acolhedor.
3. Chame o contato de eleitor(a) se não souber o nome, mas aqui o nome identificado é: ${leadName}.

CONTEXTO DA CAMPANHA:
${contextText}`
      },
      { role: "user", content: userMessage }
    ],
    max_tokens: 400,
    temperature: 0.7,
  });

  return response.choices[0]?.message?.content?.trim() || "Desculpe, tive um problema técnico. Posso te ajudar em algo mais?";
}
