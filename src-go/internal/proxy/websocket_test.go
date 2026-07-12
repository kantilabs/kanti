package proxy

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// encodeFrame builds a WebSocket frame on the wire (used by tests to synthesize
// client-masked and server-unmasked frames).
func encodeFrame(fin bool, opcode byte, payload []byte, mask bool) []byte {
	var b []byte
	b0 := opcode
	if fin {
		b0 |= 0x80
	}
	b = append(b, b0)

	n := len(payload)
	var b1 byte
	if mask {
		b1 = 0x80
	}
	switch {
	case n < 126:
		b = append(b, b1|byte(n))
	case n < 65536:
		b = append(b, b1|126, byte(n>>8), byte(n))
	default:
		b = append(b, b1|127)
		var ext [8]byte
		binary.BigEndian.PutUint64(ext[:], uint64(n))
		b = append(b, ext[:]...)
	}

	if mask {
		key := []byte{0x37, 0xfa, 0x21, 0x3d}
		b = append(b, key...)
		for i := 0; i < n; i++ {
			b = append(b, payload[i]^key[i&3])
		}
	} else {
		b = append(b, payload...)
	}
	return b
}

// TestWebSocketParseFrame drives ParseFrame with canonical RFC 6455 §5.7 byte
// vectors plus a 16-bit extended-length frame and every control opcode.
func TestWebSocketParseFrame(t *testing.T) {
	big := bytes.Repeat([]byte("x"), 256) // forces 16-bit extended length

	cases := []struct {
		name       string
		raw        []byte
		wantFIN    bool
		wantOpcode byte
		wantPayld  []byte
	}{
		{
			name:       "masked client text Hello",
			raw:        []byte{0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58},
			wantFIN:    true,
			wantOpcode: opcodeText,
			wantPayld:  []byte("Hello"),
		},
		{
			name:       "unmasked server text Hello",
			raw:        []byte{0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f},
			wantFIN:    true,
			wantOpcode: opcodeText,
			wantPayld:  []byte("Hello"),
		},
		{
			name:       "16-bit extended length binary",
			raw:        encodeFrame(true, opcodeBinary, big, false),
			wantFIN:    true,
			wantOpcode: opcodeBinary,
			wantPayld:  big,
		},
		{
			name:       "unmasked ping",
			raw:        []byte{0x89, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f},
			wantFIN:    true,
			wantOpcode: opcodePing,
			wantPayld:  []byte("Hello"),
		},
		{
			name:       "unmasked pong",
			raw:        []byte{0x8a, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f},
			wantFIN:    true,
			wantOpcode: opcodePong,
			wantPayld:  []byte("Hello"),
		},
		{
			name:       "close with status 1000",
			raw:        []byte{0x88, 0x02, 0x03, 0xe8},
			wantFIN:    true,
			wantOpcode: opcodeClose,
			wantPayld:  []byte{0x03, 0xe8},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f, err := ParseFrame(bufio.NewReader(bytes.NewReader(tc.raw)))
			if err != nil {
				t.Fatalf("ParseFrame error: %v", err)
			}
			if f.FIN != tc.wantFIN {
				t.Errorf("FIN = %v, want %v", f.FIN, tc.wantFIN)
			}
			if f.Opcode != tc.wantOpcode {
				t.Errorf("Opcode = 0x%x, want 0x%x", f.Opcode, tc.wantOpcode)
			}
			if !bytes.Equal(f.Payload, tc.wantPayld) {
				t.Errorf("Payload = %q, want %q", f.Payload, tc.wantPayld)
			}
		})
	}
}

