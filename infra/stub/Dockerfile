FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init stub && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o stub .

FROM scratch
COPY --from=builder /app/stub /stub
EXPOSE 8080
CMD ["/stub"]
