# MVJ Attendance System

## Project structure

```text
project/
├── app.py                  # Flask backend with Firebase Admin, attendance APIs, and account request APIs
├── index.html              # Main login, dashboard, admin, and account request UI
├── script.js               # Frontend Firebase Auth, API calls, dashboard logic, and admin actions
├── style.css               # Application styling and responsive dashboard layout
├── requirements.txt        # Python dependencies for the Flask backend
├── Procfile                # Production start command for hosting platforms
├── .env.example            # Example environment variables for local/hosted configuration
├── .gitignore              # Files excluded from source control
├── serviceAcountkey.json   # Local Firebase service account key; keep private
└── README.md               # Project documentation
```

## Local setup

1. Create a virtual environment and install dependencies.
2. Copy `.env.example` to `.env`.
3. Set either `FIREBASE_SERVICE_ACCOUNT_PATH` or `FIREBASE_SERVICE_ACCOUNT_JSON`.
4. Run the backend:

```bash
python app.py
```

5. Open `index.html` with a local static server.

## Hosting checklist

- Set `FIREBASE_SERVICE_ACCOUNT_JSON` or upload the service account securely as a host secret.
- Set `ALLOWED_ORIGINS` to your deployed frontend URL.
- Use `gunicorn app:app` as the production start command.
- Test `GET /api/health` after deploy.

## Frontend API base

By default, the frontend uses the current site origin as its API base in hosted environments and `http://127.0.0.1:5000` when opened from local files.

If your frontend and backend are on different domains, override this in `index.html`:

```html
<script>
  window.APP_CONFIG = {
    apiBase: "https://your-backend-domain.com"
  };
</script>
```
