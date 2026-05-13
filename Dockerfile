# Use a imagem base do Node.js com Chromium pré-instalado para o Puppeteer
FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Define o diretório de trabalho
WORKDIR /app

# Copia os arquivos de dependências
COPY package*.json ./

# Instala as dependências
RUN npm install

# Copia o restante dos arquivos do projeto
COPY . .

# Expõe a porta que o servidor usa
EXPOSE 3002

# Define variáveis de ambiente padrão (devem ser sobrescritas no deploy)
ENV NODE_ENV=production
ENV PORT=3002
ENV CHROME_PATH=/usr/bin/google-chrome-stable

# Comando para iniciar a aplicação
# Nota: Usamos tsx para rodar o server.ts direto ou compilamos.
# Para produção, o ideal é compilar para JS, mas o tsx funciona bem em containers modernos.
CMD ["npx", "tsx", "server.ts"]
