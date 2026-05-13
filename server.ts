import 'dotenv/config'; // DEVE ser o primeiro import — carrega o .env antes de qualquer outro módulo
import express from "express";
import http from "http";
import { createServer as createViteServer } from "vite";
import path from "path";
import { Server as SocketIOServer } from "socket.io";
import multer from "multer";
import { processDocument, generateRagResponse } from "./src/server/geminiRAG.js";
import { loadAgenda, addEvent, updateEvent, deleteEvent, type AgendaEvent } from "./src/server/agendaAgent.js";

const upload = multer({ storage: multer.memoryStorage() });

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3002;

  // Middleware for parsing JSON
  app.use(express.json());

  // Cria o servidor HTTP explicitamente para ser compartilhado
  // entre Express, Socket.IO e Vite HMR
  const httpServer = http.createServer(app);

  // Inicializa Socket.IO no mesmo servidor HTTP
  const io = new SocketIOServer(httpServer, {
    cors: { origin: "*" }
  });

  // Torna o io acessível globalmente (para uso nos webhooks)
  (global as any).io = io;

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
  });

  // --- META WEBHOOK (WhatsApp & Instagram) ---

  // VERIFICAÇÃO DO WEBHOOK (GET)
  const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "meu_token_secreto_123";

  app.get("/api/webhooks/meta", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === META_VERIFY_TOKEN) {
      console.log("[Webhook] Verificado com sucesso pela Meta.");
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  // RECEBIMENTO DE EVENTOS (POST)
  app.post("/api/webhooks/meta", async (req, res) => {
    try {
      const payload = req.body;

      if (payload.object !== "whatsapp_business_account" && payload.object !== "instagram" && payload.object !== "page") {
        return res.sendStatus(404);
      }

      console.log(`[Webhook] Evento recebido - Source: ${payload.object}`);

      let provider: 'whatsapp' | 'instagram' = 'whatsapp';
      let incomingMessageText = '';
      let senderId = '';
      let businessId = '';

      if (payload.object === "whatsapp_business_account") {
        provider = 'whatsapp';
        const entry = payload.entry?.[0];
        businessId = entry?.id;
        const changes = entry?.changes?.[0]?.value;
        const message = changes?.messages?.[0];
        if (message) {
          senderId = message.from;
          incomingMessageText = message.text?.body || '';
        }
      } else if (payload.object === "instagram" || payload.object === "page") {
        provider = 'instagram';
        const entry = payload.entry?.[0];
        businessId = entry?.id;
        const messaging = entry?.messaging?.[0];
        if (messaging) {
          senderId = messaging.sender?.id;
          incomingMessageText = messaging.message?.text || '';
        }
      }

      if (incomingMessageText && senderId) {
        console.log(`[${provider.toUpperCase()}] Mensagem de ${senderId}: ${incomingMessageText}`);

        io.emit("new_message", {
          contactId: senderId,
          provider,
          text: incomingMessageText,
          sender: "contact",
          timestamp: new Date().toISOString()
        });

        try {
          const iaResponse = await generateRagResponse(incomingMessageText, businessId);
          console.log(`[IA RAG] Resposta Gerada: ${iaResponse}`);

          io.emit("new_message", {
            contactId: senderId,
            provider,
            text: iaResponse,
            sender: "bot",
            timestamp: new Date().toISOString()
          });
        } catch (e) {
          console.error("[IA RAG] Falha ao processar RAG no webhook", e);
        }
      }

      res.status(200).send("EVENT_RECEIVED");
    } catch (error) {
      console.error("[Webhook] Erro Processando", error);
      res.sendStatus(500);
    }
  });

  // --- ENDPOINT UPLOAD RAG ---
  app.post("/api/rag/upload", upload.single("document"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "Nenhum arquivo enviado" });
      }
      const channelId = req.body.channelId || 'global';
      const result = await processDocument(req.file.buffer, req.file.originalname, channelId);
      res.json({ message: "Documento vetorizado com sucesso", ...result });
    } catch (error) {
      console.error("[RAG Upload]", error);
      res.status(500).json({ error: "Erro ao vetorizar documento" });
    }
  });

  // --- WA WEB ENDPOINTS ---
  app.get("/api/wa-web/status", async (req, res) => {
    try {
      const { getWhatsAppWebStatus } = await import("./src/server/whatsappWebClient.js");
      res.json(getWhatsAppWebStatus());
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/wa-web/connect", async (req, res) => {
    try {
      const { initializeWhatsAppWeb } = await import("./src/server/whatsappWebClient.js");
      initializeWhatsAppWeb(io);
      res.json({ success: true, message: 'Iniciando conexão...' });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/wa-web/disconnect", async (req, res) => {
    try {
      const { disconnectWhatsAppWeb } = await import("./src/server/whatsappWebClient.js");
      disconnectWhatsAppWeb();
      res.json({ success: true, message: 'Desconectado.' });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // --- AGENDA ENDPOINTS ---
  // GET todos os eventos
  app.get("/api/agenda", (req, res) => {
    try {
      const events = loadAgenda();
      res.json(events);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // POST criar evento
  app.post("/api/agenda", (req, res) => {
    try {
      const body = req.body as Omit<AgendaEvent, 'id' | 'createdAt' | 'updatedAt'>;
      if (!body.title || !body.date || !body.time) {
        return res.status(400).json({ error: 'Campos obrigatórios: title, date, time' });
      }
      const newEvent = addEvent(body);
      io.emit('agenda_updated', { timestamp: new Date().toISOString() });
      res.status(201).json(newEvent);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // PATCH atualizar evento
  app.patch("/api/agenda/:id", (req, res) => {
    try {
      const updated = updateEvent(req.params.id, req.body);
      if (!updated) return res.status(404).json({ error: 'Evento não encontrado' });
      io.emit('agenda_updated', { timestamp: new Date().toISOString() });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // DELETE remover evento
  app.delete("/api/agenda/:id", (req, res) => {
    try {
      const deleted = deleteEvent(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Evento não encontrado' });
      io.emit('agenda_updated', { timestamp: new Date().toISOString() });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // POST teste: enviar resumo diário manualmente
  app.post("/api/agenda/test/daily-summary", async (req, res) => {
    try {
      const { sendDailySummary } = await import("./src/server/agendaScheduler.js");
      await sendDailySummary();
      res.json({ success: true, message: 'Resumo diário enviado.' });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        // Compartilha o mesmo servidor HTTP para o HMR WebSocket
        // Evita conflito com Socket.IO (erro 426 Upgrade Required)
        hmr: { server: httpServer }
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Inicia o servidor HTTP
  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on http://localhost:${PORT}`);
  });
}

startServer();
