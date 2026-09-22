FROM node:20-alpine AS base
WORKDIR /app
COPY certs/ ./certs/
RUN touch ./certs/extra-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=base /app/.next ./.next
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
