# Feedback Widget Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                            │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │              Deployed Client React App                      │ │
│  │                                                              │ │
│  │  ┌────────────────────────────────────────────────────────┐│ │
│  │  │         Feedback Widget (Embedded)                     ││ │
│  │  │                                                         ││ │
│  │  │  [Floating Button] ──click──> [Modal]                 ││ │
│  │  │                                                         ││ │
│  │  │  Step 1: Screenshot Capture (html2canvas)             ││ │
│  │  │  Step 2: Annotation Editor (Canvas API)               ││ │
│  │  │  Step 3: Description Form + Metadata                  ││ │
│  │  │                                                         ││ │
│  │  │  ──submit──> FormData (screenshot + data)             ││ │
│  │  └────────────────────────────────────────────────────────┘│ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ POST /api/feedback
                              │ (multipart/form-data)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend API Server                          │
│                                                                   │
│  ┌──────────────────┐    ┌──────────────────┐                  │
│  │  Feedback API    │───>│ Storage Service  │                  │
│  │  Controller      │    │ (S3 or Local)    │                  │
│  └──────────────────┘    └──────────────────┘                  │
│           │                                                      │
│           ├──────────────> ┌──────────────────┐                │
│           │                │ Feedback Service │                 │
│           │                │ (Database CRUD)  │                 │
│           │                └──────────────────┘                 │
│           │                         │                            │
│           │                         ▼                            │
│           │                ┌──────────────────┐                 │
│           │                │   PostgreSQL     │                 │
│           │                │   (feedback      │                 │
│           │                │    table)        │                 │
│           │                └──────────────────┘                 │
│           │                                                      │
│           └──────────────> ┌──────────────────┐                │
│                            │  Jira Service    │                 │
│                            │  (Create Ticket) │                 │
│                            └──────────────────┘                 │
│                                     │                            │
└─────────────────────────────────────┼────────────────────────────┘
                                      │
                                      │ REST API
                                      ▼
                            ┌──────────────────┐
                            │   Jira Cloud     │
                            │   (Atlassian)    │
                            └──────────────────┘
```

## Component Architecture

### Frontend (Widget)

```
feedback-widget/
│
├── index.js (Entry Point)
│   └── FeedbackWidgetAPI Class
│       ├── init(config)
│       ├── destroy()
│       └── setupKeyboardShortcut()
│
├── FeedbackWidget.js (Main Component)
│   ├── State Management
│   │   ├── step (capture/annotate/describe/submitting/success)
│   │   ├── screenshot data
│   │   ├── annotation data
│   │   └── metadata
│   │
│   └── Components
│       ├── Modal
│       ├── ScreenshotCapture
│       └── AnnotationEditor
│
├── Components/
│   ├── Modal.jsx
│   │   └── Overlay + ESC handling
│   │
│   ├── ScreenshotCapture.jsx
│   │   ├── Capture viewport button
│   │   ├── Capture full page button
│   │   └── Error handling
│   │
│   └── AnnotationEditor.jsx
│       ├── Canvas drawing (tldraw)
│       ├── Tools (pen, arrow, rectangle, text)
│       ├── Description textarea with validation
│       └── Undo/Redo
│
└── Services/
    ├── screenshot.service.js
    │   ├── captureFullPage()
    │   ├── captureViewport()
    │   ├── canvasToBlob()
    │   └── blobToFile()
    │
    ├── metadata.service.js
    │   ├── collectMetadata()
    │   └── formatMetadataForDisplay()
    │
    └── api.service.js
        ├── submitFeedback()
        └── validateConfig()
```

## Data Flow

### 1. Initialization

```
Page Load
    │
    ├──> Load feedback-widget.min.js
    │
    ├──> FeedbackWidget.init({projectId, apiUrl})
    │
    ├──> Create React root
    │
    ├──> Render floating button
    │
    └──> Setup keyboard shortcut (Ctrl+Shift+F)
```

### 2. Screenshot Capture

```
User clicks button / presses Ctrl+Shift+F
    │
    ├──> Open modal (Step 1: Capture)
    │
    ├──> User selects capture type
    │
    ├──> Hide widget elements
    │
    ├──> html2canvas captures page
    │
    ├──> Show widget elements
    │
    ├──> Convert canvas to data URL
    │
    └──> Move to Step 2 (Annotate)
```

### 3. Annotation

```
Step 2: Annotate
    │
    ├──> Display screenshot on canvas
    │
    ├──> User selects tool (pen/arrow/rectangle/text)
    │
    ├──> User selects color
    │
    ├──> User draws on canvas
    │
    ├──> Save to history (for undo/redo)
    │
    ├──> User clicks "Next" or "Skip"
    │
    ├──> Convert canvas to blob
    │
    └──> Move to Step 3 (Describe)
```

### 4. Submission

```
Step 3: Describe
    │
    ├──> Display annotated screenshot
    │
    ├──> Collect metadata (browser, URL, etc.)
    │
    ├──> User enters description
    │
    ├──> Validate form (min 10 chars)
    │
    ├──> User clicks "Submit"
    │
    ├──> Create FormData
    │   ├── projectId
    │   ├── description
    │   ├── metadata (JSON)
    │   └── screenshot (File)
    │
    ├──> POST to /api/feedback
    │
    ├──> Backend processes
    │   ├── Save to database
    │   ├── Upload screenshot to storage
    │   └── Create Jira ticket
    │
    ├──> Receive response
    │   ├── feedbackId
    │   ├── jiraTicket
    │   └── jiraUrl
    │
    └──> Show success message
