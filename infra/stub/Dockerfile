FROM public.ecr.aws/docker/library/golang:1.22-alpine AS builder
WORKDIR /app
COPY main.go .
RUN go mod init stub && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o stub .

FROM public.ecr.aws/docker/library/alpine:3.20
RUN apk add --no-cache curl
COPY --from=builder /app/stub /stub
EXPOSE 8080
CMD ["/stub"]
