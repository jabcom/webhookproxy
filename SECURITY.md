# Security Guide

## Overview

MondayProxy implements comprehensive security measures to protect against common web vulnerabilities and attacks. This guide covers security features, configuration, and best practices.

## Security Features

### 🔐 Authentication & Authorization

#### **Admin Authentication**
- **JWT-based authentication** for admin access
- **Password-protected status page** access
- **Token expiration** (24 hours default)
- **Secure password storage** recommendations

#### **WebSocket Client Authentication**
- **Optional authentication** for WebSocket connections
- **Slug-based authorization** with whitelist support
- **Client permission tracking**

### 🛡️ Input Validation & Sanitization

#### **Request Validation**
- **Slug format validation** (alphanumeric, hyphens, underscores only)
- **Request size limits** (10MB default)
- **Method and URL validation**
- **Header sanitization** (removes dangerous headers)

#### **Injection Prevention**
- **XSS protection** with input pattern detection
- **Header injection prevention**
- **JSON injection protection**
- **Path traversal protection**

### 🚦 Rate Limiting & DDoS Protection

#### **Request Rate Limiting**
- **Per-IP request limits** (100 requests/minute default)
- **WebSocket connection limits** (10 connections/IP default)
- **Automatic cleanup** of rate limit data
- **Configurable limits** via environment variables

#### **Resource Protection**
- **Memory usage monitoring**
- **Connection tracking**
- **Request size limits**
- **Timeout protection**

### 🔒 Security Headers

#### **HTTP Security Headers**
```http
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
```

#### **CORS Configuration**
- **Configurable origins** (default: all)
- **Method restrictions**
- **Header restrictions**

## Configuration

### Environment Variables

```bash
# Authentication
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
REQUIRE_AUTH=true
ADMIN_PASSWORD=your-secure-admin-password

# Rate Limiting
ENABLE_RATE_LIMIT=true
MAX_CONNECTIONS_PER_IP=10
MAX_REQUESTS_PER_MINUTE=100

# Security
ALLOWED_ORIGINS=https://yourdomain.com,https://anotherdomain.com
SLUG_WHITELIST=api-service,webhook-handler,data-processor
MAX_REQUEST_SIZE=10485760  # 10MB in bytes

# CORS
ENABLE_CORS=true
```

### Security Configuration Object

```javascript
this.securityConfig = {
  jwtSecret: process.env.JWT_SECRET || 'default-secret',
  jwtExpiry: '24h',
  maxConnectionsPerIP: 10,
  maxRequestsPerMinute: 100,
  maxRequestSize: 10 * 1024 * 1024, // 10MB
  allowedOrigins: ['*'], // or specific domains
  requireAuth: false, // or true for production
  adminPassword: 'admin123', // CHANGE IN PRODUCTION!
  slugWhitelist: [], // empty = allow all
  enableRateLimit: true,
  enableCORS: true
};
```

## Security Endpoints

### Authentication Endpoint

```bash
# Login
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password": "your-admin-password"}'

# Response
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "24h"
}
```

### Protected Status Page

```bash
# Access status page with authentication
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:3000/status
```

## Security Best Practices

### 🔧 Production Deployment

#### **1. Environment Configuration**
```bash
# Required for production
export JWT_SECRET="$(openssl rand -base64 32)"
export ADMIN_PASSWORD="$(openssl rand -base64 16)"
export REQUIRE_AUTH="true"
export ENABLE_RATE_LIMIT="true"
export SLUG_WHITELIST="your-allowed-slugs"
```

#### **2. Network Security**
- **Use HTTPS/WSS** in production
- **Deploy behind reverse proxy** (nginx/Apache)
- **Use firewall rules** to restrict access
- **Enable SSL/TLS termination**

#### **3. Monitoring & Logging**
- **Monitor security logs** for suspicious activity
- **Set up alerts** for failed login attempts
- **Track rate limit violations**
- **Monitor memory usage**

### 🛠️ Development Security

#### **1. Secure Development**
```bash
# Use strong passwords in development
export ADMIN_PASSWORD="dev-secure-password-123"
export JWT_SECRET="dev-jwt-secret-key"

# Enable all security features
export REQUIRE_AUTH="true"
export ENABLE_RATE_LIMIT="true"
```

