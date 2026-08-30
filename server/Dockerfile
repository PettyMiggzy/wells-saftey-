# Build context is the repository root: docker build -f server/Dockerfile .
#
# node:sqlite ships with Node and the server has no npm dependencies, so there
# is no install step, no lockfile to drift, and nothing to audit.
FROM node:22-alpine

RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

# --- API ---
COPY server/package.json ./
COPY server/src ./src

# --- the site, served from the same origin as the API so the session cookie
#     stays first-party and CORS never enters the picture ---
# Glob rather than a list: naming pages individually meant every new page had
# to be remembered here, and faq/reviews/guide/404 were already missing.
COPY *.html ./site/
COPY robots.txt sitemap.xml ./site/
COPY css    ./site/css
COPY js     ./site/js
COPY assets ./site/assets

ENV NODE_ENV=production \
    PORT=8080 \
    DB_FILE=/data/wellssafety.db \
    PHOTO_DIR=/data/photos \
    STATIC_DIR=/app/site

RUN mkdir -p /data && chown -R app:app /data /app
USER app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
