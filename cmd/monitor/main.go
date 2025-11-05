// cmd/monitor/main.go
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"

	"monitor/internal/collector"
	"monitor/internal/grpcserver"
	"monitor/internal/httpserver"
)

func main() {
	// Минимизация GC паузы
	debug.SetGCPercent(75)
	debug.SetMemoryLimit(256 << 20) // 256MB лимит
	
	ctx, stop := signal.NotifyContext(context.Background(), 
		os.Interrupt, syscall.SIGTERM, syscall.SIGQUIT)
	defer stop()

	// Увеличен интервал до 1 секунды
	coll := collector.New(collector.Config{
		Interval: 1000 * time.Millisecond,
		TopN:     20, // Снижено до 20 процессов
	})
	defer coll.Close()

	grpcSrv := grpcserver.New(":50051", coll)
	httpSrv := httpserver.New(":9183", grpcSrv.Server())

	errCh := make(chan error, 2)
	
	go func() {
		log.Println("Starting gRPC server on :50051")
		if err := grpcSrv.Serve(); err != nil {
			errCh <- err
		}
	}()
	
	go func() {
		log.Println("Starting HTTP server on :9183")
		if err := httpSrv.Serve(); err != nil {
			errCh <- err
		}
	}()

	select {
	case <-ctx.Done():
		log.Println("Shutdown signal received")
	case err := <-errCh:
		log.Printf("Server error: %v", err)
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP shutdown error: %v", err)
	}
	grpcSrv.GracefulStop()
	
	log.Println("Shutdown complete")
}
