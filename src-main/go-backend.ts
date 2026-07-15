import { spawn, ChildProcess } from 'child_process';
import { app, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';

export interface GoProxyStatus {
  isRunning: boolean;
  port: number;
  certificatePath: string;
}

export interface GoProxyConfig {
  port: number;
  sslInterception: boolean;
  customHeaders: Record<string, string>;
  saveOnlyInScope: boolean;
  inScope: string[];
  outOfScope: string[];
}

export class GoBackendManager {
  private process: ChildProcess | null = null;
  private baseUrl = 'http://localhost:9090';
  private ipcPort = 9090;
  private isReady = false;
  private eventSource: any = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000; // Start with 1 second
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = false;

  async start(): Promise<void> {
    if (this.process) {
      console.log('Go backend already running');
      return;
    }

    const binary = await this.ensureBinaryInUserData();
    const dataDir = path.join(app.getPath('userData'), 'kanti-go');

    // Ensure binary exists
    if (!fs.existsSync(binary)) {
      throw new Error(`Go backend binary not found at: ${binary}`);
    }

    console.log(`Starting Go backend from: ${binary}`);
    console.log(`Data directory: ${dataDir}`);

    this.process = spawn(binary, [
      '-data', dataDir,
      '-ipc-port', this.ipcPort.toString(),
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    if (this.process.stdout) {
      this.process.stdout.on('data', (data) => {
        console.log(`[Go Backend] ${data.toString().trim()}`);
      });
    }

    if (this.process.stderr) {
      this.process.stderr.on('data', (data) => {
        console.error(`[Go Backend Error] ${data.toString().trim()}`);
      });
    }

    this.process.on('error', (error) => {
      console.error('Go backend process error:', error);
      this.process = null;
      this.isReady = false;
    });

    this.process.on('exit', (code, signal) => {
      console.log(`Go backend exited with code ${code} and signal ${signal}`);
      this.process = null;
      this.isReady = false;
    });

    // Wait for backend to be ready
    await this.waitForReady();
    this.isReady = true;
    console.log('Go backend ready');
    
    // Enable automatic reconnection
    this.shouldReconnect = true;
    
    // Connect to event stream
    this.connectEventStream();
  }

  async stop(): Promise<void> {
    // Disable automatic reconnection
    this.shouldReconnect = false;
    
    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    // Disconnect event stream first
    this.disconnectEventStream();
    
    if (this.process) {
      console.log('Stopping Go backend...');
      this.process.kill('SIGTERM');
      
      // Wait a bit for graceful shutdown
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Force kill if still running
      if (this.process) {
        this.process.kill('SIGKILL');
      }
      
      this.process = null;
      this.isReady = false;
    }
  }

  isRunning(): boolean {
    return this.process !== null && this.isReady;
  }

  // Proxy control methods
  async startProxy(port: number): Promise<GoProxyStatus> {
    const response = await this.request('POST', '/api/proxy/start', { port });
    
    // Ensure event stream is connected when proxy starts
    if (!this.eventSource || !this.eventSource.active) {
      console.log('Reconnecting event stream when proxy starts...');
      this.reconnectAttempts = 0; // Reset reconnect attempts
      this.connectEventStream();
    }
    
    return response.data;
  }

  async stopProxy(): Promise<GoProxyStatus> {
    const response = await this.request('POST', '/api/proxy/stop');
    return response.data;
  }

  async getStatus(): Promise<GoProxyStatus> {
    const response = await this.request('GET', '/api/proxy/status');
    return response.data;
  }

  async getConfig(): Promise<GoProxyConfig> {
    const response = await this.request('GET', '/api/proxy/config');
    return response.data;
  }

  async updateConfig(config: Partial<GoProxyConfig>): Promise<GoProxyConfig> {
    const response = await this.request('POST', '/api/proxy/config', config);
    return response.data;
  }

  async getRequests(): Promise<any[]> {
    const response = await this.request('GET', '/api/proxy/requests');
    return response.data;
  }

  async clearRequests(): Promise<void> {
    await this.request('POST', '/api/proxy/clear');
  }

  // WebSocket capture methods (talk to the Go backend's /api/websocket/*).
  async getWebSocketConnections(): Promise<any[]> {
    const response = await this.request('GET', '/api/websocket/connections');
    return response.data ?? [];
  }

  async getWebSocketMessages(connId: string): Promise<any[]> {
    const response = await this.request('GET', `/api/websocket/messages?conn=${encodeURIComponent(connId)}`);
    return response.data ?? [];
  }

  async clearWebSockets(): Promise<void> {
    await this.request('POST', '/api/websocket/clear');
  }

  // Helper methods
  private getBinaryPath(): string {
    const platform = process.platform;
    let binaryName = 'kanti-backend';
    
    if (platform === 'win32') {
      binaryName += '.exe';
    }

    console.log(`Looking for binary: ${binaryName}`);
    console.log(`Platform: ${platform}`);
    console.log(`DEV mode: ${import.meta.env.DEV}`);

    // Check if running from development
    if (import.meta.env.DEV) {
      // Development: look in src-go/bin/
      const devPath = path.join(process.cwd(), 'src-go', 'bin', binaryName);
      console.log(`Checking dev path: ${devPath}`);
      if (fs.existsSync(devPath)) {
        console.log(`✓ Found binary at: ${devPath}`);
        return devPath;
      }
    }

    // Production: When packaged with asar, binaries are unpacked to .asar.unpacked
    const appPath = app.getAppPath();
    const resourcesPath = process.resourcesPath;
    
    console.log(`App path: ${appPath}`);
    console.log(`Resources path: ${resourcesPath}`);
    
    // List of paths to try in order
    const pathsToTry = [];
    
    // Check if running from asar
    if (appPath.includes('app.asar')) {
      // Try .asar.unpacked location first (this is where unpacked files go)
      pathsToTry.push(
        path.join(appPath.replace('app.asar', 'app.asar.unpacked'), 'resources', 'bin', binaryName)
      );
      
      // Also try directly in the unpacked .vite directory structure
      pathsToTry.push(
        path.join(appPath.replace('app.asar', 'app.asar.unpacked'), '.vite', 'main', 'resources', 'bin', binaryName)
      );
    }
    
    // Try standard resources path (outside asar)
    pathsToTry.push(
      path.join(resourcesPath, 'bin', binaryName)
    );
    
    // Try relative to app path
    pathsToTry.push(
      path.join(appPath, 'resources', 'bin', binaryName)
    );
    
    // Try in .vite directory structure
    pathsToTry.push(
      path.join(appPath, '.vite', 'main', 'resources', 'bin', binaryName)
    );

    // Try each path
    for (const testPath of pathsToTry) {
      console.log(`Checking: ${testPath}`);
      if (fs.existsSync(testPath)) {
        console.log(`✓ Found binary at: ${testPath}`);
        return testPath;
      }
    }

    // If nothing found, log all attempted paths and throw error with the first path
    console.error('Binary not found. Attempted paths:');
    pathsToTry.forEach(p => console.error(`  - ${p}`));
    
    // Return the most likely path so the error message is helpful
    return pathsToTry[0];
  }

  /**
   * Ensures the Go binary exists in the userData directory.
   * If not present, copies it from the bundled location.
   * Returns the path to the binary in userData.
   */
  private async ensureBinaryInUserData(): Promise<string> {
    const platform = process.platform;
    let binaryName = 'kanti-backend';
    
    if (platform === 'win32') {
      binaryName += '.exe';
    }

    // Define the target location in userData
    const userDataDir = app.getPath('userData');
    const binDir = path.join(userDataDir, 'bin');
    const targetBinaryPath = path.join(binDir, binaryName);

    console.log(`Target binary location: ${targetBinaryPath}`);

    // Check if binary already exists in userData
    if (fs.existsSync(targetBinaryPath)) {
      console.log(`✓ Binary already exists in userData directory`);
      return targetBinaryPath;
    }

    console.log(`Binary not found in userData, will copy from bundled location...`);

    // Get the bundled binary path
    const sourceBinaryPath = this.getBinaryPath();

    if (!fs.existsSync(sourceBinaryPath)) {
      throw new Error(`Source binary not found at: ${sourceBinaryPath}`);
    }

    console.log(`Copying binary from: ${sourceBinaryPath}`);
    console.log(`Copying binary to: ${targetBinaryPath}`);

    // Create bin directory if it doesn't exist
    if (!fs.existsSync(binDir)) {
      fs.mkdirSync(binDir, { recursive: true });
      console.log(`Created directory: ${binDir}`);
    }

    // Copy the binary
    fs.copyFileSync(sourceBinaryPath, targetBinaryPath);
    console.log(`✓ Binary copied successfully`);

    // Make the binary executable on Unix-like systems
    if (platform !== 'win32') {
      fs.chmodSync(targetBinaryPath, 0o755);
      console.log(`✓ Set binary as executable`);
    }

    return targetBinaryPath;
  }

  private async request(method: string, path: string, body?: any): Promise<any> {
    if (!this.isReady) {
      throw new Error('Go backend not ready');
    }

    const url = `${this.baseUrl}${path}`;
    
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error(`Request to ${url} failed:`, error);
      throw error;
    }
  }

  private async waitForReady(): Promise<void> {
    const maxAttempts = 100; // 10 seconds
    const delayMs = 100;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`${this.baseUrl}/api/proxy/status`);
        if (response.ok) {
          return;
        }
      } catch (e) {
        // Backend not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }

    throw new Error('Go backend failed to start within timeout');
  }

  // Get event stream URL for SSE
  getEventStreamUrl(): string {
    return `${this.baseUrl}/api/events`;
  }

  // Connect to the Go backend's SSE event stream
  private connectEventStream(): void {
    // Don't reconnect if we shouldn't or if already connected
    if (!this.shouldReconnect) {
      console.log('Skipping event stream connection (shouldReconnect is false)');
      return;
    }
    
    if (this.eventSource?.active) {
      console.log('Event stream already active, skipping reconnection');
      return;
    }
    
    try {
      console.log(`Connecting to Go backend event stream (attempt ${this.reconnectAttempts + 1})...`);
      
      const eventStreamUrl = this.getEventStreamUrl();
      console.log(`Event stream URL: ${eventStreamUrl}`);
      
      // Use fetch with streaming for SSE
      fetch(eventStreamUrl).then(response => {
        if (!response.ok) {
          console.error('Failed to connect to event stream:', response.statusText);
          this.scheduleReconnect();
          return;
        }
        
        console.log('✓ Connected to Go backend event stream successfully');
        
        // Reset reconnect attempts on successful connection
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        
        if (!reader) {
          console.error('No reader available for event stream');
          this.scheduleReconnect();
          return;
        }
        
        // Store reader reference for cleanup
        this.eventSource = { reader, active: true };
        
        // Process stream
        const processStream = async () => {
          let buffer = ''; // Buffer to accumulate incomplete chunks
          
          try {
            while (this.eventSource?.active) {
              const { done, value } = await reader.read();
              
              if (done) {
                console.log('Event stream ended');
                this.eventSource.active = false;
                break;
              }
              
              // Decode the chunk and add to buffer
              buffer += decoder.decode(value, { stream: true });
              
              // SSE format: "data: <json>\n\n"
              // Split by double newline to get complete events
              const events = buffer.split('\n\n');
              
              // Keep the last incomplete event in the buffer
              buffer = events.pop() || '';
              
              // Process complete events
              for (const eventText of events) {
                if (!eventText.trim()) continue;
                
                const lines = eventText.split('\n');
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    const jsonData = line.substring(6); // Remove "data: " prefix
                    
                    try {
                      const event = JSON.parse(jsonData);
                      this.handleEvent(event);
                    } catch (e) {
                      console.error('Failed to parse event data:', e);
                      console.error('Problematic data:', jsonData.substring(0, 200));
                    }
                  }
                }
              }
            }
          } catch (error) {
            if (this.eventSource?.active) {
              console.error('Error reading event stream:', error);
              this.eventSource.active = false;
            }
          } finally {
            reader.releaseLock();
            // Schedule reconnection if stream ended unexpectedly and we should reconnect
            if (this.shouldReconnect && !this.eventSource?.active) {
              console.log('Event stream closed, scheduling reconnection...');
              this.scheduleReconnect();
            }
          }
        };
        
        processStream();
      }).catch(error => {
        console.error('Failed to connect to event stream:', error);
        this.scheduleReconnect();
      });
      
    } catch (error) {
      console.error('Error setting up event stream:', error);
      this.scheduleReconnect();
    }
  }
  
  // Schedule a reconnection attempt with exponential backoff
  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      console.log('Not scheduling reconnect (shouldReconnect is false)');
      return;
    }
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }
    
    // Clear any existing timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.reconnectAttempts++;
    
    // Calculate delay with exponential backoff (max 30 seconds)
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms...`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectEventStream();
    }, delay);
  }

  // Disconnect from event stream
  private disconnectEventStream(): void {
    if (this.eventSource) {
      console.log('Disconnecting from event stream...');
      this.eventSource.active = false;
      this.eventSource = null;
    }
  }

  // Handle events from Go backend and forward to renderer windows
  private handleEvent(event: any): void {
    // Use lowercase property names to match Go's JSON tags
    if (!event.type || !event.data) {
      console.warn('Received malformed event:', event);
      return;
    }
    
    console.log(`Received event from Go backend: ${event.type}, data items: ${Array.isArray(event.data) ? event.data.length : 'N/A'}`);
    
    // Get all browser windows
    const allWindows = BrowserWindow.getAllWindows();
    
    if (allWindows.length === 0) {
      console.warn('No browser windows available to forward event to');
      return;
    }
    
    // Forward event to all windows
    let successCount = 0;
    allWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send(event.type, event.data);
        successCount++;
      }
    });
    
    console.log(`Forwarded event ${event.type} to ${successCount}/${allWindows.length} windows`);
  }
}