// TestWebSocketParseFrameFragmented parses a fragmented text message split into
// a non-FIN text frame and a FIN continuation frame (RFC 6455 §5.4).
func TestWebSocketParseFrameFragmented(t *testing.T) {
	// "Hel" (text, not FIN) then "lo" (continuation, FIN).
	raw := append([]byte{0x01, 0x03, 0x48, 0x65, 0x6c}, 0x80, 0x02, 0x6c, 0x6f)
	r := bufio.NewReader(bytes.NewReader(raw))

	f1, err := ParseFrame(r)
	if err != nil {
		t.Fatalf("frame 1 error: %v", err)
	}
	if f1.FIN {
		t.Errorf("frame 1 FIN = true, want false")
	}
	if f1.Opcode != opcodeText || string(f1.Payload) != "Hel" {
		t.Errorf("frame 1 = (0x%x, %q), want (text, \"Hel\")", f1.Opcode, f1.Payload)
	}

	f2, err := ParseFrame(r)
	if err != nil {
		t.Fatalf("frame 2 error: %v", err)
	}
	if !f2.FIN {
		t.Errorf("frame 2 FIN = false, want true")
	}
	if f2.Opcode != opcodeContinuation || string(f2.Payload) != "lo" {
		t.Errorf("frame 2 = (0x%x, %q), want (continuation, \"lo\")", f2.Opcode, f2.Payload)
	}
}

// TestWebSocketRelayFramesReassembly checks that relayFrames reassembles a
// fragmented data message into one recorded message, reports control frames
// individually, forwards bytes verbatim, and stops on close.
func TestWebSocketRelayFramesReassembly(t *testing.T) {
	var wire bytes.Buffer
	wire.Write([]byte{0x01, 0x03, 0x48, 0x65, 0x6c}) // "Hel" text, not FIN
	wire.Write([]byte{0x80, 0x02, 0x6c, 0x6f})       // "lo" continuation, FIN
	wire.Write([]byte{0x89, 0x01, 0x70})             // ping "p"
	wire.Write([]byte{0x88, 0x00})                   // close, no payload
	input := wire.Bytes()

	rec := &captureRecorder{}
	var forwarded bytes.Buffer
	relayFrames(rec, "c1", "incoming", bufio.NewReader(bytes.NewReader(input)), &forwarded)

	msgs := rec.snapshot()
	if len(msgs) != 3 {
		t.Fatalf("recorded %d messages, want 3: %+v", len(msgs), msgs)
	}
	if msgs[0].opcode != "text" || string(msgs[0].payload) != "Hello" {
		t.Errorf("msg[0] = (%s, %q), want (text, \"Hello\")", msgs[0].opcode, msgs[0].payload)
	}
	if msgs[1].opcode != "ping" || string(msgs[1].payload) != "p" {
		t.Errorf("msg[1] = (%s, %q), want (ping, \"p\")", msgs[1].opcode, msgs[1].payload)
	}
	if msgs[2].opcode != "close" {
		t.Errorf("msg[2] opcode = %s, want close", msgs[2].opcode)
	}

	// Bytes must be forwarded byte-for-byte through the tee.
	if !bytes.Equal(forwarded.Bytes(), input) {
		t.Errorf("forwarded bytes differ from input:\n got %x\nwant %x", forwarded.Bytes(), input)
	}
}

// TestWebSocketComputeAcceptKey verifies the Sec-WebSocket-Accept derivation
// against the RFC 6455 §1.3 worked example.
func TestWebSocketComputeAcceptKey(t *testing.T) {
	got := computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ==")
	want := "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
	if got != want {
		t.Errorf("computeAcceptKey = %q, want %q", got, want)
	}
}

