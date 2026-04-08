# Frontend - build only; serve static files with Node (no Nginx in this image)
# Build context must be repo root (.)
FROM node:20-alpine AS build

WORKDIR /app


ARG VITE_API_URL=http://15.206.209.185:5000
ARG VITE_FRONTEND_URL=http://15.206.209.185:3000

ARG VITE_MODE=production
ARG VITE_HUB_API_URL=
ARG VITE_HUB_OAUTH_REDIRECT_URL=
ARG VITE_HUB_PROFILE_PIC_API_KEY=

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_FRONTEND_URL=$VITE_FRONTEND_URL
ENV VITE_MODE=$VITE_MODE
ENV VITE_HUB_API_URL=$VITE_HUB_API_URL
ENV VITE_HUB_OAUTH_REDIRECT_URL=$VITE_HUB_OAUTH_REDIRECT_URL
ENV VITE_HUB_PROFILE_PIC_API_KEY=$VITE_HUB_PROFILE_PIC_API_KEY

COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# Static app + /iframe-preview/<port>/ proxy (same behavior as Vite dev)
FROM node:20-alpine
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
# --ignore-scripts: prepare runs husky (devDependency); not needed in the runtime image
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/dist ./dist
COPY --from=build /app/serve-static.mjs /app/iframePreviewProxy.js ./
EXPOSE 80
ENV PORT=80
# Preview servers listen on the backend container; override only for custom topologies
ENV IFRAME_PREVIEW_HOST=http://backend
CMD ["node", "serve-static.mjs"]
