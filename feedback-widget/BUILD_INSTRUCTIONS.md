# Build Instructions for Feedback Widget

## Quick Start

### 1. Install Dependencies

```bash
cd feedback-widget
npm install
```

### 2. Build the Widget

```bash
npm run build
```

This will create `dist/feedback-widget.min.js`

### 3. Test Locally

Open `public/test.html` in your browser to test the widget.

## Development Workflow

### Watch Mode (Auto-rebuild on changes)

```bash
npm run dev
```

Keep this running while developing. It will automatically rebuild when you save files.

### Development Server

```bash
npm run serve
```

This starts a dev server at `http://localhost:9000` and opens the test page.

## Integration with Your Platform

### Step 1: Build the Widget

```bash
cd feedback-widget
npm run build
```

### Step 2: Copy to Backend

Copy the built file to your backend's static assets:

```bash
# Option A: Copy to backend public folder
cp dist/feedback-widget.min.js ../backend/public/

# Option B: Copy to a CDN folder
cp dist/feedback-widget.min.js /path/to/cdn/folder/
```

### Step 3: Serve the Widget

In your backend (Express.js example):

```javascript
// Serve static files
app.use('/static', express.static('public'));

// Widget will be available at:
// http://localhost:3000/static/feedback-widget.min.js
```

### Step 4: Auto-Inject into Client Projects

When building client React projects, inject the widget script:

```javascript
// In your build service
const injectFeedbackWidget = (htmlContent, projectId) => {
  const widgetScript = `
    <script src="${process.env.CDN_URL}/feedback-widget.min.js"></script>
    <script>
      FeedbackWidget.init({
        projectId: '${projectId}',
        apiUrl: '${process.env.API_URL}'
      });
    </script>
  `;
  
  return htmlContent.replace('</head>', `${widgetScript}</head>`);
};
```

## File Sizes

After building, check the bundle size:

```bash
ls -lh dist/
```

Target: < 500KB for the minified bundle

## Testing Checklist

Before deploying, test these scenarios:

- [ ] Widget button appears in bottom-right corner
- [ ] Clicking button opens modal
- [ ] Keyboard shortcut (Ctrl+Shift+F) works
- [ ] Screenshot capture (viewport) works
- [ ] Screenshot capture (full page) works
- [ ] Annotation tools work (pen, arrow, rectangle, text)
- [ ] Color picker works
- [ ] Undo/Redo works
- [ ] Description form validation works
- [ ] Metadata is collected correctly
- [ ] Submission to backend works
- [ ] Success message shows with Jira ticket
- [ ] Error handling works
- [ ] Mobile responsive design works
- [ ] Widget closes properly
- [ ] ESC key closes modal

## Troubleshooting

### Build Fails

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Widget Not Loading

1. Check browser console for errors
2. Verify script path is correct
3. Check CORS headers if loading from different domain

### Screenshot Capture Fails

- Check for CORS issues with images on the page
- Try viewport capture instead of full page
- Check browser console for html2canvas errors

## Production Deployment

### 1. Build for Production

```bash
NODE_ENV=production npm run build
```

### 2. Upload to CDN

```bash
# Example: AWS S3
aws s3 cp dist/feedback-widget.min.js s3://your-bucket/feedback-widget.min.js --acl public-read

# Example: Google Cloud Storage
gsutil cp dist/feedback-widget.min.js gs://your-bucket/feedback-widget.min.js
gsutil acl ch -u AllUsers:R gs://your-bucket/feedback-widget.min.js
```

### 3. Update Environment Variables

```bash
# In your backend .env
CDN_URL=https://cdn.yourplatform.com
API_URL=https://api.yourplatform.com
```

### 4. Test in Production

Visit a deployed project and verify:
- Widget loads
- Screenshot capture works
- Submission creates Jira ticket

## Updating the Widget

When you make changes:

1. Update code in `src/`
2. Run `npm run build`
3. Copy new `dist/feedback-widget.min.js` to CDN
4. Clear CDN cache if needed
5. Test on a deployed project

## Version Management

Update version in `package.json`:

```json
{
  "version": "1.0.1"
}
```

Consider versioned URLs for cache busting:

```
https://cdn.yourplatform.com/feedback-widget.v1.0.1.min.js
```

## Next Steps

After completing Phase 3, you should:

1. ✅ Have a working feedback widget
2. ✅ Be able to build and deploy it
3. ✅ Test it on a sample page

Next phases:
- **Phase 1**: Database setup
- **Phase 2**: Backend API implementation
- **Phase 4**: Admin dashboard
- **Phase 5**: Build system integration