// TestWebSocketRelayIntegration runs an in-process WS echo server and drives a
// client THROUGH proxyWebSocket over an in-memory pipe, asserting that both the
// outgoing and the echoed incoming text frames are captured.
func TestWebSocketRelayIntegration(t *testing.T) {
	upstreamAddr, stop := startEchoWSServer(t)
	defer stop()

	// clientBrowser <-> clientProxySide is the hijacked client connection.
	clientBrowser, clientProxySide := net.Pipe()
	defer clientBrowser.Close()

	handshake := []byte("GET /chat HTTP/1.1\r\n" +
		"Host: " + upstreamAddr + "\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n\r\n")

	rec := &captureRecorder{}
	go proxyWebSocket(rec, "c1", upstreamAddr, clientProxySide, bufio.NewReader(clientProxySide), handshake)

	br := bufio.NewReader(clientBrowser)
	clientBrowser.SetDeadline(time.Now().Add(5 * time.Second))

	// Consume the relayed 101 handshake response.
	status := ""
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("reading handshake response: %v", err)
		}
		if status == "" {
			status = line
		}
		if line == "\r\n" {
			break
		}
	}
	if !strings.Contains(status, "101") {
		t.Fatalf("handshake status = %q, want 101", strings.TrimSpace(status))
	}

	// Send a masked text frame "Hello" and read the echoed frame back.
	if _, err := clientBrowser.Write(encodeFrame(true, opcodeText, []byte("Hello"), true)); err != nil {
		t.Fatalf("client write: %v", err)
	}
	echoed, err := ParseFrame(br)
	if err != nil {
		t.Fatalf("reading echoed frame: %v", err)
	}
	if echoed.Opcode != opcodeText || string(echoed.Payload) != "Hello" {
		t.Fatalf("echoed frame = (0x%x, %q), want (text, \"Hello\")", echoed.Opcode, echoed.Payload)
	}

	// Both directions of the "Hello" exchange must have been recorded.
	if !rec.waitFor(t, "outgoing", "text", "Hello") {
		t.Errorf("outgoing text \"Hello\" was not recorded")
	}
	if !rec.waitFor(t, "incoming", "text", "Hello") {
		t.Errorf("incoming text \"Hello\" was not recorded")
	}

	// Close from the client; the relay should tear down and mark closed.
	clientBrowser.Write(encodeFrame(true, opcodeClose, nil, true))
	if !rec.waitForClose(t, "c1") {
		t.Errorf("connection close was not recorded")
	}
}

// startEchoWSServer starts a minimal raw WebSocket echo server on a random
// local port. It completes the handshake and echoes each data/control frame
// back unmasked.
func startEchoWSServer(t *testing.T) (addr string, stop func()) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		br := bufio.NewReader(conn)

		// Read the handshake request; grab the Sec-WebSocket-Key.
		var key string
		for {
			line, err := br.ReadString('\n')
			if err != nil {
				return
			}
			if strings.HasPrefix(strings.ToLower(line), "sec-websocket-key:") {
				key = strings.TrimSpace(line[len("sec-websocket-key:"):])
			}
			if line == "\r\n" {
				break
			}
		}

		resp := "HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\n" +
			"Connection: Upgrade\r\n" +
			"Sec-WebSocket-Accept: " + computeAcceptKey(key) + "\r\n\r\n"
		if _, err := conn.Write([]byte(resp)); err != nil {
			return
		}

		// Echo frames (unmasked, server->client) until close/EOF.
		for {
			f, err := ParseFrame(br)
			if err != nil {
				return
			}
			if _, err := conn.Write(encodeFrame(f.FIN, f.Opcode, f.Payload, false)); err != nil {
				return
			}
			if f.Opcode == opcodeClose {
				return
			}
		}
	}()

	return ln.Addr().String(), func() { ln.Close() }
}

// captureRecorder is a thread-safe wsRecorder used by the relay tests.
type captureRecorder struct {
	mu     sync.Mutex
	msgs   []capturedMsg
	closed []string
}

type capturedMsg struct {
	connID    string
	direction string
	opcode    string
	payload   []byte
}

func (c *captureRecorder) recordWSMessage(connID, direction, opcode string, payload []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.msgs = append(c.msgs, capturedMsg{connID, direction, opcode, append([]byte(nil), payload...)})
}

func (c *captureRecorder) closeWSConnection(connID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = append(c.closed, connID)
}

func (c *captureRecorder) snapshot() []capturedMsg {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]capturedMsg{}, c.msgs...)
}

func (c *captureRecorder) waitFor(t *testing.T, direction, opcode, payload string) bool {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		for _, m := range c.msgs {
			if m.direction == direction && m.opcode == opcode && string(m.payload) == payload {
				c.mu.Unlock()
				return true
			}
		}
		c.mu.Unlock()
		time.Sleep(5 * time.Millisecond)
	}
	return false
}

func (c *captureRecorder) waitForClose(t *testing.T, connID string) bool {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		for _, id := range c.closed {
			if id == connID {
				c.mu.Unlock()
				return true
			}
		}
		c.mu.Unlock()
		time.Sleep(5 * time.Millisecond)
	}
	return false
}
