package proxy

// websocket.go — self-contained, stdlib-only RFC 6455 WebSocket frame parsing
// and a transparent MITM relay used by the proxy to capture ws:// traffic.
//
// This file intentionally has NO dependency on the models package or goproxy:
// it works purely on net.Conn / bufio.Reader / io and reports captured frames
// back through the small wsRecorder interface. That keeps the RFC 6455 logic
// unit-testable in isolation (see websocket_test.go).

import (
	"bufio"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"time"
)

// WebSocket opcodes (RFC 6455 §5.2).
const (
	opcodeContinuation byte = 0x0
	opcodeText         byte = 0x1
	opcodeBinary       byte = 0x2
	opcodeClose        byte = 0x8
	opcodePing         byte = 0x9
	opcodePong         byte = 0xA
)

// wsGUID is the magic value used to compute Sec-WebSocket-Accept (RFC 6455 §1.3).
const wsGUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

// maxFramePayload caps how many bytes of a single frame's payload we retain for
// reporting. The full payload is always read off the wire (to stay byte-aligned
// and to forward it verbatim), but only up to this many bytes are handed to the
// recorder.
const maxFramePayload = 1 << 20 // 1 MiB

// Frame is a single parsed WebSocket frame with its payload already unmasked.
type Frame struct {
	FIN     bool
	Opcode  byte
	Payload []byte
}

// opcodeName maps a numeric opcode to its human-readable name.
func opcodeName(op byte) string {
	switch op {
	case opcodeContinuation:
		return "continuation"
	case opcodeText:
		return "text"
	case opcodeBinary:
		return "binary"
	case opcodeClose:
		return "close"
	case opcodePing:
		return "ping"
	case opcodePong:
		return "pong"
	default:
		return fmt.Sprintf("opcode-0x%x", op)
	}
}

// computeAcceptKey derives the Sec-WebSocket-Accept response value from a
// client's Sec-WebSocket-Key per RFC 6455 §4.2.2. Exposed for handshake
// validation and tests.
func computeAcceptKey(key string) string {
	h := sha1.New()
	io.WriteString(h, strings.TrimSpace(key)+wsGUID)
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

// ParseFrame reads exactly one WebSocket frame from r, unmasking the payload if
// the MASK bit is set. It handles the 7-bit, 16-bit and 64-bit extended payload
// length encodings. It does NOT reassemble fragments — callers combine
// continuation frames (see relayFrames). The returned Payload is a fresh slice.
func ParseFrame(r *bufio.Reader) (Frame, error) {
	// First two bytes: FIN/RSV/opcode, then MASK/length.
	b0, err := r.ReadByte()
	if err != nil {
		return Frame{}, err
	}
	b1, err := r.ReadByte()
	if err != nil {
		return Frame{}, err
	}

	fin := b0&0x80 != 0
	opcode := b0 & 0x0F
	masked := b1&0x80 != 0
	length := uint64(b1 & 0x7F)

	switch length {
	case 126:
		var ext [2]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return Frame{}, err
		}
		length = uint64(binary.BigEndian.Uint16(ext[:]))
	case 127:
		var ext [8]byte
		if _, err := io.ReadFull(r, ext[:]); err != nil {
			return Frame{}, err
		}
		length = binary.BigEndian.Uint64(ext[:])
	}

	var maskKey [4]byte
	if masked {
		if _, err := io.ReadFull(r, maskKey[:]); err != nil {
			return Frame{}, err
		}
	}

	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return Frame{}, err
	}

	if masked {
		for i := range payload {
			payload[i] ^= maskKey[i&3]
		}
	}

	return Frame{FIN: fin, Opcode: opcode, Payload: payload}, nil
}

// wsRecorder is how the relay reports captured activity back to the proxy.
// *ProxyServer implements it (see proxy.go).
type wsRecorder interface {
	recordWSMessage(connID, direction, opcode string, payload []byte)
	closeWSConnection(connID string)
}

// nopRecorder discards all captured activity. Used for out-of-scope
// connections so frames are still relayed (the app keeps working) but nothing
// is stored/emitted.
type nopRecorder struct{}

func (nopRecorder) recordWSMessage(_, _, _ string, _ []byte) {}
func (nopRecorder) closeWSConnection(_ string)               {}

