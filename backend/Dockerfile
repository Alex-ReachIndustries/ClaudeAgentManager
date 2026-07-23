# Debian (glibc) base: onnxruntime-node (used by @huggingface/transformers for
# local embeddings) ships glibc prebuilt binaries and cannot load on Alpine/musl.
FROM node:20-slim
WORKDIR /app
# libgomp1 is required by onnxruntime-node's native runtime.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
EXPOSE 3001
CMD ["node", "dist/server.js"]
