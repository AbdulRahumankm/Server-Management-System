FROM node:20-alpine AS base
WORKDIR /app
COPY certs/ ./certs/
RUN touch ./certs/extra-ca.pem \
    && cat ./certs/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=base /app/certs ./certs
RUN cat ./certs/extra-ca.pem >> /etc/ssl/certs/ca-certificates.crt
ENV NODE_EXTRA_CA_CERTS=/app/certs/extra-ca.pem
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=base /app/dist ./dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/package.json ./package.json
EXPOSE 4003
CMD ["node", "dist/index.js"]
