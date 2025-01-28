FROM node:20-alpine

WORKDIR /usr/src/app

# Copy only the compiled JavaScript files and package files
COPY package*.json ./
RUN npm install --production

# Copy precompiled code (from dist folder)
COPY dist ./dist

# Start the application
CMD ["node", "dist/services/server.js"]
