# Memory Management Guide

## Overview

WebhookProxy implements comprehensive memory management to prevent memory leaks and ensure long-term stability. This document outlines the memory management strategies and configuration options.

## Memory Leak Prevention

### 1. **Automatic Cleanup Intervals**

- **Regular Cleanup**: Every 60 seconds
- **Full Garbage Collection**: Every 5 minutes
- **Hourly Stats Aggregation**: Every hour
- **Daily Stats Aggregation**: Every 24 hours

### 2. **Data Retention Policies**

| Data Type | Retention Period | Max Items | Cleanup Strategy |
|-----------|------------------|-----------|------------------|
| **Logs** | 7 days | 1,000 entries | Age-based + count-based |
| **Response Times** | N/A | 100 samples | Rolling window |
| **Hourly Stats** | 30 days | Unlimited | Age-based |
| **Daily Stats** | 30 days | Unlimited | Age-based |
| **Pending Requests** | 5 minutes | Unlimited | Age-based |
| **WebSocket Clients** | N/A | Unlimited | Health check |

### 3. **Memory Monitoring**

The server tracks:
- Heap usage before/after GC
- Memory freed during cleanup
- Number of items cleaned
- Cleanup operation timing

## Configuration

### Memory Management Settings

```javascript
this.memoryConfig = {
  maxLogs: 1000,           // Maximum log entries in memory
  maxResponseTimes: 100,   // Maximum response time samples
  logRetentionDays: 7,     // Keep logs for 7 days
  statsRetentionDays: 30,  // Keep detailed stats for 30 days
  cleanupIntervalMs: 60000, // Cleanup every minute
  gcIntervalMs: 300000     // Full GC every 5 minutes
};
```

### Customizing Retention Periods

You can modify the retention periods by changing the configuration:

```javascript
// For production with high traffic
this.memoryConfig = {
  maxLogs: 5000,           // More logs for debugging
  maxResponseTimes: 500,   // More samples for better averages
  logRetentionDays: 3,     // Shorter retention for high volume
  statsRetentionDays: 7,   // Shorter stats retention
  cleanupIntervalMs: 30000, // More frequent cleanup
  gcIntervalMs: 120000     // More frequent GC
};

// For development with low traffic
this.memoryConfig = {
  maxLogs: 500,            // Fewer logs
  maxResponseTimes: 50,    // Fewer samples
  logRetentionDays: 14,    // Longer retention for debugging
  statsRetentionDays: 60,  // Longer stats retention
  cleanupIntervalMs: 120000, // Less frequent cleanup
  gcIntervalMs: 600000     // Less frequent GC
};
```

## Memory Usage Patterns

### Expected Memory Usage

| Component | Base Memory | Growth Rate | Max Memory |
|-----------|-------------|-------------|------------|
| **Core Server** | ~10MB | Static | ~10MB |
| **Logs (1000 entries)** | ~2MB | Linear | ~2MB |
| **Response Times (100)** | ~1KB | Linear | ~1KB |
| **Stats Maps** | ~1MB | Linear | ~5MB |
| **WebSocket Clients** | ~1KB per client | Linear | Variable |
| **Pending Requests** | ~1KB per request | Linear | Variable |

### Memory Leak Detection

Watch for these warning signs:
- **Increasing heap usage** over time without corresponding traffic
- **Growing pending requests** map
- **Accumulating dead WebSocket connections**
- **Unbounded log growth**

## Monitoring Commands

### Check Memory Usage

```bash
# Get current memory usage
curl http://localhost:3000/api/status | jq '.memoryUsage'

# Monitor memory over time
watch -n 5 'curl -s http://localhost:3000/api/status | jq ".memoryUsage.heapUsed / 1024 / 1024"'
```

### Force Garbage Collection

```bash
# Start server with GC enabled
node --expose-gc index.js

# The server will automatically use global.gc() if available
```

## Best Practices

### 1. **Production Deployment**

- Enable garbage collection: `node --expose-gc index.js`
- Monitor memory usage with external tools
- Set up alerts for memory growth
- Use shorter retention periods for high-traffic servers

### 2. **Development**

- Use longer retention periods for debugging
- Monitor logs for memory cleanup messages
- Test with high request volumes

### 3. **Docker Deployment**

```dockerfile
# Add memory limits
ENV NODE_OPTIONS="--max-old-space-size=512"

# Enable GC
CMD ["node", "--expose-gc", "index.js"]
```

### 4. **Monitoring Integration**

```javascript
// Add to your monitoring system
setInterval(() => {
  const memoryUsage = process.memoryUsage();
  console.log(`Memory: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
}, 30000);
```

## Troubleshooting

### High Memory Usage

1. **Check log volume**: Reduce `maxLogs` if needed
2. **Reduce retention**: Lower `logRetentionDays` and `statsRetentionDays`
3. **Increase cleanup frequency**: Lower `cleanupIntervalMs`
4. **Enable GC**: Start with `--expose-gc` flag

### Memory Leaks

1. **Check pending requests**: Look for stuck requests
2. **Monitor WebSocket connections**: Ensure proper cleanup
3. **Review custom code**: Check for unbounded arrays/objects
4. **Use heap profiler**: `node --inspect index.js`

### Performance Impact

- **Cleanup operations**: Typically <10ms
- **GC operations**: Typically <100ms
- **Memory overhead**: <1% of total memory
- **CPU impact**: <0.1% average

## Advanced Configuration

### Custom Cleanup Strategies

```javascript
// Add custom cleanup logic
performMemoryCleanup() {
  // Your custom cleanup code here
  this.customDataCleanup();
  
  // Call parent cleanup
  super.performMemoryCleanup();
}
```

### Memory Alerts

```javascript
// Add memory alerts
performFullGC() {
  const memoryUsage = process.memoryUsage();
  const heapUsedMB = memoryUsage.heapUsed / 1024 / 1024;
  
  if (heapUsedMB > 500) { // Alert if > 500MB
    console.warn(`[MEMORY] High memory usage: ${heapUsedMB}MB`);
    // Send alert to monitoring system
  }
  
  // Continue with normal GC
  super.performFullGC();
}
```

## Conclusion

The memory management system ensures MondayProxy can run indefinitely without memory leaks while maintaining useful statistics and logs. The configurable retention periods allow you to balance memory usage with debugging needs.

For production deployments, consider:
- Shorter retention periods
- More frequent cleanup
- External log storage
- Memory monitoring alerts
- Regular restarts during maintenance windows