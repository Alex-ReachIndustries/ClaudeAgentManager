FROM python:3.12-slim

# System deps for WeasyPrint rendering + Chromium for mermaid-cli
RUN apt-get update -qq && \
    apt-get install -y -qq --no-install-recommends \
      libpango-1.0-0 libpangocairo-1.0-0 libcairo2 \
      libglib2.0-0 libharfbuzz0b libfontconfig1 \
      shared-mime-info fonts-liberation fonts-dejavu-core fontconfig \
      curl ca-certificates \
      chromium \
      nodejs npm && \
    fc-cache -f && \
    rm -rf /var/lib/apt/lists/*

# Python packages
RUN pip install --no-cache-dir weasyprint cairosvg pillow fastapi uvicorn

# mermaid-cli
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
RUN npm install -g @mermaid-js/mermaid-cli

WORKDIR /app

EXPOSE 8090

CMD ["uvicorn", "api_wrapper:app", "--host", "0.0.0.0", "--port", "8090"]
