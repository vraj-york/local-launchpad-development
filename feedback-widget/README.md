# Feedback Widget

A complete screenshot annotation and feedback tool that can be embedded into any web application.

## Features

- 🎯 **Floating Button** - Non-intrusive button in bottom-right corner
- 📸 **Screenshot Capture** - Full page or visible area capture
- ✏️ **Professional Annotation Tools** - Powered by tldraw
  - Draw tool (freehand)
  - Arrow tool
  - Rectangle and ellipse shapes
  - Text annotations
  - Highlighter
  - Eraser
  - Pan and zoom
  - Undo/Redo
- 📝 **Feedback Form** - Description with metadata collection
- 🎫 **Jira Integration** - Automatic ticket creation
- ⌨️ **Keyboard Shortcuts** - Ctrl+Shift+F to open, plus tldraw shortcuts
- 📱 **Mobile Responsive** - Works on all devices
- 🎨 **Professional UI** - Clean, modern interface

## Installation

### Step 1: Install Dependencies

```bash
cd feedback-widget
npm install
```

### Step 2: Build the Widget

```bash
npm run build
```

This creates `dist/feedback-widget.min.js` (~400KB)

### Step 3: Development Mode

```bash
npm run dev
```

Or serve the test page:

```bash
npm run serve
```

Then open `http://localhost:9000/test.html`

## Usage

### Basic Integration

Add these scripts to your HTML:

```html
<script src="https://cdn.yourplatform.com/feedback-widget.min.js"></script>
<script>
  FeedbackWidget.init({
    projectId: 'your-project-id',
    apiUrl: 'https://api.yourplatform.com'
  });
</script>
```

### Advanced Configuration

```javascript
FeedbackWidget.init({
  // Required
  projectId: 'project-abc-123',
  apiUrl: 'https://api.yourplatform.com',
  
  // Optional
  position: 'bottom-right', // or 'bottom-left', 'top-right', 'top-left'
  theme: 'light', // or 'dark'
  
  // Callbacks
  onSuccess: (data) => {
    console.log('Feedback submitted:', data);
    // data.feedbackId, data.jiraTicket, data.jiraUrl
  },
  
  onError: (error) => {
    console.error('Submission failed:', error);
  }
});
```

## API Methods

```javascript
// Initialize widget
FeedbackWidget.init(config);

// Check if initialized
FeedbackWidget.isReady(); // returns boolean

// Get current config
FeedbackWidget.getConfig(); // returns config object

// Destroy widget
FeedbackWidget.destroy();
```

## Keyboard Shortcuts

- **Ctrl+Shift+F** (or Cmd+Shift+F on Mac) - Open feedback widget
- **Escape** - Close modal

### Annotation Shortcuts (tldraw)
- **V** - Select tool
- **D** - Draw tool
- **A** - Arrow tool
- **R** - Rectangle tool
- **E** - Ellipse tool
- **T** - Text tool
- **H** - Hand/Pan tool
- **Ctrl+Z** - Undo
- **Ctrl+Shift+Z** or **Ctrl+Y** - Redo
- **Delete** - Delete selected
- **Ctrl+C** - Copy
- **Ctrl+V** - Paste
- **Ctrl+D** - Duplicate

## Backend API Requirements

The widget expects a POST endpoint at `/api/feedback`:

### Request Format

```
POST /api/feedback
Content-Type: multipart/form-data

Fields:
- projectId: string
- description: string
- metadata: JSON string
- screenshot: File (PNG)
```

### Response Format

```json
{
  "success": true,
  "feedbackId": "uuid",
  "jiraTicket": "PROJ-123",
  "jiraUrl": "https://jira.atlassian.net/browse/PROJ-123",
  "message": "Feedback submitted successfully"
}
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

## File Structure

```
feedback-widget/
├── src/
│   ├── components/
│   │   ├── Modal.jsx
│   │   ├── ScreenshotCapture.jsx
│   │   └── AnnotationEditor.jsx
│   ├── services/
│   │   ├── api.service.js
│   │   ├── screenshot.service.js
│   │   └── metadata.service.js
│   ├── styles/
│   │   └── widget.css
│   ├── FeedbackWidget.js
│   └── index.js
├── public/
│   └── test.html
├── dist/
│   └── feedback-widget.min.js
├── package.json
├── webpack.config.js
└── README.md
```

## Development

### Build for Production

```bash
npm run build
```

### Watch Mode

```bash
npm run dev
```

### Test Locally

1. Build the widget: `npm run build`
2. Open `public/test.html` in a browser
3. Click the purple button or press Ctrl+Shift+F

## Deployment

### Option 1: CDN

Upload `dist/feedback-widget.min.js` to your CDN:

```html
<script src="https://cdn.yourplatform.com/feedback-widget.min.js"></script>
```

### Option 2: Self-Hosted

Serve the file from your backend:

```html
<script src="https://api.yourplatform.com/static/feedback-widget.min.js"></script>
```

### Option 3: Auto-Inject (Build System)

Inject into HTML during build:

```javascript
const html = originalHtml.replace(
  '</head>',
  `<script src="${CDN_URL}/feedback-widget.min.js"></script>
   <script>
     FeedbackWidget.init({
       projectId: '${projectId}',
       apiUrl: '${API_URL}'
     });
   </script>
   </head>`
);
```

## Troubleshooting

### Widget not appearing

- Check browser console for errors
- Verify script is loaded: `console.log(window.FeedbackWidget)`
- Ensure `init()` was called with valid config

### Screenshot capture fails

- Check for CORS issues with images
- Verify html2canvas is loaded
- Try capturing viewport instead of full page

### Submission fails

- Check network tab for API errors
- Verify backend endpoint is accessible
- Check CORS headers on backend

## License

MIT

## Support

For issues or questions, contact your platform administrator.