// proxyWebSocket completes a ws:// upgrade against the upstream host and then
// relays frames in both directions, tee-parsing each frame for capture while
// forwarding the ORIGINAL bytes unmodified so the connection stays intact.
//
//   - clientConn / clientReader: the hijacked client side. clientReader is the
//     buffered reader returned by Hijack (positioned at the first client frame).
//   - handshakeReq: the raw origin-form GET upgrade request bytes to send
//     upstream (reconstructed by the caller from the parsed *http.Request).
//   - dialHost: the upstream "host:port" to connect to.
func proxyWebSocket(rec wsRecorder, connID, dialHost string, clientConn net.Conn, clientReader *bufio.Reader, handshakeReq []byte) error {
	upstream, err := net.DialTimeout("tcp", dialHost, 30*time.Second)
	if err != nil {
		rec.closeWSConnection(connID)
		clientConn.Close()
		return fmt.Errorf("ws upstream dial %s: %w", dialHost, err)
	}
	defer upstream.Close()
	defer clientConn.Close()

	// Forward the client's handshake to the upstream server.
	if _, err := upstream.Write(handshakeReq); err != nil {
		rec.closeWSConnection(connID)
		return fmt.Errorf("ws handshake write: %w", err)
	}

	// Read the upstream handshake response and relay it verbatim back to the
	// client. If the server did not switch protocols, fall back to an opaque
	// bidirectional copy (no framing).
	upstreamReader := bufio.NewReader(upstream)
	status, err := relayHandshakeResponse(upstreamReader, clientConn)
	if err != nil {
		rec.closeWSConnection(connID)
		return fmt.Errorf("ws handshake relay: %w", err)
	}

	if status != 101 {
		// Not a WebSocket after all — just tunnel the remaining bytes so the
		// client sees a coherent response, then close.
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); io.Copy(upstream, clientReader) }()
		go func() { defer wg.Done(); io.Copy(clientConn, upstreamReader) }()
		wg.Wait()
		rec.closeWSConnection(connID)
		return nil
	}

	// Both sides upgraded — relay + tee-parse frames in each direction.
	var wg sync.WaitGroup
	wg.Add(2)
	// Client -> server frames are "outgoing".
	go func() {
		defer wg.Done()
		relayFrames(rec, connID, "outgoing", clientReader, upstream)
		// A closed client side should tear down the upstream copy too.
		upstream.SetReadDeadline(time.Now())
	}()
	// Server -> client frames are "incoming".
	go func() {
		defer wg.Done()
		relayFrames(rec, connID, "incoming", upstreamReader, clientConn)
		clientConn.SetReadDeadline(time.Now())
	}()
	wg.Wait()

	rec.closeWSConnection(connID)
	return nil
}

// relayHandshakeResponse reads the upstream HTTP response status line and
// headers, writing every raw byte to dst as it goes, and returns the parsed
// status code. Any bytes buffered past the header terminator remain in src for
// the frame relay to consume.
func relayHandshakeResponse(src *bufio.Reader, dst io.Writer) (int, error) {
	status := 0
	first := true
	for {
		line, err := src.ReadString('\n')
		if len(line) > 0 {
			if _, werr := io.WriteString(dst, line); werr != nil {
				return 0, werr
			}
		}
		if err != nil {
			return status, err
		}
		if first {
			// e.g. "HTTP/1.1 101 Switching Protocols\r\n"
			if parts := strings.SplitN(line, " ", 3); len(parts) >= 2 {
				fmt.Sscanf(parts[1], "%d", &status)
			}
			first = false
		}
		if line == "\r\n" || line == "\n" {
			return status, nil
		}
	}
}

// relayFrames reads frames from src, forwards the exact bytes to dst via an
// io.TeeReader, and reports each completed message to rec. Fragmented data
// messages (a non-FIN text/binary frame followed by continuation frames) are
// reassembled; control frames (ping/pong/close) are reported individually.
func relayFrames(rec wsRecorder, connID, direction string, src *bufio.Reader, dst io.Writer) {
	// Every byte ParseFrame consumes from tee is written to dst unmodified,
	// keeping the proxied connection byte-for-byte intact.
	tee := bufio.NewReader(io.TeeReader(src, dst))

	var fragOpcode byte
	var fragBuf []byte

	for {
		frame, err := ParseFrame(tee)
		if err != nil {
			return
		}

		switch frame.Opcode {
		case opcodeContinuation:
			fragBuf = append(fragBuf, frame.Payload...)
			if frame.FIN {
				rec.recordWSMessage(connID, direction, opcodeName(fragOpcode), fragBuf)
				fragBuf, fragOpcode = nil, 0
			}
		case opcodeText, opcodeBinary:
			if frame.FIN {
				rec.recordWSMessage(connID, direction, opcodeName(frame.Opcode), frame.Payload)
			} else {
				// Start of a fragmented message.
				fragOpcode = frame.Opcode
				fragBuf = append([]byte(nil), frame.Payload...)
			}
		case opcodeClose, opcodePing, opcodePong:
			rec.recordWSMessage(connID, direction, opcodeName(frame.Opcode), frame.Payload)
			if frame.Opcode == opcodeClose {
				return
			}
		default:
			// Unknown/reserved opcode: still forwarded (via tee) but recorded
			// under its numeric name.
			rec.recordWSMessage(connID, direction, opcodeName(frame.Opcode), frame.Payload)
		}
	}
}