#### **2. Testing Security**
```bash
# Test rate limiting
for i in {1..150}; do curl http://localhost:3000/test-slug; done

# Test authentication
curl -X POST http://localhost:3000/auth/login \
  -d '{"password": "wrong-password"}'

# Test input validation
curl http://localhost:3000/../../../etc/passwd
```

## Security Monitoring

### Security Events Logged

| Event Type | Log Level | Description |
|------------|------------|-------------|
| **Failed Login** | `security` | Invalid admin password attempts |
| **Rate Limit Exceeded** | `security` | IP exceeded request limits |
| **Invalid Slug** | `security` | Malformed slug attempts |
| **Unauthorized Access** | `security` | Access to protected resources |
| **Large Request** | `security` | Request exceeding size limits |
| **Suspicious Input** | `security` | Potential injection attempts |

### Monitoring Commands

```bash
# Monitor security events
curl -s http://localhost:3000/api/status | jq '.logs[] | select(.level == "security")'

# Check rate limit status
curl -s http://localhost:3000/api/status | jq '.rateLimitTracker'

# Monitor memory usage
curl -s http://localhost:3000/api/status | jq '.memoryUsage'
```

## Threat Mitigation

### 🚨 Common Attacks & Protections

#### **1. DDoS Attacks**
- ✅ **Rate limiting** per IP
- ✅ **Connection limits**
- ✅ **Request size limits**
- ✅ **Automatic cleanup**

#### **2. Injection Attacks**
- ✅ **Input validation**
- ✅ **Header sanitization**
- ✅ **Pattern detection**
- ✅ **Request size limits**

#### **3. Authentication Bypass**
- ✅ **JWT token validation**
- ✅ **Password protection**
- ✅ **Token expiration**
- ✅ **Failed attempt logging**

#### **4. Information Disclosure**
- ✅ **Sanitized error messages**
- ✅ **Protected status page**
- ✅ **Secure logging**
- ✅ **Header filtering**

#### **5. Resource Exhaustion**
- ✅ **Memory management**
- ✅ **Connection limits**
- ✅ **Request timeouts**
- ✅ **Automatic cleanup**

## Security Checklist

### ✅ Pre-Production Checklist

- [ ] **Change default passwords**
- [ ] **Set strong JWT secret**
- [ ] **Enable authentication**
- [ ] **Configure rate limiting**
- [ ] **Set up slug whitelist**
- [ ] **Enable HTTPS/WSS**
- [ ] **Configure firewall rules**
- [ ] **Set up monitoring**
- [ ] **Test security features**
- [ ] **Review security logs**

### ✅ Production Monitoring

- [ ] **Monitor failed login attempts**
- [ ] **Track rate limit violations**
- [ ] **Watch memory usage**
- [ ] **Review security logs daily**
- [ ] **Update dependencies regularly**
- [ ] **Backup configuration securely**
- [ ] **Test incident response**

## Incident Response

### 🚨 Security Incident Procedures

#### **1. Detect**
- Monitor security logs
- Set up automated alerts
- Regular security audits

#### **2. Respond**
```bash
# Immediate response
# 1. Block suspicious IPs
iptables -A INPUT -s SUSPICIOUS_IP -j DROP

# 2. Increase rate limits temporarily
export MAX_REQUESTS_PER_MINUTE=10

# 3. Enable additional logging
export LOG_LEVEL=debug
```

#### **3. Recover**
- Analyze attack vectors
- Update security configuration
- Patch vulnerabilities
- Review and improve monitoring

## Security Updates

### Regular Maintenance

- **Update dependencies** monthly
- **Review security logs** weekly
- **Test security features** quarterly
- **Audit configuration** annually
- **Penetration testing** annually

### Dependency Security

```bash
# Check for vulnerabilities
npm audit

# Update dependencies
npm update

# Use security-focused packages
npm install --save helmet express-rate-limit
```

## Conclusion

MondayProxy provides comprehensive security features to protect against common web vulnerabilities. Proper configuration and monitoring are essential for maintaining security in production environments.

**Remember**: Security is an ongoing process, not a one-time setup. Regular monitoring, updates, and testing are crucial for maintaining a secure proxy server.