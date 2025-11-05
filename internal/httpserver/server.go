package httpserver

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/improbable-eng/grpc-web/go/grpcweb"
	"google.golang.org/grpc"
)

//go:embed web/*
var webFS embed.FS

type Server struct {
	srv *http.Server
}

func New(addr string, grpcSrv *grpc.Server) *Server {
	wrappedGrpc := grpcweb.WrapServer(grpcSrv,
		grpcweb.WithOriginFunc(func(origin string) bool { return true }),
		grpcweb.WithWebsockets(true),
		grpcweb.WithWebsocketOriginFunc(func(req *http.Request) bool { return true }),
		grpcweb.WithCorsForRegisteredEndpointsOnly(false),
	)

	webRoot, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatalf("Failed to create web filesystem: %v", err)
	}

	mux := http.NewServeMux()

	// gRPC-Web handler
	mux.HandleFunc("/telemetry.Telemetry/", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Grpc-Web, X-User-Agent")
		wrappedGrpc.ServeHTTP(w, r)
	})

	// Static files handler
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Проверяем, если это gRPC-Web запрос (fallback)
		if wrappedGrpc.IsGrpcWebRequest(r) || wrappedGrpc.IsGrpcWebSocketRequest(r) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, HEAD")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Grpc-Web, X-User-Agent")
			wrappedGrpc.ServeHTTP(w, r)
			return
		}

		// CORS для всех статических файлов
		w.Header().Set("Access-Control-Allow-Origin", "*")

		// Дефолтный путь
		path := r.URL.Path
		if path == "/" {
			path = "/index.html"
		}

		// Логируем запросы к статике
		log.Printf("Serving static file: %s", path)

		// Проверяем наличие файла
		if _, err := fs.Stat(webRoot, strings.TrimPrefix(path, "/")); err != nil {
			log.Printf("File not found: %s", path)
			http.NotFound(w, r)
			return
		}

		// Отдаём файл
		http.FileServer(http.FS(webRoot)).ServeHTTP(w, r)
	})

	return &Server{
		srv: &http.Server{
			Addr:         addr,
			Handler:      mux,
			ReadTimeout:  15 * time.Second,
			WriteTimeout: 60 * time.Second,
			IdleTimeout:  120 * time.Second,
			BaseContext: func(net.Listener) context.Context {
				return context.Background()
			},
		},
	}
}

func (s *Server) Serve() error {
	log.Printf("Starting HTTP/gRPC-Web server on %s", s.srv.Addr)
	return s.srv.ListenAndServe()
}

func (s *Server) Shutdown(ctx context.Context) error {
	log.Println("Shutting down HTTP server...")
	return s.srv.Shutdown(ctx)
}
