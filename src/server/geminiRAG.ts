import OpenAI from 'openai';
import { v4 as uuidv4 } from "uuid";
import { writeFileSync, readFileSync, existsSync } from 'fs';
import path from 'path';

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

// Banco de dados vetorial (persistência simples para desenvolvimento)
const VECTOR_STORE_PATH = path.join(process.cwd(), 'vectorStore.json');
let vectorStore: DocumentChunk[] = [];

// Carrega o banco ao iniciar o módulo
if (existsSync(VECTOR_STORE_PATH)) {
  try {
    const data = readFileSync(VECTOR_STORE_PATH, 'utf-8');
    vectorStore = JSON.parse(data);
    console.log(`[RAG] Banco vetorial carregado: ${vectorStore.length} chunks.`);
  } catch (e) {
    console.error("[RAG] Erro ao carregar banco vetorial:", e);
  }
}

function saveVectorStore() {
  try {
    writeFileSync(VECTOR_STORE_PATH, JSON.stringify(vectorStore, null, 2));
  } catch (e) {
    console.error("[RAG] Erro ao salvar banco vetorial:", e);
  }
}

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
  const text = fileBuffer.toString('utf-8');
  const chunks = splitIntoChunks(text);
  
  if (chunks.length === 0) {
    throw new Error("Documento vazio ou sem conteúdo legível.");
  }

  const embeddingResponse = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: chunks,
  });

  for (let i = 0; i < chunks.length; i++) {
    vectorStore.push({
      id: uuidv4(),
      text: chunks[i],
      embedding: embeddingResponse.data[i].embedding,
      metadata: { fileName, channelId }
    });
  }

  saveVectorStore();
  return { success: true, chunksProcessed: chunks.length };
}

/**
 * Transcreve áudio usando OpenAI Whisper
 */
export async function transcribeAudio(audioBuffer: Buffer): Promise<string> {
  const client = getOpenAI();
  
  // Whisper espera um arquivo real ou stream com nome/mimetype
  // Criamos um File fake para o SDK do Node
  const file = await OpenAI.toFile(audioBuffer, "audio.ogg", { type: "audio/ogg" });

  const response = await client.audio.transcriptions.create({
    model: "whisper-1",
    file: file,
  });

  return response.text;
}

/**
 * Calcula similaridade por Cosseno
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
 * Busca os N chunks mais relevantes
 */
export async function searchContext(query: string, channelId: string, topK: number = 5): Promise<string[]> {
  const client = getOpenAI();
  if (vectorStore.length === 0) return [];

  const queryEmbeddingRes = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });

  const queryVec = queryEmbeddingRes.data[0].embedding;

  const relevantDocs = vectorStore
    .filter(doc => doc.metadata.channelId === 'global' || doc.metadata.channelId === channelId)
    .map(doc => ({ text: doc.text, score: cosineSimilarity(queryVec, doc.embedding) }))
    .sort((a, b) => b.score - a.score)
    .filter(d => d.score > 0.3) // Filtro de relevância mínima
    .slice(0, topK);

  return relevantDocs.map(d => d.text);
}

/**
 * RAG completo: busca contexto + geração de resposta
 */
export async function generateRagResponse(userMessage: string, channelId: string, leadInfo?: { name?: string }): Promise<string> {
  const client = getOpenAI();
  const contextChunks = await searchContext(userMessage, channelId);
  
  const contextText = contextChunks.length > 0
    ? contextChunks.join('\n\n')
    : "Diga apenas que é assessor do Daniel Soranz e pergunte como pode ajudar, pois não encontrou detalhes específicos sobre este assunto na base.";

  const leadName = leadInfo?.name || "Eleitor(a)";

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Você é um assessor direto do candidato Daniel Soranz. 
Sua missão é dar respostas CURTAS, DIRETAS e sempre baseadas no contexto abaixo.

Regras de Ouro:
1. Responda em no máximo 2 ou 3 frases curtas.
2. Seja objetivo. Se a resposta estiver no contexto, use-a. 
3. Se não souber, diga: "Ainda não tenho essa informação confirmada, mas posso anotar para nossa equipe te responder."
4. Trate o eleitor pelo nome (${leadName}) de forma natural.
5. Foco total em propostas e ações do Daniel Soranz.

CONTEXTO:
${contextText}`
      },
      { role: "user", content: userMessage }
    ],
    max_tokens: 250,
    temperature: 0.5, // Menos criatividade, mais precisão
  });

  return response.choices[0]?.message?.content?.trim() || "Posso te ajudar em algo mais?";
}
