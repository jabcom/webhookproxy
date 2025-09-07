import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import validator from 'validator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ProxyServer {
  constructor() {
    this.clients = new Map(); // slug -> WebSocket client
    this.pendingRequests = new Map(); // requestId -> {res, timeout}
    this.serverStartTime = new Date();
    this.stats = {
      totalRequests: 0,
      successfulResponses: 0,
      failedResponses: 0,
      responseTimes: [],
      hourlyStats: new Map(), // hour -> {requests, responses, avgTime}
      dailyStats: new Map()    // date -> {requests, responses, avgTime}
    };
    this.logs = [];
    this.statusClients = new Set(); // WebSocket clients connected to status page
    
    // Security configuration
    this.securityConfig = {
      jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
      jwtExpiry: '24h',
      maxConnectionsPerIP: 10,
      maxRequestsPerMinute: 100,
      maxRequestSize: 10 * 1024 * 1024, // 10MB
      allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : ['*'],
      requireAuth: process.env.REQUIRE_AUTH === 'true',
      adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
      slugWhitelist: process.env.SLUG_WHITELIST ? process.env.SLUG_WHITELIST.split(',') : [],
      enableRateLimit: process.env.ENABLE_RATE_LIMIT !== 'false',
      enableCORS: process.env.ENABLE_CORS !== 'false'
    };
    
    // Rate limiting tracking
    this.rateLimitTracker = new Map(); // ip -> {requests: [], connections: []}
    this.clientAuthTokens = new Map(); // ws -> {token, slug, permissions}
    
    // Memory management settings
    this.memoryConfig = {
      maxLogs: 1000,           // Maximum log entries in memory
      maxResponseTimes: 100,   // Maximum response time samples
      logRetentionDays: 7,     // Keep logs for 7 days
      statsRetentionDays: 30,  // Keep detailed stats for 30 days
      cleanupIntervalMs: 60000, // Cleanup every minute
      gcIntervalMs: 300000     // Full GC every 5 minutes
    };
    
    this.setupHttpServer();
    this.setupWebSocketServer();
    this.setupMemoryManagement();
    this.setupSecurity();
  }

  setupSecurity() {
    console.log(`[SECURITY] Security configuration loaded`);
    console.log(`[SECURITY] Authentication required: ${this.securityConfig.requireAuth}`);
    console.log(`[SECURITY] Rate limiting enabled: ${this.securityConfig.enableRateLimit}`);
    console.log(`[SECURITY] CORS enabled: ${this.securityConfig.enableCORS}`);
    console.log(`[SECURITY] Max connections per IP: ${this.securityConfig.maxConnectionsPerIP}`);
    console.log(`[SECURITY] Max requests per minute: ${this.securityConfig.maxRequestsPerMinute}`);
    
    if (this.securityConfig.requireAuth) {
      console.log(`[SECURITY] WARNING: Using default admin password. Change ADMIN_PASSWORD in production!`);
    }
  }

  setupHttpServer() {
    this.httpServer = createServer((req, res) => {
      try {
        const clientIP = this.getClientIP(req);
        
        // Apply security headers
        this.applySecurityHeaders(res);
        
        // Rate limiting check
        if (this.securityConfig.enableRateLimit && !this.checkRateLimit(clientIP, req)) {
          this.addLog(`Rate limit exceeded for IP: ${clientIP}`, 'security');
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
          return;
        }
        
        const url = new URL(req.url, `http://${req.headers.host}`);
        const pathname = url.pathname;
        
        // Handle authentication endpoints
        if (pathname === '/auth/login') {
          this.handleLogin(req, res);
          return;
        }
        
        // Handle status page - always serve HTML, let client handle auth
        if (pathname === '/status') {
          this.handleStatusPage(req, res);
          return;
        }
        
        // Handle API endpoints
        if (pathname.startsWith('/api/')) {
          this.handleApiRequest(req, res, pathname);
          return;
        }
        
        const slug = pathname.substring(1); // Remove leading slash
        
        console.log(`[HTTP] ${req.method} ${req.url} - Slug: "${slug}" - IP: ${clientIP}`);
        
        if (!slug) {
          console.log(`[HTTP] Error: No slug provided for ${req.method} ${req.url}`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Slug required' }));
          return;
        }

        // Validate slug
        if (!this.validateSlug(slug)) {
          console.log(`[HTTP] Error: Invalid slug "${slug}"`);
          this.addLog(`Invalid slug attempt: "${slug}" from IP: ${clientIP}`, 'security');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid slug format' }));
          return;
        }

        // Prevent using 'status' as a slug
        if (slug === 'status') {
          console.log(`[HTTP] Error: 'status' slug is reserved`);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'The slug "status" is reserved for the server status page' }));
          return;
        }

        // Check slug whitelist if configured
        if (this.securityConfig.slugWhitelist.length > 0 && !this.securityConfig.slugWhitelist.includes(slug)) {
          console.log(`[HTTP] Error: Slug "${slug}" not in whitelist`);
          this.addLog(`Unauthorized slug attempt: "${slug}" from IP: ${clientIP}`, 'security');
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Slug not authorized' }));
          return;
        }

        // Check if there's an active WebSocket client for this slug
        const client = this.clients.get(slug);
        
        if (client && client.readyState === 1) { // WebSocket.OPEN
          console.log(`[HTTP] Found active WebSocket client for slug: "${slug}"`);
          this.handleRequestWithClient(req, res, slug, client);
        } else {
          console.log(`[HTTP] No active WebSocket client for slug: "${slug}" - queuing request`);
          this.handleRequestWithoutClient(req, res, slug);
        }
      } catch (error) {
        console.error(`[HTTP] Error processing request ${req.method} ${req.url}:`, error.message);
        this.addLog(`HTTP request error: ${error.message}`, 'error');
        try {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        } catch (responseError) {
          console.error(`[HTTP] Error sending error response:`, responseError.message);
        }
      }
    });
  }

  setupWebSocketServer() {
    try {
      this.wsServer = new WebSocketServer({ 
        server: this.httpServer,
        path: '/ws'
      });

      this.wsServer.on('connection', (ws, req) => {
        try {
          const clientId = req.headers['sec-websocket-key'] || 'unknown';
          console.log(`[WS] Client connected - ID: ${clientId}, IP: ${req.socket.remoteAddress}`);
          
          ws.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              console.log(`[WS] Received message from client ${clientId}:`, JSON.stringify(message, null, 2));
              this.handleWebSocketMessage(ws, message);
            } catch (error) {
              console.error(`[WS] Invalid JSON message from client ${clientId}:`, error.message);
              console.error(`[WS] Raw message:`, data.toString());
              try {
                ws.send(JSON.stringify({ error: 'Invalid JSON' }));
              } catch (sendError) {
                console.error(`[WS] Error sending error response to client ${clientId}:`, sendError.message);
              }
            }
          });

          ws.on('close', (code, reason) => {
            try {
              console.log(`[WS] Client ${clientId} disconnected - Code: ${code}, Reason: ${reason.toString()}`);
              this.removeClient(ws);
            } catch (error) {
              console.error(`[WS] Error handling client ${clientId} disconnect:`, error.message);
            }
          });

          ws.on('error', (error) => {
            try {
              console.error(`[WS] Error from client ${clientId}:`, error.message);
              this.removeClient(ws);
            } catch (removeError) {
              console.error(`[WS] Error removing client ${clientId}:`, removeError.message);
            }
          });
        } catch (error) {
          console.error(`[WS] Error setting up client connection:`, error.message);
          try {
            ws.close(1011, 'Server error');
          } catch (closeError) {
            console.error(`[WS] Error closing WebSocket:`, closeError.message);
          }
        }
      });

      this.wsServer.on('error', (error) => {
        console.error(`[WS] WebSocket server error:`, error.message);
      });
    } catch (error) {
      console.error(`[WS] Error setting up WebSocket server:`, error.message);
      throw error;
    }
  }

  handleWebSocketMessage(ws, message) {
    try {
      console.log(`[WS] Processing message type: ${message.slug && !message.requestId ? 'registration' : message.slug && message.requestId && message.response ? 'response' : message.type === 'status-client' ? 'status-client' : 'unknown'}`);
      
      if (message.type === 'status-client') {
        // Status page client connecting
        this.statusClients.add(ws);
        this.sendStatusUpdate(ws);
        console.log(`[WS] Status client connected. Total status clients: ${this.statusClients.size}`);
        return;
      }
      
      if (message.slug && !message.requestId) {
        // Prevent using 'status' as a slug
        if (message.slug === 'status') {
          console.log(`[WS] Error: 'status' slug is reserved`);
          ws.send(JSON.stringify({ error: 'The slug "status" is reserved for the server status page' }));
          return;
        }
        
        // Client registering with a slug
        console.log(`[WS] Client registering for slug: "${message.slug}"`);
        this.registerClient(ws, message.slug);
      } else if (message.slug && message.requestId && message.response) {
        // Client responding to a request
        console.log(`[WS] Client responding to request ${message.requestId} for slug: "${message.slug}"`);
        this.handleClientResponse(message);
      } else {
        console.log(`[WS] Invalid message format received:`, message);
        try {
          ws.send(JSON.stringify({ error: 'Invalid message format' }));
        } catch (sendError) {
          console.error(`[WS] Error sending invalid format response:`, sendError.message);
        }
      }
    } catch (error) {
      console.error(`[WS] Error handling WebSocket message:`, error.message);
      try {
        ws.send(JSON.stringify({ error: 'Message processing failed' }));
      } catch (sendError) {
        console.error(`[WS] Error sending error response:`, sendError.message);
      }
    }
  }

  registerClient(ws, slug) {
    try {
      // Check if there's already a client for this slug
      const existingClient = this.clients.get(slug);
      if (existingClient && existingClient.readyState === 1) {
        console.log(`[WS] Replacing existing client for slug: "${slug}"`);
        try {
          // Close the existing connection
          existingClient.close(1000, 'Replaced by new client');
        } catch (closeError) {
          console.error(`[WS] Error closing existing client for slug "${slug}":`, closeError.message);
        }
      }
      
      console.log(`[WS] Client registered for slug: "${slug}"`);
      this.clients.set(slug, ws);
      
      // Process any pending requests for this slug
      const pendingCount = this.processPendingRequestsForSlug(slug, ws);
      console.log(`[WS] Processed ${pendingCount} pending requests for slug: "${slug}"`);
      
      // Send acknowledgment
      try {
        ws.send(JSON.stringify({ 
          type: 'registered', 
          slug: slug 
        }));
        console.log(`[WS] Sent registration acknowledgment to client for slug: "${slug}"`);
      } catch (sendError) {
        console.error(`[WS] Error sending registration acknowledgment for slug "${slug}":`, sendError.message);
      }
    } catch (error) {
      console.error(`[WS] Error registering client for slug "${slug}":`, error.message);
      try {
        ws.send(JSON.stringify({ error: 'Registration failed' }));
      } catch (sendError) {
        console.error(`[WS] Error sending registration failure response:`, sendError.message);
      }
    }
  }

  removeClient(ws) {
    try {
      // Check if it's a status client
      if (this.statusClients.has(ws)) {
        this.statusClients.delete(ws);
        console.log(`[WS] Status client disconnected. Total status clients: ${this.statusClients.size}`);
        return;
      }
      
      // Find and remove the client from the map
      for (const [slug, client] of this.clients.entries()) {
        if (client === ws) {
          this.clients.delete(slug);
          console.log(`[WS] Client removed for slug: "${slug}"`);
          
          // Reject any pending requests for this slug
          const rejectedCount = this.rejectPendingRequestsForSlug(slug);
          console.log(`[WS] Rejected ${rejectedCount} pending requests for slug: "${slug}"`);
          break;
        }
      }
    } catch (error) {
      console.error(`[WS] Error removing client:`, error.message);
    }
  }

  rejectPendingRequestsForSlug(slug) {
    let rejectedCount = 0;
    try {
      for (const [requestId, requestData] of this.pendingRequests.entries()) {
        if (requestData.slug === slug) {
          console.log(`[HTTP] Rejecting pending request ${requestId} for slug: "${slug}"`);
          try {
            if (!requestData.res.headersSent) {
              requestData.res.writeHead(503, { 'Content-Type': 'application/json' });
              requestData.res.end(JSON.stringify({ 
                error: 'No active WebSocket client for this slug' 
              }));
            }
          } catch (responseError) {
            console.error(`[HTTP] Error sending rejection response for request ${requestId}:`, responseError.message);
          }
          clearTimeout(requestData.timeout);
          this.pendingRequests.delete(requestId);
          rejectedCount++;
        }
      }
    } catch (error) {
      console.error(`[HTTP] Error rejecting pending requests for slug "${slug}":`, error.message);
    }
    return rejectedCount;
  }

  processPendingRequestsForSlug(slug, client) {
    let processedCount = 0;
    try {
      for (const [requestId, requestData] of this.pendingRequests.entries()) {
        if (requestData.slug === slug) {
          console.log(`[HTTP] Processing queued request ${requestId} for slug: "${slug}"`);
          try {
            // Clear the timeout since we now have a client
            clearTimeout(requestData.timeout);
            
            // Process the request with the new client
            this.handleRequestWithClient(
              requestData.req, 
              requestData.res, 
              slug, 
              client
            );
            
            // Remove from pending requests
            this.pendingRequests.delete(requestId);
            processedCount++;
          } catch (processError) {
            console.error(`[HTTP] Error processing queued request ${requestId}:`, processError.message);
            // Still remove from pending to prevent memory leaks
            this.pendingRequests.delete(requestId);
          }
        }
      }
    } catch (error) {
      console.error(`[HTTP] Error processing pending requests for slug "${slug}":`, error.message);
    }
    return processedCount;
  }

  async handleRequestWithClient(req, res, slug, client) {
    const requestId = uuidv4();
    const startTime = Date.now();
    
    try {
      console.log(`[HTTP] Handling request ${requestId} for slug: "${slug}"`);
      this.addLog(`Handling request ${requestId} for slug: "${slug}"`, 'http');
      
      // Update stats
      this.stats.totalRequests++;
      
      // Collect request data
      const requestData = await this.collectRequestData(req);
      console.log(`[HTTP] Collected request data for ${requestId}:`, {
        method: requestData.method,
        url: requestData.url,
        headersCount: Object.keys(requestData.headers).length,
        bodyLength: requestData.body.length
      });
      
      // Send request to WebSocket client
      const message = {
        slug: slug,
        requestId: requestId,
        request: requestData
      };
      
      try {
        client.send(JSON.stringify(message));
        console.log(`[WS] Sent request ${requestId} to WebSocket client for slug: "${slug}"`);
        this.addLog(`Sent request ${requestId} to WebSocket client for slug: "${slug}"`, 'ws');
      } catch (sendError) {
        console.error(`[WS] Error sending request ${requestId} to client:`, sendError.message);
        this.addLog(`Error sending request ${requestId} to client: ${sendError.message}`, 'error');
        this.stats.failedResponses++;
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to send request to WebSocket client' }));
        }
        return;
      }
      
      // Store pending request
      const timeout = setTimeout(() => {
        try {
          console.log(`[HTTP] Request ${requestId} timed out after 2.5 minutes`);
          this.addLog(`Request ${requestId} timed out after 2.5 minutes`, 'error');
          this.stats.failedResponses++;
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request timeout' }));
          }
          this.pendingRequests.delete(requestId);
        } catch (timeoutError) {
          console.error(`[HTTP] Error handling timeout for request ${requestId}:`, timeoutError.message);
        }
      }, 150000); // 2.5 minutes
      
      this.pendingRequests.set(requestId, { 
        res, 
        timeout, 
        slug,
        timestamp: Date.now(),
        startTime: startTime
      });
      
      console.log(`[HTTP] Request ${requestId} queued for response from WebSocket client`);
    } catch (error) {
      console.error(`[HTTP] Error handling request ${requestId} for slug "${slug}":`, error.message);
      this.addLog(`Error handling request ${requestId} for slug "${slug}": ${error.message}`, 'error');
      this.stats.failedResponses++;
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      } catch (responseError) {
        console.error(`[HTTP] Error sending error response for request ${requestId}:`, responseError.message);
      }
    }
  }

  handleRequestWithoutClient(req, res, slug) {
    const requestId = uuidv4();
    
    try {
      console.log(`[HTTP] No active client for slug: "${slug}" - queuing request ${requestId}`);
      
      // Store pending request and wait for client
      const timeout = setTimeout(() => {
        try {
          console.log(`[HTTP] Request ${requestId} timed out waiting for WebSocket client`);
          if (!res.headersSent) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No WebSocket client connected within timeout' }));
          }
          this.pendingRequests.delete(requestId);
        } catch (timeoutError) {
          console.error(`[HTTP] Error handling timeout for queued request ${requestId}:`, timeoutError.message);
        }
      }, 30000);
      
      this.pendingRequests.set(requestId, { 
        res, 
        timeout, 
        slug,
        req,
        timestamp: Date.now()
      });
      
      console.log(`[HTTP] Request ${requestId} queued for slug: "${slug}", waiting for WebSocket client`);
    } catch (error) {
      console.error(`[HTTP] Error queuing request ${requestId} for slug "${slug}":`, error.message);
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to queue request' }));
        }
      } catch (responseError) {
        console.error(`[HTTP] Error sending error response for queued request ${requestId}:`, responseError.message);
      }
    }
  }

  async collectRequestData(req) {
    return new Promise((resolve, reject) => {
      try {
        let body = '';
        
        req.on('data', chunk => {
          try {
            body += chunk.toString();
            
            // Check body size limit
            if (body.length > this.securityConfig.maxRequestSize) {
              reject(new Error('Request body too large'));
              return;
            }
          } catch (error) {
            console.error(`[HTTP] Error processing request data chunk:`, error.message);
            reject(error);
          }
        });
        
        req.on('end', () => {
          try {
            // Validate and sanitize input
            if (!this.validateInput(req.method) || !this.validateInput(req.url)) {
              reject(new Error('Invalid request method or URL'));
              return;
            }
            
            resolve({
              method: req.method,
              url: req.url,
              headers: this.sanitizeHeaders(req.headers),
              body: body
            });
          } catch (error) {
            console.error(`[HTTP] Error resolving request data:`, error.message);
            reject(error);
          }
        });
        
        req.on('error', (error) => {
          console.error(`[HTTP] Error reading request data:`, error.message);
          reject(error);
        });
      } catch (error) {
        console.error(`[HTTP] Error setting up request data collection:`, error.message);
        reject(error);
      }
    });
  }

  handleClientResponse(message) {
    try {
      const { slug, requestId, response } = message;
      const pendingRequest = this.pendingRequests.get(requestId);
      
      if (!pendingRequest) {
        console.log(`[WS] No pending request found for ID: ${requestId}`);
        this.addLog(`No pending request found for ID: ${requestId}`, 'error');
        return;
      }
      
      console.log(`[WS] Processing response for request ${requestId} from slug: "${slug}"`);
      this.addLog(`Processing response for request ${requestId} from slug: "${slug}"`, 'ws');
      
      console.log(`[WS] Response details:`, {
        statusCode: response.statusCode || 200,
        headersCount: response.headers ? Object.keys(response.headers).length : 0,
        bodyLength: response.body ? response.body.length : 0
      });
      
      // Calculate response time
      const responseTime = Date.now() - pendingRequest.startTime;
      this.stats.responseTimes.push(responseTime);
      
      // Keep only last 100 response times for average calculation
      if (this.stats.responseTimes.length > 100) {
        this.stats.responseTimes = this.stats.responseTimes.slice(-100);
      }
      
      // Clear timeout and send response
      clearTimeout(pendingRequest.timeout);
      this.pendingRequests.delete(requestId);
      
      const { res } = pendingRequest;
      
      try {
        // Set response headers
        if (response.headers) {
          Object.entries(response.headers).forEach(([key, value]) => {
            res.setHeader(key, value);
          });
        }
        
        // Set status code
        const statusCode = response.statusCode || 200;
        res.writeHead(statusCode);
        
        // Send response body
        res.end(response.body || '');
        
        console.log(`[HTTP] Response sent for request ${requestId} with status ${statusCode}`);
        this.addLog(`Response sent for request ${requestId} with status ${statusCode} (${responseTime}ms)`, 'http');
        
        // Update stats
        this.stats.successfulResponses++;
        
      } catch (responseError) {
        console.error(`[HTTP] Error sending response for request ${requestId}:`, responseError.message);
        this.addLog(`Error sending response for request ${requestId}: ${responseError.message}`, 'error');
        this.stats.failedResponses++;
        try {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Failed to send response' }));
          }
        } catch (fallbackError) {
          console.error(`[HTTP] Error sending fallback error response for request ${requestId}:`, fallbackError.message);
        }
      }
    } catch (error) {
      console.error(`[WS] Error handling client response for request ${message.requestId}:`, error.message);
      this.addLog(`Error handling client response for request ${message.requestId}: ${error.message}`, 'error');
    }
  }

  handleStatusPage(req, res) {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      
      const statusHtmlPath = join(__dirname, 'public', 'status.html');
      const statusHtml = readFileSync(statusHtmlPath, 'utf8');
      
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(statusHtml);
      
      console.log(`[HTTP] Status page served to ${req.socket.remoteAddress}`);
    } catch (error) {
      console.error(`[HTTP] Error serving status page:`, error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to load status page' }));
    }
  }

  handleApiRequest(req, res, pathname) {
    try {
      // Check authentication for API endpoints
      if (this.securityConfig.requireAuth && !this.checkStatusPageAccess(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized access to API' }));
        return;
      }
      
      if (pathname === '/api/status') {
        this.handleStatusApi(req, res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'API endpoint not found' }));
      }
    } catch (error) {
      console.error(`[HTTP] Error handling API request ${pathname}:`, error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  handleStatusApi(req, res) {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }
      
      const statusData = {
        serverStartTime: this.serverStartTime.toISOString(),
        activeClients: Array.from(this.clients.keys()),
        pendingRequests: this.pendingRequests.size,
        stats: this.stats
      };
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(statusData));
      
      console.log(`[HTTP] Status API served to ${req.socket.remoteAddress}`);
    } catch (error) {
      console.error(`[HTTP] Error serving status API:`, error.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to get status' }));
    }
  }

  sendStatusUpdate(ws) {
    try {
      const statusData = {
        type: 'status',
        data: {
          serverStartTime: this.serverStartTime.toISOString(),
          activeClients: Array.from(this.clients.keys()),
          pendingRequests: this.pendingRequests.size
        }
      };
      
      ws.send(JSON.stringify(statusData));
      
      // Send stats update
      const statsData = {
        type: 'stats',
        data: this.stats
      };
      
      ws.send(JSON.stringify(statsData));
    } catch (error) {
      console.error(`[WS] Error sending status update:`, error.message);
    }
  }

  broadcastToStatusClients(message) {
    try {
      const messageStr = JSON.stringify(message);
      this.statusClients.forEach(ws => {
        try {
          if (ws.readyState === 1) { // WebSocket.OPEN
            ws.send(messageStr);
          } else {
            this.statusClients.delete(ws);
          }
        } catch (error) {
          console.error(`[WS] Error broadcasting to status client:`, error.message);
          this.statusClients.delete(ws);
        }
      });
    } catch (error) {
      console.error(`[WS] Error broadcasting to status clients:`, error.message);
    }
  }

  setupMemoryManagement() {
    // Regular cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.performMemoryCleanup();
    }, this.memoryConfig.cleanupIntervalMs);
    
    // Full garbage collection interval
    this.gcInterval = setInterval(() => {
      this.performFullGC();
    }, this.memoryConfig.gcIntervalMs);
    
    // Hourly stats aggregation
    this.hourlyStatsInterval = setInterval(() => {
      this.aggregateHourlyStats();
    }, 3600000); // 1 hour
    
    // Daily stats aggregation
    this.dailyStatsInterval = setInterval(() => {
      this.aggregateDailyStats();
    }, 86400000); // 24 hours
    
    console.log(`[MEMORY] Memory management initialized`);
    console.log(`[MEMORY] Cleanup interval: ${this.memoryConfig.cleanupIntervalMs}ms`);
    console.log(`[MEMORY] GC interval: ${this.memoryConfig.gcIntervalMs}ms`);
    console.log(`[MEMORY] Log retention: ${this.memoryConfig.logRetentionDays} days`);
    console.log(`[MEMORY] Stats retention: ${this.memoryConfig.statsRetentionDays} days`);
  }

  performMemoryCleanup() {
    try {
      const startTime = Date.now();
      let cleaned = 0;
      
      // Clean up old logs
      const logCutoff = new Date(Date.now() - (this.memoryConfig.logRetentionDays * 24 * 60 * 60 * 1000));
      const originalLogCount = this.logs.length;
      this.logs = this.logs.filter(log => new Date(log.timestamp) > logCutoff);
      cleaned += originalLogCount - this.logs.length;
      
      // Clean up old hourly stats
      const hourlyCutoff = new Date(Date.now() - (this.memoryConfig.statsRetentionDays * 24 * 60 * 60 * 1000));
      for (const [hour, _] of this.stats.hourlyStats.entries()) {
        if (new Date(hour) < hourlyCutoff) {
          this.stats.hourlyStats.delete(hour);
          cleaned++;
        }
      }
      
      // Clean up old daily stats
      for (const [date, _] of this.stats.dailyStats.entries()) {
        if (new Date(date) < hourlyCutoff) {
          this.stats.dailyStats.delete(date);
          cleaned++;
        }
      }
      
      // Clean up dead WebSocket connections
      const originalStatusClients = this.statusClients.size;
      this.statusClients.forEach(ws => {
        if (ws.readyState !== 1) { // Not OPEN
          this.statusClients.delete(ws);
        }
      });
      cleaned += originalStatusClients - this.statusClients.size;
      
      // Clean up stale pending requests (older than 5 minutes)
      const staleCutoff = Date.now() - 300000; // 5 minutes
      for (const [requestId, requestData] of this.pendingRequests.entries()) {
        if (requestData.timestamp < staleCutoff) {
          clearTimeout(requestData.timeout);
          this.pendingRequests.delete(requestId);
          cleaned++;
        }
      }
      
      const cleanupTime = Date.now() - startTime;
      if (cleaned > 0) {
        console.log(`[MEMORY] Cleanup completed: ${cleaned} items cleaned in ${cleanupTime}ms`);
        this.addLog(`Memory cleanup: ${cleaned} items cleaned in ${cleanupTime}ms`, 'server');
      }
    } catch (error) {
      console.error(`[MEMORY] Error during cleanup:`, error.message);
    }
  }

  performFullGC() {
    try {
      const startTime = Date.now();
      const beforeMemory = process.memoryUsage();
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Clean up response times array
      if (this.stats.responseTimes.length > this.memoryConfig.maxResponseTimes) {
        this.stats.responseTimes = this.stats.responseTimes.slice(-this.memoryConfig.maxResponseTimes);
      }
      
      // Clean up logs array
      if (this.logs.length > this.memoryConfig.maxLogs) {
        this.logs = this.logs.slice(-this.memoryConfig.maxLogs);
      }
      
      const afterMemory = process.memoryUsage();
      const gcTime = Date.now() - startTime;
      const memoryFreed = beforeMemory.heapUsed - afterMemory.heapUsed;
      
      console.log(`[MEMORY] Full GC completed in ${gcTime}ms`);
      console.log(`[MEMORY] Memory freed: ${Math.round(memoryFreed / 1024 / 1024)}MB`);
      console.log(`[MEMORY] Current heap: ${Math.round(afterMemory.heapUsed / 1024 / 1024)}MB`);
      
      this.addLog(`Full GC: ${Math.round(memoryFreed / 1024 / 1024)}MB freed in ${gcTime}ms`, 'server');
    } catch (error) {
      console.error(`[MEMORY] Error during full GC:`, error.message);
    }
  }

  aggregateHourlyStats() {
    try {
      const now = new Date();
      const hour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
      const hourKey = hour.toISOString();
      
      const currentHourStats = this.stats.hourlyStats.get(hourKey) || {
        requests: 0,
        responses: 0,
        totalResponseTime: 0,
        responseCount: 0
      };
      
      // Update with current stats
      currentHourStats.requests = this.stats.totalRequests;
      currentHourStats.responses = this.stats.successfulResponses + this.stats.failedResponses;
      
      if (this.stats.responseTimes.length > 0) {
        currentHourStats.totalResponseTime = this.stats.responseTimes.reduce((a, b) => a + b, 0);
        currentHourStats.responseCount = this.stats.responseTimes.length;
      }
      
      this.stats.hourlyStats.set(hourKey, currentHourStats);
      
      console.log(`[MEMORY] Hourly stats aggregated for ${hourKey}`);
    } catch (error) {
      console.error(`[MEMORY] Error aggregating hourly stats:`, error.message);
    }
  }

  aggregateDailyStats() {
    try {
      const now = new Date();
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayKey = day.toISOString().split('T')[0];
      
      const currentDayStats = this.stats.dailyStats.get(dayKey) || {
        requests: 0,
        responses: 0,
        avgResponseTime: 0,
        peakHourlyRequests: 0
      };
      
      // Calculate daily stats from hourly data
      let totalRequests = 0;
      let totalResponses = 0;
      let totalResponseTime = 0;
      let responseCount = 0;
      let peakHourlyRequests = 0;
      
      for (const [hourKey, hourStats] of this.stats.hourlyStats.entries()) {
        if (hourKey.startsWith(dayKey)) {
          totalRequests = Math.max(totalRequests, hourStats.requests);
          totalResponses = Math.max(totalResponses, hourStats.responses);
          totalResponseTime += hourStats.totalResponseTime;
          responseCount += hourStats.responseCount;
          peakHourlyRequests = Math.max(peakHourlyRequests, hourStats.requests);
        }
      }
      
      currentDayStats.requests = totalRequests;
      currentDayStats.responses = totalResponses;
      currentDayStats.avgResponseTime = responseCount > 0 ? totalResponseTime / responseCount : 0;
      currentDayStats.peakHourlyRequests = peakHourlyRequests;
      
      this.stats.dailyStats.set(dayKey, currentDayStats);
      
      console.log(`[MEMORY] Daily stats aggregated for ${dayKey}`);
    } catch (error) {
      console.error(`[MEMORY] Error aggregating daily stats:`, error.message);
    }
  }

  // Security helper methods
  getClientIP(req) {
    return req.headers['x-forwarded-for'] || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           'unknown';
  }

  applySecurityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    
    if (this.securityConfig.enableCORS) {
      res.setHeader('Access-Control-Allow-Origin', this.securityConfig.allowedOrigins.includes('*') ? '*' : this.securityConfig.allowedOrigins.join(', '));
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
  }

  checkRateLimit(clientIP, req) {
    const now = Date.now();
    const minuteAgo = now - 60000;
    
    if (!this.rateLimitTracker.has(clientIP)) {
      this.rateLimitTracker.set(clientIP, { requests: [], connections: [] });
    }
    
    const tracker = this.rateLimitTracker.get(clientIP);
    
    // Clean old requests
    tracker.requests = tracker.requests.filter(timestamp => timestamp > minuteAgo);
    
    // Check request rate limit
    if (tracker.requests.length >= this.securityConfig.maxRequestsPerMinute) {
      return false;
    }
    
    // Add current request
    tracker.requests.push(now);
    
    // Check connection limit for WebSocket connections
    if (req.headers.upgrade === 'websocket') {
      tracker.connections = tracker.connections.filter(timestamp => timestamp > minuteAgo);
      if (tracker.connections.length >= this.securityConfig.maxConnectionsPerIP) {
        return false;
      }
      tracker.connections.push(now);
    }
    
    return true;
  }

  validateSlug(slug) {
    // Allow only alphanumeric characters, hyphens, and underscores
    // Length between 1 and 50 characters
    return validator.isLength(slug, { min: 1, max: 50 }) &&
           validator.matches(slug, /^[a-zA-Z0-9_-]+$/);
  }

  validateInput(input) {
    if (typeof input !== 'string') return false;
    
    // Check for common injection patterns
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /eval\s*\(/i,
      /expression\s*\(/i,
      /vbscript:/i,
      /data:text\/html/i
    ];
    
    return !dangerousPatterns.some(pattern => pattern.test(input));
  }

  sanitizeHeaders(headers) {
    const sanitized = {};
    const dangerousHeaders = [
      'host', 'content-length', 'transfer-encoding', 'connection',
      'upgrade', 'proxy-connection', 'proxy-authenticate',
      'proxy-authorization', 'te', 'trailers'
    ];
    
    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();
      if (!dangerousHeaders.includes(lowerKey) && this.validateInput(value)) {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }

  checkStatusPageAccess(req) {
    if (!this.securityConfig.requireAuth) {
      return true;
    }
    
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return false;
    }
    
    try {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, this.securityConfig.jwtSecret);
      return decoded.type === 'admin';
    } catch (error) {
      return false;
    }
  }

  handleLogin(req, res) {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > this.securityConfig.maxRequestSize) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request too large' }));
        return;
      }
    });
    
    req.on('end', () => {
      try {
        const { password } = JSON.parse(body);
        
        if (password === this.securityConfig.adminPassword) {
          const token = jwt.sign(
            { type: 'admin', timestamp: Date.now() },
            this.securityConfig.jwtSecret,
            { expiresIn: this.securityConfig.jwtExpiry }
          );
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ token, expiresIn: this.securityConfig.jwtExpiry }));
          
          this.addLog(`Admin login successful from IP: ${this.getClientIP(req)}`, 'security');
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid credentials' }));
          
          this.addLog(`Failed admin login attempt from IP: ${this.getClientIP(req)}`, 'security');
        }
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request format' }));
      }
    });
  }

  addLog(message, level = 'info') {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: level,
        message: message
      };
      
      this.logs.push(logEntry);
      
      // Keep only last maxLogs entries
      if (this.logs.length > this.memoryConfig.maxLogs) {
        this.logs = this.logs.slice(-this.memoryConfig.maxLogs);
      }
      
      // Broadcast to status clients
      this.broadcastToStatusClients({
        type: 'log',
        level: level,
        message: message
      });
    } catch (error) {
      console.error(`[SERVER] Error adding log:`, error.message);
    }
  }

  start(port = 3000) {
    try {
      this.httpServer.listen(port, () => {
        console.log(`[SERVER] Proxy server running on port ${port}`);
        console.log(`[SERVER] WebSocket endpoint: ws://localhost:${port}/ws`);
        console.log(`[SERVER] HTTP endpoint: http://localhost:${port}/{slug}`);
        console.log(`[SERVER] Status page: http://localhost:${port}/status`);
        console.log(`[SERVER] Status API: http://localhost:${port}/api/status`);
        console.log(`[SERVER] Supports multiple concurrent slugs simultaneously`);
        console.log(`[SERVER] Request timeout: 2.5 minutes for active clients, 30 seconds for queued requests`);
        console.log(`[SERVER] Using UUID-based request IDs for better tracking`);
        
        this.addLog('Server started successfully', 'server');
      });
      
      this.httpServer.on('error', (error) => {
        console.error(`[SERVER] HTTP server error:`, error.message);
        this.addLog(`HTTP server error: ${error.message}`, 'error');
      });
      
      this.httpServer.on('clientError', (error, socket) => {
        console.error(`[SERVER] HTTP client error:`, error.message);
        this.addLog(`HTTP client error: ${error.message}`, 'error');
        try {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        } catch (socketError) {
          console.error(`[SERVER] Error closing client socket:`, socketError.message);
        }
      });
    } catch (error) {
      console.error(`[SERVER] Error starting server:`, error.message);
      throw error;
    }
  }

  // Utility method to get status information
  getStatus() {
    return {
      activeClients: Array.from(this.clients.keys()),
      pendingRequests: this.pendingRequests.size,
      memoryUsage: process.memoryUsage(),
      uptime: Date.now() - this.serverStartTime.getTime(),
      stats: this.stats
    };
  }

  // Graceful shutdown method
  shutdown() {
    try {
      console.log(`[SERVER] Starting graceful shutdown...`);
      
      // Clear all intervals
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        console.log(`[SERVER] Cleanup interval cleared`);
      }
      
      if (this.gcInterval) {
        clearInterval(this.gcInterval);
        console.log(`[SERVER] GC interval cleared`);
      }
      
      if (this.hourlyStatsInterval) {
        clearInterval(this.hourlyStatsInterval);
        console.log(`[SERVER] Hourly stats interval cleared`);
      }
      
      if (this.dailyStatsInterval) {
        clearInterval(this.dailyStatsInterval);
        console.log(`[SERVER] Daily stats interval cleared`);
      }
      
      // Close all WebSocket connections
      this.clients.forEach((client, slug) => {
        try {
          client.close(1001, 'Server shutting down');
          console.log(`[SERVER] Closed client for slug: ${slug}`);
        } catch (error) {
          console.error(`[SERVER] Error closing client for slug ${slug}:`, error.message);
        }
      });
      
      this.statusClients.forEach(client => {
        try {
          client.close(1001, 'Server shutting down');
        } catch (error) {
          console.error(`[SERVER] Error closing status client:`, error.message);
        }
      });
      
      // Clear all pending requests
      this.pendingRequests.forEach((requestData, requestId) => {
        try {
          clearTimeout(requestData.timeout);
          if (!requestData.res.headersSent) {
            requestData.res.writeHead(503, { 'Content-Type': 'application/json' });
            requestData.res.end(JSON.stringify({ error: 'Server shutting down' }));
          }
        } catch (error) {
          console.error(`[SERVER] Error handling pending request ${requestId}:`, error.message);
        }
      });
      
      // Close HTTP server
      this.httpServer.close(() => {
        console.log(`[SERVER] HTTP server closed`);
        console.log(`[SERVER] Graceful shutdown completed`);
        process.exit(0);
      });
      
      // Force exit after 10 seconds if graceful shutdown fails
      setTimeout(() => {
        console.log(`[SERVER] Force exit after timeout`);
        process.exit(1);
      }, 10000);
      
    } catch (error) {
      console.error(`[SERVER] Error during shutdown:`, error.message);
      process.exit(1);
    }
  }
}

// Start the server with error handling
try {
  const proxyServer = new ProxyServer();
  proxyServer.start(3000);
} catch (error) {
  console.error(`[SERVER] Failed to start proxy server:`, error.message);
  process.exit(1);
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(`[SERVER] Uncaught Exception:`, error.message);
  console.error(`[SERVER] Stack:`, error.stack);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error(`[SERVER] Unhandled Rejection at:`, promise);
  console.error(`[SERVER] Reason:`, reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`[SERVER] Received SIGINT, shutting down gracefully...`);
  proxyServer.shutdown();
});

process.on('SIGTERM', () => {
  console.log(`[SERVER] Received SIGTERM, shutting down gracefully...`);
  proxyServer.shutdown();
});
