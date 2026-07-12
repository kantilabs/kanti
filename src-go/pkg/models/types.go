package models

import (
	"net/http"
	"time"
)

// RequestDetails represents a captured HTTP request/response
type RequestDetails struct {
	ID              int         `json:"id"`
	Host            string      `json:"host"`
	Method          string      `json:"method"`
	Path            string      `json:"path"`
	Query           string      `json:"query,omitempty"`
	Headers         http.Header `json:"headers"`
	Timestamp       time.Time   `json:"timestamp"`
	ResponseLength  int         `json:"responseLength"`
	Status          int         `json:"status"`
	ResponseTime    int64       `json:"responseTime"` // milliseconds
	Protocol        string      `json:"protocol"`     // "http" or "https"
	Body            string      `json:"body,omitempty"`
	ResponseBody    string      `json:"responseBody,omitempty"`
	ResponseHeaders http.Header `json:"responseHeaders,omitempty"`
	Error           string      `json:"error,omitempty"`
}

// ProxyConfig holds proxy server configuration
type ProxyConfig struct {
	Port            int               `json:"port"`
	SSLInterception bool              `json:"sslInterception"`
	CustomHeaders   map[string]string `json:"customHeaders"`
	SaveOnlyInScope bool              `json:"saveOnlyInScope"`
	InScope         []string          `json:"inScope"`
	OutOfScope      []string          `json:"outOfScope"`
	CertPath        string            `json:"certPath"`
}

// ProxyStatus represents the current state of the proxy
type ProxyStatus struct {
	IsRunning       bool   `json:"isRunning"`
	Port            int    `json:"port"`
	CertificatePath string `json:"certificatePath"`
}

// WebSocketConnection represents an intercepted WebSocket connection (real capture).
type WebSocketConnection struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	Host      string    `json:"host"`
	Path      string    `json:"path"`
	Protocol  string    `json:"protocol"` // "ws" (plaintext) or "wss" (TLS)
	Timestamp time.Time `json:"timestamp"`
	Status    string    `json:"status"` // "open" or "closed"
}

// WebSocketMessage represents a single WebSocket frame/message captured from the wire.
type WebSocketMessage struct {
	ID           string    `json:"id"`
	ConnectionID string    `json:"connectionId"`
	Direction    string    `json:"direction"` // "outgoing" (client->server) or "incoming" (server->client)
	Opcode       string    `json:"opcode"`    // "text", "binary", "ping", "pong", "close"
	Payload      string    `json:"payload"`
	Length       int       `json:"length"`
	Timestamp    time.Time `json:"timestamp"`
}

// IPCMessage represents a message sent over IPC
type IPCMessage struct {
	Type string      `json:"type"`
	ID   string      `json:"id"`
	Data interface{} `json:"data,omitempty"`
}

// IPCResponse represents a response to an IPC message
type IPCResponse struct {
	ID      string      `json:"id"`
	Success bool        `json:"success"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// IPCEvent represents an event broadcast over IPC
type IPCEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}
