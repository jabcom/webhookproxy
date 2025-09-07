# Monday.com Webhook Integration with Unity C#

## Overview

This guide demonstrates how to use WebhookProxy with Unity C# to handle webhooks from Monday.com. This setup allows you to receive real-time notifications from Monday.com boards directly in your Unity application.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Monday.com Webhook Setup](#mondaycom-webhook-setup)
3. [Unity Project Setup](#unity-project-setup)
4. [WebhookProxy Server Setup](#webhookproxy-server-setup)
5. [Unity Client Implementation](#unity-client-implementation)
6. [Monday.com Webhook Handler](#mondaycom-webhook-handler)
7. [Testing the Integration](#testing-the-integration)
8. [Production Deployment](#production-deployment)
9. [Troubleshooting](#troubleshooting)
10. [Best Practices](#best-practices)

## Prerequisites

### Required Software
- Unity 2022.3 LTS or newer
- Node.js 18+ (for WebhookProxy server)
- Monday.com account with admin access
- Visual Studio or VS Code

### Required Unity Packages
- **WebSocketSharp** (for WebSocket communication)
- **Newtonsoft.Json** (for JSON parsing)
- **Unity Web Request** (built-in)

### Required npm Packages
- WebhookProxy server dependencies (already included)

## Monday.com Webhook Setup

### 1. Create a Monday.com App

1. Go to [Monday.com Developer Portal](https://developer.monday.com/)
2. Create a new app
3. Note down your **App ID** and **Client Secret**

### 2. Configure Webhook Endpoint

1. In your Monday.com app settings, add a webhook endpoint:
   ```
   https://your-domain.com/monday-webhooks
   ```
   Replace `your-domain.com` with your WebhookProxy server domain.

2. Set up webhook triggers for the events you want to monitor:
   - **Item Created**
   - **Item Updated**
   - **Item Deleted**
   - **Column Value Changed**
   - **Board Updated**

### 3. Get Webhook Verification Token

Monday.com provides a verification token for webhook security. Save this token for later use.

## Unity Project Setup

### 1. Install Required Packages

#### WebSocketSharp
```bash
# Using Package Manager (Window > Package Manager)
# Search for "WebSocketSharp" and install
```

#### Newtonsoft.Json
```bash
# Using Package Manager
# Search for "Newtonsoft Json" and install
```

### 2. Create Project Structure

```
Assets/
├── Scripts/
│   ├── WebhookProxy/
│   │   ├── WebhookProxyClient.cs
│   │   ├── MondayWebhookHandler.cs
│   │   └── WebhookDataModels.cs
│   └── Managers/
│       └── WebhookManager.cs
├── Prefabs/
│   └── WebhookProxyClient.prefab
└── Scenes/
    └── WebhookTestScene.unity
```

## WebhookProxy Server Setup

### 1. Configure Environment Variables

Create a `.env` file:

```bash
# WebhookProxy Configuration
PORT=3000
NODE_ENV=production

# Security
JWT_SECRET=your-super-secret-jwt-key-here
ADMIN_PASSWORD=your-admin-password-here
REQUIRE_AUTH=true
ENABLE_RATE_LIMIT=true

# Monday.com Webhook Security
MONDAY_WEBHOOK_VERIFICATION_TOKEN=your-monday-verification-token

# CORS (allow Unity WebGL builds)
CORS_ORIGINS=http://localhost:3000,https://your-unity-build-domain.com
```

### 2. Start WebhookProxy Server

```bash
# Install dependencies
npm install

# Start server
npm start
```

The server will be available at:
- **HTTP**: `http://localhost:3000`
- **WebSocket**: `ws://localhost:3000/ws`
- **Status Page**: `http://localhost:3000/status`

## Unity Client Implementation

### 1. Webhook Data Models

Create `WebhookDataModels.cs`:

```csharp
using System;
using Newtonsoft.Json;

namespace WebhookProxy.Monday
{
    [Serializable]
    public class MondayWebhookPayload
    {
        [JsonProperty("challenge")]
        public string Challenge { get; set; }
        
        [JsonProperty("event")]
        public MondayEvent Event { get; set; }
        
        [JsonProperty("subscription")]
        public MondaySubscription Subscription { get; set; }
    }

    [Serializable]
    public class MondayEvent
    {
        [JsonProperty("type")]
        public string Type { get; set; }
        
        [JsonProperty("boardId")]
        public long BoardId { get; set; }
        
        [JsonProperty("pulseId")]
        public long PulseId { get; set; }
        
        [JsonProperty("pulseName")]
        public string PulseName { get; set; }
        
        [JsonProperty("userId")]
        public long UserId { get; set; }
        
        [JsonProperty("columnId")]
        public string ColumnId { get; set; }
        
        [JsonProperty("columnType")]
        public string ColumnType { get; set; }
        
        [JsonProperty("columnValue")]
        public object ColumnValue { get; set; }
        
        [JsonProperty("previousValue")]
        public object PreviousValue { get; set; }
        
        [JsonProperty("changedAt")]
        public DateTime ChangedAt { get; set; }
    }

    [Serializable]
    public class MondaySubscription
    {
        [JsonProperty("id")]
        public long Id { get; set; }
        
        [JsonProperty("boardId")]
        public long BoardId { get; set; }
        
        [JsonProperty("event")]
        public string Event { get; set; }
    }

    [Serializable]
    public class WebhookProxyRequest
    {
        [JsonProperty("slug")]
        public string Slug { get; set; }
        
        [JsonProperty("request")]
        public RequestData Request { get; set; }
    }

    [Serializable]
    public class RequestData
    {
        [JsonProperty("id")]
        public string Id { get; set; }
        
        [JsonProperty("data")]
        public RequestDataDetails Data { get; set; }
    }

    [Serializable]
    public class RequestDataDetails
    {
        [JsonProperty("method")]
        public string Method { get; set; }
        
        [JsonProperty("url")]
        public string Url { get; set; }
        
        [JsonProperty("headers")]
        public System.Collections.Generic.Dictionary<string, string> Headers { get; set; }
        
        [JsonProperty("body")]
        public string Body { get; set; }
        
        [JsonProperty("query")]
        public System.Collections.Generic.Dictionary<string, string> Query { get; set; }
    }

    [Serializable]
    public class WebhookProxyResponse
    {
        [JsonProperty("slug")]
        public string Slug { get; set; }
        
        [JsonProperty("requestId")]
        public string RequestId { get; set; }
        
        [JsonProperty("response")]
        public ResponseData Response { get; set; }
    }

    [Serializable]
    public class ResponseData
    {
        [JsonProperty("statusCode")]
        public int StatusCode { get; set; }
        
        [JsonProperty("headers")]
        public System.Collections.Generic.Dictionary<string, string> Headers { get; set; }
        
        [JsonProperty("body")]
        public string Body { get; set; }
    }
}
```

### 2. Enhanced WebhookProxy Client

Create `WebhookProxyClient.cs`:

```csharp
using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using WebSocketSharp;
using Newtonsoft.Json;
using WebhookProxy.Monday;

namespace WebhookProxy
{
    public class WebhookProxyClient : MonoBehaviour
    {
        [Header("Connection Settings")]
        public string serverUrl = "ws://localhost:3000/ws";
        public string slug = "monday-webhooks";
        
        [Header("Connection Options")]
        public bool autoConnect = true;
        public bool enableDebugLogs = true;
        public float reconnectDelay = 5f;
        public int maxReconnectAttempts = 10;
        
        [Header("Monday.com Settings")]
        public string mondayWebhookVerificationToken = "";
        
        // Events
        public System.Action<MondayWebhookPayload> OnMondayWebhookReceived;
        public System.Action<string> OnConnectionStatusChanged;
        public System.Action<string> OnError;
        
        // Private fields
        private WebSocket webSocket;
        private bool isConnected = false;
        private bool shouldReconnect = true;
        private int reconnectAttempts = 0;
        private Coroutine reconnectCoroutine;
        
        // Connection status
        public bool IsConnected => isConnected;
        
        void Start()
        {
            if (autoConnect)
            {
                Connect();
            }
        }
        
        public void Connect()
        {
            if (webSocket != null && webSocket.ReadyState == WebSocketState.Open)
            {
                LogDebug("Already connected to WebhookProxy");
                return;
            }
            
            try
            {
                webSocket = new WebSocket(serverUrl);
                
                // Set up event handlers
                webSocket.OnOpen += OnWebSocketOpen;
                webSocket.OnMessage += OnWebSocketMessage;
                webSocket.OnError += OnWebSocketError;
                webSocket.OnClose += OnWebSocketClose;
                
                // Connect
                webSocket.Connect();
                
                LogDebug("🔌 Attempting to connect to WebhookProxy...");
            }
            catch (Exception e)
            {
                LogError($"❌ Failed to create WebSocket connection: {e.Message}");
                OnError?.Invoke($"Connection failed: {e.Message}");
            }
        }
        
        void OnWebSocketOpen(object sender, EventArgs e)
        {
            isConnected = true;
            reconnectAttempts = 0;
            shouldReconnect = true;
            
            LogDebug("✅ Connected to WebhookProxy server");
            OnConnectionStatusChanged?.Invoke("Connected");
            
            // Register with slug
            var registrationMessage = new { slug = slug };
            string jsonMessage = JsonConvert.SerializeObject(registrationMessage);
            webSocket.Send(jsonMessage);
            
            LogDebug($"📝 Registered with slug: {slug}");
        }
        
        void OnWebSocketMessage(object sender, MessageEventArgs e)
        {
            try
            {
                LogDebug($"📨 Received message: {e.Data}");
                
                var request = JsonConvert.DeserializeObject<WebhookProxyRequest>(e.Data);
                
                if (request?.slug == slug && request?.request != null)
                {
                    HandleWebhookRequest(request.request);
                }
                else
                {
                    LogDebug("⚠️ Received message for different slug or invalid format");
                }
            }
            catch (Exception ex)
            {
                LogError($"❌ Error processing WebSocket message: {ex.Message}");
                OnError?.Invoke($"Message processing error: {ex.Message}");
            }
        }
        
        void OnWebSocketError(object sender, ErrorEventArgs e)
        {
            LogError($"❌ WebSocket error: {e.Message}");
            OnError?.Invoke($"WebSocket error: {e.Message}");
        }
        
        void OnWebSocketClose(object sender, CloseEventArgs e)
        {
            isConnected = false;
            LogDebug($"🔌 WebSocket closed: {e.Reason}");
            OnConnectionStatusChanged?.Invoke($"Disconnected: {e.Reason}");
            
            if (shouldReconnect && reconnectAttempts < maxReconnectAttempts)
            {
                StartReconnect();
            }
        }
        
        void StartReconnect()
        {
            if (reconnectCoroutine != null)
            {
                StopCoroutine(reconnectCoroutine);
            }
            
            reconnectCoroutine = StartCoroutine(ReconnectCoroutine());
        }
        
        IEnumerator ReconnectCoroutine()
        {
            reconnectAttempts++;
            LogDebug($"🔄 Attempting to reconnect ({reconnectAttempts}/{maxReconnectAttempts}) in {reconnectDelay} seconds...");
            
            yield return new WaitForSeconds(reconnectDelay);
            
            if (shouldReconnect)
            {
                Connect();
            }
        }
        
        void HandleWebhookRequest(RequestData requestData)
        {
            try
            {
                LogDebug($"🔔 Processing webhook request: {requestData.Id}");
                LogDebug($"   Method: {requestData.Data.Method}");
                LogDebug($"   URL: {requestData.Data.Url}");
                LogDebug($"   Body: {requestData.Data.Body}");
                
                // Verify Monday.com webhook (if verification token is set)
                if (!string.IsNullOrEmpty(mondayWebhookVerificationToken))
                {
                    if (!VerifyMondayWebhook(requestData.Data))
                    {
                        SendErrorResponse(requestData.Id, 401, "Unauthorized webhook");
                        return;
                    }
                }
                
                // Parse Monday.com webhook payload
                var mondayPayload = JsonConvert.DeserializeObject<MondayWebhookPayload>(requestData.Data.Body);
                
                if (mondayPayload?.Event != null)
                {
                    LogDebug($"📋 Monday.com webhook received:");
                    LogDebug($"   Type: {mondayPayload.Event.Type}");
                    LogDebug($"   Board ID: {mondayPayload.Event.BoardId}");
                    LogDebug($"   Pulse ID: {mondayPayload.Event.PulseId}");
                    LogDebug($"   Pulse Name: {mondayPayload.Event.PulseName}");
                    
                    // Trigger Unity event
                    OnMondayWebhookReceived?.Invoke(mondayPayload);
                    
                    // Send success response
                    SendSuccessResponse(requestData.Id, "Webhook processed successfully");
                }
                else
                {
                    LogDebug("⚠️ Invalid Monday.com webhook payload");
                    SendErrorResponse(requestData.Id, 400, "Invalid webhook payload");
                }
            }
            catch (Exception ex)
            {
                LogError($"❌ Error handling webhook request: {ex.Message}");
                SendErrorResponse(requestData.Id, 500, $"Internal error: {ex.Message}");
            }
        }
        
        bool VerifyMondayWebhook(RequestDataDetails requestData)
        {
            // Check for Monday.com verification token in headers
            if (requestData.Headers != null && 
                requestData.Headers.ContainsKey("X-Monday-Signature"))
            {
                // In a real implementation, you would verify the signature
                // For now, we'll just check if the token matches
                return true; // Simplified for this example
            }
            
            return false;
        }
        
        void SendSuccessResponse(string requestId, string message)
        {
            var response = new WebhookProxyResponse
            {
                slug = slug,
                requestId = requestId,
                response = new ResponseData
                {
                    statusCode = 200,
                    headers = new Dictionary<string, string>
                    {
                        { "Content-Type", "application/json" }
                    },
                    body = JsonConvert.SerializeObject(new { message = message, success = true })
                }
            };
            
            string jsonResponse = JsonConvert.SerializeObject(response);
            webSocket.Send(jsonResponse);
            
            LogDebug($"✅ Sent success response for request {requestId}");
        }
        
        void SendErrorResponse(string requestId, int statusCode, string errorMessage)
        {
            var response = new WebhookProxyResponse
            {
                slug = slug,
                requestId = requestId,
                response = new ResponseData
                {
                    statusCode = statusCode,
                    headers = new Dictionary<string, string>
                    {
                        { "Content-Type", "application/json" }
                    },
                    body = JsonConvert.SerializeObject(new { error = errorMessage, success = false })
                }
            };
            
            string jsonResponse = JsonConvert.SerializeObject(response);
            webSocket.Send(jsonResponse);
            
            LogDebug($"❌ Sent error response for request {requestId}: {errorMessage}");
        }
        
        public void Disconnect()
        {
            shouldReconnect = false;
            
            if (reconnectCoroutine != null)
            {
                StopCoroutine(reconnectCoroutine);
                reconnectCoroutine = null;
            }
            
            if (webSocket != null)
            {
                webSocket.Close();
                webSocket = null;
            }
            
            LogDebug("🔌 Disconnected from WebhookProxy");
        }
        
        void LogDebug(string message)
        {
            if (enableDebugLogs)
            {
                Debug.Log($"[WebhookProxy] {message}");
            }
        }
        
        void LogError(string message)
        {
            Debug.LogError($"[WebhookProxy] {message}");
        }
        
        void OnDestroy()
        {
            Disconnect();
        }
        
        void OnApplicationPause(bool pauseStatus)
        {
            if (pauseStatus)
            {
                Disconnect();
            }
            else if (autoConnect)
            {
                Connect();
            }
        }
        
        void OnApplicationFocus(bool hasFocus)
        {
            if (!hasFocus)
            {
                Disconnect();
            }
            else if (autoConnect)
            {
                Connect();
            }
        }
    }
}
```

### 3. Monday.com Webhook Handler

Create `MondayWebhookHandler.cs`:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;
using WebhookProxy.Monday;

namespace WebhookProxy.Monday
{
    public class MondayWebhookHandler : MonoBehaviour
    {
        [Header("Webhook Processing")]
        public bool enableDebugLogs = true;
        
        // Events for different webhook types
        public System.Action<MondayEvent> OnItemCreated;
        public System.Action<MondayEvent> OnItemUpdated;
        public System.Action<MondayEvent> OnItemDeleted;
        public System.Action<MondayEvent> OnColumnValueChanged;
        public System.Action<MondayEvent> OnBoardUpdated;
        
        // General webhook event
        public System.Action<MondayWebhookPayload> OnWebhookReceived;
        
        public void ProcessWebhook(MondayWebhookPayload webhookPayload)
        {
            if (webhookPayload?.Event == null)
            {
                LogError("Invalid webhook payload received");
                return;
            }
            
            var mondayEvent = webhookPayload.Event;
            
            LogDebug($"📋 Processing Monday.com webhook:");
            LogDebug($"   Type: {mondayEvent.Type}");
            LogDebug($"   Board ID: {mondayEvent.BoardId}");
            LogDebug($"   Pulse ID: {mondayEvent.PulseId}");
            LogDebug($"   Pulse Name: {mondayEvent.PulseName}");
            LogDebug($"   User ID: {mondayEvent.UserId}");
            LogDebug($"   Changed At: {mondayEvent.ChangedAt}");
            
            // Trigger general webhook event
            OnWebhookReceived?.Invoke(webhookPayload);
            
            // Trigger specific events based on webhook type
            switch (mondayEvent.Type.ToLower())
            {
                case "create_pulse":
                    OnItemCreated?.Invoke(mondayEvent);
                    LogDebug("🆕 Item created event triggered");
                    break;
                    
                case "change_column_value":
                    OnColumnValueChanged?.Invoke(mondayEvent);
                    LogDebug($"🔄 Column value changed: {mondayEvent.ColumnId}");
                    LogDebug($"   Previous: {mondayEvent.PreviousValue}");
                    LogDebug($"   New: {mondayEvent.ColumnValue}");
                    break;
                    
                case "change_name":
                    OnItemUpdated?.Invoke(mondayEvent);
                    LogDebug($"📝 Item name changed: {mondayEvent.PulseName}");
                    break;
                    
                case "delete_pulse":
                    OnItemDeleted?.Invoke(mondayEvent);
                    LogDebug("🗑️ Item deleted event triggered");
                    break;
                    
                case "change_board":
                    OnBoardUpdated?.Invoke(mondayEvent);
                    LogDebug("📋 Board updated event triggered");
                    break;
                    
                default:
                    LogDebug($"⚠️ Unknown webhook type: {mondayEvent.Type}");
                    break;
            }
            
            // Example: Update UI based on webhook
            UpdateUIWithWebhookData(mondayEvent);
        }
        
        void UpdateUIWithWebhookData(MondayEvent mondayEvent)
        {
            // Example implementation - customize based on your needs
            switch (mondayEvent.Type.ToLower())
            {
                case "create_pulse":
                    // Show notification for new item
                    ShowNotification($"New item created: {mondayEvent.PulseName}", Color.green);
                    break;
                    
                case "change_column_value":
                    // Show notification for column change
                    ShowNotification($"Column {mondayEvent.ColumnId} updated", Color.yellow);
                    break;
                    
                case "delete_pulse":
                    // Show notification for deleted item
                    ShowNotification($"Item deleted: {mondayEvent.PulseName}", Color.red);
                    break;
            }
        }
        
        void ShowNotification(string message, Color color)
        {
            // Example notification system - implement based on your UI framework
            LogDebug($"🔔 Notification: {message}");
            
            // You could integrate with a notification system like:
            // - Unity's built-in UI system
            // - Third-party notification plugins
            // - Custom notification manager
        }
        
        void LogDebug(string message)
        {
            if (enableDebugLogs)
            {
                Debug.Log($"[MondayWebhookHandler] {message}");
            }
        }
        
        void LogError(string message)
        {
            Debug.LogError($"[MondayWebhookHandler] {message}");
        }
    }
}
```

### 4. Webhook Manager

Create `WebhookManager.cs`:

```csharp
using System;
using UnityEngine;
using WebhookProxy.Monday;

namespace WebhookProxy
{
    public class WebhookManager : MonoBehaviour
    {
        [Header("Components")]
        public WebhookProxyClient webhookClient;
        public MondayWebhookHandler webhookHandler;
        
        [Header("Settings")]
        public bool autoStart = true;
        public bool enableNotifications = true;
        
        // Statistics
        private int totalWebhooksReceived = 0;
        private int itemsCreated = 0;
        private int itemsUpdated = 0;
        private int itemsDeleted = 0;
        private int columnChanges = 0;
        
        void Start()
        {
            if (autoStart)
            {
                InitializeWebhookSystem();
            }
        }
        
        public void InitializeWebhookSystem()
        {
            // Ensure components are assigned
            if (webhookClient == null)
                webhookClient = FindObjectOfType<WebhookProxyClient>();
            
            if (webhookHandler == null)
                webhookHandler = FindObjectOfType<MondayWebhookHandler>();
            
            // Set up event connections
            if (webhookClient != null)
            {
                webhookClient.OnMondayWebhookReceived += HandleMondayWebhook;
                webhookClient.OnConnectionStatusChanged += OnConnectionStatusChanged;
                webhookClient.OnError += OnWebhookError;
            }
            
            if (webhookHandler != null)
            {
                webhookHandler.OnItemCreated += OnItemCreated;
                webhookHandler.OnItemUpdated += OnItemUpdated;
                webhookHandler.OnItemDeleted += OnItemDeleted;
                webhookHandler.OnColumnValueChanged += OnColumnValueChanged;
                webhookHandler.OnBoardUpdated += OnBoardUpdated;
            }
            
            Debug.Log("🔧 Webhook system initialized");
        }
        
        void HandleMondayWebhook(MondayWebhookPayload webhookPayload)
        {
            totalWebhooksReceived++;
            
            Debug.Log($"📨 Webhook #{totalWebhooksReceived} received from Monday.com");
            
            // Process the webhook
            if (webhookHandler != null)
            {
                webhookHandler.ProcessWebhook(webhookPayload);
            }
        }
        
        void OnItemCreated(MondayEvent mondayEvent)
        {
            itemsCreated++;
            Debug.Log($"🆕 Item created: {mondayEvent.PulseName} (Total: {itemsCreated})");
        }
        
        void OnItemUpdated(MondayEvent mondayEvent)
        {
            itemsUpdated++;
            Debug.Log($"📝 Item updated: {mondayEvent.PulseName} (Total: {itemsUpdated})");
        }
        
        void OnItemDeleted(MondayEvent mondayEvent)
        {
            itemsDeleted++;
            Debug.Log($"🗑️ Item deleted: {mondayEvent.PulseName} (Total: {itemsDeleted})");
        }
        
        void OnColumnValueChanged(MondayEvent mondayEvent)
        {
            columnChanges++;
            Debug.Log($"🔄 Column changed: {mondayEvent.ColumnId} (Total: {columnChanges})");
        }
        
        void OnBoardUpdated(MondayEvent mondayEvent)
        {
            Debug.Log($"📋 Board updated: {mondayEvent.BoardId}");
        }
        
        void OnConnectionStatusChanged(string status)
        {
            Debug.Log($"🔌 Connection status: {status}");
        }
        
        void OnWebhookError(string error)
        {
            Debug.LogError($"❌ Webhook error: {error}");
        }
        
        // Public methods for external access
        public void ConnectToWebhookProxy()
        {
            if (webhookClient != null)
            {
                webhookClient.Connect();
            }
        }
        
        public void DisconnectFromWebhookProxy()
        {
            if (webhookClient != null)
            {
                webhookClient.Disconnect();
            }
        }
        
        public bool IsConnected()
        {
            return webhookClient != null && webhookClient.IsConnected;
        }
        
        public void GetStatistics()
        {
            Debug.Log($"📊 Webhook Statistics:");
            Debug.Log($"   Total webhooks received: {totalWebhooksReceived}");
            Debug.Log($"   Items created: {itemsCreated}");
            Debug.Log($"   Items updated: {itemsUpdated}");
            Debug.Log($"   Items deleted: {itemsDeleted}");
            Debug.Log($"   Column changes: {columnChanges}");
        }
        
        void OnDestroy()
        {
            // Clean up event subscriptions
            if (webhookClient != null)
            {
                webhookClient.OnMondayWebhookReceived -= HandleMondayWebhook;
                webhookClient.OnConnectionStatusChanged -= OnConnectionStatusChanged;
                webhookClient.OnError -= OnWebhookError;
            }
        }
    }
}
```

## Testing the Integration

### 1. Create Test Scene

1. Create a new Unity scene
2. Add an empty GameObject named "WebhookManager"
3. Add the `WebhookManager` script to it
4. Create child objects for `WebhookProxyClient` and `MondayWebhookHandler`
5. Assign the components in the inspector

### 2. Configure Settings

In the Unity Inspector:

**WebhookProxyClient:**
- Server URL: `ws://localhost:3000/ws`
- Slug: `monday-webhooks`
- Auto Connect: ✅
- Enable Debug Logs: ✅
- Monday Webhook Verification Token: (your token)

**MondayWebhookHandler:**
- Enable Debug Logs: ✅

### 3. Test Webhook Reception

1. Start your WebhookProxy server
2. Run the Unity scene
3. Check the Console for connection messages
4. Trigger a webhook from Monday.com
5. Verify the webhook is received and processed

### 4. Manual Testing with curl

```bash
# Test webhook endpoint directly
curl -X POST http://localhost:3000/monday-webhooks \
  -H "Content-Type: application/json" \
  -H "X-Monday-Signature: your-signature" \
  -d '{
    "challenge": "test-challenge",
    "event": {
      "type": "create_pulse",
      "boardId": 123456789,
      "pulseId": 987654321,
      "pulseName": "Test Item",
      "userId": 111111111,
      "changedAt": "2024-01-15T10:30:00Z"
    },
    "subscription": {
      "id": 555555555,
      "boardId": 123456789,
      "event": "create_pulse"
    }
  }'
```

## Production Deployment

### 1. Unity Build Settings

**For WebGL builds:**
- Set WebSocket URL to use `wss://` (secure WebSocket)
- Configure CORS on WebhookProxy server
- Test in browser environment

**For Standalone builds:**
- Use `ws://` or `wss://` URLs
- Handle network connectivity issues
- Implement offline mode if needed

### 2. WebhookProxy Server Deployment

```bash
# Build Docker image
docker build -t webhookproxy .

# Run with production settings
docker run -d \
  --name webhookproxy \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e JWT_SECRET="your-production-jwt-secret" \
  -e ADMIN_PASSWORD="your-production-admin-password" \
  -e REQUIRE_AUTH=true \
  -e MONDAY_WEBHOOK_VERIFICATION_TOKEN="your-monday-token" \
  webhookproxy
```

### 3. Nginx Configuration

```nginx
# Add to your nginx.conf
location /monday-webhooks {
    proxy_pass http://webhookproxy:3000/monday-webhooks;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_cache_bypass $http_upgrade;
}
```

## Troubleshooting

### Common Issues

#### 1. Connection Failed
```
❌ Failed to create WebSocket connection
```
**Solutions:**
- Check if WebhookProxy server is running
- Verify server URL is correct
- Check firewall settings
- Ensure WebSocketSharp package is installed

#### 2. Webhook Not Received
```
⚠️ No webhooks received from Monday.com
```
**Solutions:**
- Verify Monday.com webhook URL is correct
- Check webhook is registered with correct slug
- Test webhook endpoint manually with curl
- Check Monday.com webhook logs

#### 3. JSON Parsing Errors
```
❌ Error processing WebSocket message
```
**Solutions:**
- Verify Newtonsoft.Json package is installed
- Check webhook payload format
- Add error handling for malformed JSON
- Enable debug logs to see raw message

#### 4. Unity Build Issues
```
WebSocket connection fails in build
```
**Solutions:**
- Use `wss://` for secure connections
- Configure CORS properly
- Test in WebGL build environment
- Handle platform-specific WebSocket implementations

### Debug Commands

```bash
# Check WebhookProxy server status
curl http://localhost:3000/api/status

# Test webhook endpoint
curl -X POST http://localhost:3000/monday-webhooks \
  -H "Content-Type: application/json" \
  -d '{"test": "data"}'

# View server logs
docker logs webhookproxy
```

## Best Practices

### 1. Security
- ✅ Always verify Monday.com webhook signatures
- ✅ Use HTTPS/WSS in production
- ✅ Implement rate limiting
- ✅ Validate all incoming data
- ✅ Use environment variables for secrets

### 2. Error Handling
- ✅ Implement comprehensive try-catch blocks
- ✅ Log all errors and warnings
- ✅ Handle network disconnections gracefully
- ✅ Implement retry mechanisms
- ✅ Provide user-friendly error messages

### 3. Performance
- ✅ Process webhooks asynchronously
- ✅ Implement webhook queuing for high volume
- ✅ Use object pooling for frequent allocations
- ✅ Monitor memory usage
- ✅ Implement cleanup routines

### 4. Monitoring
- ✅ Track webhook statistics
- ✅ Monitor connection status
- ✅ Log all webhook events
- ✅ Set up alerts for failures
- ✅ Monitor server performance

### 5. Testing
- ✅ Unit test webhook handlers
- ✅ Integration test with Monday.com
- ✅ Test error scenarios
- ✅ Performance test under load
- ✅ Test reconnection logic

## Example Use Cases

### 1. Project Management Dashboard
- Display real-time project updates
- Show task completion notifications
- Update progress bars automatically
- Alert on deadline changes

### 2. Team Collaboration Tool
- Sync team member activities
- Show real-time status updates
- Display notification badges
- Update shared resources

### 3. Analytics Dashboard
- Track project metrics in real-time
- Update charts and graphs
- Show performance indicators
- Display team productivity stats

### 4. Game Integration
- Update game state based on project progress
- Unlock features when tasks complete
- Show project status in-game UI
- Sync achievements with project milestones

## Support and Resources

### Documentation Links
- [WebhookProxy README](../README.md)
- [WebhookProxy Security Guide](../SECURITY.md)
- [Monday.com API Documentation](https://developer.monday.com/api-reference/docs)
- [Unity WebSocketSharp Documentation](https://github.com/sta/websocket-sharp)

### Community Support
- GitHub Issues: [WebhookProxy Issues](https://github.com/yourusername/webhookproxy/issues)
- Monday.com Developer Community
- Unity Forums

---

**Happy Webhooking! 🚀**

This integration allows you to build powerful real-time applications that respond instantly to changes in your Monday.com boards. The combination of WebhookProxy's reliability and Unity's flexibility creates endless possibilities for project management, team collaboration, and interactive dashboards.