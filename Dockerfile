# syntax=docker/dockerfile:1

# ---- build ----
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
ARG VERSION=dev
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/bug-trail . \
 && mkdir -p /out/data

# ---- run ----
# Static binary on distroless: no shell, no package manager, runs as non-root (uid 65532).
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/bug-trail /usr/local/bin/bug-trail
# Owned by the nonroot user so a fresh named volume mounted here is writable.
COPY --from=build --chown=65532:65532 /out/data /data

ENV BUG_TRAIL_DIR=/data \
    BUG_TRAIL_HOST=0.0.0.0 \
    PORT=4317
VOLUME /data
EXPOSE 4317

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/usr/local/bin/bug-trail", "healthcheck"]

ENTRYPOINT ["/usr/local/bin/bug-trail"]
CMD ["serve"]