```

## Backend API Flow

```
POST /api/feedback
    │
    ├──> Multer middleware (parse multipart)
    │
    ├──> Feedback Controller
    │   │
    │   ├──> Validate request
    │   │   ├── projectId exists?
    │   │   ├── description valid?
    │   │   └── screenshot uploaded?
    │   │
    │   ├──> Storage Service
    │   │   ├── Upload to S3 / Local
    │   │   └── Get screenshot URL
    │   │
    │   ├──> Feedback Service
    │   │   ├── Create database record
    │   │   └── Return feedback ID
    │   │
    │   ├──> Jira Service
    │   │   ├── Create Jira ticket
    │   │   ├── Attach screenshot
    │   │   └── Return ticket key
    │   │
    │   └──> Return response
    │       ├── success: true
    │       ├── feedbackId
    │       ├── jiraTicket
    │       └── jiraUrl
    │
    └──> Response to frontend
```

## Database Schema

```sql
-- Feedback table
CREATE TABLE feedback (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES projects(id),
  
  -- Screenshot
  screenshot_url VARCHAR(1000),
  screenshot_size INTEGER,
  
  -- User input
  description TEXT NOT NULL,
  
  -- Metadata
  browser_info JSONB,
  screen_resolution VARCHAR(50),
  viewport_size VARCHAR(50),
  page_url TEXT,
  user_agent TEXT,
  
  -- Jira
  jira_ticket_key VARCHAR(50),
  jira_ticket_url VARCHAR(500),
  
  -- Status
  status VARCHAR(50) DEFAULT 'new',
  priority VARCHAR(50) DEFAULT 'medium',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## Build Process

```
Source Code (src/)
    │
    ├──> Webpack
    │   ├── Babel (JSX → JS)
    │   ├── CSS Loader
    │   └── Style Loader
    │
    ├──> Bundle as UMD
    │   ├── Library: FeedbackWidget
    │   ├── Target: umd
    │   └── Global: window.FeedbackWidget
    │
    └──> Output: dist/feedback-widget.min.js
```

## Deployment Flow

```
Developer
    │
    ├──> npm run build
    │
    ├──> dist/feedback-widget.min.js created
    │
    ├──> Copy to backend/public/
    │
    └──> Backend serves at /static/feedback-widget.min.js

User uploads React project
    │
    ├──> Backend extracts zip
    │
    ├──> npm install
    │
    ├──> npm run build
    │
    ├──> Inject widget script into index.html
    │   <script src="/static/feedback-widget.min.js"></script>
    │   <script>FeedbackWidget.init({...})</script>
    │
    ├──> Deploy to static hosting
    │
    └──> User visits deployed URL
        │
        └──> Widget loads and initializes
```

## Security Considerations

1. **CORS**: Widget must be served from same origin or with proper CORS headers
2. **XSS**: All user input is sanitized before display
3. **File Upload**: Screenshot size limited, file type validated
4. **API Authentication**: Backend validates projectId exists
5. **Rate Limiting**: Prevent spam submissions

## Performance Optimizations

1. **Lazy Loading**: Widget only loads when needed
2. **Code Splitting**: Could split annotation tools into separate chunk
3. **Image Compression**: Screenshots compressed before upload
4. **Caching**: Widget script cached with long TTL
5. **Debouncing**: Drawing events debounced for performance

## Browser Compatibility

```
Chrome 90+   ✅ Full support
Firefox 88+  ✅ Full support
Safari 14+   ✅ Full support
Edge 90+     ✅ Full support
IE 11        ❌ Not supported
```

## Dependencies

```
Production:
- react: ^18.2.0 (UI framework)
- react-dom: ^18.2.0 (DOM rendering)
- html2canvas: ^1.4.1 (Screenshot capture)
- tldraw: ^2.0.0 (Annotation tools)

Development:
- webpack: ^5.89.0 (Bundler)
- babel: ^7.23.0 (Transpiler)
- css-loader: ^6.8.1 (CSS processing)
- style-loader: ^3.3.3 (CSS injection)
```

## Error Handling

```
Widget Level:
├── Initialization errors → Console error + callback
├── Screenshot capture errors → User-friendly message
├── Annotation errors → Fallback to original screenshot
├── Validation errors → Inline form errors
└── Submission errors → Retry option + callback

Backend Level:
├── Invalid request → 400 Bad Request
├── Missing project → 404 Not Found
├── Upload failure → 500 Internal Server Error
├── Jira failure → Log error, still save feedback
└── Database error → 500 Internal Server Error
```

## Monitoring & Logging

```
Frontend:
├── Widget initialization
├── Screenshot capture success/failure
├── Annotation tool usage
├── Submission attempts
└── API errors

Backend:
├── Feedback submissions
├── Screenshot uploads
├── Jira ticket creation
├── Database operations
└── Error rates
```

---

This architecture provides a scalable, maintainable solution for collecting user feedback with screenshots and annotations.
