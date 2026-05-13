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
export async function searchContext(query: string, channelId: string, topK: number = 6): Promise<string[]> {
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
    .slice(0, topK);

  return relevantDocs.map(d => d.text);
}

/**
 * RAG completo: busca contexto + geração de resposta com histórico
 */
export async function generateRagResponse(
  userMessage: string, 
  channelId: string, 
  leadInfo?: { name?: string },
  history: string = ""
): Promise<string> {
  const client = getOpenAI();
  
  // Busca contexto baseado na pergunta atual E um pouco do histórico se houver
  const searchQueries = history ? `${history.split('\n').slice(-2).join('\n')}\n${userMessage}` : userMessage;
  const contextChunks = await searchContext(searchQueries, channelId, 6);
  
  const contextText = contextChunks.length > 0
    ? contextChunks.join('\n\n')
    : "INFORMAÇÃO: Não há dados específicos no manual para esta pergunta. Responda como Assessor do Daniel Soranz, seja gentil, e diga que vai verificar com a coordenação técnica.";

  const leadName = leadInfo?.name || "Eleitor(a)";

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Você é o Assessor Digital do Deputado Federal Daniel Soranz.
Seu tom de voz deve ser: ACOLHEDOR, TÉCNICO e BASEADO EM DADOS.

Diretrizes de Personalidade (Baseadas no Dossiê):
1. Daniel Soranz é Médico Sanitarista, focado em Ciência e Eficiência na Gestão Pública.
2. Ele defende a Saúde como política de Estado, técnica e imune a ideologias partidárias extremas.
3. Principais bandeiras: Clínicas da Família, Cegonha Carioca, Centros de Autismo (TEA) e base em dados (CIE).

Regras de Conversação:
- Responda de forma CURTA (máximo 3 frases).
- Seja SEMPRE objetivo. Se a resposta estiver no contexto técnico, use-a.
- Trate o eleitor pelo nome (${leadName}) de forma natural.
- Use o histórico recente para manter a coerência da conversa.

CONTEXTO TÉCNICO (Dossiê/RAG):
${contextText}

HISTÓRICO RECENTE:
${history || "Início de conversa."}`
      },
      { role: "user", content: userMessage }
    ],
    max_tokens: 300,
    temperature: 0.6,
  });

  return response.choices[0]?.message?.content?.trim() || "Como posso ajudar você e o Daniel Soranz hoje?";
}
