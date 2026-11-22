# Code is baked in (not bind-mounted) so the container starts even while
# WSL folders are not mounted yet after a reboot; only /data is mounted.
FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
USER node
CMD ["node", "server.mjs"]
