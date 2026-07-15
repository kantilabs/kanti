package ipc

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/1342tools/kanti/backend/internal/proxy"
	"github.com/1342tools/kanti/backend/pkg/models"
)

// Server handles IPC communication with Electron
type Server struct {
	proxyServer *proxy.ProxyServer
	httpServer  *http.Server
	port        int
	mu          sync.RWMutex

	// Event channels for streaming events to clients
	eventClients   map[chan models.IPCEvent]bool
	eventClientsMu sync.RWMutex
}

// NewServer creates a new IPC server
func NewServer(proxyServer *proxy.ProxyServer, port int) *Server {
	s := &Server{
		proxyServer:  proxyServer,
		port:         port,
		eventClients: make(map[chan models.IPCEvent]bool),
	}

	// Set up proxy event handlers
	proxyServer.SetOnBatchFlush(s.handleBatchFlush)

	// Wire real WebSocket capture callbacks to SSE broadcasts.
	proxyServer.SetOnWebSocketConnection(func(conn models.WebSocketConnection) {
		s.broadcast(models.IPCEvent{Type: "websocket-connection", Data: conn})
	})
	proxyServer.SetOnWebSocketMessage(func(msg models.WebSocketMessage) {
		s.broadcast(models.IPCEvent{Type: "websocket-message", Data: msg})
	})
	proxyServer.SetOnWebSocketClose(func(conn models.WebSocketConnection) {
		s.broadcast(models.IPCEvent{Type: "websocket-close", Data: conn})
	})

	return s
}

// broadcast sends an IPC event to all connected SSE clients (non-blocking).
func (s *Server) broadcast(event models.IPCEvent) {
	s.eventClientsMu.RLock()
	defer s.eventClientsMu.RUnlock()
	for client := range s.eventClients {
		select {
		case client <- event:
		default:
			// Client buffer full, skip.
		}
	}
}

// Start starts the IPC HTTP server
func (s *Server) Start() error {
	mux := http.NewServeMux()

	// API endpoints
	mux.HandleFunc("/api/proxy/start", s.handleStart)
	mux.HandleFunc("/api/proxy/stop", s.handleStop)
	mux.HandleFunc("/api/proxy/status", s.handleStatus)
	mux.HandleFunc("/api/proxy/config", s.handleConfig)
	mux.HandleFunc("/api/proxy/requests", s.handleRequests)
	mux.HandleFunc("/api/proxy/clear", s.handleClear)
	mux.HandleFunc("/api/websocket/connections", s.handleWSConnections)
	mux.HandleFunc("/api/websocket/messages", s.handleWSMessages)
	mux.HandleFunc("/api/websocket/clear", s.handleWSClear)
	mux.HandleFunc("/api/events", s.handleEvents)

	// Enable CORS for Electron
	handler := corsMiddleware(mux)

	s.httpServer = &http.Server{
		Addr:    fmt.Sprintf(":%d", s.port),
		Handler: handler,
	}

	log.Printf("IPC server listening on port %d\n", s.port)
	return s.httpServer.ListenAndServe()
}

// Stop stops the IPC server
func (s *Server) Stop() error {
	if s.httpServer != nil {
		return s.httpServer.Close()
	}
	return nil
}

// corsMiddleware adds CORS headers for Electron
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// handleStart starts the proxy server
func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Port int `json:"port"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Update config with port
	config := s.proxyServer.GetConfig()
	config.Port = req.Port
	s.proxyServer.UpdateConfig(config)

	// Start proxy
	if err := s.proxyServer.Start(); err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	sendSuccess(w, s.proxyServer.GetStatus())
}

// handleStop stops the proxy server
func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := s.proxyServer.Stop(); err != nil {
		sendError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	sendSuccess(w, s.proxyServer.GetStatus())
}

// handleStatus returns the proxy server status
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sendSuccess(w, s.proxyServer.GetStatus())
}

// handleConfig handles config get/update
func (s *Server) handleConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		sendSuccess(w, s.proxyServer.GetConfig())

	case http.MethodPost:
		var config models.ProxyConfig
		if err := json.NewDecoder(r.Body).Decode(&config); err != nil {
			sendError(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		s.proxyServer.UpdateConfig(&config)
		sendSuccess(w, s.proxyServer.GetConfig())

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleRequests returns cached requests
func (s *Server) handleRequests(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	requests := s.proxyServer.GetRequests()
	sendSuccess(w, requests)
}

// handleClear clears cached requests
func (s *Server) handleClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.proxyServer.ClearRequests()
	sendSuccess(w, map[string]bool{"success": true})
}

// handleWSConnections returns all captured WebSocket connections.
func (s *Server) handleWSConnections(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sendSuccess(w, s.proxyServer.GetWebSocketConnections())
}

// handleWSMessages returns captured messages for a connection: /api/websocket/messages?conn=<id>
func (s *Server) handleWSMessages(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	connID := r.URL.Query().Get("conn")
	if connID == "" {
		sendError(w, "conn query parameter required", http.StatusBadRequest)
		return
	}
	sendSuccess(w, s.proxyServer.GetWebSocketMessages(connID))
}

// handleWSClear clears all captured WebSocket data.
func (s *Server) handleWSClear(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	s.proxyServer.ClearWebSockets()
	sendSuccess(w, map[string]bool{"success": true})
}

// handleEvents handles Server-Sent Events for streaming proxy events
func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Set headers for SSE
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	// Create event channel for this client
	eventChan := make(chan models.IPCEvent, 100)

	// Register client
	s.eventClientsMu.Lock()
	s.eventClients[eventChan] = true
	s.eventClientsMu.Unlock()

	// Remove client on disconnect
	defer func() {
		s.eventClientsMu.Lock()
		delete(s.eventClients, eventChan)
		close(eventChan)
		s.eventClientsMu.Unlock()
	}()

	// Stream events
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	for {
		select {
		case event := <-eventChan:
			data, err := json.Marshal(event)
			if err != nil {
				log.Printf("Error marshaling event: %v\n", err)
				continue
			}

			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()

		case <-r.Context().Done():
			return
		}
	}
}

// handleBatchFlush handles batch flush events from proxy
func (s *Server) handleBatchFlush(requests []models.RequestDetails, responses []models.RequestDetails) {
	s.eventClientsMu.RLock()
	defer s.eventClientsMu.RUnlock()

	// Broadcast request batch
	if len(requests) > 0 {
		event := models.IPCEvent{
			Type: "proxy-request-batch",
			Data: requests,
		}

		for client := range s.eventClients {
			select {
			case client <- event:
			default:
				// Client buffer full, skip
			}
		}
	}

	// Broadcast response batch
	if len(responses) > 0 {
		event := models.IPCEvent{
			Type: "proxy-response-batch",
			Data: responses,
		}

		for client := range s.eventClients {
			select {
			case client <- event:
			default:
				// Client buffer full, skip
			}
		}
	}
}

// sendSuccess sends a successful JSON response
func sendSuccess(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"data":    data,
	})
}

// sendError sends an error JSON response
func sendError(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": false,
		"error":   message,
	})
}
