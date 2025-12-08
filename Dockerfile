# Use Node.js 20 LTS
FROM node:20-slim

# Install system dependencies required for Playwright Chromium
RUN apt-get update && apt-get install -y \
    # Core Chromium dependencies
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    libatspi2.0-0 \
    libxshmfence1 \
    libx11-xcb1 \
    # Additional dependencies
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libgtk-3-0 \
    xdg-utils \
    # Cleanup to reduce image size
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json yarn.lock* ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Install Playwright Chromium (without system deps since we installed them above)
RUN yarn playwright install chromium

# Copy application code
COPY . .

# Expose port
EXPOSE 3001

# Start the application
CMD ["yarn", "start"]

