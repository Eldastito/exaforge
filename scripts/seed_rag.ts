import { processDocument } from '../src/server/geminiRAG';
import fs from 'fs';
import path from 'path';

async function seed() {
  const filePath = path.resolve(__dirname, '../dossie_soranz.txt');
  if (!fs.existsSync(filePath)) {
    console.error('Arquivo dossie_soranz.txt não encontrado.');
    return;
  }

  const content = fs.readFileSync(filePath);
  console.log('Iniciando vetorização do Dossiê Daniel Soranz...');
  
  try {
    await processDocument(content, 'dossie_soranz.txt', 'global');
    console.log('✅ Dossiê Daniel Soranz vetorizado e salvo com sucesso no vectorStore.json!');
  } catch (error) {
    console.error('❌ Erro ao vetorizar dossiê:', error);
  }
}

seed();
