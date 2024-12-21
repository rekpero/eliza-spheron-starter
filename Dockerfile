# Use Node.js 22 as base image
FROM node:23

ENV DEBIAN_FRONTEND=noninteractive 

# Install pnpm and required dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && npm install -g pnpm

# Configure pnpm
RUN pnpm config set registry https://registry.npmmirror.com
RUN pnpm config set network-timeout 100000

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install

# Copy source code
COPY . .

# Expose ports for both services
EXPOSE 3000

RUN chmod +x /app/start.sh

# Start both services
CMD ["/app/start.sh"]
