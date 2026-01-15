# Security Best Practices

This document outlines security considerations and best practices for Jette's AI App.

## Environment Variables & Secrets

### ✅ DO:
- Store all sensitive data in environment variables
- Use Google Secret Manager for production deployments
- Never commit `.env` files to version control
- Rotate API keys and secrets regularly
- Use strong, randomly generated SECRET_KEY values

### ❌ DON'T:
- Hardcode API keys or secrets in source code
- Share `.env` files via email or chat
- Use default or weak secret keys in production
- Log sensitive data (API keys, user data, tokens)

## Production Deployment

### Required Environment Variables:
- `SECRET_KEY`: Use a cryptographically strong random string
- `GEMINI_API_KEY`: Store in Google Secret Manager
- `FLASK_ENV`: Must be set to `production` (not `development`)

### Setting up Secret Manager:

```bash
# Create secrets
echo -n "your-secret-key" | gcloud secrets create flask-secret-key --data-file=-
echo -n "your-gemini-key" | gcloud secrets create gemini-api-key --data-file=-

# Grant access to Cloud Run service account
PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
SERVICE_ACCOUNT="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

gcloud secrets add-iam-policy-binding flask-secret-key \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

gcloud secrets add-iam-policy-binding gemini-api-key \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

# Deploy with secrets
gcloud run services update jettes-ai-app \
  --update-secrets SECRET_KEY=flask-secret-key:latest,GEMINI_API_KEY=gemini-api-key:latest
```

## Authentication

### Current Implementation:
- Optional Google OAuth authentication
- Session-based authentication with Flask sessions
- Configurable via `REQUIRE_AUTH` environment variable

### Recommendations:
- Enable authentication (`REQUIRE_AUTH=true`) for production
- Use HTTPS only (automatically enforced by Cloud Run)
- Implement rate limiting for public endpoints
- Consider adding CSRF protection for state-changing operations

## Data Privacy

### User Messages:
- User messages are sent to Google Gemini API
- Messages are NOT logged to prevent data leakage
- Session data is stored in signed cookies
- No persistent storage of chat history by default

### Compliance:
- Review Google Gemini terms of service
- Implement data retention policies as needed
- Add privacy policy if collecting user data
- Consider GDPR/CCPA requirements for your use case

## API Security

### Rate Limiting:
Consider implementing rate limiting to prevent abuse:

```python
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["200 per day", "50 per hour"]
)

@app.route('/api/chat', methods=['POST'])
@limiter.limit("30 per minute")
def chat():
    # ... existing code
```

### CORS:
If you need to allow cross-origin requests, use Flask-CORS:

```python
from flask_cors import CORS

# Only allow specific origins in production
CORS(app, origins=["https://yourdomain.com"])
```

## Dependency Security

### Regular Updates:
```bash
# Check for security vulnerabilities
pip install safety
safety check

# Update dependencies
pip install --upgrade -r requirements.txt
pip freeze > requirements.txt
```

### Known Vulnerabilities Fixed:
- **Gunicorn < 22.0.0**: HTTP Request/Response Smuggling vulnerability (CVE) - Fixed by upgrading to v22.0.0
  - Issue: Request smuggling leading to endpoint restriction bypass
  - Resolution: Updated requirements.txt to gunicorn==22.0.0

### Automated Scanning:
- GitHub Dependabot is recommended for automated dependency updates
- Enable GitHub security scanning in repository settings

## Container Security

### Docker Best Practices:
- ✅ Using slim base image (python:3.11-slim)
- ✅ Running as non-root user (Cloud Run default)
- ✅ No unnecessary packages installed
- ✅ Multi-stage builds not needed for this simple app

## Logging & Monitoring

### What to Log:
- Application errors and exceptions
- Health check failures
- Authentication attempts (success/failure)
- Rate limit violations

### What NOT to Log:
- User messages or chat content
- API keys or secrets
- Session tokens
- Personal identifiable information (PII)

### Cloud Run Logging:
```bash
# View logs
gcloud run services logs read jettes-ai-app --limit=50

# Monitor errors
gcloud run services logs read jettes-ai-app --filter="severity>=ERROR"
```

## Security Headers

Consider adding security headers to responses:

```python
@app.after_request
def set_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response
```

## Incident Response

### If API Keys are Compromised:
1. Immediately rotate the compromised key
2. Review access logs for unauthorized usage
3. Update all deployments with new keys
4. Investigate how the leak occurred

### If Application is Compromised:
1. Take the service offline if actively being exploited
2. Review Cloud Run logs for suspicious activity
3. Scan for vulnerabilities
4. Apply security patches
5. Redeploy with fixes

## Security Checklist for Production

- [ ] SECRET_KEY is strong and unique
- [ ] GEMINI_API_KEY stored in Secret Manager
- [ ] FLASK_ENV set to `production`
- [ ] Authentication enabled if needed
- [ ] HTTPS enforced (automatic with Cloud Run)
- [ ] Dependencies are up to date
- [ ] Security scanning enabled
- [ ] Logs configured and monitored
- [ ] Rate limiting implemented
- [ ] Privacy policy added if needed
- [ ] Incident response plan documented

## Reporting Security Issues

If you discover a security vulnerability:
1. **DO NOT** open a public issue
2. Email the maintainers privately
3. Provide detailed information about the vulnerability
4. Allow time for a fix before public disclosure

## Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Google Cloud Security Best Practices](https://cloud.google.com/security/best-practices)
- [Flask Security Considerations](https://flask.palletsprojects.com/en/2.3.x/security/)
- [Google Gemini API Documentation](https://ai.google.dev/docs)
